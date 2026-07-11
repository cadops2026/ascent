import type { AssetClass, ClassSlice } from './networth'

/**
 * Drawdown stress: apply a historical *analog* shock to the investable portfolio
 * and read the blast radius. These are illustrative peak-to-trough analogs, not
 * forecasts (and not price-triggered alerts) — they answer "if this repeated,
 * what would I be exposed to." The primary residence is deliberately not stressed
 * here: it's out of the investable math and its AVM is noisy (invariant #11).
 */
export interface StressScenario {
  id: string
  name: string
  period: string
  note: string
  /** Per-class shock as a negative fraction (−0.5 = −50%). Missing class ⇒ 0. */
  shocks: Partial<Record<AssetClass, number>>
}

export const STRESS_SCENARIOS: StressScenario[] = [
  {
    id: 'dotcom',
    name: 'Dot-com bust',
    period: '2000–02',
    note: 'Equity/growth unwind; high-beta sleeves hit hardest.',
    shocks: { Equities: -0.45, Crypto: -0.55, Private: -0.35, Collectibles: -0.2, 'Real estate': -0.05 },
  },
  {
    id: 'gfc',
    name: 'Global financial crisis',
    period: '2008–09',
    note: 'Broad risk-off; property and credit included.',
    shocks: { Equities: -0.55, Crypto: -0.6, Private: -0.45, Collectibles: -0.3, 'Real estate': -0.25 },
  },
  {
    id: 'y2022',
    name: 'Rate shock',
    period: '2022',
    note: 'Inflation/rate repricing; duration and crypto hit. The one analog where bonds fall.',
    shocks: { Equities: -0.25, Bonds: -0.13, Crypto: -0.65, Private: -0.2, Collectibles: -0.1, 'Real estate': -0.1 },
  },
  {
    id: 'cryptowinter',
    name: 'Crypto winter',
    period: '2022',
    note: 'Digital-asset-led drawdown; VC markdowns follow.',
    shocks: { Equities: -0.2, Crypto: -0.75, Private: -0.25, Collectibles: -0.15, 'Real estate': -0.05 },
  },
]

export interface StressResult {
  scenario: StressScenario
  lossAmount: number
  lossPct: number // of investable
  afterValue: number
  byClassLoss: { class: AssetClass; loss: number }[]
  /** Years for the post-shock portfolio to compound back to its pre-shock value at
   *  the blended expected REAL return. null when there's no positive return to grow
   *  on (e.g. all-cash) or no loss. A band, not a forecast (invariant #4). */
  yearsToRecover: number | null
}

/** t such that (1+r)^t = baseline/afterValue, i.e. ln(1/(1−lossPct)) / ln(1+r). */
function yearsToRecover(lossPct: number, expectedAnnualReturn: number): number | null {
  if (!(expectedAnnualReturn > 0) || lossPct <= 0 || lossPct >= 1) return null
  return Math.log(1 / (1 - lossPct)) / Math.log(1 + expectedAnnualReturn)
}

export function runStress(
  byClass: ClassSlice[],
  investable: number,
  sc: StressScenario,
  expectedAnnualReturn = 0,
): StressResult {
  let lossAmount = 0
  const byClassLoss: { class: AssetClass; loss: number }[] = []
  for (const s of byClass) {
    const shock = sc.shocks[s.class] ?? 0
    const loss = s.value * -shock // shock is negative ⇒ loss positive
    if (loss > 0) byClassLoss.push({ class: s.class, loss })
    lossAmount += loss
  }
  byClassLoss.sort((a, b) => b.loss - a.loss)
  const lossPct = investable > 0 ? lossAmount / investable : 0
  return {
    scenario: sc,
    lossAmount,
    lossPct,
    afterValue: Math.max(0, investable - lossAmount),
    byClassLoss,
    yearsToRecover: yearsToRecover(lossPct, expectedAnnualReturn),
  }
}

export function runAllStress(
  byClass: ClassSlice[],
  investable: number,
  expectedAnnualReturn = 0,
): StressResult[] {
  return STRESS_SCENARIOS.map((sc) => runStress(byClass, investable, sc, expectedAnnualReturn))
}
