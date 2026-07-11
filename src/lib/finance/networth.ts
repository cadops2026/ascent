import type { Holding, RealEstate, Liability, BasketLeg } from '../db'
import { amortize } from './amortization'
import { cmaClassForHolding, COARSE_OF_CMA } from './assetclass'
import type { AssetClass, CmaClass } from './assetclass'

/** symbol (UPPERCASE) -> price */
export type QuoteMap = Record<string, number>

// Asset-class taxonomy (coarse AssetClass + fine CmaClass + the per-holding
// classifier) is the one source of truth in ./assetclass (invariant #1); re-export
// AssetClass/CmaClass so existing importers of './networth' keep working.
export type { AssetClass, CmaClass }

/**
 * Market value of one holding, or null if it's a shares-based holding whose
 * quote hasn't been fetched yet (so the UI can show "pending" honestly rather
 * than a wrong zero).
 */
export function holdingValue(h: Holding, quotes: QuoteMap): number | null {
  // Composition-priced (e.g. a 529 portfolio): value live off its underlyings.
  // Returns null until every leg's quote is cached, so the UI shows "pending"
  // rather than an understated value.
  const basket = h.synthetic_basket as BasketLeg[] | null
  if (basket && basket.length) {
    let v = 0
    for (const leg of basket) {
      const p = quotes[leg.symbol.toUpperCase()]
      if (p == null) return null
      v += leg.shares * p
    }
    return v
  }
  if (h.entry_mode === 'amount') return h.manual_amount ?? 0
  if (h.shares == null || !h.symbol) return null
  const price = quotes[h.symbol.toUpperCase()]
  if (price == null) return null
  return h.shares * price
}

/** Current balance of a liability — mortgages amortize; other debt uses orig. */
export function liabilityBalance(l: Liability, asOf: Date = new Date()): number {
  if (l.kind === 'mortgage') {
    return amortize(
      { origBalance: l.orig_balance, annualRate: l.rate, termMonths: l.term_months, startDate: l.start_date },
      asOf,
    ).currentBalance
  }
  return l.orig_balance
}

export interface ClassSlice {
  class: AssetClass
  value: number
  pct: number
}

export interface BalanceSheet {
  totalAssets: number
  totalLiabilities: number
  netWorth: number
  /** Investable excludes the primary residence (invariant #11). */
  investable: number
  residenceValue: number
  byClass: ClassSlice[]
  /** Investable value by fine engine (CMA) class — the weights the projection,
   *  Monte Carlo and CMA engines consume (bonds/TIPS/intl/commodities now reach
   *  their own class instead of collapsing into us_equity). Raw dollars; the
   *  Monte Carlo normalizes. */
  cmaWeights: Record<string, number>
  /** Count of shares-based holdings still waiting on a quote. */
  pendingQuotes: number
}

export function computeBalanceSheet(
  holdings: Holding[],
  realEstate: RealEstate[],
  liabilities: Liability[],
  quotes: QuoteMap,
  asOf: Date = new Date(),
): BalanceSheet {
  const classTotals = new Map<AssetClass, number>()
  const cmaTotals = new Map<CmaClass, number>()
  let holdingsTotal = 0
  let pendingQuotes = 0

  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null) {
      pendingQuotes += 1
      continue
    }
    holdingsTotal += v
    const cc = cmaClassForHolding(h)
    cmaTotals.set(cc, (cmaTotals.get(cc) ?? 0) + v)
    const coarse = COARSE_OF_CMA[cc]
    classTotals.set(coarse, (classTotals.get(coarse) ?? 0) + v)
  }

  let residenceValue = 0
  let investmentRE = 0
  for (const p of realEstate) {
    if (p.kind === 'residence') residenceValue += p.market_value
    else investmentRE += p.market_value
  }
  if (investmentRE > 0) {
    classTotals.set('Real estate', (classTotals.get('Real estate') ?? 0) + investmentRE)
    cmaTotals.set('real_estate', (cmaTotals.get('real_estate') ?? 0) + investmentRE)
  }

  const totalLiabilities = liabilities.reduce((sum, l) => sum + liabilityBalance(l, asOf), 0)

  // Net worth includes the residence; investable excludes it (invariant #11).
  const totalAssets = holdingsTotal + residenceValue + investmentRE
  const netWorth = totalAssets - totalLiabilities
  const investable = holdingsTotal + investmentRE

  const byClass: ClassSlice[] = [...classTotals.entries()]
    .map(([cls, value]) => ({ class: cls, value, pct: investable > 0 ? value / investable : 0 }))
    .sort((a, b) => b.value - a.value)

  const cmaWeights: Record<string, number> = {}
  for (const [cls, value] of cmaTotals) cmaWeights[cls] = value

  return {
    totalAssets,
    totalLiabilities,
    netWorth,
    investable,
    residenceValue,
    byClass,
    cmaWeights,
    pendingQuotes,
  }
}
