import { test } from 'node:test'
import assert from 'node:assert/strict'
import { computeBalanceSheet } from '../networth.ts'
import type { QuoteMap } from '../networth.ts'
import type { Holding } from '../../db.ts'

// Minimal shares-based holding (only the fields the engine reads at runtime).
const holding = (symbol: string, kind: string, shares: number): Holding =>
  ({
    id: symbol,
    symbol,
    kind,
    entry_mode: 'shares',
    shares,
    manual_amount: null,
    synthetic_basket: null,
    account_id: null,
  }) as unknown as Holding

test('a 60/40 (VTI + BND) is NOT collapsed into 100% us_equity (P0-B fix)', () => {
  // $600k VTI + $400k BND, priced at $1 so shares == dollars.
  const holdings = [holding('VTI', 'etf', 600_000), holding('BND', 'etf', 400_000)]
  const quotes: QuoteMap = { VTI: 1, BND: 1 }
  const bs = computeBalanceSheet(holdings, [], [], quotes)

  // The bug: the old taxonomy produced { us_equity: 1_000_000 }.
  assert.equal(bs.cmaWeights.us_equity, 600_000, 'bond sleeve must not be modeled as equity')
  assert.equal(bs.cmaWeights.bonds, 400_000)
  assert.equal(bs.cmaWeights.us_equity ?? 0, 600_000)
  assert.notEqual(bs.cmaWeights.us_equity, 1_000_000)

  // Coarse pie reflects the split too.
  const byClass = Object.fromEntries(bs.byClass.map((s) => [s.class, s.value]))
  assert.equal(byClass.Equities, 600_000)
  assert.equal(byClass.Bonds, 400_000)
  assert.equal(bs.investable, 1_000_000)
})

test('cmaWeights sum to investable (holdings only)', () => {
  const holdings = [
    holding('VTI', 'etf', 500_000),
    holding('VXUS', 'etf', 200_000),
    holding('TIP', 'etf', 150_000),
    holding('BTC', 'crypto', 150_000),
  ]
  const quotes: QuoteMap = { VTI: 1, VXUS: 1, TIP: 1, BTC: 1 }
  const bs = computeBalanceSheet(holdings, [], [], quotes)
  assert.equal(bs.cmaWeights.us_equity, 500_000)
  assert.equal(bs.cmaWeights.intl_equity, 200_000)
  assert.equal(bs.cmaWeights.tips, 150_000)
  assert.equal(bs.cmaWeights.crypto, 150_000)
  const sum = Object.values(bs.cmaWeights).reduce((a, b) => a + b, 0)
  assert.equal(sum, bs.investable)
})
