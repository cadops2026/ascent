// refresh-dividends — trailing dividend yield per symbol → dividend_cache.
// Feeds the asset-location view (what belongs in taxable vs tax-deferred).
//
// Finnhub first, as chosen; but Finnhub covers common stocks and ETFs and NOT
// mutual funds, so anything it can't price falls back to computing the yield
// from Yahoo's actual dividend events — the same keyless source refresh-quotes
// already uses for fund NAVs. Browser → Supabase only (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

const TTL_MS = 24 * 60 * 60 * 1000 // yields move slowly; a day is plenty

// Same per-vendor separator normalization as refresh-quotes (BRK/B).
const finnhubSym = (s: string) => s.replace(/\//g, '.')
const yahooSym = (s: string) => s.replace(/\//g, '-')

interface Yield {
  trailing: number
  annual: number
  source: string
}

/** Finnhub's indicated annual yield, as a percent figure (e.g. 1.02 = 1.02%). */
async function finnhubYield(sym: string, token: string): Promise<Yield | null> {
  try {
    const r = await fetch(
      `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(finnhubSym(sym))}&metric=all&token=${token}`,
    )
    if (!r.ok) return null
    const d = (await r.json()) as {
      metric?: { dividendYieldIndicatedAnnual?: number; dividendPerShareAnnual?: number }
    }
    const pct = d.metric?.dividendYieldIndicatedAnnual
    if (pct == null || !Number.isFinite(pct)) return null
    return {
      trailing: pct / 100, // vendor reports percent; we store a fraction
      annual: d.metric?.dividendPerShareAnnual ?? 0,
      source: 'finnhub',
    }
  } catch {
    return null
  }
}

/** Trailing 12-month yield from ACTUAL distributions ÷ current price. Works for
 *  mutual funds, which Finnhub does not cover. */
async function yahooYield(sym: string): Promise<Yield | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym(sym))}?interval=1d&range=1y&events=div`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    if (!r.ok) return null
    const d = (await r.json()) as {
      chart?: {
        result?: {
          meta?: { regularMarketPrice?: number }
          events?: { dividends?: Record<string, { amount?: number }> }
        }[]
      }
    }
    const res = d.chart?.result?.[0]
    const price = res?.meta?.regularMarketPrice
    if (price == null || price <= 0) return null
    // No dividends in 12 months is a REAL answer (yield 0), not a failure —
    // that's exactly the tax-efficient case this feature is looking for.
    const divs = res?.events?.dividends ?? {}
    const annual = Object.values(divs).reduce((s, v) => s + (v.amount ?? 0), 0)
    return { trailing: annual / price, annual, source: 'yahoo' }
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { symbols } = (await req.json()) as { symbols?: string[] }
    if (!symbols?.length) return json({ updated: 0 })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const FINNHUB = Deno.env.get('FINNHUB_API_KEY')

    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))]
    const { data: existing } = await admin
      .from('dividend_cache')
      .select('symbol, updated_at')
      .in('symbol', uniq)
    const fresh = new Set(
      (existing ?? [])
        .filter((r) => Date.now() - new Date(r.updated_at).getTime() < TTL_MS)
        .map((r) => r.symbol),
    )
    const toFetch = uniq.filter((s) => !fresh.has(s))

    let updated = 0
    let viaFallback = 0
    const missing: string[] = []

    for (const sym of toFetch) {
      let y: Yield | null = FINNHUB ? await finnhubYield(sym, FINNHUB) : null
      if (!y) {
        y = await yahooYield(sym)
        if (y) viaFallback++
      }
      if (!y) {
        missing.push(sym)
        continue
      }
      const { error } = await admin.from('dividend_cache').upsert({
        symbol: sym,
        trailing_yield: y.trailing,
        annual_amount: y.annual,
        source: y.source,
        updated_at: new Date().toISOString(),
      })
      if (!error) updated++
    }

    return json({ updated, viaFallback, skipped: fresh.size, missing })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
