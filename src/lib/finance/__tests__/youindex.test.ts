import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildYouIndex, periodStart } from '../youindex.ts'
import type { PriceHistory } from '../youindex.ts'
import type { Holding } from '../../db.ts'

const h = (symbol: string, shares: number): Holding =>
  ({ id: symbol, symbol, name: symbol, kind: 'etf', entry_mode: 'shares', shares }) as unknown as Holding

test('you index is the basket normalized to the period start, vs the benchmark', () => {
  // 10 sh A ($10 -> $12) + 5 sh B ($20 -> $20).
  // Start value = 100 + 100 = 200; end = 120 + 100 = 220 => +10%.
  // SPY 400 -> 420 => +5%.
  const history: PriceHistory = {
    A: { '2026-01-01': 10, '2026-01-02': 11, '2026-01-03': 12 },
    B: { '2026-01-01': 20, '2026-01-02': 20, '2026-01-03': 20 },
    SPY: { '2026-01-01': 400, '2026-01-02': 410, '2026-01-03': 420 },
  }
  const r = buildYouIndex([h('A', 10), h('B', 5)], history, 'SPY', '2026-01-01')
  assert.equal(r.points.length, 3)
  assert.equal(r.covered, 2)
  assert.ok(Math.abs(r.you - 0.10) < 1e-9, `you ${r.you}`)
  assert.ok(Math.abs(r.bench - 0.05) < 1e-9, `bench ${r.bench}`)
  assert.ok(Math.abs(r.points[0]!.you) < 1e-9) // starts at zero by construction
})

test('weekend-only crypto prices forward-fill onto the benchmark calendar', () => {
  // SPY has no Saturday bar; the basket must still price that day off Friday.
  const history: PriceHistory = {
    BTC: { '2026-01-02': 100, '2026-01-03': 200 },
    SPY: { '2026-01-02': 100, '2026-01-05': 110 },
  }
  const r = buildYouIndex([h('BTC', 1)], history, 'SPY', '2026-01-02')
  assert.equal(r.points.length, 2) // SPY's two sessions
  assert.ok(Math.abs(r.you - 1.0) < 1e-9, `you ${r.you}`) // Saturday's 200 carries to Monday
})

test('holdings without history for the whole window are left out, not faked', () => {
  const history: PriceHistory = {
    A: { '2026-01-01': 10, '2026-01-02': 12 },
    NEW: { '2026-01-02': 50 }, // listed mid-window
    SPY: { '2026-01-01': 100, '2026-01-02': 100 },
  }
  const r = buildYouIndex([h('A', 1), h('NEW', 1)], history, 'SPY', '2026-01-01')
  assert.equal(r.covered, 1)
  assert.equal(r.skipped, 1)
  assert.ok(Math.abs(r.you - 0.2) < 1e-9, `you ${r.you}`) // A alone, not a fake jump
})

test('YTD anchors to Jan 1', () => {
  assert.equal(periodStart('YTD', new Date('2026-08-18T00:00:00Z')), '2026-01-01')
})
