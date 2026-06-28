// refresh-etf-holdings — fund/ETF holdings → etf_holdings (service role write).
// Prefers FMP when an FMP_API_KEY is set; otherwise (or when FMP returns nothing)
// falls back to a KEYLESS Yahoo top-holdings source so look-through works with no
// paid key — mirroring refresh-quotes' keyless Yahoo NAV fallback. Browser →
// Supabase only; keys live in Supabase secrets (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TOP_N = 25 // top holdings by weight kept per ETF (look-through stays tractable)
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36'

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

/** Normalized constituent: weight is a FRACTION (0.065), not a percent. */
type Leg = { holding_symbol: string; holding_name: string | null; weight: number }

// ── FMP (preferred when a key is set) ─────────────────────────────────────────
// stable endpoint returns weightPercentage as a PERCENT (6.5 == 6.5%); legacy
// /api/v3/etf-holder uses asset/assetSymbol — read both spellings defensively.
type FmpHolding = {
  symbol?: string
  assetSymbol?: string
  asset?: string
  name?: string
  weightPercentage?: number | string | null
}
async function fmpHoldings(sym: string, key: string): Promise<Leg[] | null> {
  try {
    const r = await fetch(
      `https://financialmodelingprep.com/stable/etf/holdings?symbol=${encodeURIComponent(sym)}&apikey=${key}`,
    )
    if (!r.ok) return null
    const body = (await r.json()) as FmpHolding[]
    if (!Array.isArray(body) || body.length === 0) return null
    return body
      .map((h) => {
        const holding_symbol = (h.symbol ?? h.assetSymbol ?? '').toUpperCase()
        const holding_name = h.name ?? h.asset ?? null
        const pct = typeof h.weightPercentage === 'string' ? parseFloat(h.weightPercentage) : h.weightPercentage
        return { holding_symbol, holding_name, weight: pct == null || Number.isNaN(pct) ? null : pct / 100 }
      })
      .filter((h): h is Leg => !!h.holding_symbol && h.weight != null)
  } catch {
    return null
  }
}

// ── Yahoo keyless fallback (top ~10 holdings via the crumb flow) ───────────────
async function yahooSession(): Promise<{ cookie: string; crumb: string } | null> {
  try {
    const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } })
    const setCookies = r1.headers.getSetCookie?.() ?? []
    const cookie = setCookies.map((c) => c.split(';')[0]).join('; ')
    if (!cookie) return null
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': UA, Cookie: cookie },
    })
    if (!r2.ok) return null
    const crumb = (await r2.text()).trim()
    // A real crumb is a short opaque token; reject "Too Many Requests"/HTML/errors.
    if (!crumb || crumb.length > 24 || /[<\s]/.test(crumb)) return null
    return { cookie, crumb }
  } catch {
    return null
  }
}
async function yahooHoldings(sym: string, sess: { cookie: string; crumb: string }): Promise<Leg[] | null> {
  try {
    const url =
      `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}` +
      `?modules=topHoldings&crumb=${encodeURIComponent(sess.crumb)}`
    const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: sess.cookie } })
    if (!r.ok) return null
    const d = (await r.json()) as {
      quoteSummary?: {
        result?: {
          topHoldings?: { holdings?: { symbol?: string; holdingName?: string; holdingPercent?: { raw?: number } }[] }
        }[]
      }
    }
    const holdings = d.quoteSummary?.result?.[0]?.topHoldings?.holdings
    if (!Array.isArray(holdings) || holdings.length === 0) return null
    return holdings
      .map((h) => ({
        holding_symbol: (h.symbol ?? '').toUpperCase(),
        holding_name: h.holdingName ?? null,
        weight: h.holdingPercent?.raw ?? null, // already a fraction
      }))
      .filter((h): h is Leg => !!h.holding_symbol && h.weight != null)
  } catch {
    return null
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { etfs } = (await req.json()) as { etfs?: string[] }
    if (!etfs?.length) return json({ updated: 0 })

    const FMP = Deno.env.get('FMP_API_KEY')
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

    const today = new Date().toISOString().slice(0, 10) // yyyy-mm-dd
    const uniq = [...new Set(etfs.map((s) => s.toUpperCase()))]

    // Lazily establish a Yahoo session (cookie+crumb) only if/when we need it,
    // and reuse it across every symbol in this request.
    let sessLoaded = false
    let sess: { cookie: string; crumb: string } | null = null
    const getSess = async () => {
      if (!sessLoaded) {
        sessLoaded = true
        sess = await yahooSession()
      }
      return sess
    }

    let updated = 0
    let viaYahoo = 0
    for (const etf of uniq) {
      let legs: Leg[] | null = FMP ? await fmpHoldings(etf, FMP) : null
      if (!legs || legs.length === 0) {
        const s = await getSess()
        if (s) {
          legs = await yahooHoldings(etf, s)
          if (legs && legs.length) viaYahoo++
        }
      }
      if (!legs || legs.length === 0) continue

      const rows = legs
        .sort((a, b) => b.weight - a.weight)
        .slice(0, TOP_N)
        .map((h) => ({ etf_symbol: etf, holding_symbol: h.holding_symbol, holding_name: h.holding_name, weight: h.weight, asof: today }))

      // Replace the full set so stale holdings never accumulate.
      await admin.from('etf_holdings').delete().eq('etf_symbol', etf)
      const { error } = await admin.from('etf_holdings').insert(rows)
      if (!error) updated++
    }

    if (updated === 0) {
      return json({ updated: 0, error: 'No holdings resolved — Yahoo may be rate-limiting; set FMP_API_KEY for reliable look-through.' }, 502)
    }
    return json({ updated, viaYahoo })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
