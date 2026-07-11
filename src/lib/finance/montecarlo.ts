import type { ClassCma } from './cma'
import type { InflationCurve } from './inflation'
import { buildCorrelationMatrix, cholesky } from './correlation'

/**
 * Monte Carlo wealth simulation — LOGNORMAL / geometric-Brownian returns
 * (Layer 1 of Ascent DOCS/MONTE-CARLO-MODEL-SPEC.md). Each class's annual gross
 * return is drawn lognormally as exp(muLog + sigLog·shock), with muLog = ln(1+g)
 * where g is the class's REAL geometric CMA. Anchoring the log-mean at ln(1+g)
 * makes the MEDIAN path compound at exactly the published CMA — no σ²/2
 * under-compounding (the classic error of feeding a geometric CMA in as the
 * arithmetic drift; cf. Kitces "volatility drag", Boldin's CAGR→AAGR fix). The
 * portfolio's gross return is the weighted average of the class gross returns
 * (annual rebalancing). Because exp(·) > 0, a single year can never return
 * ≤ −100%, so the old additive-normal "artifact ruin" is gone; only withdrawals
 * can deplete the portfolio.
 *
 * Cross-class correlation uses the FULL consensus correlation matrix via Cholesky
 * (Layer 2 — see ./correlation), not the old single-market-factor approximation
 * that understated safe-asset co-movement (bonds↔TIPS etc.).
 *
 * Returns are a MULTIVARIATE STUDENT-T (Layer 3): after correlating the shocks
 * (y = L·g) the whole vector is scaled by √((ν−2)/W) with ONE shared W ~ χ²_ν per
 * year (`studentDf`, default 6). The shared mixer fattens every marginal AND, because
 * a small W amplifies all assets together, produces the crisis correlation-spike /
 * tail dependence that plain-normal Monte Carlo misses (and which makes it understate
 * failure rates). Crypto additionally draws a class-specific Student-t(4) idiosyncratic
 * shock (invariant #12; crypto ordered last so its extra fat tail stays in its
 * marginal). The √ scaling is common to all assets, so it preserves both unit variance
 * and the correlation matrix exactly, and it leaves the MEDIAN at (1+g) — fat tails
 * widen the bands without biasing the central path.
 *
 * Works in REAL (today's dollars): the CMA per-class expected returns are
 * themselves real (after inflation), so the sim draws real returns directly — no
 * inflation deflation step. Contributions/withdrawals are in today's dollars and
 * stay constant in real terms, so the output bands are already in today's dollars
 * (invariants #2/#4). Inflation still drives nominal-denominated things elsewhere
 * (the macro readout, tax-bracket indexing) — just not real wealth growth here.
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
  /** Degrees of freedom for the shared multivariate-t fat-tail mixer. Default 5
   *  (research range 4–6). ≤2 disables it → Gaussian (used for baselining/tests). */
  studentDf?: number
  /** When set, retirement withdrawals follow Guyton-Klinger guardrails (DYNAMIC
   *  spending) instead of a constant real withdrawal: each retirement year, if the
   *  withdrawal rate rises above `upGuard`× its initial level cut spending by `cut`
   *  (capital preservation); if it falls below `downGuard`× raise it by `raise`
   *  (prosperity). Models the realistic strategy → higher success than rigid spend.
   *  Applies only to the simple two-phase mode (retirementInYears + annualWithdrawal),
   *  not the cashFlow path. Defaults: 1.2 / 0.8 / 0.10 / 0.10. */
  guardrails?: { upGuard?: number; downGuard?: number; cut?: number; raise?: number }
}

export interface McBand {
  year: number
  /** 1st-percentile (deep-tail / worst-case). Where the fat tails live — the
   *  p10–p90 body barely reflects them (a unit-variance t is tighter in the body). */
  p01: number
  p10: number
  p25: number
  p50: number
  p75: number
  p90: number
}
export interface McResult {
  bands: McBand[]
  successProbability: number
  terminal: { p01: number; p10: number; p25: number; p50: number; p75: number; p90: number }
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

/** Chi-square(df) = sum of df squared standard normals (df a positive integer). */
function chi2(rng: Rng, df: number): number {
  let s = 0
  for (let i = 0; i < df; i++) {
    const z = randn(rng)
    s += z * z
  }
  return s
}

function pctile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
  return sorted[idx]!
}

export function monteCarlo(
  cma: Record<string, ClassCma>,
  _infl: InflationCurve, // retained for call-site stability; the sim is real-terms (CMA is real)
  params: McParams,
): McResult {
  const sims = params.sims ?? 5000
  const years = Math.max(1, Math.round(params.horizonYears))
  const rng = mulberry32(params.seed ?? DEFAULT_SEED)

  // Crypto ordered last so its fat-tailed idiosyncratic shock stays in the crypto
  // marginal under the (lower-triangular) Cholesky factor below.
  const classes = Object.keys(params.weights)
    .filter((c) => cma[c] && (params.weights[c] ?? 0) > 0)
    .sort((a, b) => (a === 'crypto' ? 1 : 0) - (b === 'crypto' ? 1 : 0))
  const totalW = classes.reduce((s, c) => s + (params.weights[c] ?? 0), 0) || 1
  const w = classes.map((c) => (params.weights[c] ?? 0) / totalW)
  const mean = classes.map((c) => cma[c]!.expectedReturn)
  const vol = classes.map((c) => cma[c]!.vol)
  const corr = classes.map((c) => cma[c]!.corr)
  const isCrypto = classes.map((c) => c === 'crypto')

  // Lognormal (geometric-Brownian) parameters per class, in log space.
  //   g       = class REAL geometric CMA (floored at −95% to keep ln finite)
  //   muLog   = ln(1+g)                  → median annual gross = 1+g
  //   sigLog  = √(ln(1 + (σ/(1+g))²))    → log-vol matched to simple-return vol σ
  // Median path then compounds at exactly g; arithmetic mean = (1+g)·e^{σ_log²/2}−1
  // sits above g, as it should (the volatility-drag gap is now produced by the
  // sim, not double-counted into it). See MONTE-CARLO-MODEL-SPEC.md (Layer 1).
  const muLog = mean.map((g) => Math.log(1 + Math.max(-0.95, g)))
  const sigLog = vol.map((v, i) => {
    const gp = 1 + Math.max(-0.95, mean[i]!)
    return Math.sqrt(Math.log(1 + (v / gp) ** 2))
  })

  // Full cross-class correlation via Cholesky (Layer 2): correlated shocks z = L·g,
  // where g is the per-class independent unit-variance draw (Student-t for crypto,
  // normal otherwise). Since every g has unit variance, Cov(z) equals the correlation
  // matrix exactly — so the fat tail doesn't perturb the correlations. Replaces the
  // single-factor model (which understated safe-asset co-movement, e.g. bonds↔TIPS).
  const L = cholesky(buildCorrelationMatrix(classes, corr))
  const g = new Array<number>(classes.length)

  // Shared multivariate-t mixer (Layer 3): each year scale all correlated shocks by
  // √((ν−2)/W), W ~ χ²_ν. Common scale ⇒ preserves unit variance + correlation, fattens
  // every marginal, and small W ⇒ all assets crash together (tail dependence).
  const nu = Math.round(params.studentDf ?? 5)
  const useSharedT = nu > 2
  const tNum = Math.sqrt(nu - 2) // numerator of the per-year √((ν−2)/W) scale

  // Guyton-Klinger dynamic-withdrawal config (Layer P1-E). Active only in the simple
  // two-phase mode (no cashFlow); the reference rate is set per path at retirement.
  const gk = params.guardrails && !params.cashFlow
    ? {
        up: params.guardrails.upGuard ?? 1.2,
        down: params.guardrails.downGuard ?? 0.8,
        cut: params.guardrails.cut ?? 0.1,
        raise: params.guardrails.raise ?? 0.1,
      }
    : null

  const wealthByYear: number[][] = Array.from({ length: years + 1 }, () => new Array<number>(sims))
  let successes = 0
  const legacy = params.legacyTarget ?? 0

  for (let s = 0; s < sims; s++) {
    let wealth = params.initialWealth
    wealthByYear[0]![s] = wealth
    let ruined = false
    let curSpend = params.annualWithdrawal ?? 0 // running GK spend (real $)
    let refRate = 0 // initial withdrawal rate, set at retirement onset
    let refSet = false

    for (let y = 1; y <= years; y++) {
      // Independent unit-variance shocks, correlate via z = L·g, then apply the
      // shared multivariate-t scale (Layer 3) common to all classes this year.
      for (let i = 0; i < classes.length; i++) g[i] = isCrypto[i] ? randt(rng, 4) : randn(rng)
      const tScale = useSharedT ? tNum / Math.sqrt(chi2(rng, nu)) : 1
      let portGross = 0
      for (let i = 0; i < classes.length; i++) {
        let z = 0
        for (let k = 0; k <= i; k++) z += L[i]![k]! * g[k]!
        // Lognormal class gross return; portfolio gross = weighted avg (rebalanced).
        const gross = Math.exp(muLog[i]! + sigLog[i]! * z * tScale)
        portGross += w[i]! * gross
      }
      wealth = wealth * portGross
      if (params.cashFlow) {
        wealth += params.cashFlow(y)
      } else if (y <= (params.retirementInYears ?? 0)) {
        wealth += params.annualContribution ?? 0
      } else if (gk) {
        // Retirement year under Guyton-Klinger guardrails. Set the reference rate the
        // first year; thereafter adjust spending when the current rate breaches a guard.
        if (!refSet) {
          refRate = wealth > 0 ? curSpend / wealth : 0
          refSet = true
        } else {
          const rate = wealth > 0 ? curSpend / wealth : Infinity
          if (rate > gk.up * refRate) curSpend *= 1 - gk.cut
          else if (rate < gk.down * refRate) curSpend *= 1 + gk.raise
        }
        wealth -= curSpend
      } else {
        wealth -= params.annualWithdrawal ?? 0
      }
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
      p01: pctile(sorted, 0.01),
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
    terminal: { p01: term.p01, p10: term.p10, p25: term.p25, p50: term.p50, p75: term.p75, p90: term.p90 },
    sims,
  }
}
