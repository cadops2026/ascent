import type { ClassCma } from './cma'
import type { InflationCurve } from './inflation'

/**
 * Macro-context overlay (spec §2 — context, NOT a signal). The consensus from the
 * major houses enters only *structurally*, via the CMA engine + the inflation
 * curve — never as tactical sentiment, never as a forecast of the next year, never
 * an alert or a trade implication (invariants #5, #7, #8). This computes the
 * portfolio-weighted long-run expected return — REAL (the CMA inputs are real),
 * its consensus-dispersion band, and the implied nominal after horizon-matched
 * inflation — purely to frame the user's blend against the long run. Deliberately
 * sized to dampen reactivity: markets swing far more than this number, so the
 * thing to act on is exposure vs. target — not this.
 */
export interface MacroContext {
  /** Implied nominal return = real blend grossed up by horizon-matched inflation. */
  nominalReturn: number
  /** Weighted consensus expected REAL return of the current blend (the primary figure). */
  realReturn: number
  /** Consensus-dispersion band on the real blend (low/high houses). */
  low: number
  high: number
  /** Expected average annual inflation to the horizon. */
  inflationToHorizon: number
  /** Which inflation series the curve resolved to (EXPINF / breakeven / default). */
  inflationSource: string
}

export function macroContext(
  cma: Record<string, ClassCma>,
  weights: Record<string, number>,
  infl: InflationCurve,
  horizonYears: number,
): MacroContext | null {
  const classes = Object.keys(weights).filter((c) => cma[c] && (weights[c] ?? 0) > 0)
  const total = classes.reduce((s, c) => s + (weights[c] ?? 0), 0)
  if (total <= 0) return null

  let realReturn = 0
  let low = 0
  let high = 0
  for (const c of classes) {
    const w = (weights[c] ?? 0) / total
    const k = cma[c]!
    realReturn += w * k.expectedReturn // CMA expectedReturn is real
    low += w * k.low
    high += w * k.high
  }
  const inflationToHorizon = infl.rateForHorizon(Math.max(1, horizonYears))
  const nominalReturn = (1 + realReturn) * (1 + inflationToHorizon) - 1
  return { nominalReturn, realReturn, low, high, inflationToHorizon, inflationSource: infl.source }
}
