import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monteCarlo } from '../montecarlo.ts'
import type { ClassCma } from '../cma.ts'
import { flatInflationCurve } from '../inflation.ts'

// ── helpers ──────────────────────────────────────────────────────────────────
const infl = flatInflationCurve(0.024) // unused by the sim (real-terms), but typed
const klass = (cls: string, r: number, vol: number, corr: number): ClassCma => ({
  class: cls,
  expectedReturn: r,
  low: r,
  high: r,
  vol,
  corr,
})
const cmaOf = (rows: Record<string, [r: number, vol: number, corr: number]>): Record<string, ClassCma> => {
  const out: Record<string, ClassCma> = {}
  for (const [c, [r, vol, corr]] of Object.entries(rows)) out[c] = klass(c, r, vol, corr)
  return out
}
const annualized = (multiple: number, years: number) => Math.pow(multiple, 1 / years) - 1

// ── Layer 1 acceptance tests (Ascent DOCS/MONTE-CARLO-MODEL-SPEC.md §4) ────────

test('median path compounds at the geometric CMA (no σ²/2 understatement)', () => {
  // Single lognormal asset (corr=1): median terminal = (1+g)^T exactly, in theory.
  // The OLD additive-normal model produced ~2.88%/yr here vs the 4.0% CMA — the bug.
  const g = 0.04
  const years = 30
  const r = monteCarlo(cmaOf({ us_equity: [g, 0.16, 1] }), infl, {
    initialWealth: 1,
    weights: { us_equity: 1 },
    horizonYears: years,
    sims: 40_000,
  })
  const medianCagr = annualized(r.terminal.p50, years)
  // Median must realize the CMA within Monte Carlo error (±0.3 pts); the old
  // 2.88% bug is ~1.1 pts low and would fail this hard.
  assert.ok(
    Math.abs(medianCagr - g) < 0.003,
    `median CAGR ${(medianCagr * 100).toFixed(2)}% should ≈ CMA ${(g * 100).toFixed(0)}%`,
  )
  // Analytic median terminal = 1.04^30 ≈ 3.243.
  assert.ok(Math.abs(r.terminal.p50 - Math.pow(1 + g, years)) / Math.pow(1 + g, years) < 0.04)
})

test('no artifact ruin: a no-withdrawal portfolio can never deplete (exp > 0)', () => {
  // All-crypto, high vol, NO withdrawals. Old additive-normal model wiped out ~76%
  // of paths via <−100% single-year draws; lognormal gross is always > 0.
  const r = monteCarlo(cmaOf({ crypto: [0.096, 0.7, 0.4] }), infl, {
    initialWealth: 1,
    weights: { crypto: 1 },
    horizonYears: 30,
    sims: 10_000,
  })
  assert.equal(r.successProbability, 1, 'survival must be 100% with no withdrawals')
  assert.ok(r.terminal.p10 > 0, 'even the 10th percentile stays positive')
})

test('terminal distribution is right-skewed (lognormal shape)', () => {
  const years = 30
  const r = monteCarlo(cmaOf({ us_equity: [0.04, 0.16, 1] }), infl, {
    initialWealth: 1,
    weights: { us_equity: 1 },
    horizonYears: years,
    sims: 40_000,
  })
  const upper = r.terminal.p90 - r.terminal.p50
  const lower = r.terminal.p50 - r.terminal.p10
  assert.ok(upper > lower, 'upside tail (p90−p50) should exceed downside (p50−p10)')
})

test('percentile bands are monotonically ordered', () => {
  const r = monteCarlo(cmaOf({ us_equity: [0.05, 0.16, 1], bonds: [0.02, 0.05, 0.15] }), infl, {
    initialWealth: 1_000_000,
    weights: { us_equity: 0.6, bonds: 0.4 },
    horizonYears: 20,
    sims: 8_000,
  })
  const t = r.terminal
  assert.ok(t.p01 <= t.p10 && t.p10 <= t.p25 && t.p25 <= t.p50 && t.p50 <= t.p75 && t.p75 <= t.p90)
})

test('deterministic: identical seed → identical result', () => {
  const params = {
    initialWealth: 1_000_000,
    weights: { us_equity: 0.6, bonds: 0.4 },
    horizonYears: 25,
    sims: 3_000,
  }
  const cma = cmaOf({ us_equity: [0.05, 0.16, 1], bonds: [0.02, 0.05, 0.15] })
  const a = monteCarlo(cma, infl, params)
  const b = monteCarlo(cma, infl, params)
  assert.equal(a.successProbability, b.successProbability)
  assert.deepEqual(a.bands, b.bands)
})

test('success probability is monotonic in withdrawal (solver requirement)', () => {
  const base = {
    initialWealth: 1_000_000,
    weights: { us_equity: 0.6, bonds: 0.4 },
    horizonYears: 30,
    retirementInYears: 0,
    sims: 4_000,
  }
  const cma = cmaOf({ us_equity: [0.05, 0.16, 1], bonds: [0.02, 0.05, 0.15] })
  const low = monteCarlo(cma, infl, { ...base, annualWithdrawal: 30_000 }).successProbability
  const mid = monteCarlo(cma, infl, { ...base, annualWithdrawal: 60_000 }).successProbability
  const high = monteCarlo(cma, infl, { ...base, annualWithdrawal: 120_000 }).successProbability
  assert.ok(low >= mid && mid >= high, `expected ${low} ≥ ${mid} ≥ ${high}`)
})

test('Layer 2: correlated safe assets barely diversify (bonds↔TIPS ≈ 0.8)', () => {
  // bonds and TIPS have similar means/vols and a real correlation of ~0.8, so a
  // 50/50 of them has almost the same dispersion as 100% bonds. Under the OLD
  // single-factor model their implied correlation was ~0.015 (near-independent),
  // which would shrink the 50/50 spread by ~1/√2 ≈ 0.71. This test distinguishes
  // the full-covariance model from the single-factor one.
  const cma = cmaOf({ bonds: [0.024, 0.05, 0.15], tips: [0.022, 0.05, 0.1] })
  const spread = (w: Record<string, number>) => {
    const t = monteCarlo(cma, infl, { initialWealth: 1, weights: w, horizonYears: 20, sims: 40_000 }).terminal
    return t.p90 - t.p10
  }
  const ratio = spread({ bonds: 0.5, tips: 0.5 }) / spread({ bonds: 1 })
  assert.ok(ratio > 0.85, `50/50 bonds/TIPS spread ratio ${ratio.toFixed(3)} should be ≈1 (highly correlated)`)
})

test('Layer 3: fat tails fatten the single-period DEEP tail (p01), not the p10 body', () => {
  // A unit-variance Student-t has a tighter body and fatter deep tails, so the
  // fattening shows at p01 — not p10 (where t is actually narrower). Read year-1
  // (single-period) where annual fat tails are undiluted by horizon averaging.
  const cma = cmaOf({ us_equity: [0.05, 0.16, 1] })
  const p = { initialWealth: 1, weights: { us_equity: 1 }, horizonYears: 5, sims: 80_000 }
  const gauss = monteCarlo(cma, infl, { ...p, studentDf: 0 }).bands[1]! // Gaussian, year 1
  const fat = monteCarlo(cma, infl, { ...p, studentDf: 5 }).bands[1]! // fat-tailed, year 1
  assert.ok(
    (gauss.p01 - fat.p01) / gauss.p01 > 0.02,
    `fat-tail p01 ${fat.p01.toFixed(3)} should be clearly below Gaussian ${gauss.p01.toFixed(3)}`,
  )
  // ...while the p10 body does NOT widen (t is tighter there) — the risk is deep.
  assert.ok(fat.p10 >= gauss.p10 * 0.99, 'p10 body should not be fatter under t (it is tighter)')
})

test('Layer 3: fat tails leave the median unbiased', () => {
  const cma = cmaOf({ us_equity: [0.05, 0.16, 1] })
  const p = { initialWealth: 1, weights: { us_equity: 1 }, horizonYears: 30, sims: 40_000 }
  const g = monteCarlo(cma, infl, { ...p, studentDf: 0 }).terminal.p50 // Gaussian
  const t = monteCarlo(cma, infl, { ...p, studentDf: 5 }).terminal.p50 // fat-tailed
  assert.ok(Math.abs(t - g) / g < 0.04, 'symmetric fat tails must not bias the central path')
})

test('Guyton-Klinger guardrails raise success vs a constant real withdrawal', () => {
  // Same base spend; the dynamic strategy cuts in bad markets, so it must survive
  // more often than rigid spending. (P1-E: guardrails are now simulated, not just shown.)
  const cma = cmaOf({ us_equity: [0.05, 0.16, 1], bonds: [0.024, 0.05, 0.15] })
  const base = {
    initialWealth: 1_000_000,
    weights: { us_equity: 0.6, bonds: 0.4 },
    retirementInYears: 0,
    horizonYears: 35,
    annualWithdrawal: 58_000, // ~5.8% — enough failure to leave room to improve
    sims: 12_000,
  }
  const constant = monteCarlo(cma, infl, base).successProbability
  const dynamic = monteCarlo(cma, infl, { ...base, guardrails: {} }).successProbability
  assert.ok(dynamic > constant, `guardrails ${dynamic.toFixed(3)} should beat constant ${constant.toFixed(3)}`)
})

test('engine responds to inputs: higher CMA → higher median', () => {
  const mk = (g: number) =>
    monteCarlo(cmaOf({ us_equity: [g, 0.16, 1] }), infl, {
      initialWealth: 1,
      weights: { us_equity: 1 },
      horizonYears: 25,
      sims: 8_000,
    }).terminal.p50
  assert.ok(mk(0.06) > mk(0.03))
})
