import type { Holding, Account, FilingStatus } from '../db'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'
import { bracketAt, bracketsFor, marginalRate, irmaaTier, rmdDivisor, rmdStartAge } from './taxtables'
import { DEFAULT_TAX_PARAMS } from './taxparams'
import type { TaxParams } from './taxparams'

/**
 * Tax & Withdrawal engine. Models tax *exposure* and the conventional levers
 * (location, sequencing, conversions, RMDs, harvesting) to sharpen the
 * conversation with a CPA — it never files a return or gives individualized tax
 * advice (invariant #9). Statutory numbers come from taxtables.ts and are shown.
 */

export type TaxBucket = 'taxable' | 'tax_deferred' | 'tax_free' | 'hsa' | 'other'

export const BUCKET_LABEL: Record<TaxBucket, string> = {
  taxable: 'Taxable',
  tax_deferred: 'Tax-deferred',
  tax_free: 'Tax-free (Roth)',
  hsa: 'HSA',
  other: 'Other',
}

export function bucketForTaxType(taxType: string): TaxBucket {
  switch (taxType) {
    case 'taxable': return 'taxable'
    case 'trad_401k': case 'trad_ira': case 'sep_ira': case 'solo_401k': case 'cash_balance_db':
      return 'tax_deferred'
    case 'roth_401k': case 'roth_ira': return 'tax_free'
    case 'hsa': return 'hsa'
    default: return 'other' // 529, trust, other
  }
}

export interface BucketSlice {
  bucket: TaxBucket
  value: number
  pct: number
}

/** Group account balances into tax buckets (the foundation for everything else). */
export function taxBuckets(accounts: Account[], holdings: Holding[], quotes: QuoteMap): {
  slices: BucketSlice[]
  total: number
  byBucket: Record<TaxBucket, number>
} {
  const acctBucket = new Map(accounts.map((a) => [a.id, bucketForTaxType(a.tax_type)]))
  const byBucket: Record<TaxBucket, number> = { taxable: 0, tax_deferred: 0, tax_free: 0, hsa: 0, other: 0 }
  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0) continue
    const b = (h.account_id && acctBucket.get(h.account_id)) || 'taxable' // untagged ⇒ taxable (conservative)
    byBucket[b] += v
  }
  const total = Object.values(byBucket).reduce((s, v) => s + v, 0)
  const order: TaxBucket[] = ['taxable', 'tax_deferred', 'tax_free', 'hsa', 'other']
  const slices = order
    .filter((b) => byBucket[b] > 0)
    .map((b) => ({ bucket: b, value: byBucket[b], pct: total > 0 ? byBucket[b] / total : 0 }))
  return { slices, total, byBucket }
}

export interface SequenceStep {
  bucket: TaxBucket
  rationale: string
}

/** Conventional tax-efficient drawdown order (general case — a CPA tailors it). */
export function withdrawalSequence(byBucket: Record<TaxBucket, number>): SequenceStep[] {
  const steps: { bucket: TaxBucket; rationale: string }[] = [
    { bucket: 'taxable', rationale: 'Spend taxable first — only gains are taxed (often at lower LTCG rates), and it lets tax-advantaged accounts keep compounding.' },
    { bucket: 'tax_deferred', rationale: 'Then tax-deferred — withdrawals are ordinary income; draw enough to fill low brackets (and satisfy RMDs once they begin).' },
    { bucket: 'tax_free', rationale: 'Roth last — tax-free growth is the most valuable to preserve, and it has no RMDs; ideal for late-life and heirs.' },
    { bucket: 'hsa', rationale: 'HSA for qualified medical costs — triple tax-advantaged; keep receipts to reimburse later tax-free.' },
  ]
  return steps.filter((s) => (byBucket[s.bucket] ?? 0) > 0)
}

export interface LocationFlag {
  tone: 'watch' | 'ok'
  text: string
}

/** Light asset-location read: tax-inefficient cash/interest sitting in taxable. */
export function assetLocation(accounts: Account[], holdings: Holding[], quotes: QuoteMap): LocationFlag[] {
  const acctBucket = new Map(accounts.map((a) => [a.id, bucketForTaxType(a.tax_type)]))
  let cashInTaxable = 0
  let equityInRoth = 0
  for (const h of holdings) {
    const v = holdingValue(h, quotes) ?? 0
    if (v <= 0) continue
    const b = (h.account_id && acctBucket.get(h.account_id)) || 'taxable'
    if (h.kind === 'cash' && b === 'taxable') cashInTaxable += v
    if ((h.kind === 'stock' || h.kind === 'etf') && b === 'tax_free') equityInRoth += v
  }
  const flags: LocationFlag[] = []
  if (cashInTaxable > 25_000)
    flags.push({ tone: 'watch', text: `~${Math.round(cashInTaxable).toLocaleString('en-US')} of cash sits in taxable accounts, generating taxable interest. Interest-bearing assets are usually better held in tax-deferred space.` })
  if (equityInRoth > 0)
    flags.push({ tone: 'ok', text: 'Growth equities in Roth is good location — the highest-expected-growth assets shelter best in tax-free space.' })
  if (flags.length === 0) flags.push({ tone: 'ok', text: 'No obvious location inefficiency from the current holdings.' })
  return flags
}

export interface TlhLot {
  symbol: string
  name: string
  value: number
  costBasis: number
  unrealizedLoss: number
}

/** Holding-level harvest opportunities: taxable positions trading below basis. */
export function tlhOpportunities(
  accounts: Account[],
  holdings: Holding[],
  quotes: QuoteMap,
  minLoss = 3_000,
): { lots: TlhLot[]; totalLoss: number } {
  const acctBucket = new Map(accounts.map((a) => [a.id, bucketForTaxType(a.tax_type)]))
  const lots: TlhLot[] = []
  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0 || h.cost_basis == null) continue
    const b = (h.account_id && acctBucket.get(h.account_id)) || 'taxable'
    if (b !== 'taxable') continue // harvesting only helps in taxable accounts
    const loss = h.cost_basis - v
    if (loss >= minLoss) {
      lots.push({ symbol: h.symbol ?? h.name ?? '—', name: h.name ?? h.symbol ?? '—', value: v, costBasis: h.cost_basis, unrealizedLoss: loss })
    }
  }
  lots.sort((a, b) => b.unrealizedLoss - a.unrealizedLoss)
  return { lots, totalLoss: lots.reduce((s, l) => s + l.unrealizedLoss, 0) }
}

export interface RmdView {
  startAge: number
  currentAge: number | null
  yearsUntil: number | null
  active: boolean
  divisor: number | null
  projectedRmd: number | null // current tax-deferred balance ÷ divisor at start age
}

export function rmdProjection(
  taxDeferredBalance: number,
  dob: string | null | undefined,
  params: TaxParams = DEFAULT_TAX_PARAMS,
): RmdView {
  const birthYear = dob ? new Date(dob).getFullYear() : null
  const currentAge = dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 864e5)) : null
  const startAge = birthYear != null ? rmdStartAge(birthYear) : 73
  const ageForDivisor = currentAge != null && currentAge >= startAge ? currentAge : startAge
  const divisor = rmdDivisor(ageForDivisor, params)
  return {
    startAge,
    currentAge,
    yearsUntil: currentAge != null ? Math.max(0, startAge - currentAge) : null,
    active: currentAge != null && currentAge >= startAge,
    divisor,
    projectedRmd: divisor ? taxDeferredBalance / divisor : null,
  }
}

export interface RothConversionResult {
  startBracket: number
  endBracket: number
  marginalRateOnConversion: number
  roomToNextBracket: number
  irmaaBefore: number
  irmaaAfter: number
  irmaaCrossed: boolean
  estTax: number
}

/** Marginal picture of converting `amount` to Roth at a given taxable income. */
export function rothConversion(
  taxableIncome: number,
  amount: number,
  filing: FilingStatus,
  params: TaxParams = DEFAULT_TAX_PARAMS,
): RothConversionResult {
  const start = bracketAt(taxableIncome, filing, params)
  const end = bracketAt(taxableIncome + amount, filing, params)
  // Blended marginal rate across any brackets the conversion spans. Iterate the
  // brackets (not income) so a value landing exactly on a ceiling can't stall.
  const hi = taxableIncome + amount
  let tax = 0
  let prevCeiling = 0
  for (const t of bracketsFor(filing, params)) {
    const lo = Math.max(taxableIncome, prevCeiling)
    const top = Math.min(hi, t.upTo)
    if (top > lo) tax += (top - lo) * t.rate
    prevCeiling = t.upTo
    if (prevCeiling >= hi) break
  }
  const irmaaBefore = irmaaTier(taxableIncome, filing, params)
  const irmaaAfter = irmaaTier(taxableIncome + amount, filing, params)
  return {
    startBracket: start.rate,
    endBracket: end.rate,
    marginalRateOnConversion: amount > 0 ? tax / amount : marginalRate(taxableIncome, filing, params),
    roomToNextBracket: Math.max(0, start.ceiling - taxableIncome),
    irmaaBefore: irmaaBefore.surcharge,
    irmaaAfter: irmaaAfter.surcharge,
    irmaaCrossed: irmaaAfter.index > irmaaBefore.index,
    estTax: tax,
  }
}

export interface CoordinatePrompt {
  title: string
  note: string
}

/** Flags that need data we don't hold (income) or a professional — prompt, don't compute. */
export function coordinatePrompts(ctx: {
  age: number | null
  hasTaxDeferred: boolean
  hasBusiness: boolean
  hasAppreciatedTaxable: boolean
}): CoordinatePrompt[] {
  const out: CoordinatePrompt[] = []
  if (ctx.hasAppreciatedTaxable)
    out.push({ title: 'Donate appreciated stock, not cash', note: 'Gifting long-held appreciated taxable lots to charity/a DAF avoids the capital-gains tax and still deducts fair value.' })
  if (ctx.age != null && ctx.age >= 70 && ctx.hasTaxDeferred)
    out.push({ title: 'QCD from your IRA (age 70½+)', note: 'A Qualified Charitable Distribution gives directly from the IRA, counts toward RMDs, and stays out of MAGI (helps IRMAA).' })
  if (ctx.hasBusiness)
    out.push({ title: 'QBI / cash-balance / Solo-401(k)', note: 'Business income may qualify for the QBI deduction; a Solo-401(k), SEP, or cash-balance plan can shelter large contributions — size with your CPA.' })
  out.push({ title: 'NIIT & AMT', note: 'Investment income above the MAGI threshold ($200k single / $250k MFJ) draws the 3.8% NIIT; large deductions/ISO exercises can trigger AMT. Flag for your return.' })
  return out
}
