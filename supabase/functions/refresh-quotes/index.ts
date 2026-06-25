// refresh-quotes — Finnhub equity/ETF quotes → quote_cache (service role write).
// Browser → Supabase only; the Finnhub key lives in Supabase secrets (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TTL_MS = 15 * 60 * 1000 // ~15-min cache (honest "real-time", never tick-by-tick)

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
    for (const sym of toFetch) {
      const r = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${FINNHUB}`,
      )
      if (!r.ok) continue
      const q = (await r.json()) as { c?: number; pc?: number }
      if (q.c == null || q.c === 0) continue // 0 = unknown symbol on Finnhub
      const { error } = await admin.from('quote_cache').upsert({
        symbol: sym,
        price: q.c,
        prev_close: q.pc ?? null,
        updated_at: new Date().toISOString(),
      })
      if (!error) updated++
    }

    return json({ updated, skipped: fresh.size })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
