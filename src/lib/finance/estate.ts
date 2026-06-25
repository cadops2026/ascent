import type { FilingStatus } from '../db'

/**
 * Net-to-heirs exposure (the "quick number"). Models federal estate-tax drag
 * under the OBBBA permanent exemption ($15M single / $30M married, 2026+), 40%
 * top rate. NJ contributes $0 (no estate tax; Class A heirs exempt).
 *
 * This is an EXPOSURE ESTIMATE, not advice (invariant #9). It deliberately omits
 * portability of a deceased spouse's unused exemption, prior taxable gifts, ILIT
 * structures, valuation discounts, and settlement/illiquidity costs — all of
 * which a professional would layer on. Point estimate "today"; the projected
 * legacy band comes with the Monte Carlo engine (P3).
 */
export const FEDERAL_EXEMPTION: Record<FilingStatus, number> = {
  single: 15_000_000,
  mfj: 30_000_000,
  mfs: 15_000_000,
  hoh: 15_000_000,
  qw: 15_000_000,
}

export const FEDERAL_TOP_RATE = 0.4

export interface EstateExposure {
  /** Net worth including the primary residence (assets − liabilities). */
  grossEstate: number
  exemption: number
  federalTax: number
  stateTax: number
  netToHeirs: number
  overExemption: boolean
}

export function estateExposure(
  netWorthInclResidence: number,
  filing: FilingStatus,
): EstateExposure {
  const exemption = FEDERAL_EXEMPTION[filing]
  const taxable = Math.max(0, netWorthInclResidence - exemption)
  const federalTax = taxable * FEDERAL_TOP_RATE
  const stateTax = 0 // NJ: no estate tax; Class A exempt
  return {
    grossEstate: netWorthInclResidence,
    exemption,
    federalTax,
    stateTax,
    netToHeirs: netWorthInclResidence - federalTax - stateTax,
    overExemption: netWorthInclResidence > exemption,
  }
}
