/**
 * Horizon-matched expected-inflation curve (invariant #2 — modules read this,
 * never hardcode inflation). Reads infl_expectations_cache rows; prefers live
 * Cleveland-Fed EXPINF, then breakevens, then the seeded default. Interpolates
 * linearly between horizon points.
 */
export interface InflRow {
  source: string
  horizon_years: number
  value: number | null // stored as a fraction (0.024 = 2.4%)
}

export interface InflationCurve {
  /** Expected average annual inflation to horizon h (years). */
  rateForHorizon: (h: number) => number
  source: string
}

const FALLBACK = 0.024

export function buildInflationCurve(rows: InflRow[]): InflationCurve {
  let chosen = 'default'
  for (const s of ['EXPINF', 'breakeven', 'default']) {
    if (rows.some((r) => r.source === s && r.value != null)) {
      chosen = s
      break
    }
  }
  const pts = rows
    .filter((r) => r.source === chosen && r.value != null)
    .map((r) => ({ h: r.horizon_years, v: r.value as number }))
    .sort((a, b) => a.h - b.h)

  const rateForHorizon = (h: number): number => {
    if (pts.length === 0) return FALLBACK
    const first = pts[0]!
    const last = pts[pts.length - 1]!
    if (h <= first.h) return first.v
    if (h >= last.h) return last.v
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      if (h >= a.h && h <= b.h) {
        const t = (h - a.h) / (b.h - a.h)
        return a.v + t * (b.v - a.v)
      }
    }
    return last.v
  }

  return { rateForHorizon, source: chosen }
}
