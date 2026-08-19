// You Index — your own holdings tracked as a single index line, against one
// market benchmark. Deliberately simple: two lines, two numbers, no per-holding
// statistics. It answers "how did what I own do, versus the market", nothing more.
import type { Holding } from '../db'

/** symbol (UPPERCASE) -> (YYYY-MM-DD -> close) */
export type PriceHistory = Record<string, Record<string, number>>

/**
 * The ticker daily history is stored under, which is NOT always the ticker the
 * holding uses. Crypto needs Yahoo's `-USD` pair: bare "BTC" on Yahoo is the
 * Grayscale Bitcoin Mini Trust ETF (~$28), not bitcoin (~$64k) — and it returns
 * data happily rather than erroring, so an unmapped crypto symbol silently
 * prices a completely different instrument.
 */
export function historySymbol(h: Pick<Holding, 'kind' | 'symbol'>): string {
  const s = (h.symbol ?? '').toUpperCase()
  if (!s) return s
  return h.kind === 'crypto' && !s.endsWith('-USD') ? `${s}-USD` : s
}

export interface IndexPoint {
  date: string
  /** Cumulative return since the period start, as a fraction (0.12 = +12%). */
  you: number
  bench: number
}

export interface YouIndex {
  points: IndexPoint[]
  /** True when the last point is today's live price rather than a daily close. */
  live: boolean
  /** Headline return over the whole period. */
  you: number
  bench: number
  benchmark: string
  /** Holdings included, and how much of your value they represent. */
  covered: number
  coveredValue: number
  skipped: number
}

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/** Sorted [date, close] pairs, so the index walk is a linear merge, not a scan. */
type Series = { dates: string[]; closes: number[] }

function toSeries(map: Record<string, number> | undefined): Series | null {
  if (!map) return null
  const dates = Object.keys(map).sort()
  if (!dates.length) return null
  return { dates, closes: dates.map((d) => map[d]!) }
}

/** Last close at or before `date`, using a forward-only cursor. Returns null
 *  before the series starts. Forward-fill matters: ETFs skip weekends while
 *  crypto trades through them, so the two must be read on a common calendar. */
function advance(s: Series, cursor: { i: number }, date: string): number | null {
  while (cursor.i + 1 < s.dates.length && s.dates[cursor.i + 1]! <= date) cursor.i++
  if (s.dates[cursor.i]! > date) return null
  return s.closes[cursor.i]!
}

/**
 * Build the index. Uses your CURRENT share counts across the whole window, so
 * it shows how the mix you hold today would have performed — it is not a record
 * of your actual trading. That is the same simplification the chart makes
 * readable, and it is stated in the UI rather than hidden.
 */
export function buildYouIndex(
  holdings: Holding[],
  history: PriceHistory,
  benchmark: string,
  fromDate: string,
  quotes: Record<string, number> = {},
  now: Date = new Date(),
): YouIndex {
  const bench = toSeries(history[benchmark.toUpperCase()])
  const empty: YouIndex = {
    points: [], live: false, you: 0, bench: 0, benchmark, covered: 0, coveredValue: 0, skipped: 0,
  }
  if (!bench) return empty

  // Only holdings priced for the ENTIRE window — a basket that changes
  // membership mid-chart would show a jump that isn't a real return.
  const candidates = holdings.filter(
    (h) => h.entry_mode === 'shares' && h.symbol && (h.shares ?? 0) > 0,
  )
  const basket: { shares: number; series: Series; cursor: { i: number }; symbol: string }[] = []
  let skipped = 0
  for (const h of candidates) {
    // History is keyed by the vendor ticker; live quotes by the holding's own.
    const s = toSeries(history[historySymbol(h)])
    if (!s || s.dates[0]! > fromDate) {
      skipped++
      continue
    }
    basket.push({ shares: h.shares!, series: s, cursor: { i: 0 }, symbol: h.symbol!.toUpperCase() })
  }
  if (!basket.length) return { ...empty, skipped }

  const bCursor = { i: 0 }
  const dates = bench.dates.filter((d) => d >= fromDate)
  const points: IndexPoint[] = []
  let base = 0
  let baseBench = 0

  for (const date of dates) {
    const bp = advance(bench, bCursor, date)
    if (bp == null) continue
    let value = 0
    let ok = true
    for (const b of basket) {
      const p = advance(b.series, b.cursor, date)
      if (p == null) { ok = false; break }
      value += b.shares * p
    }
    if (!ok || value <= 0) continue

    if (!base) { base = value; baseBench = bp }
    points.push({ date, you: value / base - 1, bench: bp / baseBench - 1 })
  }

  // Live tail: daily closes stop at the last session, but the rest of the app
  // re-prices every 15 minutes. Extend the line to right now using the quote
  // cache so the two don't disagree. Only when EVERY leg has a live price —
  // a partial basket would understate the value and read as a fake drop.
  let live = false
  const benchNow = quotes[benchmark.toUpperCase()]
  if (benchNow != null && benchNow > 0 && base > 0) {
    let v = 0
    let ok = true
    for (const b of basket) {
      const p = quotes[b.symbol]
      if (p == null || p <= 0) { ok = false; break }
      v += b.shares * p
    }
    if (ok && v > 0) {
      const today = isoDay(now.getTime())
      const point = { date: today, you: v / base - 1, bench: benchNow / baseBench - 1 }
      if (points.length && points[points.length - 1]!.date === today) {
        points[points.length - 1] = point // today's close already in — live wins
      } else {
        points.push(point)
      }
      live = true
    }
  }

  const last = points[points.length - 1]
  return {
    points,
    live,
    you: last?.you ?? 0,
    bench: last?.bench ?? 0,
    benchmark,
    covered: basket.length,
    coveredValue: basket.reduce((s, b) => s + b.shares * (quotes[b.symbol] ?? 0), 0),
    skipped,
  }
}

export const PERIODS = [
  { key: '1M', label: '1M', days: 30 },
  { key: '3M', label: '3M', days: 91 },
  { key: 'YTD', label: 'YTD', days: 0 },
  { key: '1Y', label: '1Y', days: 365 },
] as const
export type PeriodKey = (typeof PERIODS)[number]['key']

/** Start date for a period key. YTD anchors to Jan 1 of the current year. */
export function periodStart(key: PeriodKey, now: Date = new Date()): string {
  if (key === 'YTD') return `${now.getUTCFullYear()}-01-01`
  const days = PERIODS.find((p) => p.key === key)!.days
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}
