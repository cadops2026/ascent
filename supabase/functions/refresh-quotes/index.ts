// refresh-quotes — Finnhub equity/ETF quotes → quote_cache (service role write).
// Mutual funds / money-market funds aren't on Finnhub, so symbols Finnhub can't
// price fall back to a keyless fund-NAV source (Yahoo chart endpoint). All calls
// are server-side; the browser only talks to Supabase (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

/** Keyless fund/NAV fallback for symbols Finnhub doesn't cover (mutual funds, MMFs). */
async function fundNav(sym: string): Promise<{ price: number; prevClose: number | null } | null> {
  try {
    const r = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
      { headers: { 'User-Agent': 'Mozilla/5.0' } },
    )
    if (!r.ok) return null
    const d = (await r.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number } }[] }
    }
    const meta = d.chart?.result?.[0]?.meta
    const price = meta?.regularMarketPrice
    if (price == null || price === 0) return null
    return { price, prevClose: meta?.chartPreviousClose ?? meta?.previousClose ?? null }
  } catch {
    return null
  }
}

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TTL_MS = 15 * 60 * 1000 // ~15-min cache (honest "real-time", never tick-by-tick)

// Class-share tickers print with a slash on brokerage statements (BRK/B), but the
// quote APIs each want their own separator: Finnhub uses a dot (BRK.B), Yahoo a
// hyphen (BRK-B). We normalize per-vendor for the request but cache under the
// ORIGINAL symbol so holdingValue's lookup (which keys on the stored symbol) matches.
const finnhubSym = (s: string) => s.replace(/\//g, '.')
const yahooSym = (s: string) => s.replace(/\//g, '-')

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { symbols } = (await req.json()) as { symbols?: string[] }
    if (!symbols?.length) return json({ updated: 0 })

    const FINNHUB = Deno.env.get('FINNHUB_API_KEY')
    if (!FINNHUB) return json({ error: 'FINNHUB_API_KEY not set in Supabase secrets' }, 500)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))]
    const { data: existing } = await admin
      .from('quote_cache')
      .select('symbol, updated_at')
      .in('symbol', uniq)

    const fresh = new Set(
      (existing ?? [])
        .filter((r) => Date.now() - new Date(r.updated_at).getTime() < TTL_MS)
        .map((r) => r.symbol),
    )
    const toFetch = uniq.filter((s) => !fresh.has(s))

    let updated = 0
    let viaFunds = 0
    for (const sym of toFetch) {
      let price: number | null = null
      let prevClose: number | null = null

      // 1) Finnhub — equities/ETFs.
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(finnhubSym(sym))}&token=${FINNHUB}`,
      )
      if (r.ok) {
        const q = (await r.json()) as { c?: number; pc?: number }
        if (q.c != null && q.c !== 0) {
          price = q.c
          prevClose = q.pc ?? null
        }
      }

      // 2) Fund-NAV fallback — mutual funds / money-market that Finnhub can't price.
      if (price == null) {
        const nav = await fundNav(yahooSym(sym))
        if (nav) {
          price = nav.price
          prevClose = nav.prevClose
          viaFunds++
        }
      }

      if (price == null) continue // genuinely unknown (bad ticker / unsupported)
      const { error } = await admin.from('quote_cache').upsert({
        symbol: sym,
        price,
        prev_close: prevClose,
        updated_at: new Date().toISOString(),
      })
      if (!error) updated++
    }

    return json({ updated, viaFunds, skipped: fresh.size })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
