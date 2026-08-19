import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Holding } from '../../lib/db'
import { buildYouIndex, periodStart } from '../../lib/finance/youindex'
import type { PriceHistory, PeriodKey } from '../../lib/finance/youindex'

/** The one market line the You Index compares against. */
export const BENCHMARK = 'SPY'

// Backfilling is a once-per-load job shared across tabs.
let requested = false

export function useYouIndex(holdings: Holding[], quotes: Record<string, number>) {
  const [period, setPeriod] = useState<PeriodKey>('1Y')
  const [history, setHistory] = useState<PriceHistory>({})
  const [loading, setLoading] = useState(true)

  const symbols = useMemo(() => {
    const s = new Set<string>([BENCHMARK])
    for (const h of holdings) {
      if (h.entry_mode === 'shares' && h.symbol && (h.shares ?? 0) > 0) s.add(h.symbol.toUpperCase())
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

  // Fetch daily closes for holdings we don't have yet, then re-read.
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

  const index = useMemo(
    () => buildYouIndex(holdings, history, BENCHMARK, from, quotes),
    [holdings, history, from, quotes],
  )

  return { index, period, setPeriod, loading }
}
