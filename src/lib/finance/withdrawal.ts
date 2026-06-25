import { monteCarlo } from './montecarlo'
import type { McParams } from './montecarlo'
import type { ClassCma } from './cma'
import type { InflationCurve } from './inflation'
import type { FilingStatus } from '../db'
import { standardDeduction, ordinaryTax, ltcgTax, marginalRate } from './taxtables'
import { DEFAULT_TAX_PARAMS } from './taxparams'
import type { TaxParams } from './taxparams'

/**
 * Withdrawal Planner. Three pieces, each grounded in an existing engine:
 *  1. solveMaxWithdrawal — the *inverse* of the Projection's Monte Carlo: success
 *     probability is monotonically decreasing in the spend, so binary-search the
 *     largest constant real withdrawal that still clears the confidence target.
 *  2. guytonKlingerGuardrails — the Guyton-Klinger (2006) decision rules: cut
 *     spending 10% if the withdrawal *rate* rises >20% above its initial level
 *     (capital-preservation), raise 10% if it falls >20% below (prosperity).
 *  3. taxAwareSourcing — meet a net spending need from taxable / tax-deferred /
 *     Roth in tax-efficient order, with correct progressive ordinary tax and
 *     stacked LTCG, grossed-up so the *net* delivered equals the need.
 * Decision-support, not tax advice (invariant #9).
 */

// ── 1. Max sustainable withdrawal ───────────────────────────────────────────────
export interface MaxWithdrawalInput {
  initialWealth: number
  weights: Record<string, number>
  retirementInYears: number
  horizonYears: number
  annualContribution?: number
  confidenceTarget: number // e.g. 0.85
  sims?: number
}

export interface MaxWithdrawalResult {
  withdrawal: number // max constant real annual spend (today's $)
  rate: number // withdrawal / initialWealth
  success: number // success probability at the solution
  feasible: boolean
}

export function solveMaxWithdrawal(
  cma: Record<string, ClassCma>,
  infl: InflationCurve,
  inp: MaxWithdrawalInput,
): MaxWithdrawalResult {
  const sims = inp.sims ?? 1500
  const base: Omit<McParams, 'annualWithdrawal'> = {
    initialWealth: inp.initialWealth,
    weights: inp.weights,
    retirementInYears: inp.retirementInYears,
    horizonYears: inp.horizonYears,
    annualContribution: inp.annualContribution ?? 0,
    sims,
  }
  const success = (w: number) => monteCarlo(cma, infl, { ...base, annualWithdrawal: w }).successProbability

  // Even $0 spend can't clear the bar only if the plan is failing for other reasons.
  if (success(0) < inp.confidenceTarget) return { withdrawal: 0, rate: 0, success: success(0), feasible: false }

  let lo = 0
  let hi = Math.max(1, inp.initialWealth) * 0.25 // generous upper bound on the rate
  let guard = 0
  while (success(hi) >= inp.confidenceTarget && guard++ < 8) hi *= 1.5 // push hi until it fails

  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2
    if (success(mid) >= inp.confidenceTarget) lo = mid
    else hi = mid
  }
  const withdrawal = lo
  return {
    withdrawal,
    rate: inp.initialWealth > 0 ? withdrawal / inp.initialWealth : 0,
    success: success(withdrawal),
    feasible: true,
  }
}

// ── 2. Guyton-Klinger guardrails ────────────────────────────────────────────────
export interface Guardrails {
  initialRate: number // withdrawal / portfolio now (the reference rate)
  trimPortfolio: number // portfolio level that triggers a 10% spending cut
  raisePortfolio: number // portfolio level that triggers a 10% spending raise
  spendIfTrim: number
  spendIfRaise: number
}

/**
 * GK rule: the upper guardrail is when the withdrawal rate exceeds 1.2× the
 * initial rate (→ cut 10%); the lower guardrail is 0.8× the initial rate
 * (→ raise 10%). Since rate = spend / portfolio, those map to portfolio levels
 * spend/(1.2·r0) = P/1.2 and spend/(0.8·r0) = P/0.8.
 */
export function guytonKlingerGuardrails(currentSpend: number, portfolio: number): Guardrails {
  const r0 = portfolio > 0 ? currentSpend / portfolio : 0
  return {
    initialRate: r0,
    trimPortfolio: portfolio / 1.2,
    raisePortfolio: portfolio / 0.8,
    spendIfTrim: currentSpend * 0.9,
    spendIfRaise: currentSpend * 1.1,
  }
}

// ── 3. Tax-aware sourcing ────────────────────────────────────────────────────────
export interface SourcingInput {
  netNeed: number // after-tax spending to deliver
  taxable: number // taxable account value
  gainFraction: number // fraction of taxable value that is unrealized gain (0–1)
  taxDeferred: number
  taxFree: number
  rmd: number // forced tax-deferred distribution this year (ordinary income)
  otherOrdinaryIncome: number // SS/pension/etc before withdrawals (gross)
  filing: FilingStatus
}

export type SourceBucket = 'rmd' | 'taxable' | 'tax_deferred' | 'roth'
export interface SourcingDraw {
  bucket: SourceBucket
  gross: number
  tax: number
  net: number
}
export interface SourcingResult {
  draws: SourcingDraw[]
  totalGross: number
  totalTax: number
  netDelivered: number
  unmet: number // need that no bucket could cover
  effectiveRate: number // totalTax / totalGross
  marginalOrdinaryRate: number // bracket the ordinary withdrawals reached
}

/** Binary-search a gross draw so that gross − tax(gross) = target net. */
function grossForNet(target: number, max: number, taxOfGross: (g: number) => number): number {
  if (target <= 0) return 0
  const netAt = (g: number) => g - taxOfGross(g)
  if (netAt(max) <= target) return max // can't fully cover — take all that's left
  let lo = target
  let hi = max
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (netAt(mid) < target) lo = mid
    else hi = mid
  }
  return hi
}

export function taxAwareSourcing(inp: SourcingInput, params: TaxParams = DEFAULT_TAX_PARAMS): SourcingResult {
  const stdDed = standardDeduction(inp.filing, params)
  const draws: SourcingDraw[] = []
  let remaining = inp.netNeed
  // Running gross ordinary income (other income + ordinary withdrawals), used to
  // stack each new ordinary dollar at the right marginal rate.
  let ordinaryGross = inp.otherOrdinaryIncome
  const ordTaxAt = (gross: number) => ordinaryTax(Math.max(0, gross - stdDed), inp.filing, params)
  const incrementalOrdTax = (add: number) => ordTaxAt(ordinaryGross + add) - ordTaxAt(ordinaryGross)

  // 1) RMD — forced out of tax-deferred regardless; ordinary income.
  if (inp.rmd > 0) {
    const tax = incrementalOrdTax(inp.rmd)
    const net = inp.rmd - tax
    draws.push({ bucket: 'rmd', gross: inp.rmd, tax, net })
    ordinaryGross += inp.rmd
    remaining -= net
  }
  remaining = Math.max(0, remaining)

  // 2) Taxable — only the gain fraction is taxed, at LTCG stacked on ordinary income.
  if (remaining > 0 && inp.taxable > 0) {
    const ordTaxable = Math.max(0, ordinaryGross - stdDed)
    const taxOfGross = (g: number) => ltcgTax(ordTaxable, g * inp.gainFraction, inp.filing, params)
    const gross = grossForNet(remaining, inp.taxable, taxOfGross)
    const tax = taxOfGross(gross)
    const net = gross - tax
    draws.push({ bucket: 'taxable', gross, tax, net })
    remaining -= net
  }

  // 3) Tax-deferred (beyond any RMD already taken) — ordinary income, grossed-up.
  const deferredLeft = Math.max(0, inp.taxDeferred - inp.rmd)
  if (remaining > 0 && deferredLeft > 0) {
    const gross = grossForNet(remaining, deferredLeft, incrementalOrdTax)
    const tax = incrementalOrdTax(gross)
    const net = gross - tax
    draws.push({ bucket: 'tax_deferred', gross, tax, net })
    ordinaryGross += gross
    remaining -= net
  }

  // 4) Roth — tax-free.
  if (remaining > 0 && inp.taxFree > 0) {
    const gross = Math.min(remaining, inp.taxFree)
    draws.push({ bucket: 'roth', gross, tax: 0, net: gross })
    remaining -= gross
  }

  const totalGross = draws.reduce((s, d) => s + d.gross, 0)
  const totalTax = draws.reduce((s, d) => s + d.tax, 0)
  const netDelivered = draws.reduce((s, d) => s + d.net, 0)
  return {
    draws,
    totalGross,
    totalTax,
    netDelivered,
    unmet: Math.max(0, remaining),
    effectiveRate: totalGross > 0 ? totalTax / totalGross : 0,
    marginalOrdinaryRate: marginalRate(Math.max(0, ordinaryGross - stdDed), inp.filing, params),
  }
}
