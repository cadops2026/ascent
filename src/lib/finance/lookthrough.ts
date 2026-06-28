import type { Holding, RealEstate } from '../db'
import { holdingValue } from './networth'
import type { QuoteMap } from './networth'

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

/**
 * Mutual-fund → ETF look-through proxy. Many of the largest positions are Vanguard/
 * Fidelity *mutual funds*, which the FMP ETF-holdings endpoint won't resolve. Each
 * fund here tracks the same index as its listed ETF share-class equivalent, so we
 * borrow the ETF's constituents for look-through ONLY (shown as an explicit proxy) —
 * never for pricing. Active funds, bond funds, and target-date funds-of-funds are
 * intentionally absent: there's no honest single-ETF proxy, so they read as opaque.
 */
export const LOOKTHROUGH_PROXY: Record<string, string> = {
  VIGAX: 'VUG', // Vanguard Growth Index → Growth ETF
  VTSAX: 'VTI', // Total Stock Market → Total Stock Market ETF
  VFIAX: 'VOO', // 500 Index → S&P 500 ETF
  VIIIX: 'VOO', // Institutional Index → S&P 500
  FXAIX: 'VOO', // Fidelity 500 Index → S&P 500
  VHYAX: 'VYM', // High Dividend Yield Index → High Div Yield ETF
  VTCLX: 'VV', //  Tax-Managed Cap Appreciation → Large-Cap ETF (proxy)
  VRGWX: 'VONG', // Russell 1000 Growth Index → Russell 1000 Growth ETF
  VTIAX: 'VXUS', // Total International Stock Index → Total Intl ETF
}

/**
 * Composition of name-only fund-of-funds that have no ticker of their own — chiefly
 * 529 plan portfolios, which hold a fixed blend of underlying index funds. Keyed by
 * normalized name; each part references an ETF share-class equivalent the look-through
 * can resolve (VTSAX→VTI, VTIAX→VXUS, VIGAX→VUG). The position's exposure is rebuilt
 * ("recomposed") from these underlyings. Weights are fractions and should sum to 1.
 */
export const FUND_COMPOSITION: Record<string, { symbol: string; weight: number }[]> = {
  // NY 529 Direct Plan — Global Equity Portfolio: 60% Total US + 40% Total Intl.
  'global equity portfolio': [
    { symbol: 'VTI', weight: 0.6 },
    { symbol: 'VXUS', weight: 0.4 },
  ],
  // NY 529 Direct Plan — Growth Stock Index Portfolio: 100% Growth Index.
  'growth stock index portfolio': [{ symbol: 'VUG', weight: 1 }],
}
const normLtName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** All distinct underlying ETF symbols across the composition map (to pre-resolve). */
export function compositionEtfs(): string[] {
  return [...new Set(Object.values(FUND_COMPOSITION).flatMap((parts) => parts.map((p) => p.symbol)))]
}

/**
 * Resolve a fund/ETF into its underlying company constituents — directly from its
 * own ETF holdings, via a mutual-fund→ETF proxy (VIGAX→VUG…), or via a name
 * composition for name-only fund-of-funds (529 portfolios → VTI+VXUS / VUG).
 * Returns null when no look-through data is available (genuinely opaque). `via` is
 * the source symbol(s), for an honest "via …" label. Shared by both the flat and
 * per-position look-throughs so they agree.
 */
export function fundConstituents(
  symbol: string | null,
  name: string | null,
  etfMap: EtfMap,
  proxyMap: Record<string, string>,
): { list: { symbol: string; name: string | null; weight: number }[]; via: string } | null {
  const sym = symbol?.toUpperCase()
  if (sym && etfMap[sym]?.length) return { list: etfMap[sym]!, via: sym }
  if (sym && proxyMap[sym]) {
    const proxy = proxyMap[sym]!
    if (etfMap[proxy]?.length) return { list: etfMap[proxy]!, via: proxy }
  }
  const comp = name ? FUND_COMPOSITION[normLtName(name)] : undefined
  if (comp) {
    const merged = new Map<string, { symbol: string; name: string | null; weight: number }>()
    let any = false
    for (const part of comp) {
      const ec = etfMap[part.symbol.toUpperCase()]
      if (!ec?.length) continue
      any = true
      for (const c of ec) {
        const w = c.weight * part.weight
        const ex = merged.get(c.symbol)
        if (ex) ex.weight += w
        else merged.set(c.symbol, { symbol: c.symbol, name: c.name, weight: w })
      }
    }
    if (any && merged.size) return { list: [...merged.values()], via: comp.map((x) => x.symbol).join(' + ') }
  }
  return null
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
  proxyMap: Record<string, string> = LOOKTHROUGH_PROXY,
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

    // Funds/ETFs (incl. name-only 529 fund-of-funds) explode into companies via the
    // shared resolver — direct ETF holdings, a mutual-fund→ETF proxy, or a 529
    // composition. Only what's still unresolvable stays as an opaque single line.
    if (h.kind === 'etf') {
      const res = fundConstituents(h.symbol, h.name, etfMap, proxyMap)
      if (res) {
        let sumW = 0
        for (const c of res.list) {
          add(c.symbol, c.name ?? c.symbol, v * c.weight, true)
          sumW += c.weight
        }
        const label = h.symbol ? h.symbol.toUpperCase() : (h.name ?? 'fund')
        if (sumW < 0.999) add(`${label}~OTHER`, `${label} (other)`, v * (1 - sumW), false)
      } else {
        const label = h.symbol ? h.symbol.toUpperCase() : (h.name ?? 'Fund')
        add(label, label, v, false)
        unresolved.add(label)
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

// ── Nested look-through: the top M holdings of each of your top N holdings ──────

export type PositionStatus = 'resolved' | 'proxy' | 'opaque' | 'cash' | 'self'

export interface ConstituentExposure {
  symbol: string
  name: string
  weight: number // fraction of the parent position
  value: number // dollars in this constituent, via the parent position
}

export interface PositionLookThrough {
  symbol: string
  name: string
  kind: string
  value: number // market value of the aggregated position
  pct: number // of investable
  status: PositionStatus
  /** ETF used for look-through when status === 'proxy'. */
  proxySymbol?: string
  /** Top-M underlying names (empty for cash/opaque). */
  constituents: ConstituentExposure[]
  /** Fraction of the fund beyond the listed names ("rest of fund"); 0 for self/cash. */
  remainder: number
}

export interface NestedLookThrough {
  investable: number
  positions: PositionLookThrough[]
}

/**
 * Decompose the top `n` positions (aggregated by symbol/name across accounts) into
 * each one's top `m` underlying names. Direct stocks/crypto are their own single
 * name; ETFs/funds explode via `etfMap` (or a mutual-fund→ETF `proxyMap`); cash has
 * no underlyings; funds with no look-through data read as opaque. Reuses
 * `holdingValue` and the same `EtfMap` the flat look-through consumes.
 */
export function perPositionLookThrough(
  holdings: Holding[],
  realEstate: RealEstate[],
  quotes: QuoteMap,
  etfMap: EtfMap,
  proxyMap: Record<string, string> = {},
  n = 10,
  m = 10,
): NestedLookThrough {
  const agg = new Map<string, { symbol: string | null; name: string; kind: string; value: number }>()

  let investable = realEstate.filter((p) => p.kind === 'investment').reduce((s, p) => s + p.market_value, 0)

  for (const h of holdings) {
    const v = holdingValue(h, quotes)
    if (v == null || v <= 0) continue
    investable += v
    const sym = h.symbol ? h.symbol.toUpperCase() : null
    const key = sym ?? `name:${(h.name ?? 'Unnamed').toLowerCase()}`
    const ex = agg.get(key)
    if (ex) ex.value += v
    else agg.set(key, { symbol: sym, name: sym ? (h.name ?? sym) : (h.name ?? 'Unnamed'), kind: h.kind, value: v })
  }

  const ranked = [...agg.values()].sort((a, b) => b.value - a.value).slice(0, n)

  const positions: PositionLookThrough[] = ranked.map((p) => {
    const pct = investable > 0 ? p.value / investable : 0
    const displaySym = p.symbol ?? p.name
    const base = { symbol: displaySym, name: p.name, kind: p.kind, value: p.value, pct }

    if (p.kind === 'cash') return { ...base, status: 'cash' as const, constituents: [], remainder: 0 }

    // Direct single names: stock / crypto / private / collectible → itself.
    if (p.kind !== 'etf') {
      return {
        ...base,
        status: 'self' as const,
        constituents: [{ symbol: displaySym, name: p.name, weight: 1, value: p.value }],
        remainder: 0,
      }
    }

    // Fund / ETF: explode into companies via the shared resolver (direct holdings,
    // mutual-fund→ETF proxy, or 529 composition).
    const res = fundConstituents(p.symbol, p.name, etfMap, proxyMap)
    if (!res) {
      return { ...base, status: 'opaque' as const, constituents: [], remainder: 0 }
    }
    const status: PositionStatus = res.via === p.symbol ? 'resolved' : 'proxy'
    const proxySymbol = res.via === p.symbol ? undefined : res.via

    const top = [...res.list].sort((a, b) => b.weight - a.weight).slice(0, m)
    let shown = 0
    const constituents = top.map((c) => {
      shown += c.weight
      return { symbol: c.symbol, name: c.name ?? c.symbol, weight: c.weight, value: p.value * c.weight }
    })
    return {
      ...base,
      status,
      constituents,
      remainder: Math.max(0, 1 - shown),
      ...(proxySymbol ? { proxySymbol } : {}),
    }
  })

  return { investable, positions }
}
