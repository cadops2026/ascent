// refresh-inflation — Cleveland Fed model-based expected-inflation curve (FRED) → infl_expectations_cache.
// Browser → Supabase only; the FRED key lives in Supabase secrets (invariant #10). Single source of truth (#1, #2).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Cleveland Fed model-based expected inflation, horizons 1..30yr (EXPINF{n}YR).
const EXPINF_HORIZONS = Array.from({ length: 30 }, (_, i) => i + 1)

// Treasury breakeven inflation rates (market-implied), horizon → FRED series id.
const BREAKEVENS: { horizon: number; series: string }[] = [
  { horizon: 5, series: 'T5YIE' },
  { horizon: 10, series: 'T10YIE' },
  { horizon: 30, series: 'T30YIE' },
]

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

// Latest observation for a FRED series → { value (fraction), date } or null (missing/unavailable).
async function latestObservation(
  series: string,
  key: string,
): Promise<{ value: number; date: string } | null> {
  const r = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?series_id=${series}` +
      `&api_key=${key}&file_type=json&sort_order=desc&limit=1`,
  )
  if (!r.ok) return null
  const body = (await r.json()) as { observations?: { date?: string; value?: string }[] }
  const obs = body.observations?.[0]
  if (!obs?.value || obs.value === '.') return null // FRED's missing marker
  const pct = parseFloat(obs.value)
  if (!Number.isFinite(pct) || !obs.date) return null
  return { value: pct / 100, date: obs.date } // store as a FRACTION (2.34 → 0.0234)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const FRED = Deno.env.get('FRED_API_KEY')
    if (!FRED) return json({ error: 'FRED_API_KEY not set in Supabase secrets' }, 500)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    let updated = 0
    let skipped = 0

    for (const n of EXPINF_HORIZONS) {
      const obs = await latestObservation(`EXPINF${n}YR`, FRED)
      if (!obs) {
        skipped++
        continue
      }
      const { error } = await admin.from('infl_expectations_cache').upsert({
        source: 'EXPINF',
        horizon_years: n,
        value: obs.value,
        asof: obs.date,
      })
      if (!error) updated++
    }

    for (const { horizon, series } of BREAKEVENS) {
      const obs = await latestObservation(series, FRED)
      if (!obs) {
        skipped++
        continue
      }
      const { error } = await admin.from('infl_expectations_cache').upsert({
        source: 'breakeven',
        horizon_years: horizon,
        value: obs.value,
        asof: obs.date,
      })
      if (!error) updated++
    }

    return json({ updated, skipped })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
