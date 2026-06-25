import type { Holding, Account } from '../db'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'

/**
 * Liquidity & SBLOC. Answers: if an estate-tax bill (or any large need) lands, can
 * it be met from cash + marketable securities — or by *borrowing against* them
 * (SBLOC, "borrow-don't-sell") rather than a forced sale? Surfacing this keeps the
 * answer calm and pre-planned, never a fire sale. Illiquid sleeves (private,
 * collectibles, real estate) are excluded; the residence is out of investable (#11).
 */
const MARKETABLE = new Set(['cash', 'stock', 'etf', 'crypto'])
const SBLOC_KINDS = new Set(['stock', 'etf']) // conservative collateral: not crypto/cash
const SBLOC_ADVANCE_RATE = 0.5 // a conservative advance rate on taxable marketable securities

export interface LiquidityView {
  liquidAssets: number // cash + marketable securities (sellable now)
  taxableMarketable: number // SBLOC-eligible securities held in taxable accounts
  sblocCapacity: number // borrow-don't-sell capacity
  needToCover: number // e.g. the estate-tax bill
  totalAvailable: number // liquid + SBLOC capacity
  covered: boolean
  shortfall: number
}

export function liquidityView(
  holdings: Holding[],
  accounts: Account[],
  quotes: QuoteMap,
  needToCover: number,
): LiquidityView {
  const taxableAccountIds = new Set(accounts.filter((a) => a.tax_type === 'taxable').map((a) => a.id))

  let liquidAssets = 0
  let taxableMarketable = 0
  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0) continue
    if (MARKETABLE.has(h.kind)) liquidAssets += v
    if (SBLOC_KINDS.has(h.kind) && h.account_id != null && taxableAccountIds.has(h.account_id)) {
      taxableMarketable += v
    }
  }

  const sblocCapacity = taxableMarketable * SBLOC_ADVANCE_RATE
  const totalAvailable = liquidAssets + sblocCapacity
  return {
    liquidAssets,
    taxableMarketable,
    sblocCapacity,
    needToCover,
    totalAvailable,
    covered: totalAvailable >= needToCover,
    shortfall: Math.max(0, needToCover - totalAvailable),
  }
}
