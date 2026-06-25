import type { InsurancePolicy } from '../db'

/**
 * Insurance-gap readout. Models a rough coverage *need* per line and compares it to
 * what's in force — to flag gaps and sharpen the conversation with a professional,
 * never to recommend a product or amount (invariant #9). Needs are deliberately
 * crude (a planner refines them); the value is surfacing an obvious hole.
 */
export const INSURANCE_KINDS = ['term_life', 'disability', 'umbrella', 'ltc', 'entity'] as const
export type InsuranceKind = (typeof INSURANCE_KINDS)[number]

export const INSURANCE_LABEL: Record<InsuranceKind, string> = {
  term_life: 'Term life',
  disability: 'Disability',
  umbrella: 'Umbrella liability',
  ltc: 'Long-term care',
  entity: 'Entity / LLC liability',
}

export type GapStatus = 'covered' | 'gap' | 'review' | 'n/a'

export interface InsuranceContext {
  netWorth: number
  liabilities: number
  annualSpending: number
  liquidAssets: number
  age: number | null
  hasBusinessOrRental: boolean
}

export interface InsuranceLine {
  kind: InsuranceKind
  label: string
  coverage: number // sum of in-force coverage for this kind
  modeledNeed: number // 0 when need is presence-based, not an amount
  gap: number
  status: GapStatus
  note: string
}

const LIFE_INCOME_YEARS = 10

export function insuranceGaps(policies: InsurancePolicy[], ctx: InsuranceContext): InsuranceLine[] {
  const coverageByKind = new Map<InsuranceKind, number>()
  for (const p of policies) {
    const k = p.kind as InsuranceKind
    if (!INSURANCE_KINDS.includes(k)) continue
    coverageByKind.set(k, (coverageByKind.get(k) ?? 0) + (p.coverage ?? 0))
  }
  const cov = (k: InsuranceKind) => coverageByKind.get(k) ?? 0

  const lines: InsuranceLine[] = []

  // Term life — replace lost income + clear debts, net of liquid assets.
  {
    const need = Math.max(0, ctx.liabilities + LIFE_INCOME_YEARS * ctx.annualSpending - ctx.liquidAssets)
    const coverage = cov('term_life')
    const gap = Math.max(0, need - coverage)
    lines.push({
      kind: 'term_life',
      label: INSURANCE_LABEL.term_life,
      coverage,
      modeledNeed: need,
      gap,
      status: need <= 0 ? 'covered' : gap > 0 ? 'gap' : 'covered',
      note:
        need <= 0
          ? 'Liquid assets already cover debts + income replacement.'
          : `Need ≈ debts + ${LIFE_INCOME_YEARS}× spending − liquid assets.`,
    })
  }

  // Umbrella — protect the balance sheet against liability claims (≈ net worth).
  {
    const need = Math.max(0, ctx.netWorth)
    const coverage = cov('umbrella')
    const gap = Math.max(0, need - coverage)
    lines.push({
      kind: 'umbrella',
      label: INSURANCE_LABEL.umbrella,
      coverage,
      modeledNeed: need,
      gap,
      status: coverage <= 0 ? 'gap' : gap > 0 ? 'gap' : 'covered',
      note: 'A liability claim can reach assets beyond auto/home limits — umbrella ≈ net worth.',
    })
  }

  // Disability — income protection while working (presence-based flag).
  {
    const coverage = cov('disability')
    const working = ctx.age == null || ctx.age < 65
    lines.push({
      kind: 'disability',
      label: INSURANCE_LABEL.disability,
      coverage,
      modeledNeed: 0,
      gap: 0,
      status: !working ? 'n/a' : coverage > 0 ? 'covered' : 'gap',
      note: working
        ? 'Protects earned income — the asset that funds everything else.'
        : 'Less critical once you are no longer reliant on earned income.',
    })
  }

  // LTC — age-based prompt to evaluate, not an amount.
  {
    const coverage = cov('ltc')
    const prompt = ctx.age != null && ctx.age >= 50
    lines.push({
      kind: 'ltc',
      label: INSURANCE_LABEL.ltc,
      coverage,
      modeledNeed: 0,
      gap: 0,
      status: coverage > 0 ? 'covered' : prompt ? 'review' : 'n/a',
      note: prompt
        ? 'Worth pricing in your 50s–60s; later it gets costly or unavailable.'
        : 'Typically evaluated from your 50s.',
    })
  }

  // Entity / LLC liability — relevant when there is a business or rental.
  {
    const coverage = cov('entity')
    lines.push({
      kind: 'entity',
      label: INSURANCE_LABEL.entity,
      coverage,
      modeledNeed: 0,
      gap: 0,
      status: !ctx.hasBusinessOrRental ? 'n/a' : coverage > 0 ? 'covered' : 'review',
      note: ctx.hasBusinessOrRental
        ? 'Business/rental exposure — entity structure + liability coverage limits the blast radius.'
        : 'Relevant once you hold a business or rental property.',
    })
  }

  return lines
}
