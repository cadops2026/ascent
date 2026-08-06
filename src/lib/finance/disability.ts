import type { InsurancePolicy } from '../db'
import type { AlertSeverity } from './alertengine'
import type { GapStatus } from './insurance'

/**
 * Own-occupation income protection — the readout a high-earning professional
 * actually needs, and the one a presence-based "do you have disability cover?"
 * check misses entirely.
 *
 * For someone whose wealth is still mostly *unearned* — a large future income
 * stream rather than a large portfolio — the disability policy is the asset that
 * protects the plan. Three things decide whether it does, and none of them are
 * the coverage amount:
 *
 *  1. **Definition.** A specialty own-occupation policy pays when you can no
 *     longer perform your own specialty, even if you go earn a living another
 *     way. An "any-occupation" policy pays only if you cannot do *any* job you
 *     are reasonably suited for — so a career-ending injury that leaves you
 *     employable elsewhere pays nothing.
 *  2. **Tax character.** Benefits from employer-paid group premiums are taxable;
 *     benefits from an individually-owned policy paid with after-tax dollars are
 *     received tax-free. A headline group benefit is worth materially less than
 *     the same number on an individual policy.
 *  3. **Duration.** A benefit period that ends after a few years does not insure
 *     a career; it insures a gap.
 *
 * Exposure-and-gaps only (invariant #9): this models what is and is not covered
 * and prompts the professional conversation. It never recommends a product,
 * carrier, or amount. Every projected figure carries a band (invariant #4).
 */

/** Definition of disability, strongest → weakest. */
export const OWN_OCC_TIERS = [
  'specialty_own_occ',
  'own_occ',
  'modified_own_occ',
  'any_occ',
  'unknown',
] as const
export type OwnOccTier = (typeof OWN_OCC_TIERS)[number]

export const OWN_OCC_LABEL: Record<OwnOccTier, string> = {
  specialty_own_occ: 'Specialty own-occupation',
  own_occ: 'True own-occupation',
  modified_own_occ: 'Modified / transitional own-occ',
  any_occ: 'Any-occupation',
  unknown: 'Not recorded',
}

export const OWN_OCC_NOTE: Record<OwnOccTier, string> = {
  specialty_own_occ:
    'Pays if you cannot perform your own specialty, even if you work in another field or another specialty.',
  own_occ: 'Pays if you cannot perform your own occupation, even while working elsewhere.',
  modified_own_occ:
    'Pays only while you are NOT working in another occupation — taking other work can end the benefit.',
  any_occ:
    'Pays only if you cannot perform ANY occupation you are reasonably suited for — the weakest definition.',
  unknown: 'Definition unrecorded — the single most important term to confirm on the policy.',
}

/** Strength ranking used to find the weakest link across policies. */
const OWN_OCC_RANK: Record<OwnOccTier, number> = {
  specialty_own_occ: 4,
  own_occ: 3,
  modified_own_occ: 2,
  any_occ: 1,
  unknown: 0,
}

/** How the benefit is taxed when it pays. */
export const BENEFIT_TAX_KINDS = ['tax_free', 'taxable', 'unknown'] as const
export type BenefitTaxKind = (typeof BENEFIT_TAX_KINDS)[number]

export const BENEFIT_TAX_LABEL: Record<BenefitTaxKind, string> = {
  tax_free: 'Tax-free (after-tax premiums)',
  taxable: 'Taxable (employer-paid premiums)',
  unknown: 'Not recorded',
}

/**
 * Qualitative policy terms, stored on `insurance_policies.details` (jsonb).
 * For a disability policy the `coverage` column is read as the MONTHLY benefit.
 */
export interface DisabilityDetails {
  own_occ?: OwnOccTier
  benefit_tax?: BenefitTaxKind
  /** Employer group LTD (vs an individually-owned policy). */
  group?: boolean
  /** Benefits payable to this age (e.g. 65 or 67). */
  benefit_to_age?: number
  /** Benefit period as a fixed term in years, when it is not an age. */
  benefit_years?: number
  /** Waiting period before benefits begin. */
  elimination_days?: number
  /** Residual / partial-disability rider — pays proportionally on a partial loss. */
  residual?: boolean
  /** Cost-of-living rider — indexes the benefit during a long claim. */
  cola?: boolean
  /** Non-cancelable: premiums and terms locked for the life of the policy. */
  non_cancelable?: boolean
}

export interface ProtectionFlag {
  severity: AlertSeverity
  title: string
  detail: string
}

export interface DisabilityContext {
  /** Gross annual earned income — the asset being insured. */
  annualEarnedIncome: number
  /** Effective (average) tax rate on earned income. Drives after-tax income + human capital. */
  effectiveTaxRate: number
  /** Marginal rate — a taxable group benefit is taxed at the margin, not the average. */
  marginalRate: number
  annualSpending: number
  age: number | null
  retireAge: number
}

export interface DisabilityPolicyRead {
  id: string
  carrier: string
  group: boolean
  /** Stated monthly benefit. */
  monthlyBenefit: number
  /** Monthly benefit after the tax it would actually bear. */
  effectiveMonthly: number
  ownOcc: OwnOccTier
  benefitTax: BenefitTaxKind
  /** Years the benefit would run from today (null = unrecorded). */
  benefitYearsFromNow: number | null
  weaknesses: string[]
}

export interface DisabilityView {
  hasPolicies: boolean
  /** PV of remaining after-tax earnings to retirement — the asset at risk (#4: banded). */
  humanCapital: { low: number; mid: number; high: number }
  yearsToRetire: number
  monthlySpending: number
  /** Full after-tax income replacement — the upper anchor (stays on plan, keeps saving). */
  afterTaxIncomeMonthly: number
  grossMonthlyBenefit: number
  /** Total monthly benefit after tax — what would actually arrive. */
  effectiveMonthlyBenefit: number
  /** Shortfall against monthly spending — the "lights stay on" floor. */
  gapToSpending: number
  /** Shortfall against full after-tax income — the "plan stays on track" target. */
  gapToIncome: number
  /** effectiveMonthlyBenefit ÷ monthlySpending. */
  spendingCoverageRatio: number
  status: GapStatus
  /** Weakest definition across in-force policies — the binding constraint. */
  weakestDefinition: OwnOccTier
  policies: DisabilityPolicyRead[]
  flags: ProtectionFlag[]
}

/**
 * Human-capital assumptions. Earned income is a bond-like claim, so it is
 * discounted at a modest REAL rate; the spread produces the band (invariant #4).
 * Exported so the UI can show the assumptions (design system: always visible).
 */
export const HUMAN_CAPITAL_REAL_DISCOUNT = 0.03
export const HUMAN_CAPITAL_DISCOUNT_SPREAD = 0.015
export const HUMAN_CAPITAL_REAL_INCOME_GROWTH = 0.01

/** At or above this share of spending, a shortfall is a near-miss, not a hole. */
export const NEAR_MISS_COVERAGE = 0.8

/** PV of `years` of after-tax income growing at `g`, discounted at `r`. */
function presentValueOfEarnings(afterTaxAnnual: number, years: number, r: number, g: number): number {
  if (afterTaxAnnual <= 0 || years <= 0) return 0
  let pv = 0
  for (let t = 1; t <= years; t++) {
    pv += (afterTaxAnnual * Math.pow(1 + g, t - 1)) / Math.pow(1 + r, t)
  }
  return pv
}

function detailsOf(p: InsurancePolicy): DisabilityDetails {
  const d = (p as { details?: unknown }).details
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as DisabilityDetails) : {}
}

/**
 * Read the disability policies in force against the income they are meant to
 * replace. Returns exposure + specific, plain-language weaknesses — never advice.
 */
export function disabilityView(policies: InsurancePolicy[], ctx: DisabilityContext): DisabilityView {
  const dis = policies.filter((p) => p.kind === 'disability')

  const yearsToRetire = ctx.age == null ? 0 : Math.max(0, ctx.retireAge - ctx.age)
  const afterTaxAnnual = Math.max(0, ctx.annualEarnedIncome * (1 - ctx.effectiveTaxRate))
  const afterTaxIncomeMonthly = afterTaxAnnual / 12
  const monthlySpending = Math.max(0, ctx.annualSpending) / 12

  const g = HUMAN_CAPITAL_REAL_INCOME_GROWTH
  const humanCapital = {
    // A higher discount rate gives a LOWER present value, so it produces the low end.
    low: presentValueOfEarnings(afterTaxAnnual, yearsToRetire, HUMAN_CAPITAL_REAL_DISCOUNT + HUMAN_CAPITAL_DISCOUNT_SPREAD, g),
    mid: presentValueOfEarnings(afterTaxAnnual, yearsToRetire, HUMAN_CAPITAL_REAL_DISCOUNT, g),
    high: presentValueOfEarnings(afterTaxAnnual, yearsToRetire, HUMAN_CAPITAL_REAL_DISCOUNT - HUMAN_CAPITAL_DISCOUNT_SPREAD, g),
  }

  const reads: DisabilityPolicyRead[] = []
  let grossMonthlyBenefit = 0
  let effectiveMonthlyBenefit = 0

  for (const p of dis) {
    const d = detailsOf(p)
    const monthlyBenefit = Math.max(0, p.coverage ?? 0)
    const isGroup = d.group ?? false
    // Unrecorded tax character: assume the character implied by the policy type
    // (group premiums are normally employer-paid ⇒ taxable) rather than the
    // flattering case, and flag it as unconfirmed below.
    const benefitTax: BenefitTaxKind = d.benefit_tax ?? (isGroup ? 'taxable' : 'unknown')
    const taxDrag = benefitTax === 'taxable' ? ctx.marginalRate : 0
    const effectiveMonthly = monthlyBenefit * (1 - taxDrag)

    const ownOcc: OwnOccTier = d.own_occ ?? 'unknown'
    const benefitYearsFromNow =
      d.benefit_to_age != null && ctx.age != null
        ? Math.max(0, d.benefit_to_age - ctx.age)
        : d.benefit_years != null
          ? d.benefit_years
          : null

    const weaknesses: string[] = []
    if (ownOcc === 'any_occ') weaknesses.push('Any-occupation definition — pays only if you cannot do any suitable work.')
    else if (ownOcc === 'modified_own_occ') weaknesses.push('Modified own-occ — working in another field can end the benefit.')
    else if (ownOcc === 'unknown') weaknesses.push('Definition of disability not recorded — confirm it on the policy.')
    if (benefitTax === 'taxable') weaknesses.push(`Benefit is taxable — worth about ${Math.round((1 - ctx.marginalRate) * 100)}¢ on the dollar to you.`)
    else if (benefitTax === 'unknown') weaknesses.push('Tax character not recorded — who paid the premiums decides it.')
    if (benefitYearsFromNow != null && yearsToRetire > 0 && benefitYearsFromNow + 0.5 < yearsToRetire) {
      weaknesses.push(`Benefit period runs ~${Math.round(benefitYearsFromNow)} yrs, short of the ${Math.round(yearsToRetire)} working years it would need to cover.`)
    } else if (benefitYearsFromNow == null) {
      weaknesses.push('Benefit period not recorded.')
    }
    if (d.residual === false) weaknesses.push('No residual/partial rider — a partial loss of duties may pay nothing.')
    if (d.cola === false && (benefitYearsFromNow ?? 0) >= 10) weaknesses.push('No COLA rider — inflation erodes a long claim.')
    if (isGroup && d.non_cancelable !== true) weaknesses.push('Group cover is not portable — it typically ends when the job does.')

    grossMonthlyBenefit += monthlyBenefit
    effectiveMonthlyBenefit += effectiveMonthly
    reads.push({
      id: p.id,
      carrier: p.carrier ?? 'Unnamed policy',
      group: isGroup,
      monthlyBenefit,
      effectiveMonthly,
      ownOcc,
      benefitTax,
      benefitYearsFromNow,
      weaknesses,
    })
  }

  const gapToSpending = Math.max(0, monthlySpending - effectiveMonthlyBenefit)
  const gapToIncome = Math.max(0, afterTaxIncomeMonthly - effectiveMonthlyBenefit)
  const spendingCoverageRatio = monthlySpending > 0 ? effectiveMonthlyBenefit / monthlySpending : 0

  const weakestDefinition = reads.length
    ? reads.reduce<OwnOccTier>((worst, r) => (OWN_OCC_RANK[r.ownOcc] < OWN_OCC_RANK[worst] ? r.ownOcc : worst), 'specialty_own_occ')
    : 'unknown'

  // Working = still reliant on earned income. Past that, this readout is moot.
  const working = yearsToRetire > 0 && ctx.annualEarnedIncome > 0
  const status: GapStatus = !working
    ? 'n/a'
    : reads.length === 0
      ? 'gap'
      : gapToSpending > 0
        ? 'gap'
        : weakestDefinition === 'any_occ' || weakestDefinition === 'unknown'
          ? 'review'
          : 'covered'

  const flags: ProtectionFlag[] = []
  if (working && reads.length === 0) {
    flags.push({
      severity: 'high',
      title: 'No disability cover recorded',
      detail: `Your remaining earnings are worth roughly ${Math.round(humanCapital.mid / 1_000_000 * 10) / 10}M in today's dollars — more than most portfolios at this stage. Nothing on file protects it.`,
    })
  }
  if (working && reads.length > 0) {
    if (gapToSpending > 0) {
      // Severity tracks the size of the shortfall, not its mere existence —
      // a near-miss must not shout like a hole (invariant #6, calm by default).
      flags.push({
        severity: spendingCoverageRatio < NEAR_MISS_COVERAGE ? 'high' : 'caution',
        title:
          spendingCoverageRatio < NEAR_MISS_COVERAGE
            ? 'Benefits would not cover current spending'
            : 'Benefits land just short of current spending',
        detail: `After tax, in-force benefits pay about ${Math.round(spendingCoverageRatio * 100)}% of what you spend each month.`,
      })
    } else if (gapToIncome > 0) {
      flags.push({
        severity: 'info',
        title: 'Spending covered, saving is not',
        detail: 'Benefits cover the spending floor but not full income, so contributions would stop — the plan slows even though the lights stay on.',
      })
    }
    if (weakestDefinition === 'any_occ' || weakestDefinition === 'modified_own_occ') {
      flags.push({
        severity: 'high',
        title: `Weakest definition in force: ${OWN_OCC_LABEL[weakestDefinition].toLowerCase()}`,
        detail: OWN_OCC_NOTE[weakestDefinition],
      })
    } else if (weakestDefinition === 'unknown') {
      flags.push({
        severity: 'caution',
        title: 'Definition of disability unconfirmed',
        detail: OWN_OCC_NOTE.unknown,
      })
    }
    if (reads.every((r) => r.group)) {
      flags.push({
        severity: 'caution',
        title: 'All cover is employer group',
        detail: 'Group cover is usually taxable, capped, tied to base pay only, and lost when the job ends. An individually-owned policy is the portable layer.',
      })
    }
  }

  return {
    hasPolicies: reads.length > 0,
    humanCapital,
    yearsToRetire,
    monthlySpending,
    afterTaxIncomeMonthly,
    grossMonthlyBenefit,
    effectiveMonthlyBenefit,
    gapToSpending,
    gapToIncome,
    spendingCoverageRatio,
    status,
    weakestDefinition,
    policies: reads,
    flags,
  }
}
