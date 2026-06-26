// Vendored copy of src/lib/finance/lookthrough.ts for the Deno edge runtime.
// Logic is IDENTICAL to the app's engine (invariant #1 — one source of truth);
// only the imports differ. Keep in sync if the app's version changes.
import type { Holding, RealEstate, QuoteMap } from './types.ts'
import { holdingValue } from './networth.ts'

/** A row from etf_holdings (weights stored as fractions). */
export interface EtfHoldingRow {
  etf_symbol: string
  holding_symbol: string
  holding_name: string | null
  weight: number | null
}

/** etf_symbol (UPPER) -> underlying constituents */
export type EtfMap = Record<string, { symbol: string; name: string | null; weight: number }[]>

export interface NameExposure {
  symbol: string
  name: string
  value: number
  pct: number // of investable
  /** false = opaque (an ETF with no look-through data, or its unexplained remainder). */
  resolved: boolean
}

export interface LookThrough {
  investable: number
  topNames: NameExposure[]
  singleNameMax: NameExposure | null
  unresolvedEtfs: string[]
  realEstateFactor: number
}

export function buildEtfMap(rows: EtfHoldingRow[]): EtfMap {
  const map: EtfMap = {}
  for (const r of rows) {
    if (r.weight == null) continue
    const key = r.etf_symbol.toUpperCase()
    const list = (map[key] ??= [])
    list.push({ symbol: r.holding_symbol.toUpperCase(), name: r.holding_name, weight: r.weight })
  }
  return map
}

/**
 * Decompose holdings into single-name exposure: direct stocks/crypto map to
 * themselves, ETFs are exploded into their constituents (value × weight) when
 * look-through data exists, and private/founder + collectible stakes count as
 * their own concentrated single names. Residence is excluded from the investable
 * base (invariant #11) but tracked as a real-estate factor.
 */
export function lookThrough(
  holdings: Holding[],
  realEstate: RealEstate[],
  quotes: QuoteMap,
  etfMap: EtfMap,
): LookThrough {
  const byName = new Map<string, NameExposure>()
  const unresolved = new Set<string>()

  const add = (symbol: string, name: string, value: number, resolved: boolean) => {
    if (value <= 0) return
    const key = symbol.toUpperCase()
    const ex = byName.get(key)
    if (ex) {
      ex.value += value
      if (!resolved) ex.resolved = false
    } else {
      byName.set(key, { symbol: key, name, value, pct: 0, resolved })
    }
  }

  let investable = 0
  const investmentRE = realEstate.filter((p) => p.kind === 'investment').reduce((s, p) => s + p.market_value, 0)
  investable += investmentRE

  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0) continue
    investable += v

    if (h.kind === 'cash') continue // counts in investable, not a single name

    if (h.kind === 'etf' && h.symbol) {
      const constituents = etfMap[h.symbol.toUpperCase()]
      if (constituents && constituents.length) {
        let sumW = 0
        for (const c of constituents) {
          add(c.symbol, c.name ?? c.symbol, v * c.weight, true)
          sumW += c.weight
        }
        if (sumW < 0.999) add(h.symbol, `${h.symbol.toUpperCase()} (other)`, v * (1 - sumW), false)
      } else {
        add(h.symbol, h.symbol.toUpperCase(), v, false)
        unresolved.add(h.symbol.toUpperCase())
      }
      continue
    }

    // stock / crypto / private / collectible → a single name
    const sym = h.symbol ? h.symbol.toUpperCase() : (h.name ?? 'Unnamed')
    add(sym, h.symbol ? h.symbol.toUpperCase() : (h.name ?? 'Unnamed'), v, true)
  }

  const names = [...byName.values()].sort((a, b) => b.value - a.value)
  for (const n of names) n.pct = investable > 0 ? n.value / investable : 0

  const residence = realEstate.filter((p) => p.kind === 'residence').reduce((s, p) => s + p.market_value, 0)

  return {
    investable,
    topNames: names.slice(0, 10),
    singleNameMax: names[0] ?? null,
    unresolvedEtfs: [...unresolved],
    realEstateFactor: residence + investmentRE,
  }
}
