import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Holding, TaxLot } from '../../lib/db'
import type { QuoteMap } from '../../lib/finance/networth'
import type { CmaClass } from '../../lib/finance/assetclass'
import { benchmarkCoverage, portfolioAlpha } from '../../lib/finance/alpha'
import type { PortfolioAlpha, PriceHistory } from '../../lib/finance/alpha'

const DAY_MS = 86_400_000
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10)
/** closeOn() walks back at most this far for weekends/holidays, so these are the
 *  only dates worth fetching — far cheaper than pulling whole daily series. */
const LOOKBACK_DAYS = 10

function neededDates(lots: TaxLot[], now: Date): string[] {
  const out = new Set<string>()
  const addWindow = (iso: string) => {
    const t = Date.parse(iso)
    if (!Number.isFinite(t)) return
    for (let i = 0; i <= LOOKBACK_DAYS; i++) out.add(isoDay(t - i * DAY_MS))
  }
  for (const l of lots) if (l.acquired_on) addWindow(l.acquired_on)
  addWindow(isoDay(now.getTime()))
  return [...out]
}

// Backfilling history is a once-per-load job, and the tab that gets there first
// does it for everyone — so the guard is module-level, like the quote refresh.
let historyRequested = false

/**
 * Loads everything the alpha engine needs — tax lots for purchase dates, the
 * asset-class universe for the noise band's volatility, and benchmark closes on
 * exactly the dates the lots require — and backfills missing benchmark history.
 */
export function useAlpha(holdings: Holding[], quotes: QuoteMap) {
  const [lots, setLots] = useState<TaxLot[]>([])
  const [vols, setVols] = useState<Record<string, number>>({})
  const [history, setHistory] = useState<PriceHistory>({})
  const [loading, setLoading] = useState(true)
  const [backfilling, setBackfilling] = useState(false)
  const inFlight = useRef(false)

  const coverage = useMemo(() => benchmarkCoverage(holdings, lots), [holdings, lots])

  const loadHistory = useCallback(
    async (syms: string[], forLots: TaxLot[]) => {
      if (!syms.length) return {} as PriceHistory
      const dates = neededDates(forLots, new Date())
      const out: PriceHistory = {}
      // Chunked so the PostgREST query string stays a sane length.
      for (let i = 0; i < dates.length; i += 200) {
        const { data } = await supabase
          .from('price_history')
          .select('symbol, on_date, close')
          .in('symbol', syms)
          .in('on_date', dates.slice(i, i + 200))
        for (const r of data ?? []) {
          if (r.close == null) continue
          ;(out[r.symbol.toUpperCase()] ??= {})[r.on_date] = Number(r.close)
        }
      }
      return out
    },
    [],
  )

  const reload = useCallback(async () => {
    const [lotRows, uniRows] = await Promise.all([
      supabase.from('tax_lots').select('*'),
      supabase.from('asset_class_universe').select('class, vol'),
    ])
    const nextLots = (lotRows.data ?? []) as TaxLot[]
    const nextVols: Record<string, number> = {}
    for (const u of uniRows.data ?? []) if (u.vol != null) nextVols[u.class] = Number(u.vol)

    setLots(nextLots)
    setVols(nextVols)
    setHistory(await loadHistory(benchmarkCoverage(holdings, nextLots).symbols, nextLots))
    setLoading(false)
  }, [holdings, loadHistory])

  useEffect(() => {
    void reload()
  }, [reload])

  // Backfill benchmark closes back to the earliest purchase, then re-read.
  // Silent on failure: the meter simply reports lower coverage (invariant #6).
  useEffect(() => {
    if (loading || inFlight.current || historyRequested) return
    if (!coverage.symbols.length || !coverage.since) return
    historyRequested = true
    inFlight.current = true
    void (async () => {
      setBackfilling(true)
      try {
        const { error } = await supabase.functions.invoke('refresh-history', {
          body: { symbols: coverage.symbols, since: coverage.since },
        })
        if (!error) setHistory(await loadHistory(coverage.symbols, lots))
      } catch {
        /* leave whatever history we already have */
      } finally {
        setBackfilling(false)
        inFlight.current = false
      }
    })()
  }, [loading, coverage, lots, loadHistory])

  const classVol = useCallback(
    (c: CmaClass) => vols[c] ?? 0.15, // universe default, mirrors buildCma
    [vols],
  )

  const result: PortfolioAlpha = useMemo(
    () => portfolioAlpha(holdings, lots, quotes, history, classVol),
    [holdings, lots, quotes, history, classVol],
  )

  return { alpha: result, loading, backfilling, reload }
}
