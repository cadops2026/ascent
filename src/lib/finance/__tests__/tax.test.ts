import { test } from 'node:test'
import assert from 'node:assert/strict'
import { niitTax, amtExposure, tentativeMinimumTax, ordinaryTax, standardDeduction } from '../taxtables.ts'
import { taxAwareSourcing } from '../withdrawal.ts'
import type { SourcingInput } from '../withdrawal.ts'
import { assetLocation } from '../tax.ts'
 import { taxAdvantagedReview } from '../taxadvantaged.ts'
import { DEFAULT_TAX_PARAMS } from '../taxparams.ts'
import type { Account, Holding } from '../../db.ts'

test('niitTax: 3.8% on investment income above the MAGI threshold', () => {
  // Below threshold (single $200k): MAGI 150k → no NIIT.
  assert.equal(niitTax(100_000, 50_000, 'single'), 0)
  // Fully above: MAGI 350k, all $50k of gain is over the threshold → 3.8%·50k.
  assert.equal(niitTax(300_000, 50_000, 'single'), 0.038 * 50_000)
  // Straddling: MAGI 230k → only $30k of the gain is over $200k → 3.8%·30k.
  assert.ok(Math.abs(niitTax(180_000, 50_000, 'single') - 0.038 * 30_000) < 1e-6)
})

test('taxAwareSourcing includes NIIT on the taxable gain for a high earner', () => {
  const inp: SourcingInput = {
    netNeed: 200_000,
    taxable: 5_000_000,
    gainFraction: 1, // all gain, to isolate the LTCG+NIIT effect
    taxDeferred: 0,
    taxFree: 0,
    rmd: 0,
    otherOrdinaryIncome: 300_000, // well over the NIIT threshold and into the 15% LTCG band
    filing: 'single',
  }
  // Same plan with NIIT switched off (threshold → Infinity) isolates NIIT's effect.
  const noNiit = {
    ...DEFAULT_TAX_PARAMS,
    niitThreshold: { single: Infinity, hoh: Infinity, mfs: Infinity, mfj: Infinity, qw: Infinity },
  }
  const withNiit = taxAwareSourcing(inp)
  const without = taxAwareSourcing(inp, noNiit)

  assert.ok(withNiit.totalTax > without.totalTax, 'NIIT must add tax for a high earner')
  assert.ok(withNiit.effectiveRate > without.effectiveRate)
  // The gain sits in the 15% LTCG band, so the effective rate on the gross draw
  // should be ~18.8% (15% + 3.8% NIIT), not ~15%.
  assert.ok(withNiit.effectiveRate > 0.18 && withNiit.effectiveRate < 0.20, `eff ${withNiit.effectiveRate}`)
  assert.ok(without.effectiveRate > 0.14 && without.effectiveRate < 0.16, `eff ${without.effectiveRate}`)
})

test('assetLocation flags taxable non-muni bonds, but not munis', () => {
  const acct = { id: 'a1', tax_type: 'taxable' } as unknown as Account
  const bondHolding = (symbol: string): Holding =>
    ({ id: symbol, account_id: 'a1', symbol, kind: 'etf', entry_mode: 'shares', shares: 100_000, manual_amount: null, synthetic_basket: null }) as unknown as Holding

  const taxableBond = assetLocation([acct], [bondHolding('BND')], { BND: 1 })
  assert.ok(
    taxableBond.some((f) => f.tone === 'watch' && /municipal/i.test(f.text)),
    'a taxable Treasury/agg bond fund should draw a muni-location flag',
  )

  const muni = assetLocation([acct], [bondHolding('VTEB')], { VTEB: 1 })
  assert.ok(
    !muni.some((f) => /municipal bonds in taxable/i.test(f.text)),
    'a muni already in taxable should NOT be flagged',
  )
})

test('taxAdvantagedReview surfaces the high-earner opportunities', () => {
  const acct = (tax_type: string) => ({ id: tax_type, tax_type }) as unknown as Account
  const r = taxAdvantagedReview([acct('trad_401k')])
  const titles = r.opportunities.map((o) => o.title)
  assert.ok(titles.some((t) => /backdoor roth ira/i.test(t)), 'no Roth → backdoor nudge')
  assert.ok(titles.some((t) => /mega-backdoor/i.test(t)), 'employer plan → mega-backdoor')
  assert.ok(titles.some((t) => /457/i.test(t)))
  assert.ok(titles.some((t) => /hsa/i.test(t)))
  // Pre-tax IRA → pro-rata trap flagged.
  assert.ok(taxAdvantagedReview([acct('trad_ira')]).opportunities.some((o) => /pro-rata/i.test(o.title)))
  // Roth present → no backdoor-Roth nudge.
  assert.ok(!taxAdvantagedReview([acct('roth_ira')]).opportunities.some((o) => /backdoor roth ira/i.test(o.title)))
})

test('AMT: a high W2 income with no preference items is not binding', () => {
  // Single filer, $400k taxable income, no AMT preferences. AMTI adds back the std
  // deduction. Regular tax exceeds the tentative minimum tax → no AMT.
  const taxable = 400_000
  const amti = taxable + standardDeduction('single') // no ISO / preference add-backs
  const regular = ordinaryTax(taxable, 'single')
  const exp = amtExposure(amti, regular, 'single')
  assert.equal(exp.binding, false)
  assert.equal(exp.amtOwed, 0)
})

test('AMT: a large ISO bargain element makes it binding', () => {
  const taxable = 400_000
  const isoBargainElement = 500_000 // the classic AMT preference (exercise & hold)
  const amti = taxable + standardDeduction('single') + isoBargainElement
  const regular = ordinaryTax(taxable, 'single') // ISO exercise doesn't change regular tax
  const exp = amtExposure(amti, regular, 'single')
  assert.equal(exp.binding, true)
  assert.ok(exp.amtOwed > 50_000, `expected a meaningful AMT bill, got ${exp.amtOwed}`)
  // Exemption is fully/partly phased out at this AMTI.
  assert.ok(tentativeMinimumTax(amti, 'single') > regular)
})
