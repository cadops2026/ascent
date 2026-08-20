// Asset location — which holdings belong in a taxable account, and which are
// costing you by sitting there.
//
// The rule is simple on purpose: a holding's tax drag in a taxable account is
// driven by the income it throws off every year whether you want it or not.
// Low-yield holdings are cheap to hold taxable; high-yield ones are better
// sheltered. This RANKS and FLAGS — it never moves anything, and it is not
// advice about what to buy.
//
// Deliberately NOT folded into the look-through concentration list: that list
// exists to show what you're exposed to, and hiding dividend payers from it
// would understate real concentration.
import type { Holding, Account, TaxType } from '../db'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'

/** symbol (UPPERCASE) -> trailing 12-month yield as a FRACTION (0.0102 = 1.02%). */
export type YieldMap = Record<string, number>

/** Above this trailing yield, a holding is better sheltered than held taxable.
 *  Visible and editable in the UI (spec §6) — it is a preference, not a law. */
export const DEFAULT_YIELD_THRESHOLD = 0.01 // 1%

/** Account types where dividends are NOT taxed as they arrive. */
const SHELTERED: ReadonlySet<string> = new Set<TaxType>([
  'trad_401k', 'roth_401k', 'trad_ira', 'roth_ira', 'hsa',
  'sep_ira', 'solo_401k', '529', 'cash_balance_db',
])

export const isSheltered = (t: string | null | undefined) => (t ? SHELTERED.has(t) : false)

/**
 * Municipal / tax-exempt funds, whose distributions are federally tax-exempt
 * (and often state-exempt for a resident holder). These are the ONE case where
 * a high yield is a reason to keep something in a taxable account, not move it:
 * sheltering a muni inside an IRA throws the exemption away and converts
 * tax-free income into eventually-ordinary income. Without this check the
 * ranking recommends exactly the wrong move on the highest-yield holding.
 *
 * Matched on name, since the tax treatment is a property of the fund, not
 * something any price feed reports.
 */
export function isTaxExempt(h: Pick<Holding, 'name' | 'symbol'>): boolean {
  const n = `${h.name ?? ''} ${h.symbol ?? ''}`.toLowerCase()
  return /tax[\s-]?exempt|municipal|\bmuni\b/.test(n)
}

export type Placement =
  | 'good-in-taxable'
  | 'better-sheltered'
  | 'already-sheltered'
  | 'tax-exempt'
  | 'unknown'

export interface LocationRow {
  holdingId: string
  label: string
  symbol: string | null
  value: number
  /** Trailing 12-month yield, fraction. Null when we have no dividend data. */
  yieldPct: number | null
  /** Dollars of dividend income a year at that yield. */
  annualIncome: number
  /** True for municipal/tax-exempt funds — income that never hits a 1099. */
  taxExempt: boolean
  accountName: string | null
  taxType: string | null
  placement: Placement
}

export interface AssetLocation {
  /** Lowest-yield first — the holdings best suited to a taxable account. */
  bestForTaxable: LocationRow[]
  /** High-yield holdings currently sitting in a taxable account. */
  misplaced: LocationRow[]
  /** Dividend income a year currently landing in taxable accounts. */
  taxableIncome: number
  /** Value we could not judge because no dividend data was available. */
  unknownValue: number
  threshold: number
}

/**
 * Rank holdings by how well they suit a taxable account.
 *
 * `unknown` yields are surfaced rather than assumed to be zero — treating
 * missing data as "pays nothing" would silently promote holdings to the top of
 * the best-for-taxable list on no evidence at all.
 */
export function assetLocation(
  holdings: Holding[],
  accounts: Account[],
  quotes: QuoteMap,
  yields: YieldMap,
  threshold: number = DEFAULT_YIELD_THRESHOLD,
): AssetLocation {
  const acctById = new Map(accounts.map((a) => [a.id, a]))
  const rows: LocationRow[] = []

  for (const h of holdings) {
    const value = holdingValue(h, quotes) ?? 0
    if (value <= 0) continue

    const acct = h.account_id ? acctById.get(h.account_id) : undefined
    // Untagged accounts count as taxable elsewhere in the app; stay consistent.
    const taxType = acct?.tax_type ?? null
    const sheltered = isSheltered(taxType)

    const y = h.symbol ? yields[h.symbol.toUpperCase()] : undefined
    const yieldPct = y ?? null
    const taxExempt = isTaxExempt(h)

    let placement: Placement
    if (taxExempt) placement = 'tax-exempt' // belongs in taxable regardless of yield
    else if (yieldPct == null) placement = 'unknown'
    else if (sheltered) placement = 'already-sheltered'
    else if (yieldPct > threshold) placement = 'better-sheltered'
    else placement = 'good-in-taxable'

    rows.push({
      holdingId: h.id,
      label: h.name ?? h.symbol ?? 'Untitled holding',
      symbol: h.symbol,
      value,
      yieldPct,
      // Tax-exempt distributions are real income but not TAXABLE income, which
      // is the only kind this view is about.
      annualIncome: taxExempt ? 0 : (yieldPct ?? 0) * value,
      taxExempt,
      accountName: acct?.name ?? null,
      taxType,
      placement,
    })
  }

  const known = rows.filter((r) => r.yieldPct != null)

  return {
    // Lowest TAXABLE yield first; ties broken by size, since a big low-yield
    // position is the more useful thing to see at the top. Tax-exempt funds
    // sort as zero — they are the best thing you can hold in a taxable account.
    bestForTaxable: known
      .slice()
      .sort(
        (a, b) =>
          (a.taxExempt ? 0 : a.yieldPct!) - (b.taxExempt ? 0 : b.yieldPct!) || b.value - a.value,
      ),
    misplaced: rows
      .filter((r) => r.placement === 'better-sheltered')
      .sort((a, b) => b.annualIncome - a.annualIncome),
    taxableIncome: rows
      .filter((r) => !isSheltered(r.taxType))
      .reduce((s, r) => s + r.annualIncome, 0),
    unknownValue: rows.filter((r) => r.placement === 'unknown').reduce((s, r) => s + r.value, 0),
    threshold,
  }
}
