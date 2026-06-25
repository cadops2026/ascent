import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { cmaParamsFromJson } from './finance/cmaparams'
import type { CmaParams } from './finance/cmaparams'

export interface CmaParamsState {
  /** User's CMA override, or null when none is stored (engines use the seeded consensus). */
  params: CmaParams | null
  storedYear: number | null
  loading: boolean
  reload: () => Promise<void>
}

/** Loads the latest year's user CMA override; null until one is saved (or table unmigrated). */
export function useCmaParams(): CmaParamsState {
  const [params, setParams] = useState<CmaParams | null>(null)
  const [storedYear, setStoredYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('cma_params')
        .select('cma_year, params')
        .order('cma_year', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) {
        setParams(null)
        setStoredYear(null)
      } else {
        setParams(cmaParamsFromJson(data.params))
        setStoredYear(data.cma_year)
      }
    } catch {
      setParams(null)
      setStoredYear(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { params, storedYear, loading, reload }
}
