/**
 * Consensus-CMA engine (invariant #3 — modules read this, never hardcode
 * returns). Blends per-house capital-market assumptions (median + dispersion)
 * with the asset-class universe's vol + correlation. Returns are long-run nominal
 * (a two-stage near/long path is a later refinement once near-term data is seeded).
 */
export interface CmaSourceRow {
  asset_class: string
  house: string
  value: number | null
}
export interface UniverseRow {
  class: string
  cma_premium: number | null
  vol: number | null
  corr_to_us_equity: number | null
  cost_proxy: number | null
}

export interface ClassCma {
  class: string
  expectedReturn: number // consensus median, net of cost drag
  low: number // dispersion floor (lowest house, net of cost)
  high: number // dispersion ceiling
  vol: number
  corr: number // correlation to us_equity
}

function median(sorted: number[]): number {
  const n = sorted.length
  if (n === 0) return 0
  const mid = Math.floor(n / 2)
  return n % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function buildCma(
  sources: CmaSourceRow[],
  universe: UniverseRow[],
): Record<string, ClassCma> {
  const byClass: Record<string, number[]> = {}
  for (const s of sources) {
    if (s.value == null) continue
    ;(byClass[s.asset_class] ??= []).push(s.value)
  }

  const out: Record<string, ClassCma> = {}
  for (const u of universe) {
    const vals = (byClass[u.class] ?? []).slice().sort((a, b) => a - b)
    const cost = u.cost_proxy ?? 0
    const consensus = vals.length ? median(vals) : (u.cma_premium ?? 0)
    out[u.class] = {
      class: u.class,
      expectedReturn: consensus - cost,
      low: (vals.length ? vals[0]! : consensus) - cost,
      high: (vals.length ? vals[vals.length - 1]! : consensus) - cost,
      vol: u.vol ?? 0.15,
      corr: u.corr_to_us_equity ?? 0.5,
    }
  }
  return out
}
