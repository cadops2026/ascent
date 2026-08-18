import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type {
  Account,
  Holding,
  RealEstate,
  Liability,
  SpendingBaseline,
  Profile,
  QuoteCache,
} from '../../lib/db'
import type { QuoteMap } from '../../lib/finance/networth'
import {
  claimAutoRefresh,
  pricesAsOf,
  quotesAreStale,
  refreshHoldingQuotes,
} from '../../lib/finance/quotes'

export interface BalanceData {
  accounts: Account[]
  holdings: Holding[]
  realEstate: RealEstate[]
  liabilities: Liability[]
  spending: SpendingBaseline | null
  profile: Profile | null
  quotes: QuoteMap
  /** symbol (UPPERCASE) -> when that price was fetched (epoch ms). */
  quoteAsOf: Record<string, number>
}

const EMPTY: BalanceData = {
  accounts: [],
  holdings: [],
  realEstate: [],
  liabilities: [],
  spending: null,
  profile: null,
  quotes: {},
  quoteAsOf: {},
}

/** Loads the whole balance sheet for the signed-in user (RLS scopes to them),
 *  and keeps prices current: if any holding's quote is older than the TTL this
 *  re-prices it in the background, so every tab reads live numbers rather than
 *  whatever was cached the last time the Balance Sheet happened to be open. */
export function useBalanceSheet() {
  const [data, setData] = useState<BalanceData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [pricing, setPricing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Guards the reload -> refresh -> reload effect against re-entering itself.
  const refreshing = useRef(false)

  const reload = useCallback(async () => {
    setError(null)
    const [acc, hold, re, liab, spend, prof, quoteRows] = await Promise.all([
      supabase.from('accounts').select('*').order('created_at'),
      supabase.from('holdings').select('*').order('created_at'),
      supabase.from('real_estate').select('*').order('created_at'),
      supabase.from('liabilities').select('*').order('created_at'),
      supabase.from('spending_baseline').select('*').maybeSingle(),
      supabase.from('profiles').select('*').maybeSingle(),
      supabase.from('quote_cache').select('*'),
    ])

    const firstErr = [acc, hold, re, liab, quoteRows].find((r) => r.error)?.error
    if (firstErr) {
      setError(firstErr.message)
      setLoading(false)
      return
    }

    const quotes: QuoteMap = {}
    const quoteAsOf: Record<string, number> = {}
    for (const q of (quoteRows.data ?? []) as QuoteCache[]) {
      if (q.price == null) continue
      const sym = q.symbol.toUpperCase()
      quotes[sym] = q.price
      quoteAsOf[sym] = new Date(q.updated_at).getTime()
    }

    setData({
      accounts: acc.data ?? [],
      holdings: hold.data ?? [],
      realEstate: re.data ?? [],
      liabilities: liab.data ?? [],
      spending: spend.data ?? null,
      profile: prof.data ?? null,
      quotes,
      quoteAsOf,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // Re-price stale holdings once per TTL window, on whichever tab loaded first.
  // Failures stay silent: stale prices still render, and a quote outage is not
  // something to alarm the user about (invariant #6).
  useEffect(() => {
    if (loading || refreshing.current) return
    if (!quotesAreStale(data.holdings, data.quoteAsOf)) return
    if (!claimAutoRefresh()) return
    refreshing.current = true
    void (async () => {
      setPricing(true)
      try {
        await refreshHoldingQuotes(data.holdings)
        await reload()
      } catch {
        /* leave the cached prices in place */
      } finally {
        setPricing(false)
        refreshing.current = false
      }
    })()
  }, [loading, data.holdings, data.quoteAsOf, reload])

  return {
    data,
    loading,
    /** True while prices are being re-fetched in the background. */
    pricing,
    /** Oldest quote backing the current holdings — how current the numbers are. */
    asOf: pricesAsOf(data.holdings, data.quoteAsOf),
    error,
    reload,
  }
}
