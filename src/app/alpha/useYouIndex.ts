import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Holding } from '../../lib/db'
import { buildYouIndex, periodStart, historySymbol } from '../../lib/finance/youindex'
import type { PriceHistory, PeriodKey } from '../../lib/finance/youindex'
import { QUOTE_TTL_MS } from '../../lib/finance/quotes'

/** The one market line the You Index compares against. */
export const BENCHMARK = 'SPY'

// Backfilling is a once-per-load job shared across tabs.
let requested = false
let benchRequested = false

export function useYouIndex(holdings: Holding[], quotes: Record<string, number>) {
  const [period, setPeriod] = useState<PeriodKey>('1Y')
  const [history, setHistory] = useState<PriceHistory>({})
  const [benchQuote, setBenchQuote] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  // Vendor tickers, which differ from holding tickers for crypto (see historySymbol).
  const symbols = useMemo(() => {
    const s = new Set<string>([BENCHMARK])
    for (const h of holdings) {
      if (h.entry_mode === 'shares' && h.symbol && (h.shares ?? 0) > 0) s.add(historySymbol(h))
    }
    return [...s]
  }, [holdings])

  const from = periodStart(period)

  const load = useCallback(async (syms: string[], since: string) => {
    if (syms.length <= 1) return
    const out: PriceHistory = {}
    for (let i = 0; i < syms.length; i += 40) {
      const { data } = await supabase
        .from('price_history')
        .select('symbol, on_date, close')
        .in('symbol', syms.slice(i, i + 40))
        .gte('on_date', since)
      for (const r of data ?? []) {
        if (r.close == null) continue
        ;(out[r.symbol.toUpperCase()] ??= {})[r.on_date] = Number(r.close)
      }
    }
    setHistory(out)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(symbols, periodStart('1Y'))
  }, [load, symbols])

  // Fetch daily closes for anything we don't have yet, then re-read.
  useEffect(() => {
    if (requested || symbols.length <= 1) return
    requested = true
    void (async () => {
      try {
        await supabase.functions.invoke('refresh-history', {
          body: { symbols, since: periodStart('1Y') },
        })
        await load(symbols, periodStart('1Y'))
      } catch {
        /* keep whatever history we have */
      }
    })()
  }, [symbols, load])

  // The benchmark needs a LIVE price too, or the line's last point would compare
  // today's holdings against the benchmark's last close.
  useEffect(() => {
    if (benchRequested) return
    benchRequested = true
    void (async () => {
      const read = async () => {
        const { data } = await supabase
          .from('quote_cache')
          .select('price, updated_at')
          .eq('symbol', BENCHMARK)
          .maybeSingle()
        return data
      }
      try {
        const row = await read()
        const fresh =
          row?.price != null && Date.now() - new Date(row.updated_at).getTime() < QUOTE_TTL_MS
        if (fresh) {
          setBenchQuote(Number(row!.price))
          return
        }
        await supabase.functions.invoke('refresh-quotes', { body: { symbols: [BENCHMARK] } })
        const again = await read()
        if (again?.price != null) setBenchQuote(Number(again.price))
      } catch {
        /* no live tail — the chart still ends at the last close */
      }
    })()
  }, [])

  const liveQuotes = useMemo(
    () => (benchQuote != null ? { ...quotes, [BENCHMARK]: benchQuote } : quotes),
    [quotes, benchQuote],
  )

  const index = useMemo(
    () => buildYouIndex(holdings, history, BENCHMARK, from, liveQuotes),
    [holdings, history, from, liveQuotes],
  )

  return { index, period, setPeriod, loading }
}
