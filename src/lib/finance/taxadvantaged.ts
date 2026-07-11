import type { Account } from '../db'
import { DEFAULT_TAX_PARAMS } from './taxparams'
import type { TaxParams } from './taxparams'

/**
 * Tax-advantaged-space review — the high earner's (esp. physician's) #1 lever:
 * are you using every sheltered dollar? The app holds balances, not annual
 * contributions, so this is a *coverage + opportunity* read (which vehicles you
 * have / are missing, plus the backdoor / mega-backdoor / 457(b) / HSA moves and
 * the pro-rata trap) with the year's limits — NOT a contributed-so-far gauge.
 * Decision-support, not tax advice (invariant #9).
 */
export interface VehicleStatus {
  key: string
  label: string
  present: boolean
  limit: number
  note: string
}
export interface TaxOpportunity {
  tone: 'watch' | 'ok'
  title: string
  text: string
}
export interface TaxAdvantagedReview {
  vehicles: VehicleStatus[]
  opportunities: TaxOpportunity[]
}

const usd = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

export function taxAdvantagedReview(
  accounts: Account[],
  params: TaxParams = DEFAULT_TAX_PARAMS,
): TaxAdvantagedReview {
  const types = new Set(accounts.map((a) => a.tax_type))
  const L = params.contributionLimits

  const hasEmployerPlan = types.has('trad_401k') || types.has('roth_401k') || types.has('solo_401k')
  const hasRoth = types.has('roth_401k') || types.has('roth_ira')
  const hasPretaxIra = types.has('trad_ira') || types.has('sep_ira')
  const hasHsa = types.has('hsa')

  const vehicles: VehicleStatus[] = [
    { key: 'employer', label: '401(k) / 403(b) deferral', present: hasEmployerPlan, limit: L.electiveDeferral, note: `+${usd(L.catchUp50)} catch-up at 50+` },
    { key: 'total415c', label: '401(k) total (mega-backdoor)', present: hasEmployerPlan, limit: L.total415c, note: 'employee + employer + after-tax' },
    { key: 'roth', label: 'Roth IRA (backdoor)', present: hasRoth, limit: L.ira, note: `+${usd(L.iraCatchUp)} catch-up at 50+` },
    { key: 'hsa', label: 'HSA', present: hasHsa, limit: L.hsaFamily, note: `${usd(L.hsaSelf)} self · +${usd(L.hsaCatchUp55)} at 55+` },
  ]

  const opportunities: TaxOpportunity[] = []
  if (!hasRoth)
    opportunities.push({
      tone: 'watch',
      title: 'Backdoor Roth IRA',
      text: `As a high earner you're over the direct-Roth income limit. Contribute ${usd(L.ira)} nondeductible to a traditional IRA, then convert it — tax-free growth, no income cap on the conversion.`,
    })
  if (hasPretaxIra)
    opportunities.push({
      tone: 'watch',
      title: 'Pro-rata trap on backdoor Roth',
      text: 'A pre-tax IRA (traditional/SEP) balance makes a backdoor-Roth conversion partly taxable under the pro-rata rule. Roll the pre-tax IRA into your 401(k) first to clear it to $0.',
    })
  if (hasEmployerPlan)
    opportunities.push({
      tone: 'watch',
      title: 'Mega-backdoor Roth',
      text: `If your plan allows after-tax contributions + in-plan Roth conversion, you can fill up to the ${usd(L.total415c)} total (415(c)) limit — far beyond the ${usd(L.electiveDeferral)} elective deferral.`,
    })
  opportunities.push({
    tone: 'watch',
    title: '457(b) — a second deferral',
    text: `A governmental 457(b) deferral (${usd(L.govt457)}) stacks on top of your 401(k)/403(b). A non-governmental 457(b) is an unsecured promise of the employer (credit risk) — weigh that before deferring.`,
  })
  opportunities.push(
    hasHsa
      ? { tone: 'ok', title: 'HSA — invest it', text: 'You have an HSA: invest the balance and pay current medical costs out of pocket. It is the only triple-tax-advantaged account — a stealth IRA.' }
      : { tone: 'watch', title: 'HSA (if on an HDHP)', text: `If you're on a high-deductible plan, the HSA is triple-tax-advantaged (${usd(L.hsaSelf)} self / ${usd(L.hsaFamily)} family). Invest it; don't spend it.` },
  )

  return { vehicles, opportunities }
}
