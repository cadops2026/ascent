import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import { DEFAULT_TAX_PARAMS, paramsFromJson } from './finance/taxparams'
import type { TaxParams } from './finance/taxparams'

export interface TaxParamsState {
  params: TaxParams
  /** Year of the loaded row; null when falling back to the built-in defaults. */
  storedYear: number | null
  usingDefaults: boolean
  loading: boolean
  reload: () => Promise<void>
}

/**
 * Loads the latest year's user-maintained tax parameters; until a row exists (or
 * the table isn't migrated yet) it returns DEFAULT_TAX_PARAMS so every engine keeps
 * working with the built-in 2026 values. The reminder fires when storedYear lags
 * the calendar year (see the alert engine).
 */
export function useTaxParams(): TaxParamsState {
  const [params, setParams] = useState<TaxParams>(DEFAULT_TAX_PARAMS)
  const [storedYear, setStoredYear] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('tax_parameters')
        .select('tax_year, params')
        .order('tax_year', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error || !data) {
        setParams(DEFAULT_TAX_PARAMS)
        setStoredYear(null)
      } else {
        setParams(paramsFromJson(data.params))
        setStoredYear(data.tax_year)
      }
    } catch {
      setParams(DEFAULT_TAX_PARAMS)
      setStoredYear(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { params, storedYear, usingDefaults: storedYear == null, loading, reload }
}
