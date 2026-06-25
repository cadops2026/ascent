import { useCallback, useEffect, useState } from 'react'
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

export interface BalanceData {
  accounts: Account[]
  holdings: Holding[]
  realEstate: RealEstate[]
  liabilities: Liability[]
  spending: SpendingBaseline | null
  profile: Profile | null
  quotes: QuoteMap
}

const EMPTY: BalanceData = {
  accounts: [],
  holdings: [],
  realEstate: [],
  liabilities: [],
  spending: null,
  profile: null,
  quotes: {},
}

/** Loads the whole balance sheet for the signed-in user (RLS scopes to them). */
export function useBalanceSheet() {
  const [data, setData] = useState<BalanceData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

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
    for (const q of (quoteRows.data ?? []) as QuoteCache[]) {
      if (q.price != null) quotes[q.symbol.toUpperCase()] = q.price
    }

    setData({
      accounts: acc.data ?? [],
      holdings: hold.data ?? [],
      realEstate: re.data ?? [],
      liabilities: liab.data ?? [],
      spending: spend.data ?? null,
      profile: prof.data ?? null,
      quotes,
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { data, loading, error, reload }
}
