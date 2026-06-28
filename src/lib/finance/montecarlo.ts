import type { ClassCma } from './cma'
import type { InflationCurve } from './inflation'

/**
 * Monte Carlo wealth simulation. Correlated class returns via a single market
 * factor (corr = each class's correlation to US equity); crypto's idiosyncratic
 * shock is Student-t (fat-tailed — invariant #12). Works in REAL (today's
 * dollars): each year's nominal return is deflated by that year's *forward*
 * inflation rate from the horizon-matched curve (invariant #2) — not the
 * average-to-horizon rate, which would mis-deflate on a sloped curve — so
 * contributions/withdrawals stay constant in real terms and the output bands
 * are already in today's dollars (invariant #4).
 */
export interface McParams {
  initialWealth: number
  weights: Record<string, number> // class -> weight (normalized internally)
  horizonYears: number // total years simulated (to plan-to age)
  /** Net real cash flow for a given year (+contribution / −withdrawal). When
   *  provided, it supersedes the simple retire/contribution/withdrawal fields —
   *  the glide-path uses this for multi-phase (work → downshift → drawdown). */
  cashFlow?: (year: number) => number
  retirementInYears?: number // contributions stop / withdrawals begin (simple two-phase)
  annualContribution?: number // today's $, each year pre-retirement
  annualWithdrawal?: number // today's $, each year post-retirement
  sims?: number
  legacyTarget?: number // success requires terminal >= this (default: just survive)
  seed?: number // PRNG seed; fixed by default so results are deterministic/stable
}

export interface McBand {
  year: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}
export interface McResult {
  bands: McBand[]
  successProbability: number
  terminal: { p10: number; p25: number; p50: number; p75: number; p90: number }
  sims: number
}

/**
 * Seeded PRNG (mulberry32). The simulation is SEEDED and therefore deterministic:
 * identical inputs always yield identical bands + success probability. That keeps
 * the hero number calm (it never wobbles between renders — invariant #6), keeps
 * the Dashboard and Projection in agreement, and makes success a *monotonic*
 * function of the solve variable so the glide-path / withdrawal binary searches
 * converge correctly (RNG noise would otherwise break their monotonicity).
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const DEFAULT_SEED = 0x9e3779b9

type Rng = () => number

function randn(rng: Rng): number {
  let u = 0
  let v = 0
  while (u === 0) u = rng()
  while (v === 0) v = rng()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/** Standardized Student-t (unit variance), df=4 → fat tails for crypto. */
function randt(rng: Rng, df = 4): number {
  let chi = 0
  for (let i = 0; i < df; i++) {
    const z = randn(rng)
    chi += z * z
  }
  const t = randn(rng) / Math.sqrt(chi / df)
  return t * Math.sqrt((df - 2) / df)
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]!
}

export function monteCarlo(
  cma: Record<string, ClassCma>,
  infl: InflationCurve,
  params: McParams,
): McResult {
  const sims = params.sims ?? 5000
  const years = Math.max(1, Math.round(params.horizonYears))
  const rng = mulberry32(params.seed ?? DEFAULT_SEED)

  const classes = Object.keys(params.weights).filter((c) => cma[c] && (params.weights[c] ?? 0) > 0)
  const totalW = classes.reduce((s, c) => s + (params.weights[c] ?? 0), 0) || 1
  const w = classes.map((c) => (params.weights[c] ?? 0) / totalW)
  const mean = classes.map((c) => cma[c]!.expectedReturn)
  const vol = classes.map((c) => cma[c]!.vol)
  const corr = classes.map((c) => cma[c]!.corr)
  const isCrypto = classes.map((c) => c === 'crypto')

  const wealthByYear: number[][] = Array.from({ length: years + 1 }, () => new Array<number>(sims))
  let successes = 0
  const legacy = params.legacyTarget ?? 0

  // The forward inflation rate for year y is identical across every sim — compute
  // it once per year instead of re-deriving it inside the inner loop (sims × years).
  const inflByYear = new Array<number>(years + 1)
  for (let y = 1; y <= years; y++) inflByYear[y] = infl.forwardRate(y)

  for (let s = 0; s < sims; s++) {
    let wealth = params.initialWealth
    wealthByYear[0]![s] = wealth
    let ruined = false

    for (let y = 1; y <= years; y++) {
      const annualInfl = inflByYear[y]!
      const F = randn(rng)
      let portRet = 0
      for (let i = 0; i < classes.length; i++) {
        const e = isCrypto[i] ? randt(rng, 4) : randn(rng)
        const c = corr[i]!
        const shock = c * F + Math.sqrt(1 - c * c) * e
        const nominal = mean[i]! + vol[i]! * shock
        const real = (1 + nominal) / (1 + annualInfl) - 1
        portRet += w[i]! * real
      }
      wealth = wealth * (1 + portRet)
      wealth += params.cashFlow
        ? params.cashFlow(y)
        : y <= (params.retirementInYears ?? 0)
          ? (params.annualContribution ?? 0)
          : -(params.annualWithdrawal ?? 0)
      if (wealth <= 0) {
        wealth = 0
        ruined = true
      }
      wealthByYear[y]![s] = wealth
    }

    const terminal = wealthByYear[years]![s]!
    if (!ruined && terminal >= legacy) successes++
  }

  const bands: McBand[] = []
  for (let y = 0; y <= years; y++) {
    const sorted = wealthByYear[y]!.slice().sort((a, b) => a - b)
    bands.push({
      year: y,
      p10: pctile(sorted, 0.1),
      p25: pctile(sorted, 0.25),
      p50: pctile(sorted, 0.5),
      p75: pctile(sorted, 0.75),
      p90: pctile(sorted, 0.9),
    })
  }
  const term = bands[years]!
  return {
    bands,
    successProbability: successes / sims,
    terminal: { p10: term.p10, p25: term.p25, p50: term.p50, p75: term.p75, p90: term.p90 },
    sims,
  }
}
