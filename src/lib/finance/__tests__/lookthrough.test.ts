import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lookThrough, buildEtfMap } from '../lookthrough.ts'
import type { EtfHoldingRow } from '../lookthrough.ts'
import type { Holding } from '../../db.ts'

const hold = (symbol: string | null, kind: string, amount: number): Holding =>
  ({ id: `${symbol}-${amount}`, symbol, name: symbol, kind, entry_mode: 'amount', manual_amount: amount, account_id: null } as unknown as Holding)

/** A broad index fund: only the top 10 are cached, summing to ~35% — the real
 *  shape of the etf_holdings cache (VTSAX top-10 = 34.6% of the fund). */
const broadFundRows: EtfHoldingRow[] = [
  { etf_symbol: 'VTSAX', holding_symbol: 'AAPL', holding_name: 'Apple Inc', weight: 0.06 },
  { etf_symbol: 'VTSAX', holding_symbol: 'MSFT', holding_name: 'Microsoft Corp', weight: 0.055 },
  { etf_symbol: 'VTSAX', holding_symbol: 'NVDA', holding_name: 'NVIDIA Corp', weight: 0.05 },
  ...Array.from({ length: 7 }, (_, i) => ({
    etf_symbol: 'VTSAX',
    holding_symbol: `C${i}`,
    holding_name: `Company ${i}`,
    weight: 0.026,
  })),
] // 0.06+0.055+0.05 + 7*0.026 = 0.347

test("a fund's diversified tail is never ranked as a single name", () => {
  const map = buildEtfMap(broadFundRows)
  // $1,000,000 in the fund; $80,000 in one directly-held stock.
  const lt = lookThrough([hold('VTSAX', 'etf', 1_000_000), hold('TSLA', 'stock', 80_000)], [], {}, map, {})

  assert.equal(lt.investable, 1_080_000)

  // The ~65% tail is reported, not ranked.
  assert.ok(Math.abs(lt.unexplained - 1_000_000 * (1 - 0.347)) < 1)
  assert.ok(Math.abs(lt.unexplainedPct - 653_000 / 1_080_000) < 1e-6)

  // No synthetic "(other)" line anywhere in the ranking.
  assert.equal(lt.topNames.filter((n) => /other/i.test(n.name)).length, 0)
  assert.equal(lt.topNames.filter((n) => n.symbol.includes('~OTHER')).length, 0)

  // The largest single name is the real one: TSLA at 80k beats AAPL's 60k slice.
  assert.equal(lt.singleNameMax?.symbol, 'TSLA')
  assert.ok(Math.abs(lt.singleNameMax!.value - 80_000) < 1)

  // Before this fix the tail (653k) would have ranked first and reported a
  // single-name max of ~60% of investable, which is the bug being pinned here.
  assert.ok(lt.singleNameMax!.pct < 0.1)
})

test('a fund with no composition at all falls into the tail, not the ranking', () => {
  // VNJUX — a muni bond fund. No equity constituents exist to resolve.
  const lt = lookThrough([hold('VNJUX', 'etf', 300_000), hold('AAPL', 'stock', 50_000)], [], {}, {}, {})

  assert.equal(lt.unexplained, 300_000)
  assert.deepEqual(lt.unresolvedEtfs, ['VNJUX'])
  // It is still flagged as unresolved, but it is not a "single name".
  assert.equal(lt.topNames.find((n) => n.symbol === 'VNJUX'), undefined)
  assert.equal(lt.singleNameMax?.symbol, 'AAPL')
})

test('resolved constituents still aggregate across funds and direct holdings', () => {
  const map = buildEtfMap(broadFundRows)
  const lt = lookThrough([hold('VTSAX', 'etf', 1_000_000), hold('AAPL', 'stock', 20_000)], [], {}, map, {})
  // 6% of 1M inside the fund + 20k held directly.
  const apple = lt.topNames.find((n) => n.symbol === 'AAPL')!
  assert.ok(Math.abs(apple.value - (60_000 + 20_000)) < 1)
  assert.equal(apple.resolved, true)
})

test('percentages still sum sensibly: named + tail = investable', () => {
  const map = buildEtfMap(broadFundRows)
  const lt = lookThrough([hold('VTSAX', 'etf', 1_000_000)], [], {}, map, {})
  const named = lt.topNames.reduce((s, n) => s + n.value, 0)
  assert.ok(Math.abs(named + lt.unexplained - lt.investable) < 1)
})
