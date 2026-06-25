import type { Holding, RealEstate, Liability } from '../db'
import { amortize } from './amortization'

/** symbol (UPPERCASE) -> price */
export type QuoteMap = Record<string, number>

/** Allocation classes for the investable pie. */
export type AssetClass = 'Equities' | 'Crypto' | 'Cash' | 'Private' | 'Collectibles' | 'Real estate'

const KIND_TO_CLASS: Record<string, AssetClass> = {
  stock: 'Equities',
  etf: 'Equities',
  crypto: 'Crypto',
  cash: 'Cash',
  private: 'Private',
  collectible: 'Collectibles',
}

/**
 * Market value of one holding, or null if it's a shares-based holding whose
 * quote hasn't been fetched yet (so the UI can show "pending" honestly rather
 * than a wrong zero).
 */
export function holdingValue(h: Holding, quotes: QuoteMap): number | null {
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
  let holdingsTotal = 0
  let pendingQuotes = 0

  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null) {
      pendingQuotes += 1
      continue
    }
    holdingsTotal += v
    const cls = KIND_TO_CLASS[h.kind] ?? 'Equities'
    classTotals.set(cls, (classTotals.get(cls) ?? 0) + v)
  }

  let residenceValue = 0
  let investmentRE = 0
  for (const p of realEstate) {
    if (p.kind === 'residence') residenceValue += p.market_value
    else investmentRE += p.market_value
  }
  if (investmentRE > 0) {
    classTotals.set('Real estate', (classTotals.get('Real estate') ?? 0) + investmentRE)
  }

  const totalLiabilities = liabilities.reduce((sum, l) => sum + liabilityBalance(l, asOf), 0)

  // Net worth includes the residence; investable excludes it (invariant #11).
  const totalAssets = holdingsTotal + residenceValue + investmentRE
  const netWorth = totalAssets - totalLiabilities
  const investable = holdingsTotal + investmentRE

  const byClass: ClassSlice[] = [...classTotals.entries()]
    .map(([cls, value]) => ({ class: cls, value, pct: investable > 0 ? value / investable : 0 }))
    .sort((a, b) => b.value - a.value)

  return {
    totalAssets,
    totalLiabilities,
    netWorth,
    investable,
    residenceValue,
    byClass,
    pendingQuotes,
  }
}
