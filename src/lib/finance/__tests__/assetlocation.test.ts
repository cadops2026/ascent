import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assetLocation, DEFAULT_YIELD_THRESHOLD, isSheltered, isTaxExempt } from '../assetlocation.ts'
import type { QuoteMap } from '../networth.ts'
import type { Holding, Account } from '../../db.ts'

const acct = (id: string, name: string, tax_type: string): Account =>
  ({ id, name, tax_type }) as unknown as Account
const hold = (id: string, symbol: string, shares: number, account_id: string | null): Holding =>
  ({ id, symbol, name: symbol, kind: 'etf', entry_mode: 'shares', shares, account_id,
     manual_amount: null, synthetic_basket: null }) as unknown as Holding

const accounts = [acct('tax', 'Brokerage', 'taxable'), acct('ira', 'Roth IRA', 'roth_ira')]
const quotes: QuoteMap = { LOW: 100, HIGH: 100, NONE: 100, REIT: 100 }

test('ranks lowest-yield first — those are the taxable-friendly ones', () => {
  const r = assetLocation(
    [hold('a', 'HIGH', 10, 'tax'), hold('b', 'LOW', 10, 'tax')],
    accounts, quotes, { HIGH: 0.035, LOW: 0.002 },
  )
  assert.deepEqual(r.bestForTaxable.map((x) => x.symbol), ['LOW', 'HIGH'])
  assert.equal(r.bestForTaxable[0]!.placement, 'good-in-taxable')
})

test('flags a high-yield holding sitting in a taxable account', () => {
  // $1,000 at 3.5% = $35/yr of dividends landing in a 1099.
  const r = assetLocation([hold('a', 'REIT', 10, 'tax')], accounts, quotes, { REIT: 0.035 })
  assert.equal(r.misplaced.length, 1)
  assert.equal(r.misplaced[0]!.placement, 'better-sheltered')
  assert.ok(Math.abs(r.misplaced[0]!.annualIncome - 35) < 1e-9)
  assert.ok(Math.abs(r.taxableIncome - 35) < 1e-9)
})

test('the same holding inside a Roth is not flagged, and adds no taxable income', () => {
  const r = assetLocation([hold('a', 'REIT', 10, 'ira')], accounts, quotes, { REIT: 0.035 })
  assert.equal(r.misplaced.length, 0)
  assert.equal(r.bestForTaxable[0]!.placement, 'already-sheltered')
  assert.equal(r.taxableIncome, 0)
})

test('missing dividend data is reported, never treated as zero yield', () => {
  // A no-data holding must NOT out-rank a genuinely 0.2%-yield one.
  const r = assetLocation(
    [hold('a', 'NONE', 10, 'tax'), hold('b', 'LOW', 10, 'tax')],
    accounts, quotes, { LOW: 0.002 },
  )
  assert.deepEqual(r.bestForTaxable.map((x) => x.symbol), ['LOW'])
  assert.equal(r.unknownValue, 1000)
  assert.equal(r.taxableIncome, 2) // only LOW contributes
})

test('threshold is honoured exactly at the boundary', () => {
  const at = assetLocation([hold('a', 'LOW', 10, 'tax')], accounts, quotes,
    { LOW: DEFAULT_YIELD_THRESHOLD })
  assert.equal(at.misplaced.length, 0) // equal to threshold is NOT over it
  const over = assetLocation([hold('a', 'LOW', 10, 'tax')], accounts, quotes,
    { LOW: DEFAULT_YIELD_THRESHOLD + 1e-9 })
  assert.equal(over.misplaced.length, 1)
})

test('untagged accounts are treated as taxable, matching the rest of the app', () => {
  const r = assetLocation([hold('a', 'REIT', 10, null)], accounts, quotes, { REIT: 0.035 })
  assert.equal(isSheltered(null), false)
  assert.equal(r.misplaced.length, 1)
  assert.ok(Math.abs(r.taxableIncome - 35) < 1e-9)
})

test('a municipal fund is NOT flagged for sheltering, however high its yield', () => {
  // The real case this guards: VNJUX at 3.70% was ranked #1 "move to shelter",
  // which is backwards — sheltering a muni throws away the exemption entirely.
  const muni = { id: 'm', symbol: 'VNJUX', name: 'VANGUARD NEW JERSEY LONG TERM TAX EXEMPT ADMIRAL CL',
    kind: 'etf', entry_mode: 'shares', shares: 10, account_id: 'tax',
    manual_amount: null, synthetic_basket: null } as unknown as Holding
  const r = assetLocation([muni], accounts, { VNJUX: 100 }, { VNJUX: 0.037 })

  assert.equal(r.misplaced.length, 0, 'muni must never be flagged for sheltering')
  assert.equal(r.bestForTaxable[0]!.placement, 'tax-exempt')
  assert.equal(r.bestForTaxable[0]!.taxExempt, true)
  // Its distributions are real income but not TAXABLE income.
  assert.equal(r.taxableIncome, 0)
})

test('a muni outranks a low-yield taxable holding for taxable placement', () => {
  const muni = { id: 'm', symbol: 'VTEB', name: 'Vanguard Tax-Exempt Bond ETF', kind: 'etf',
    entry_mode: 'shares', shares: 10, account_id: 'tax', manual_amount: null,
    synthetic_basket: null } as unknown as Holding
  const r = assetLocation([hold('b', 'LOW', 10, 'tax'), muni], accounts,
    { LOW: 100, VTEB: 100 }, { LOW: 0.002, VTEB: 0.031 })
  // Muni sorts as zero taxable yield -> ahead of the 0.2% payer.
  assert.deepEqual(r.bestForTaxable.map((x) => x.symbol), ['VTEB', 'LOW'])
})

test('tax-exempt detection matches the phrasings statements actually use', () => {
  const yes = ['VANGUARD NEW JERSEY LONG TERM TAX EXEMPT ADMIRAL CL',
               'Vanguard Tax-Exempt Bond ETF', 'iShares National Muni Bond ETF',
               'Some Municipal Income Fund']
  for (const n of yes) {
    assert.equal(isTaxExempt({ name: n, symbol: null }), true, n)
  }
  // Must not swallow ordinary funds that merely mention tax.
  assert.equal(isTaxExempt({ name: 'Vanguard Tax-Managed Capital Appreciation', symbol: 'VTCLX' }), false)
  assert.equal(isTaxExempt({ name: 'Vanguard Total Stock Market Index', symbol: 'VTSAX' }), false)
})
