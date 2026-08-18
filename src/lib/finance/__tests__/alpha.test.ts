import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  holdingAlpha,
  portfolioAlpha,
  underperformers,
  benchmarkCoverage,
  closeOn,
  MIN_YEARS,
} from '../alpha.ts'
import type { PriceHistory, HoldingAlpha, AlphaExclusion } from '../alpha.ts'
import type { QuoteMap } from '../networth.ts'
import type { Holding, TaxLot } from '../../db.ts'

const holding = (id: string, symbol: string, kind: string, shares: number): Holding =>
  ({
    id,
    symbol,
    name: symbol,
    kind,
    entry_mode: 'shares',
    shares,
    cost_basis: null,
    manual_amount: null,
    synthetic_basket: null,
    account_id: null,
  }) as unknown as Holding

const lot = (holdingId: string, shares: number, costBasis: number, acquired: string): TaxLot =>
  ({ id: `${holdingId}-${acquired}`, holding_id: holdingId, shares, cost_basis: costBasis, acquired_on: acquired }) as unknown as TaxLot

// Flat 20% vol for every class keeps the noise band hand-checkable.
const vol = () => 0.2
const NOW = new Date('2026-08-17T00:00:00Z')

/** Daily series from a start date at a constant compound daily rate. */
function series(startIso: string, startPrice: number, endIso: string, endPrice: number) {
  const d0 = Date.parse(startIso)
  const d1 = Date.parse(endIso)
  const days = Math.round((d1 - d0) / 86_400_000)
  const step = Math.pow(endPrice / startPrice, 1 / days)
  const out: Record<string, number> = {}
  for (let i = 0; i <= days; i++) {
    out[new Date(d0 + i * 86_400_000).toISOString().slice(0, 10)] = startPrice * Math.pow(step, i)
  }
  return out
}

const asAlpha = (r: HoldingAlpha | AlphaExclusion) => {
  assert.ok(!('reason' in r), `expected a measurement, got exclusion: ${(r as AlphaExclusion).reason}`)
  return r as HoldingAlpha
}

test('alpha = holding CAGR minus its own benchmark CAGR over the same window', () => {
  // Bought 4 yrs ago (2022-08-17) for $10,000; now worth 100 sh x $200 = $20,000.
  // Holding CAGR = 2^(1/4) - 1 = 18.9207%.
  // VTI over the same window: 100 -> 150, CAGR = 1.5^(1/4) - 1 = 10.6682%.
  // alpha = 18.9207% - 10.6682% = 8.2525%.
  const h = holding('h1', 'AAPL', 'stock', 100)
  const lots = [lot('h1', 100, 10_000, '2022-08-17')]
  const quotes: QuoteMap = { AAPL: 200 }
  const history: PriceHistory = { VTI: series('2022-08-17', 100, '2026-08-17', 150) }

  const r = asAlpha(holdingAlpha(h, lots, quotes, history, vol, NOW))
  assert.equal(r.benchmark, 'VTI')
  assert.ok(Math.abs(r.years - 4) < 0.01, `years ${r.years}`)
  assert.ok(Math.abs(r.annualizedReturn - 0.189207) < 1e-4, `ret ${r.annualizedReturn}`)
  assert.ok(Math.abs(r.benchAnnualized - 0.106682) < 1e-4, `bench ${r.benchAnnualized}`)
  assert.ok(Math.abs(r.alpha - 0.082525) < 1e-4, `alpha ${r.alpha}`)

  // Noise: TE = 1.0 (stock) x 0.20 vol = 0.20; SE = 0.20 / sqrt(4) = 0.10.
  assert.ok(Math.abs(r.noise - 0.1) < 1e-9, `noise ${r.noise}`)
  // 8.25% alpha does NOT clear 1.65 x 10% = 16.5% -> honestly reported as noise.
  assert.equal(r.signal, 'noise')
})

test('a bond fund is judged against bonds, not against equities', () => {
  // BND-like holding flat over 4 yrs while equities ran: must NOT read as behind.
  const h = holding('h2', 'BNDX', 'etf', 1000)
  const lots = [lot('h2', 1000, 10_000, '2022-08-17')]
  const quotes: QuoteMap = { BNDX: 10 } // $10,000 now — dead flat, 0% return
  const history: PriceHistory = {
    BND: series('2022-08-17', 100, '2026-08-17', 100), // bonds flat too
    VTI: series('2022-08-17', 100, '2026-08-17', 200), // equities doubled
  }
  const r = asAlpha(holdingAlpha(h, lots, quotes, history, vol, NOW))
  assert.equal(r.benchmark, 'BND')
  assert.ok(Math.abs(r.alpha) < 1e-9, `alpha ${r.alpha}`)
  assert.equal(r.signal, 'noise')
})

test('only alpha outside the noise band is called behind', () => {
  // ETF halved (-50%) over 4 yrs while its class doubled (+100%).
  // Holding CAGR = 0.5^(1/4)-1 = -15.910%; bench = 2^(1/4)-1 = +18.921%.
  // alpha = -34.83%. TE = 0.35 x 0.20 = 0.07; SE = 0.07/2 = 3.5%; 1.65*SE = 5.78%.
  const h = holding('h3', 'ARKK', 'etf', 100)
  const lots = [lot('h3', 100, 20_000, '2022-08-17')]
  const quotes: QuoteMap = { ARKK: 100 } // $10,000 now vs $20,000 basis
  const history: PriceHistory = { VTI: series('2022-08-17', 100, '2026-08-17', 200) }

  const r = asAlpha(holdingAlpha(h, lots, quotes, history, vol, NOW))
  assert.ok(Math.abs(r.alpha - -0.348307) < 1e-4, `alpha ${r.alpha}`)
  assert.ok(Math.abs(r.noise - 0.035) < 1e-9, `noise ${r.noise}`)
  assert.equal(r.signal, 'behind')
})

test('multi-lot positions weight each lot by its own basis and window', () => {
  // Two equal-share lots of the same holding, bought 4 yrs and 1 yr ago.
  // Now: 200 sh x $150 = $30,000, so each 100-share lot is worth $15,000.
  //   Lot A: $10,000 -> $15,000 over 4y  => 1.5^(1/4)-1 = 10.6682%
  //   Lot B: $12,000 -> $15,000 over 1y  => 25%
  // Equal current value => return = (10.6682 + 25)/2 = 17.8341%.
  const h = holding('h4', 'MSFT', 'stock', 200)
  const lots = [lot('h4', 100, 10_000, '2022-08-17'), lot('h4', 100, 12_000, '2025-08-17')]
  const quotes: QuoteMap = { MSFT: 150 }
  const history: PriceHistory = { VTI: series('2022-08-17', 100, '2026-08-17', 100) } // flat bench

  const r = asAlpha(holdingAlpha(h, lots, quotes, history, vol, NOW))
  assert.ok(Math.abs(r.annualizedReturn - 0.178341) < 1e-4, `ret ${r.annualizedReturn}`)
  assert.ok(Math.abs(r.benchAnnualized) < 1e-6, `bench ${r.benchAnnualized}`)
  assert.ok(Math.abs(r.years - 2.5) < 0.01, `years ${r.years}`) // equal weight on 4y and 1y
  assert.ok(Math.abs(r.costBasis - 22_000) < 1e-6)
})

test('holdings too new, undated, or unbenchmarkable are excluded with a reason', () => {
  const history: PriceHistory = { VTI: series('2020-01-01', 100, '2026-08-17', 200) }
  const quotes: QuoteMap = { NEW: 100, OLD: 100, PVT: 100 }

  // Held one month — annualizing would print an absurd headline number.
  const tooNew = holdingAlpha(
    holding('a', 'NEW', 'stock', 100), [lot('a', 100, 9_000, '2026-07-17')], quotes, history, vol, NOW,
  )
  assert.ok('reason' in tooNew && tooNew.reason.includes(`${MIN_YEARS * 12} months`), JSON.stringify(tooNew))

  // No tax lot at all -> no honest purchase date.
  const undated = holdingAlpha(holding('b', 'OLD', 'stock', 100), [], quotes, history, vol, NOW)
  assert.ok('reason' in undated && /cost basis|purchase date/.test(undated.reason))

  // Private equity has no public benchmark — excluded, never faked against VTI.
  const pvt = holdingAlpha(
    holding('c', 'PVT', 'private', 100), [lot('c', 100, 5_000, '2020-01-01')], quotes, history, vol, NOW,
  )
  assert.ok('reason' in pvt && pvt.reason.includes('no public benchmark'))
})

test('portfolio alpha is dollar-weighted and reports its own coverage', () => {
  // Bench (VTI 100->150 over 4y) = 10.6682% CAGR.
  //   $30k winner: doubled over 4y => 18.9207% - 10.6682% = +8.2525% alpha
  //   $10k loser:  halved over 4y  => -15.9104% - 10.6682% = -26.5786% alpha
  // Weights 0.75 / 0.25 => 0.75(8.2525) + 0.25(-26.5786) = -0.4553%.
  const holdings = [
    holding('w', 'AAPL', 'stock', 150), // 150 x $200 = $30,000
    holding('l', 'ARKK', 'etf', 100), // 100 x $100 = $10,000
    holding('p', 'PVT', 'private', 100), // $10,000, no benchmark
  ]
  const lots = [
    lot('w', 150, 15_000, '2022-08-17'), // doubled over 4y
    lot('l', 100, 20_000, '2022-08-17'), // halved over 4y
    lot('p', 100, 5_000, '2022-08-17'),
  ]
  const quotes: QuoteMap = { AAPL: 200, ARKK: 100, PVT: 100 }
  const history: PriceHistory = { VTI: series('2022-08-17', 100, '2026-08-17', 150) }

  const p = portfolioAlpha(holdings, lots, quotes, history, vol, NOW)
  assert.equal(p.holdings.length, 2)
  assert.ok(Math.abs(p.alpha - -0.004553) < 1e-5, `alpha ${p.alpha}`)
  assert.equal(p.measuredValue, 40_000)
  assert.ok(Math.abs(p.coverage - 0.8) < 1e-9, `coverage ${p.coverage}`) // 40k of 50k
  assert.equal(p.excluded.length, 1)
  assert.ok(p.excluded[0]!.reason.includes('no public benchmark'))

  // Portfolio SE = sqrt((0.75*0.10)^2 + (0.25*0.035)^2) = 0.075509 -> alpha is noise.
  assert.ok(Math.abs(p.noise - 0.075509) < 1e-5, `noise ${p.noise}`)
  assert.equal(p.signal, 'noise')

  // The ARKK loser clears its band; the winner does not clear its own.
  const under = underperformers(p)
  assert.equal(under.length, 1)
  assert.equal(under[0]!.symbol, 'ARKK')
})

test('closeOn walks back over weekends to the last session', () => {
  const s = { '2026-08-14': 42 } // Friday
  assert.equal(closeOn(s, '2026-08-16'), 42) // Sunday -> Friday's close
  assert.equal(closeOn(s, '2026-08-01'), null) // too far back, no invention
})

test('benchmarkCoverage names the symbols and the earliest date history must reach', () => {
  const holdings = [holding('a', 'VTI', 'etf', 1), holding('b', 'BTC', 'crypto', 1)]
  const lots = [lot('a', 1, 1, '2019-03-04'), lot('b', 1, 1, '2021-11-09')]
  const c = benchmarkCoverage(holdings, lots)
  assert.deepEqual(c.symbols.sort(), ['BTC-USD', 'VTI'])
  assert.equal(c.since, '2019-03-04')
})
