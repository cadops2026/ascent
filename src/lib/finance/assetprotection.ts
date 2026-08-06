import type { Holding, Account, RealEstate, InsurancePolicy } from '../db'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'
import type { ProtectionFlag } from './disability'

/**
 * Creditor-exposure readout — which dollars a liability claim can actually reach.
 *
 * A liability judgment does not land on "net worth"; it lands on the assets that
 * are reachable. Those are wildly uneven: an ERISA-governed employer plan sits
 * behind a federal anti-alienation shield, an IRA behind a capped and
 * jurisdiction-dependent one, and a taxable brokerage account behind nothing at
 * all. Two investors with identical net worth can have completely different
 * blast radii.
 *
 * This engine sorts the balance sheet into those buckets so the exposure is
 * visible, and so umbrella cover can be sized against what is actually reachable
 * rather than against a headline net-worth number.
 *
 * **This is not legal advice and asserts no legal conclusion (invariant #9).**
 * Creditor protection turns on the state, the kind of claim, whether the matter
 * is inside or outside bankruptcy, how title is held, and the timing of
 * transfers. Every bucket below carries the general framework and a prompt to
 * confirm the specifics with counsel. ASCENT models exposure and flags gaps; it
 * never structures, drafts, or opines.
 */

export const PROTECTION_TIERS = ['strong', 'capped', 'state', 'depends', 'exposed'] as const
export type ProtectionTier = (typeof PROTECTION_TIERS)[number]

export const TIER_LABEL: Record<ProtectionTier, string> = {
  strong: 'Generally well protected',
  capped: 'Protected up to a cap',
  state: 'Depends on state law',
  depends: 'Depends on structure',
  exposed: 'Generally reachable',
}

/** Tiers counted as reachable when sizing liability cover. `capped`/`state`/
 *  `depends` are deliberately treated as reachable — sizing cover against the
 *  optimistic reading of an untested protection is how people get surprised. */
const REACHABLE: ReadonlySet<ProtectionTier> = new Set<ProtectionTier>(['exposed', 'capped', 'state', 'depends'])

export interface ProtectionBucket {
  key: string
  label: string
  value: number
  tier: ProtectionTier
  note: string
}

export interface MalpracticeDetails {
  /** Occurrence policies cover acts during the policy period whenever the claim
   *  arrives; claims-made policies cover only claims reported while cover is live. */
  form?: 'occurrence' | 'claims_made' | 'unknown'
  /** Extended reporting endorsement ("tail") secured for a claims-made policy. */
  tail_secured?: boolean
  per_claim?: number
  aggregate?: number
  employer_provided?: boolean
}

export interface MalpracticeRead {
  form: 'occurrence' | 'claims_made' | 'unknown'
  tailSecured: boolean | null
  perClaim: number
  aggregate: number
  employerProvided: boolean
  /** Reachable assets above the per-claim limit — the personal blast radius. */
  aboveLimit: number
}

export interface AssetProtectionView {
  buckets: ProtectionBucket[]
  /** Sum of `strong`-tier buckets. */
  wellProtected: number
  /** Sum of everything a claim could plausibly reach (see REACHABLE). */
  reachable: number
  total: number
  reachablePct: number
  umbrellaCoverage: number
  /** Reachable assets not covered by umbrella liability. */
  umbrellaGap: number
  malpractice: MalpracticeRead | null
  stateNote: string
  flags: ProtectionFlag[]
}

/** How each account tax-type is generally treated, before state law. */
interface TierDef {
  tier: ProtectionTier
  label: string
  note: string
}

const UNTAGGED: TierDef = {
  tier: 'exposed',
  label: 'Other accounts',
  note: 'Untagged — treated as reachable until the account type is set.',
}

const ACCOUNT_TIER: Record<string, TierDef> = {
  trad_401k: {
    tier: 'strong',
    label: 'Employer 401(k)/403(b) — pre-tax',
    note: 'Employer plans governed by ERISA carry a federal anti-alienation shield that is generally respected against creditors.',
  },
  roth_401k: {
    tier: 'strong',
    label: 'Employer 401(k)/403(b) — Roth',
    note: 'Same ERISA anti-alienation shield as the pre-tax side of an employer plan.',
  },
  cash_balance_db: {
    tier: 'strong',
    label: 'Cash-balance / defined-benefit plan',
    note: 'A qualified employer defined-benefit plan sits behind the same ERISA protection.',
  },
  solo_401k: {
    tier: 'depends',
    label: 'Solo 401(k)',
    note: 'A plan covering only owners is generally NOT an ERISA plan, so it falls back on state law and the bankruptcy code rather than the federal shield. Worth confirming — many assume otherwise.',
  },
  sep_ira: {
    tier: 'capped',
    label: 'SEP-IRA',
    note: 'Treated as an IRA: the federal bankruptcy exemption is capped and inflation-adjusted; outside bankruptcy, state law governs.',
  },
  trad_ira: {
    tier: 'capped',
    label: 'Traditional IRA',
    note: 'Federal bankruptcy exemption is capped and inflation-adjusted. Amounts rolled over from a qualified employer plan are generally not subject to that cap — keeping rollovers unmixed preserves the distinction.',
  },
  roth_ira: {
    tier: 'capped',
    label: 'Roth IRA',
    note: 'Shares the capped IRA bankruptcy exemption with traditional IRAs; state law governs outside bankruptcy.',
  },
  hsa: {
    tier: 'state',
    label: 'HSA',
    note: 'HSAs are not covered by the retirement-account exemptions and are protected only where state law says so — treatment varies widely.',
  },
  '529': {
    tier: 'state',
    label: '529 education accounts',
    note: 'Bankruptcy protection depends on how long before filing the contribution was made, with limits on recent contributions; state law governs otherwise.',
  },
  trust: {
    tier: 'depends',
    label: 'Trust-held assets',
    note: 'A revocable living trust provides no creditor protection during life — it is an estate-planning instrument, not a shield. Irrevocable structures are a different question entirely, and one for counsel.',
  },
  taxable: {
    tier: 'exposed',
    label: 'Taxable brokerage',
    note: 'Directly reachable by a judgment creditor. Usually the largest single piece of the blast radius.',
  },
  other: UNTAGGED,
}

const STATE_NOTES: Record<string, string> = {
  NJ: 'New Jersey provides no state homestead exemption, though a filer may elect the federal exemption set in bankruptcy. Property held by spouses as tenants by the entirety can be shielded from a creditor of one spouse alone. New Jersey also broadly exempts qualified retirement and IRA assets outside bankruptcy, with exceptions. Confirm all of this against your facts with counsel.',
}

const DEFAULT_STATE_NOTE =
  'Homestead protection, tenancy-by-the-entirety availability, and IRA/HSA treatment outside bankruptcy are all set by state law and vary enormously. Confirm the rules for your state with counsel.'

function detailsOf(p: InsurancePolicy): MalpracticeDetails {
  const d = (p as { details?: unknown }).details
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as MalpracticeDetails) : {}
}

export function assetProtectionView(
  holdings: Holding[],
  accounts: Account[],
  realEstate: RealEstate[],
  quotes: QuoteMap,
  policies: InsurancePolicy[],
  state: string | null,
): AssetProtectionView {
  const accountById = new Map(accounts.map((a) => [a.id, a]))

  // Sum holdings into their account's protection bucket. Holdings with no
  // account are reachable by default — an untagged dollar is not a shielded one.
  const totals = new Map<string, number>()
  const add = (key: string, v: number) => totals.set(key, (totals.get(key) ?? 0) + v)

  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0) continue
    const acct = h.account_id != null ? accountById.get(h.account_id) : undefined
    const taxType = acct?.tax_type
    add(taxType && ACCOUNT_TIER[taxType] ? taxType : 'other', v)
  }

  const buckets: ProtectionBucket[] = []
  for (const [key, value] of totals) {
    if (value <= 0) continue
    const def = ACCOUNT_TIER[key] ?? UNTAGGED
    buckets.push({ key, label: def.label, value, tier: def.tier, note: def.note })
  }

  // Real estate. The residence is out of investable allocation (invariant #11)
  // but very much in the creditor conversation, so it belongs here.
  const residence = realEstate.filter((p) => p.kind === 'residence').reduce((s, p) => s + (p.market_value ?? 0), 0)
  const investmentRe = realEstate.filter((p) => p.kind === 'investment').reduce((s, p) => s + (p.market_value ?? 0), 0)
  if (residence > 0) {
    buckets.push({
      key: 'residence',
      label: 'Primary residence',
      value: residence,
      tier: 'state',
      note: 'Protection depends on the state homestead exemption and on how title is held between spouses. Gross value — the mortgage reduces what a creditor could actually recover.',
    })
  }
  if (investmentRe > 0) {
    buckets.push({
      key: 'investment_re',
      label: 'Investment property',
      value: investmentRe,
      tier: 'exposed',
      note: 'Rental property is reachable, and it also creates its own premises liability. Entity structure and adequate liability limits are the usual conversation.',
    })
  }

  buckets.sort((a, b) => b.value - a.value)

  const total = buckets.reduce((s, b) => s + b.value, 0)
  const wellProtected = buckets.filter((b) => b.tier === 'strong').reduce((s, b) => s + b.value, 0)
  const reachable = buckets.filter((b) => REACHABLE.has(b.tier)).reduce((s, b) => s + b.value, 0)

  const umbrellaCoverage = policies
    .filter((p) => p.kind === 'umbrella')
    .reduce((s, p) => s + (p.coverage ?? 0), 0)
  const umbrellaGap = Math.max(0, reachable - umbrellaCoverage)

  // Malpractice — the professional-liability layer that sits in front of everything.
  const mp = policies.find((p) => p.kind === 'malpractice')
  let malpractice: MalpracticeRead | null = null
  if (mp) {
    const d = detailsOf(mp)
    const perClaim = d.per_claim ?? mp.coverage ?? 0
    malpractice = {
      form: d.form ?? 'unknown',
      tailSecured: d.tail_secured ?? null,
      perClaim,
      aggregate: d.aggregate ?? 0,
      employerProvided: d.employer_provided ?? false,
      aboveLimit: Math.max(0, reachable - perClaim),
    }
  }

  const flags: ProtectionFlag[] = []

  if (total > 0 && reachable / total >= 0.5) {
    flags.push({
      severity: 'caution',
      title: `${Math.round((reachable / total) * 100)}% of assets sit outside the strongest protection`,
      detail: 'Employer-plan dollars carry a federal shield that taxable, IRA and state-law-dependent dollars do not. Where new savings land changes this over time.',
    })
  }

  if (umbrellaCoverage <= 0 && reachable > 0) {
    flags.push({
      severity: 'high',
      title: 'No umbrella liability cover recorded',
      detail: `Auto and homeowner limits are the first layer; above them roughly ${fmtM(reachable)} is reachable. Umbrella is the cheapest cover per dollar of protection on the balance sheet.`,
    })
  } else if (umbrellaGap > 0) {
    flags.push({
      severity: 'caution',
      title: 'Umbrella limit sits below reachable assets',
      detail: `About ${fmtM(umbrellaGap)} of reachable assets sits above the umbrella limit.`,
    })
  }

  if (!malpractice) {
    flags.push({
      severity: 'caution',
      title: 'No professional-liability policy recorded',
      detail: 'Add it to see whether the form and limits actually stand between a claim and the reachable assets above.',
    })
  } else {
    if (malpractice.form === 'claims_made' && malpractice.tailSecured !== true) {
      flags.push({
        severity: 'high',
        title: 'Claims-made policy with no tail recorded',
        detail: 'A claims-made policy only responds to claims reported while cover is live. Leaving the job, retiring, or switching carriers without an extended reporting endorsement opens a gap over every year already worked — and the long claim horizon in medicine is exactly what makes that gap expensive.',
      })
    } else if (malpractice.form === 'unknown') {
      flags.push({
        severity: 'caution',
        title: 'Policy form not recorded',
        detail: 'Occurrence vs claims-made decides whether cover follows you when the job ends. It is the first thing to confirm on the declarations page.',
      })
    }
    if (malpractice.employerProvided && malpractice.form === 'claims_made') {
      flags.push({
        severity: 'info',
        title: 'Employer-provided cover ends with the job',
        detail: 'Confirm in writing who buys the tail on separation — employment agreements vary, and this is negotiable while you are still there.',
      })
    }
    if (malpractice.perClaim > 0 && malpractice.aboveLimit > 0) {
      flags.push({
        severity: 'caution',
        title: 'Reachable assets exceed the per-claim limit',
        detail: `About ${fmtM(malpractice.aboveLimit)} sits above the ${fmtM(malpractice.perClaim)} per-claim limit. An award above policy limits is where personal assets enter the picture.`,
      })
    }
  }

  return {
    buckets,
    wellProtected,
    reachable,
    total,
    reachablePct: total > 0 ? reachable / total : 0,
    umbrellaCoverage,
    umbrellaGap,
    malpractice,
    stateNote: (state && STATE_NOTES[state.toUpperCase()]) || DEFAULT_STATE_NOTE,
    flags,
  }
}

/** Compact money for flag prose (the UI formats its own figures). */
function fmtM(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v)}`
}
