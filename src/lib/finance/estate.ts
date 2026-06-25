import type { FilingStatus } from '../db'
import { DEFAULT_TAX_PARAMS } from './taxparams'
import type { TaxParams } from './taxparams'

/**
 * Net-to-heirs exposure (the "quick number"). Models federal estate-tax drag
 * under the OBBBA permanent exemption ($15M single / $30M married, 2026+), 40%
 * top rate (both from TaxParams now, so they update yearly). NJ contributes $0.
 *
 * This is an EXPOSURE ESTIMATE, not advice (invariant #9). It deliberately omits
 * portability of a deceased spouse's unused exemption, prior taxable gifts, ILIT
 * structures, valuation discounts, and settlement/illiquidity costs — all of
 * which a professional would layer on. Point estimate "today"; the projected
 * legacy band comes with the Monte Carlo engine (P3).
 */
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
  params: TaxParams = DEFAULT_TAX_PARAMS,
): EstateExposure {
  const exemption = params.estateExemption[filing]
  const taxable = Math.max(0, netWorthInclResidence - exemption)
  const federalTax = taxable * params.estateTopRate
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
