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
  /** Expected *average* annual inflation from today to horizon h (years).
   *  Use this to deflate a single end-of-horizon value. */
  rateForHorizon: (h: number) => number
  /** Expected *forward* (marginal) one-year inflation rate applying during
   *  year y (y ≥ 1, i.e. from year y−1 to year y), implied by the average curve.
   *  Use this for year-by-year real deflation in a multi-period simulation —
   *  deflating each year by the average-to-that-year (rateForHorizon) would be
   *  wrong on a sloped curve. By construction ∏_{y=1..H}(1+forwardRate(y)) =
   *  (1+rateForHorizon(H))^H, so cumulative real wealth stays exact (invariant #2). */
  forwardRate: (y: number) => number
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

  // Forward one-year rate for year y from the cumulative inflation factors:
  //   C(k) = (1 + rateForHorizon(k))^k,  forward(y) = C(y)/C(y-1) − 1.
  // C(0) = 1, so forward(1) = rateForHorizon(1); for a flat curve every
  // forward equals the average (no change vs. deflating by the average).
  const cumFactor = (k: number): number => Math.pow(1 + rateForHorizon(k), k)
  const forwardRate = (y: number): number => {
    const yr = Math.max(1, Math.round(y))
    return cumFactor(yr) / cumFactor(yr - 1) - 1
  }

  return { rateForHorizon, forwardRate, source: chosen }
}
