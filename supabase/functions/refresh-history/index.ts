// refresh-history — daily closes for benchmark symbols → price_history.
// Feeds the alpha engine, which needs each benchmark's price on the date a
// holding was acquired. Keyless Yahoo chart endpoint (the same source
// refresh-quotes already falls back to for fund NAVs). Browser → Supabase
// only (invariant #10).
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

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Split-adjusted daily closes in [from, now]. Deliberately NOT adjclose — see
 *  the migration comment: holdings' returns are price-only, so benchmarks must
 *  be too, or every holding would show a spurious dividend-sized alpha gap. */
async function dailyCloses(sym: string, fromMs: number) {
  const p1 = Math.floor(fromMs / 1000)
  const p2 = Math.floor(Date.now() / 1000)
  const r = await fetch(
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}` +
      `?period1=${p1}&period2=${p2}&interval=1d`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } },
  )
  if (!r.ok) return null
  const d = (await r.json()) as {
    chart?: {
      result?: {
        timestamp?: number[]
        indicators?: { quote?: { close?: (number | null)[] }[] }
      }[]
    }
  }
  const res = d.chart?.result?.[0]
  const ts = res?.timestamp
  const closes = res?.indicators?.quote?.[0]?.close
  if (!ts?.length || !closes?.length) return null

  const rows: { on_date: string; close: number }[] = []
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i]
    if (c == null || !Number.isFinite(c)) continue // market holiday / gap
    rows.push({ on_date: isoDay(ts[i]! * 1000), close: c })
  }
  return rows
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { symbols, since } = (await req.json()) as { symbols?: string[]; since?: string }
    if (!symbols?.length || !since) return json({ updated: 0 })

    const sinceMs = Date.parse(since)
    if (!Number.isFinite(sinceMs)) return json({ error: 'bad `since` date' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))]
    let updated = 0
    const missing: string[] = []

    for (const sym of uniq) {
      // Incremental: only fetch forward of what we already have, unless our
      // coverage starts later than the caller needs (a newly-added older lot).
      const [{ data: newest }, { data: oldest }] = await Promise.all([
        admin.from('price_history').select('on_date').eq('symbol', sym)
          .order('on_date', { ascending: false }).limit(1).maybeSingle(),
        admin.from('price_history').select('on_date').eq('symbol', sym)
          .order('on_date', { ascending: true }).limit(1).maybeSingle(),
      ])

      const haveFrom = oldest ? Date.parse(oldest.on_date) : null
      const haveTo = newest ? Date.parse(newest.on_date) : null
      const needsBackfill = haveFrom == null || haveFrom > sinceMs
      // Up to date through the last close already — nothing to do.
      if (!needsBackfill && haveTo != null && Date.now() - haveTo < DAY_MS) continue

      const from = needsBackfill ? sinceMs : (haveTo ?? sinceMs)
      const rows = await dailyCloses(sym, from - 7 * DAY_MS) // pad: `since` may be a weekend
      if (!rows?.length) {
        missing.push(sym)
        continue
      }

      // Chunked upsert — a decade of daily closes is a few thousand rows.
      for (let i = 0; i < rows.length; i += 1000) {
        const chunk = rows.slice(i, i + 1000).map((r) => ({ symbol: sym, ...r }))
        const { error } = await admin.from('price_history').upsert(chunk)
        if (!error) updated += chunk.length
      }
    }

    return json({ updated, missing })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
