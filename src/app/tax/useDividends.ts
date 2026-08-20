import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { Holding } from '../../lib/db'
import type { YieldMap } from '../../lib/finance/assetlocation'
import { historySymbol } from '../../lib/finance/youindex'

// Once-per-load, shared across tabs — same guard the other refreshers use.
let requested = false

/** Trailing dividend yields for the user's symboled holdings. */
export function useDividends(holdings: Holding[]) {
  const [yields, setYields] = useState<YieldMap>({})
  const [loading, setLoading] = useState(true)

  const symbols = useMemo(() => {
    const s = new Set<string>()
    // Vendor ticker, not the holding's — bare 'BTC' is a Grayscale ETF on Yahoo.
    for (const h of holdings) if (h.symbol) s.add(historySymbol(h))
    return [...s]
  }, [holdings])

  const load = useCallback(async (syms: string[]) => {
    if (!syms.length) {
      setLoading(false)
      return
    }
    const out: YieldMap = {}
    for (let i = 0; i < syms.length; i += 100) {
      const { data } = await supabase
        .from('dividend_cache')
        .select('symbol, trailing_yield')
        .in('symbol', syms.slice(i, i + 100))
      for (const r of data ?? []) {
        if (r.trailing_yield != null) out[r.symbol.toUpperCase()] = Number(r.trailing_yield)
      }
    }
    setYields(out)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load(symbols)
  }, [load, symbols])

  useEffect(() => {
    if (requested || !symbols.length) return
    requested = true
    void (async () => {
      try {
        await supabase.functions.invoke('refresh-dividends', { body: { symbols } })
        await load(symbols)
      } catch {
        /* keep whatever we have; the panel reports missing data honestly */
      }
    })()
  }, [symbols, load])

  return { yields, loading }
}
