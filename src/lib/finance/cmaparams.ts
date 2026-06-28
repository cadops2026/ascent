/**
 * User-maintained capital-market assumptions. The consensus CMA is seeded in the DB
 * (cma_sources / asset_class_universe) but the houses republish annually, so this lets
 * the user override the per-class expected return / vol / correlation for a given year
 * (same pattern as TaxParams). When no override exists, the seeded consensus is used.
 */
export interface CmaClassParams {
  expectedReturn: number // real (after-inflation), fraction
  vol: number // annual stdev, fraction
  corr: number // correlation to US equity
}

export interface CmaParams {
  year: number
  classes: Record<string, CmaClassParams> // keyed by asset-class (us_equity, crypto, …)
}

export function cmaParamsFromJson(raw: unknown): CmaParams {
  return (typeof raw === 'string' ? JSON.parse(raw) : raw) as CmaParams
}
