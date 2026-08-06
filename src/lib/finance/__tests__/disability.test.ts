import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  disabilityView,
  HUMAN_CAPITAL_REAL_DISCOUNT,
  HUMAN_CAPITAL_DISCOUNT_SPREAD,
  HUMAN_CAPITAL_REAL_INCOME_GROWTH,
} from '../disability.ts'
import type { DisabilityContext, DisabilityDetails } from '../disability.ts'
import type { InsurancePolicy } from '../../db.ts'

/** Minimal policy row — only the fields the engine reads. */
const policy = (kind: string, coverage: number, details: DisabilityDetails = {}, carrier = 'Test'): InsurancePolicy =>
  ({ id: `${kind}-${carrier}-${coverage}`, kind, coverage, carrier, details } as unknown as InsurancePolicy)

// A 40-year-old earning $500k gross, spending $180k, retiring at 60.
const ctx: DisabilityContext = {
  annualEarnedIncome: 500_000,
  effectiveTaxRate: 0.35,
  marginalRate: 0.4,
  annualSpending: 180_000,
  age: 40,
  retireAge: 60,
}

test('human capital is the PV of remaining after-tax earnings, banded by discount rate', () => {
  const v = disabilityView([], ctx)
  assert.equal(v.yearsToRetire, 20)

  // Hand-calc: after-tax $325,000/yr, growing 1% real, discounted 20 years.
  const afterTax = 500_000 * (1 - 0.35)
  assert.equal(afterTax, 325_000)
  const pv = (r: number) => {
    let s = 0
    for (let t = 1; t <= 20; t++) s += (afterTax * Math.pow(1 + HUMAN_CAPITAL_REAL_INCOME_GROWTH, t - 1)) / Math.pow(1 + r, t)
    return s
  }
  assert.ok(Math.abs(v.humanCapital.mid - pv(HUMAN_CAPITAL_REAL_DISCOUNT)) < 1e-6)
  assert.ok(Math.abs(v.humanCapital.low - pv(HUMAN_CAPITAL_REAL_DISCOUNT + HUMAN_CAPITAL_DISCOUNT_SPREAD)) < 1e-6)
  assert.ok(Math.abs(v.humanCapital.high - pv(HUMAN_CAPITAL_REAL_DISCOUNT - HUMAN_CAPITAL_DISCOUNT_SPREAD)) < 1e-6)

  // A higher discount rate must give a LOWER present value.
  assert.ok(v.humanCapital.low < v.humanCapital.mid)
  assert.ok(v.humanCapital.mid < v.humanCapital.high)
  // Sanity: ~$5.5M for a 20-year $325k after-tax stream at ~3% real.
  assert.ok(v.humanCapital.mid > 5_000_000 && v.humanCapital.mid < 6_000_000)
})

test('no policy while still working is a high-severity gap', () => {
  const v = disabilityView([], ctx)
  assert.equal(v.hasPolicies, false)
  assert.equal(v.status, 'gap')
  assert.equal(v.weakestDefinition, 'unknown')
  assert.ok(v.flags.some((f) => f.severity === 'high' && /no disability cover/i.test(f.title)))
})

test('a taxable group benefit is discounted at the marginal rate; a tax-free one is not', () => {
  const group = disabilityView(
    [policy('disability', 10_000, { group: true, benefit_tax: 'taxable', own_occ: 'any_occ' })],
    ctx,
  )
  // $10,000/mo taxed at 40% arrives as $6,000.
  assert.equal(group.grossMonthlyBenefit, 10_000)
  assert.equal(group.effectiveMonthlyBenefit, 6_000)

  const individual = disabilityView(
    [policy('disability', 10_000, { group: false, benefit_tax: 'tax_free', own_occ: 'specialty_own_occ' })],
    ctx,
  )
  assert.equal(individual.effectiveMonthlyBenefit, 10_000)
})

test('an unrecorded tax character on a group policy is assumed taxable, not flattering', () => {
  const v = disabilityView([policy('disability', 10_000, { group: true })], ctx)
  assert.equal(v.effectiveMonthlyBenefit, 6_000)
  assert.equal(v.policies[0]!.benefitTax, 'taxable')
})

test('gaps measure against the spending floor and the full-income target separately', () => {
  // $10k/mo tax-free vs $15k/mo spending and $27,083/mo after-tax income.
  const v = disabilityView([policy('disability', 10_000, { benefit_tax: 'tax_free', own_occ: 'own_occ' })], ctx)
  assert.equal(v.monthlySpending, 15_000)
  assert.ok(Math.abs(v.afterTaxIncomeMonthly - 325_000 / 12) < 1e-9)
  assert.equal(v.gapToSpending, 5_000)
  assert.ok(Math.abs(v.gapToIncome - (325_000 / 12 - 10_000)) < 1e-9)
  assert.ok(Math.abs(v.spendingCoverageRatio - 10_000 / 15_000) < 1e-9)
  assert.equal(v.status, 'gap')
})

test('clearing the spending floor with a weak definition is "review", not "covered"', () => {
  // Status separates the two failure modes: `gap` is a dollar shortfall,
  // `review` is a terms problem. Severity rides on the flag, not the status.
  const weak = disabilityView([policy('disability', 20_000, { benefit_tax: 'tax_free', own_occ: 'any_occ' })], ctx)
  assert.equal(weak.gapToSpending, 0)
  assert.equal(weak.status, 'review')
  assert.ok(weak.flags.some((f) => f.severity === 'high' && /any-occupation/i.test(f.title)))

  const unknownDef = disabilityView([policy('disability', 20_000, { benefit_tax: 'tax_free' })], ctx)
  assert.equal(unknownDef.status, 'review')

  const strong = disabilityView(
    [policy('disability', 20_000, { benefit_tax: 'tax_free', own_occ: 'specialty_own_occ', benefit_to_age: 65 })],
    ctx,
  )
  assert.equal(strong.status, 'covered')
})

test('shortfall severity scales with the size of the hole, not its existence', () => {
  // $14,800 effective against $15,000 spending — 99% covered. A near-miss must
  // not shout like a hole (invariant #6).
  const nearMiss = disabilityView(
    [
      policy('disability', 10_000, { group: true, benefit_tax: 'taxable', own_occ: 'own_occ', benefit_to_age: 65 }, 'Group'),
      policy('disability', 8_000, { benefit_tax: 'tax_free', own_occ: 'own_occ', benefit_to_age: 65 }, 'Individual'),
    ],
    ctx,
  )
  assert.equal(nearMiss.effectiveMonthlyBenefit, 10_000 * 0.6 + 8_000) // 14,000
  const nearFlag = nearMiss.flags.find((f) => /spending/i.test(f.title))!
  assert.equal(nearFlag.severity, 'caution')
  assert.match(nearFlag.title, /just short/)

  // Half covered is a real hole.
  const hole = disabilityView([policy('disability', 5_000, { benefit_tax: 'tax_free', own_occ: 'own_occ', benefit_to_age: 65 })], ctx)
  const holeFlag = hole.flags.find((f) => /spending/i.test(f.title))!
  assert.equal(holeFlag.severity, 'high')
  assert.match(holeFlag.title, /would not cover/)
})

test('the weakest definition across policies binds', () => {
  const v = disabilityView(
    [
      policy('disability', 8_000, { own_occ: 'specialty_own_occ', benefit_tax: 'tax_free' }, 'Individual'),
      policy('disability', 10_000, { own_occ: 'modified_own_occ', group: true }, 'Group LTD'),
    ],
    ctx,
  )
  assert.equal(v.weakestDefinition, 'modified_own_occ')
  assert.ok(v.flags.some((f) => /modified/i.test(f.title)))
})

test('a benefit period short of the working horizon is called out', () => {
  const v = disabilityView(
    [policy('disability', 20_000, { benefit_tax: 'tax_free', own_occ: 'own_occ', benefit_years: 5 })],
    ctx,
  )
  assert.equal(v.policies[0]!.benefitYearsFromNow, 5)
  assert.ok(v.policies[0]!.weaknesses.some((w) => /benefit period runs ~5 yrs/i.test(w)))

  // benefit_to_age converts against current age: to 65 for a 40-year-old = 25 yrs > 20 working years.
  const toAge = disabilityView(
    [policy('disability', 20_000, { benefit_tax: 'tax_free', own_occ: 'own_occ', benefit_to_age: 65 })],
    ctx,
  )
  assert.equal(toAge.policies[0]!.benefitYearsFromNow, 25)
  assert.ok(!toAge.policies[0]!.weaknesses.some((w) => /benefit period runs/i.test(w)))
})

test('all-group cover raises the portability flag', () => {
  const v = disabilityView(
    [policy('disability', 25_000, { group: true, benefit_tax: 'tax_free', own_occ: 'own_occ', benefit_to_age: 65 })],
    ctx,
  )
  assert.ok(v.flags.some((f) => /all cover is employer group/i.test(f.title)))
})

test('past the working horizon the readout is n/a and raises nothing', () => {
  const retired = disabilityView([], { ...ctx, age: 70, annualEarnedIncome: 0 })
  assert.equal(retired.status, 'n/a')
  assert.equal(retired.flags.length, 0)
  assert.equal(retired.humanCapital.mid, 0)
})

test('non-disability policies are ignored', () => {
  const v = disabilityView(
    [policy('term_life', 2_000_000), policy('umbrella', 5_000_000), policy('malpractice', 1_000_000)],
    ctx,
  )
  assert.equal(v.hasPolicies, false)
  assert.equal(v.grossMonthlyBenefit, 0)
})
