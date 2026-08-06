import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetProtectionView } from '../assetprotection.ts'
import type { MalpracticeDetails } from '../assetprotection.ts'
import { insuranceGaps } from '../insurance.ts'
import type { Holding, Account, RealEstate, InsurancePolicy } from '../../db.ts'

const acct = (id: string, tax_type: string): Account => ({ id, tax_type } as unknown as Account)

const hold = (account_id: string | null, manual_amount: number): Holding =>
  ({ id: `h-${account_id}-${manual_amount}`, account_id, kind: 'stock', entry_mode: 'amount', manual_amount } as unknown as Holding)

const re = (kind: string, market_value: number): RealEstate =>
  ({ id: `re-${kind}`, kind, market_value } as unknown as RealEstate)

const policy = (kind: string, coverage: number, details: MalpracticeDetails = {}): InsurancePolicy =>
  ({ id: `p-${kind}`, kind, coverage, carrier: 'Test', details } as unknown as InsurancePolicy)

const ACCOUNTS = [
  acct('a-401k', 'trad_401k'),
  acct('a-ira', 'trad_ira'),
  acct('a-tax', 'taxable'),
  acct('a-hsa', 'hsa'),
  acct('a-solo', 'solo_401k'),
]

const HOLDINGS = [
  hold('a-401k', 1_000_000),
  hold('a-ira', 500_000),
  hold('a-tax', 2_000_000),
  hold('a-hsa', 100_000),
  hold('a-solo', 400_000),
]

test('accounts sort into protection tiers and totals add up', () => {
  const v = assetProtectionView(HOLDINGS, ACCOUNTS, [], {}, [], 'NJ')

  assert.equal(v.total, 4_000_000)
  // Only the ERISA employer plan is 'strong'.
  assert.equal(v.wellProtected, 1_000_000)
  // Everything else is treated as reachable: IRA (capped) + taxable + HSA (state) + solo-401k (depends).
  assert.equal(v.reachable, 3_000_000)
  assert.equal(v.reachablePct, 0.75)

  const byKey = new Map(v.buckets.map((b) => [b.key, b]))
  assert.equal(byKey.get('trad_401k')!.tier, 'strong')
  assert.equal(byKey.get('trad_ira')!.tier, 'capped')
  assert.equal(byKey.get('taxable')!.tier, 'exposed')
  assert.equal(byKey.get('hsa')!.tier, 'state')
  // A solo 401(k) is generally not an ERISA plan — it must NOT inherit 'strong'.
  assert.equal(byKey.get('solo_401k')!.tier, 'depends')
})

test('buckets are ordered largest first', () => {
  const v = assetProtectionView(HOLDINGS, ACCOUNTS, [], {}, [], 'NJ')
  const values = v.buckets.map((b) => b.value)
  assert.deepEqual(values, [...values].sort((a, b) => b - a))
})

test('holdings with no account are treated as reachable, not shielded', () => {
  const v = assetProtectionView([hold(null, 250_000)], [], [], {}, [], null)
  assert.equal(v.reachable, 250_000)
  assert.equal(v.wellProtected, 0)
  assert.equal(v.buckets[0]!.tier, 'exposed')
})

test('residence is state-dependent; investment property is reachable', () => {
  const v = assetProtectionView([], [], [re('residence', 1_200_000), re('investment', 600_000)], {}, [], 'NJ')
  const byKey = new Map(v.buckets.map((b) => [b.key, b]))
  assert.equal(byKey.get('residence')!.tier, 'state')
  assert.equal(byKey.get('investment_re')!.tier, 'exposed')
  assert.equal(v.reachable, 1_800_000)
})

test('umbrella gap measures against reachable assets, not the whole balance sheet', () => {
  const v = assetProtectionView(HOLDINGS, ACCOUNTS, [], {}, [policy('umbrella', 2_000_000)], 'NJ')
  assert.equal(v.umbrellaCoverage, 2_000_000)
  // reachable 3.0M − 2.0M cover = 1.0M gap (NOT 4.0M total − 2.0M).
  assert.equal(v.umbrellaGap, 1_000_000)
  assert.ok(v.flags.some((f) => /umbrella limit sits below/i.test(f.title)))
})

test('the insurance summary sizes umbrella off the same reachable number (invariant #1)', () => {
  const ap = assetProtectionView(HOLDINGS, ACCOUNTS, [], {}, [policy('umbrella', 2_000_000)], 'NJ')
  const lines = insuranceGaps([policy('umbrella', 2_000_000)], {
    netWorth: 4_000_000,
    liabilities: 0,
    annualSpending: 180_000,
    liquidAssets: 2_000_000,
    age: 40,
    hasBusinessOrRental: false,
    reachableAssets: ap.reachable,
  })
  const umbrella = lines.find((l) => l.kind === 'umbrella')!
  // The two readouts must agree; without reachableAssets it would have said 4.0M.
  assert.equal(umbrella.modeledNeed, ap.reachable)
  assert.equal(umbrella.gap, ap.umbrellaGap)

  const fallback = insuranceGaps([policy('umbrella', 2_000_000)], {
    netWorth: 4_000_000,
    liabilities: 0,
    annualSpending: 180_000,
    liquidAssets: 2_000_000,
    age: 40,
    hasBusinessOrRental: false,
  })
  assert.equal(fallback.find((l) => l.kind === 'umbrella')!.modeledNeed, 4_000_000)
})

test('the disability verdict passes through so the summary cannot contradict the detail', () => {
  const ctx = {
    netWorth: 4_000_000,
    liabilities: 0,
    annualSpending: 180_000,
    liquidAssets: 2_000_000,
    age: 40,
    hasBusinessOrRental: false,
  }
  // Presence alone would read "covered" — the engine's verdict must win.
  const withPolicy = [policy('disability', 5_000)]
  assert.equal(insuranceGaps(withPolicy, ctx).find((l) => l.kind === 'disability')!.status, 'covered')
  assert.equal(
    insuranceGaps(withPolicy, { ...ctx, disabilityStatus: 'gap' }).find((l) => l.kind === 'disability')!.status,
    'gap',
  )
})

test('claims-made cover with no tail is a high-severity flag', () => {
  const v = assetProtectionView(
    HOLDINGS,
    ACCOUNTS,
    [],
    {},
    [policy('malpractice', 1_000_000, { form: 'claims_made', per_claim: 1_000_000, aggregate: 3_000_000 })],
    'NJ',
  )
  assert.equal(v.malpractice!.form, 'claims_made')
  assert.equal(v.malpractice!.tailSecured, null)
  assert.ok(v.flags.some((f) => f.severity === 'high' && /no tail recorded/i.test(f.title)))

  const withTail = assetProtectionView(
    HOLDINGS,
    ACCOUNTS,
    [],
    {},
    [policy('malpractice', 1_000_000, { form: 'claims_made', tail_secured: true, per_claim: 1_000_000 })],
    'NJ',
  )
  assert.ok(!withTail.flags.some((f) => /no tail recorded/i.test(f.title)))
})

test('occurrence cover raises no tail flag', () => {
  const v = assetProtectionView(
    HOLDINGS,
    ACCOUNTS,
    [],
    {},
    [policy('malpractice', 1_000_000, { form: 'occurrence', per_claim: 1_000_000 })],
    'NJ',
  )
  assert.ok(!v.flags.some((f) => /tail/i.test(f.title)))
})

test('reachable assets above the per-claim limit are the personal blast radius', () => {
  const v = assetProtectionView(
    HOLDINGS,
    ACCOUNTS,
    [],
    {},
    [policy('malpractice', 0, { form: 'occurrence', per_claim: 1_000_000 })],
    'NJ',
  )
  // reachable 3.0M − 1.0M per-claim limit.
  assert.equal(v.malpractice!.aboveLimit, 2_000_000)
  assert.ok(v.flags.some((f) => /exceed the per-claim limit/i.test(f.title)))
})

test('state note is specific where known and generic otherwise', () => {
  const nj = assetProtectionView([], [], [], {}, [], 'nj') // case-insensitive
  assert.match(nj.stateNote, /New Jersey/)
  const other = assetProtectionView([], [], [], {}, [], 'CA')
  assert.match(other.stateNote, /vary enormously/)
  const none = assetProtectionView([], [], [], {}, [], null)
  assert.match(none.stateNote, /vary enormously/)
})

test('an empty balance sheet produces no divide-by-zero', () => {
  const v = assetProtectionView([], [], [], {}, [], null)
  assert.equal(v.total, 0)
  assert.equal(v.reachablePct, 0)
  assert.equal(v.umbrellaGap, 0)
  assert.equal(v.malpractice, null)
})
