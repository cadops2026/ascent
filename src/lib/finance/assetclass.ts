import type { Holding } from '../db'

/**
 * Asset-class taxonomy — the ONE source of truth (invariant #1). Two layers:
 *  • CmaClass   — the 10-class engine taxonomy (matches asset_class_universe /
 *                 cma_sources): the granularity the projection, Monte Carlo, CMA
 *                 and risk engines actually need.
 *  • AssetClass — the coarse display taxonomy for the calm allocation pie.
 *
 * Previously the balance sheet only knew the 6 coarse classes and every tab
 * re-implemented its own coarse→engine map (CLASS_MAP ×4, CLASS_TO_UNI), all of
 * which collapsed *every* equity/bond/TIPS holding into `us_equity` — so a bond
 * ETF was modeled with 16%-vol equity risk and the bonds/tips/intl/commodities
 * CMA rows were unreachable. This module fixes that: a per-holding classifier
 * routes fixed income, international, commodities and money-market funds to their
 * true class, and a single coarse↔fine map replaces the five copies.
 */

/** The consensus-CMA / asset_class_universe keys (engine taxonomy). */
export const CMA_CLASSES = [
  'us_equity', 'intl_equity', 'bonds', 'tips', 'cash',
  'real_estate', 'commodities', 'private_equity', 'collectibles', 'crypto',
] as const
export type CmaClass = (typeof CMA_CLASSES)[number]

/** Coarse classes for the allocation pie. */
export const ASSET_CLASSES = [
  'Equities', 'Bonds', 'Crypto', 'Cash', 'Real estate', 'Commodities', 'Private', 'Collectibles',
] as const
export type AssetClass = (typeof ASSET_CLASSES)[number]

/** Fine engine class → coarse display class. */
export const COARSE_OF_CMA: Record<CmaClass, AssetClass> = {
  us_equity: 'Equities',
  intl_equity: 'Equities',
  bonds: 'Bonds',
  tips: 'Bonds',
  cash: 'Cash',
  real_estate: 'Real estate',
  commodities: 'Commodities',
  private_equity: 'Private',
  collectibles: 'Collectibles',
  crypto: 'Crypto',
}

/** A representative engine key per coarse class — for universe-attribute lookups
 *  (corr_to_us_equity, return) that are keyed by the coarse pie class. Replaces the
 *  per-tab CLASS_MAP / CLASS_TO_UNI copies. */
export const CMA_KEY_FOR_COARSE: Record<AssetClass, CmaClass> = {
  Equities: 'us_equity',
  Bonds: 'bonds',
  Crypto: 'crypto',
  Cash: 'cash',
  'Real estate': 'real_estate',
  Commodities: 'commodities',
  Private: 'private_equity',
  Collectibles: 'collectibles',
}

// ── Symbol heuristics ────────────────────────────────────────────────────────
// Split stock/etf holdings into fixed income / TIPS / international / commodities /
// money-market by ticker. Unknown tickers fall through to us_equity (the prior
// behavior, so nothing regresses); known funds route to their true class. A
// per-holding asset_class tag can supersede this later (schema change, deferred).
const TIPS_SYMBOLS = new Set([
  'TIP', 'VTIP', 'SCHP', 'STIP', 'LTPZ', 'SPIP', 'TDTT', 'TDTF', 'IVTI', 'VAIPX', 'VIPSX', 'FIPDX',
])
const BOND_SYMBOLS = new Set([
  'BND', 'AGG', 'BNDX', 'BNDW', 'VBTLX', 'FXNAX', 'VCIT', 'VCSH', 'LQD', 'VGIT', 'VGSH', 'VGLT', 'GOVT',
  'IEF', 'TLT', 'SHY', 'SHV', 'BIL', 'SGOV', 'VTEB', 'MUB', 'TFI', 'VWIUX', 'VWLUX', 'VWITX', 'VMLUX',
  'HYG', 'JNK', 'BSV', 'BIV', 'BLV', 'IGSB', 'IGIB', 'USIG', 'SCHZ', 'SCHR', 'SPAB', 'FBND', 'FXNAX',
  'VMBS', 'MBB', 'EMB', 'PCY', 'VWEHX', 'PTTRX', 'PIMIX', 'DODIX', 'VBILX', 'FBIIX',
])
const INTL_SYMBOLS = new Set([
  'VXUS', 'VEU', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM', 'IXUS', 'SCHF', 'SCHE', 'SPDW', 'SPEM',
  'ACWX', 'VSS', 'VGK', 'VPL', 'BBJP', 'EWJ', 'FNDF', 'FNDC', 'DFAX', 'AVDE', 'AVDV', 'AVEM',
  'VEMAX', 'VTMGX', 'VTIAX', 'VFWAX', 'VEUSX', 'VGTSX', 'FTIHX', 'FSGGX', 'FZILX',
])
const COMMODITY_SYMBOLS = new Set([
  'GLD', 'IAU', 'GLDM', 'SGOL', 'SLV', 'SIVR', 'PDBC', 'DBC', 'GSG', 'BCI', 'COMT', 'PPLT', 'PALL',
  'DJP', 'USO', 'UNG', 'DBA', 'DBB', 'GLTR', 'BCD', 'FTGC',
])
const MMKT_SYMBOLS = new Set([
  'VMFXX', 'VMRXX', 'VUSXX', 'VYFXX', 'SPAXX', 'SPRXX', 'FZFXX', 'FDRXX', 'FDLXX', 'SWVXX', 'SNVXX',
  'SNAXX', 'SNSXX', 'TTTXX', 'FNSXX', 'VCTXX', 'SPSXX',
])

/** Municipal-bond funds (a subset of BOND_SYMBOLS) — interest is federally tax-exempt,
 *  so for a high-bracket investor these are the *right* bond to hold in taxable. */
const MUNI_SYMBOLS = new Set([
  'VTEB', 'MUB', 'TFI', 'SUB', 'SHM', 'PZA', 'ITM', 'MUNI', 'HYD', 'VWIUX', 'VWLUX', 'VWITX', 'VMLUX',
  'VTEAX', 'FLTMX', 'PRIHX', 'NEARX',
])
/** True if the symbol is a municipal-bond fund (tax-exempt interest). */
export function isMuniBond(symbol: string | null | undefined): boolean {
  return !!symbol && MUNI_SYMBOLS.has(symbol.toUpperCase())
}

/** Classify a holding into its engine (CMA) class. Only kind + symbol are needed. */
export function cmaClassForHolding(h: Pick<Holding, 'kind' | 'symbol'>): CmaClass {
  switch (h.kind) {
    case 'crypto': return 'crypto'
    case 'private': return 'private_equity'
    case 'collectible': return 'collectibles'
    case 'cash': return 'cash'
    case 'stock':
    case 'etf': {
      const s = h.symbol?.toUpperCase()
      if (s) {
        if (MMKT_SYMBOLS.has(s)) return 'cash'
        if (TIPS_SYMBOLS.has(s)) return 'tips'
        if (BOND_SYMBOLS.has(s)) return 'bonds'
        if (COMMODITY_SYMBOLS.has(s)) return 'commodities'
        if (INTL_SYMBOLS.has(s)) return 'intl_equity'
      }
      return 'us_equity'
    }
    default:
      return 'us_equity'
  }
}
