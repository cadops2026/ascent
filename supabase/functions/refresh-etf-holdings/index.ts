// refresh-etf-holdings — FMP ETF holdings → etf_holdings (service role write).
// Browser → Supabase only; the FMP key lives in Supabase secrets (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TOP_N = 25 // top holdings by weight kept per ETF (look-through stays tractable)

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// FMP stable ETF-holdings endpoint returns a flat array, e.g.:
//   [{ "symbol": "AAPL", "name": "Apple Inc", "weightPercentage": 6.5, ... }, ...]
// `weightPercentage` is a PERCENT value (6.5 == 6.5% of the fund), so we divide
// by 100 to store a fraction (0.065). Legacy `/api/v3/etf-holder/{sym}` uses
// `asset`/`assetSymbol` instead of `symbol`/`name`, so we read both spellings
// defensively before normalizing.
type FmpHolding = {
  symbol?: string
  assetSymbol?: string
  asset?: string
  name?: string
  weightPercentage?: number | string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { etfs } = (await req.json()) as { etfs?: string[] }
    if (!etfs?.length) return json({ updated: 0 })

    const FMP = Deno.env.get('FMP_API_KEY')
    if (!FMP) return json({ error: 'FMP_API_KEY not set in Supabase secrets' }, 500)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const today = new Date().toISOString().slice(0, 10) // yyyy-mm-dd
    const uniq = [...new Set(etfs.map((s) => s.toUpperCase()))]

    let updated = 0
    for (const etf of uniq) {
      const r = await fetch(
        `https://financialmodelingprep.com/stable/etf/holdings?symbol=${encodeURIComponent(etf)}&apikey=${FMP}`,
      )
      if (!r.ok) continue
      const body = (await r.json()) as FmpHolding[]
      if (!Array.isArray(body) || body.length === 0) continue

      const rows = body
        .map((h) => {
          const holding_symbol = (h.symbol ?? h.assetSymbol ?? '').toUpperCase()
          const holding_name = h.name ?? h.asset ?? null
          const pct = typeof h.weightPercentage === 'string'
            ? parseFloat(h.weightPercentage)
            : h.weightPercentage
          return { holding_symbol, holding_name, pct }
        })
        .filter((h) => h.holding_symbol && h.pct != null && !Number.isNaN(h.pct))
        .sort((a, b) => (b.pct as number) - (a.pct as number))
        .slice(0, TOP_N)
        .map((h) => ({
          etf_symbol: etf,
          holding_symbol: h.holding_symbol,
          holding_name: h.holding_name,
          weight: (h.pct as number) / 100, // percent → fraction (6.5 → 0.065)
          asof: today,
        }))
      if (rows.length === 0) continue

      // Replace the full set so stale holdings never accumulate.
      await admin.from('etf_holdings').delete().eq('etf_symbol', etf)
      const { error } = await admin.from('etf_holdings').insert(rows)
      if (!error) updated++
    }

    return json({ updated })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
