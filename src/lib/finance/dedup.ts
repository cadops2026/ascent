import type { Holding } from '../db'

/**
 * Duplicate-holding detection for the Balance Sheet.
 *
 * Re-imports and overlapping statements can create exact-duplicate positions — the
 * same ticker, kind, and share/amount in the same account. The import-time dedup
 * (ImportSection) keys on the *resolved account_id*, so re-imports that parsed the
 * institution slightly differently created parallel account rows and slipped past
 * it. This finds those after the fact for a review-then-remove cleanup; it never
 * deletes on its own.
 */

const roundShares = (n: number) => Math.round(n * 1e4) / 1e4
const roundAmt = (n: number) => Math.round(n * 100) / 100

export interface DuplicateGroup {
  /** Earliest-created row in the group — the one to keep. */
  keep: Holding
  /** The later exact-duplicate rows to remove. */
  drop: Holding[]
}

/**
 * Identity of a position for duplicate detection: account dimension + ticker-or-name
 * + kind + entry mode + rounded amount. `accountLabel` lets the caller collapse the
 * account dimension by *name* (so parallel same-name accounts from re-imports match)
 * rather than by raw id.
 */
export function holdingIdentity(h: Holding, accountLabel: string): string {
  const label = (h.symbol || h.name || '').trim().toUpperCase()
  const mode = h.entry_mode === 'shares' ? 'shares' : 'amount'
  const amt = mode === 'shares' ? roundShares(h.shares ?? 0) : roundAmt(h.manual_amount ?? 0)
  return `${accountLabel}|${label}|${h.kind}|${mode}|${amt}`
}

/**
 * Group holdings by identity and return the groups that have more than one row.
 * Within each group the earliest-created row is kept and the rest are flagged to
 * drop. By default the account dimension is the raw account_id; pass `accountLabelOf`
 * (e.g. id → lowercased account name) to also collapse parallel same-name accounts.
 * Rows with no symbol AND no name are never matched (we can't identify them).
 */
export function findDuplicateHoldings(
  holdings: Holding[],
  accountLabelOf: (accountId: string | null) => string = (id) => id ?? '',
): DuplicateGroup[] {
  const groups = new Map<string, Holding[]>()
  for (const h of holdings) {
    if (!(h.symbol || h.name)) continue
    const key = holdingIdentity(h, accountLabelOf(h.account_id))
    const list = groups.get(key)
    if (list) list.push(h)
    else groups.set(key, [h])
  }

  const result: DuplicateGroup[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    const sorted = [...list].sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))
    result.push({ keep: sorted[0]!, drop: sorted.slice(1) })
  }
  return result
}
