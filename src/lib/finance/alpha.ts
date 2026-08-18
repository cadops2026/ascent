// Alpha engine — realized, class-relative excess return since purchase.
//
// This MEASURES what already happened; it never forecasts what will outperform
// (invariant #5). Two design choices carry most of the honesty:
//
//  1. Each holding is benchmarked against its OWN asset class, not the market.
//     A bond fund is judged against bonds. Measuring everything against total
//     US equity would label every diversifier a loser and invite exactly the
//     reactive selling this app exists to dampen.
//
//  2. Every alpha figure carries a noise band (invariant #4). Excess return over
//     a short window is mostly luck, and the band says so out loud: a holding is
//     only called ahead/behind when its alpha clears ~1.65 standard errors.
//     Most holdings land in 'noise', which is the truthful answer.
//
// Known limitation, surfaced in the UI: returns here are PRICE-only. A holding's
// return comes from cost basis vs current price, and benchmark closes are
// split- but not dividend-adjusted, so both sides of the subtraction omit
// income. Alpha is therefore only fair where a holding's yield is close to its
// benchmark's; a high-yield holding will read low against a low-yield index.
import type { Holding, TaxLot, HoldingKind } from '../db'
import { cmaClassForHolding } from './assetclass'
import type { CmaClass } from './assetclass'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'

/** Benchmark per CMA class. Classes with no honest public proxy map to null and
 *  are excluded from the meter rather than measured against something wrong. */
export const BENCHMARK_FOR_CMA: Record<CmaClass, string | null> = {
  us_equity: 'VTI',
  intl_equity: 'VXUS',
  bonds: 'BND',
  tips: 'SCHP',
  cash: 'BIL',
  real_estate: 'VNQ',
  commodities: 'DJP',
  crypto: 'BTC-USD',
  private_equity: null, // marks/valuations aren't comparable to a public index
  collectibles: null,
}

/** Assumed annual tracking error vs the class benchmark, as a multiple of that
 *  class's volatility. This sets the width of the noise band — the higher it is,
 *  the more excess return is treated as luck. Assumptions stay visible and
 *  editable (spec §6); these are deliberately conservative. */
export const TE_MULTIPLE: Record<HoldingKind, number> = {
  etf: 0.35, // a fund drifts from its class, but not far
  stock: 1.0, // one name carries roughly class-sized idiosyncratic risk
  crypto: 1.0,
  cash: 0.15,
  private: 1.0,
  collectible: 1.0,
}

/** Below this, annualizing turns a small move into a meaningless headline
 *  number (a 3% gain over three weeks annualizes past 60%). Held-too-briefly
 *  holdings are reported as not-yet-measurable instead. */
export const MIN_YEARS = 0.25

/** Alpha must clear this many standard errors to count as signal (~90% one-sided). */
export const SIGNAL_SIGMAS = 1.65

/** symbol -> (YYYY-MM-DD -> close) */
export type PriceHistory = Record<string, Record<string, number>>

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Close on `isoDate`, walking back over weekends/holidays to the last session. */
export function closeOn(
  series: Record<string, number> | undefined,
  isoDate: string,
  maxBackDays = 10,
): number | null {
  if (!series) return null
  let ms = Date.parse(isoDate)
  if (!Number.isFinite(ms)) return null
  for (let i = 0; i <= maxBackDays; i++) {
    const v = series[isoDay(ms)]
    if (v != null) return v
    ms -= DAY_MS
  }
  return null
}

/** Annualized (CAGR) form of a total return earned over `years`. */
function annualize(totalReturn: number, years: number): number {
  return Math.pow(1 + totalReturn, 1 / years) - 1
}

export type AlphaSignal = 'ahead' | 'behind' | 'noise'

export interface HoldingAlpha {
  holdingId: string
  label: string
  symbol: string | null
  cmaClass: CmaClass
  benchmark: string
  /** Current market value — the weight this carries in portfolio alpha. */
  value: number
  costBasis: number
  /** Dollar-weighted holding period in years. */
  years: number
  annualizedReturn: number
  benchAnnualized: number
  /** Annualized excess return vs its own class. The headline. */
  alpha: number
  /** One standard error of that alpha estimate — the noise band. */
  noise: number
  signal: AlphaSignal
}

/** A holding the meter deliberately leaves out, with the reason shown to the
 *  user. Silence here would quietly bias the portfolio number. */
export interface AlphaExclusion {
  holdingId: string
  label: string
  value: number
  reason: string
}

export interface PortfolioAlpha {
  /** Dollar-weighted annualized alpha across measurable holdings. */
  alpha: number
  /** One standard error of the portfolio figure. */
  noise: number
  signal: AlphaSignal
  /** Value covered by the measurement, and the share of investable it represents. */
  measuredValue: number
  coverage: number
  holdings: HoldingAlpha[]
  excluded: AlphaExclusion[]
}

/** One lot's contribution: exact basis, exact window. */
interface LotSlice {
  shares: number
  costBasis: number
  acquired: string
}

/** Lots for a holding, or a single synthetic lot from the holding's own basis.
 *  Returns null when there's no honest way to date the purchase. */
function lotsFor(h: Holding, lots: TaxLot[]): LotSlice[] | null {
  const own = lots.filter((l) => l.holding_id === h.id && l.acquired_on && l.cost_basis > 0)
  if (own.length) {
    return own.map((l) => ({
      shares: l.shares,
      costBasis: l.cost_basis,
      acquired: l.acquired_on!,
    }))
  }
  return null
}

/**
 * Realized annualized alpha for one holding vs its class benchmark.
 * Computed per tax lot (each lot has its own basis and its own window), then
 * dollar-weighted — which is exact, where a single average purchase date is not.
 */
export function holdingAlpha(
  h: Holding,
  lots: TaxLot[],
  quotes: QuoteMap,
  history: PriceHistory,
  classVol: (c: CmaClass) => number,
  now: Date = new Date(),
): HoldingAlpha | AlphaExclusion {
  const label = h.name ?? h.symbol ?? 'Untitled holding'
  const value = holdingValue(h, quotes) ?? 0
  const out = (reason: string): AlphaExclusion => ({ holdingId: h.id, label, value, reason })

  if (value <= 0) return out('not priced yet')

  const cls = cmaClassForHolding(h)
  const benchmark = BENCHMARK_FOR_CMA[cls]
  if (!benchmark) return out(`no public benchmark for ${cls.replace(/_/g, ' ')}`)

  const slices = lotsFor(h, lots)
  if (!slices) {
    return out(
      h.cost_basis == null
        ? 'no cost basis recorded'
        : 'no purchase date — add a tax lot to measure it',
    )
  }

  const series = history[benchmark.toUpperCase()]
  if (!series) return out(`no price history for ${benchmark}`)

  const totalShares = slices.reduce((s, l) => s + l.shares, 0)
  if (totalShares <= 0) return out('no shares recorded')
  const pricePerShare = value / totalShares
  const nowIso = isoDay(now.getTime())
  const benchNow = closeOn(series, nowIso)
  if (benchNow == null) return out(`no current ${benchmark} close`)

  // Per-lot, then weight by each lot's CURRENT value (its share of the position).
  let wSum = 0
  let wReturn = 0
  let wBench = 0
  let wYears = 0
  let basis = 0
  let skippedShort = 0

  for (const lot of slices) {
    const lotValue = lot.shares * pricePerShare
    const years = (now.getTime() - Date.parse(lot.acquired)) / (365.25 * DAY_MS)
    if (!Number.isFinite(years) || years < MIN_YEARS) {
      skippedShort += lotValue
      continue
    }
    const benchThen = closeOn(series, lot.acquired)
    if (benchThen == null || benchThen <= 0) continue

    const lotReturn = annualize(lotValue / lot.costBasis - 1, years)
    const benchReturn = annualize(benchNow / benchThen - 1, years)

    wSum += lotValue
    wReturn += lotValue * lotReturn
    wBench += lotValue * benchReturn
    wYears += lotValue * years
    basis += lot.costBasis
  }

  if (wSum <= 0) {
    return out(skippedShort > 0 ? `held under ${MIN_YEARS * 12} months` : 'benchmark history too short')
  }

  const annualizedReturn = wReturn / wSum
  const benchAnnualized = wBench / wSum
  const years = wYears / wSum
  const alpha = annualizedReturn - benchAnnualized

  // Standard error of an annualized excess return over `years`: TE / sqrt(T).
  const te = (TE_MULTIPLE[h.kind as HoldingKind] ?? 1.0) * classVol(cls)
  const noise = te / Math.sqrt(years)

  return {
    holdingId: h.id,
    label,
    symbol: h.symbol,
    cmaClass: cls,
    benchmark,
    value: wSum,
    costBasis: basis,
    years,
    annualizedReturn,
    benchAnnualized,
    alpha,
    noise,
    signal: alpha > SIGNAL_SIGMAS * noise ? 'ahead' : alpha < -SIGNAL_SIGMAS * noise ? 'behind' : 'noise',
  }
}

const isExclusion = (x: HoldingAlpha | AlphaExclusion): x is AlphaExclusion => 'reason' in x

/**
 * Portfolio alpha: the dollar-weighted average of per-holding alpha.
 *
 * Because each holding is measured against its OWN class, this isolates
 * selection — what your picks added over simply owning each category — and
 * deliberately excludes the effect of the allocation itself, which is a
 * decision you already steer elsewhere in the app.
 *
 * The portfolio noise band assumes holdings' residuals-vs-their-own-benchmark
 * are roughly independent. Within a class that's optimistic (two large-cap
 * funds share exposure), so treat the band as a floor on the true uncertainty.
 */
export function portfolioAlpha(
  holdings: Holding[],
  lots: TaxLot[],
  quotes: QuoteMap,
  history: PriceHistory,
  classVol: (c: CmaClass) => number,
  now: Date = new Date(),
): PortfolioAlpha {
  const results = holdings.map((h) => holdingAlpha(h, lots, quotes, history, classVol, now))
  const measured = results.filter((r): r is HoldingAlpha => !isExclusion(r))
  const excluded = results.filter(isExclusion)

  const measuredValue = measured.reduce((s, m) => s + m.value, 0)
  const totalValue = measuredValue + excluded.reduce((s, e) => s + e.value, 0)

  if (measuredValue <= 0) {
    return {
      alpha: 0,
      noise: 0,
      signal: 'noise',
      measuredValue: 0,
      coverage: 0,
      holdings: [],
      excluded,
    }
  }

  let alpha = 0
  let varSum = 0
  for (const m of measured) {
    const w = m.value / measuredValue
    alpha += w * m.alpha
    varSum += (w * m.noise) ** 2
  }
  const noise = Math.sqrt(varSum)

  return {
    alpha,
    noise,
    signal: alpha > SIGNAL_SIGMAS * noise ? 'ahead' : alpha < -SIGNAL_SIGMAS * noise ? 'behind' : 'noise',
    measuredValue,
    coverage: totalValue > 0 ? measuredValue / totalValue : 0,
    holdings: measured.slice().sort((a, b) => a.alpha - b.alpha),
    excluded,
  }
}

/** Holdings genuinely behind their own class — alpha below the noise band, not
 *  merely negative. Ordered worst-first, and by dollars at stake among ties. */
export function underperformers(p: PortfolioAlpha): HoldingAlpha[] {
  return p.holdings
    .filter((h) => h.signal === 'behind')
    .sort((a, b) => a.alpha - b.alpha || b.value - a.value)
}

/** Every benchmark symbol the current holdings need priced, plus the earliest
 *  purchase date history must reach back to. */
export function benchmarkCoverage(
  holdings: Holding[],
  lots: TaxLot[],
): { symbols: string[]; since: string | null } {
  const symbols = new Set<string>()
  for (const h of holdings) {
    const b = BENCHMARK_FOR_CMA[cmaClassForHolding(h)]
    if (b) symbols.add(b)
  }
  const ids = new Set(holdings.map((h) => h.id))
  const dates = lots
    .filter((l) => ids.has(l.holding_id) && l.acquired_on)
    .map((l) => l.acquired_on!)
    .sort()
  return { symbols: [...symbols], since: dates[0] ?? null }
}
