import type { FilingStatus } from '../db'

/**
 * The full set of statutory parameters that change with time (annually, on the IRS
 * Revenue Procedure / SSA COLA). Previously hardcoded in taxtables.ts/estate.ts;
 * now a single data object so it can live in the DB and be updated yearly without a
 * code change (the user's directive: nothing time-varying baked into code). The
 * engines are pure functions of (inputs, TaxParams); DEFAULT_TAX_PARAMS below is the
 * graceful fallback used until a year's values are entered.
 *
 * `upTo: Infinity` marks an unbounded top bracket — serialized to null for the DB.
 */
export interface BracketRow {
  upTo: number // Infinity for the top bracket
  rate: number
}
export interface IrmaaRow {
  magiUpTo: number // single thresholds; mfj doubled below the top (Infinity = top)
  monthlySurcharge: number
}

export interface TaxParams {
  year: number
  /** Ordinary-income brackets for single / mfj / hoh (mfs≈single, qw≈mfj). */
  brackets: { single: BracketRow[]; mfj: BracketRow[]; hoh: BracketRow[] }
  standardDeduction: Record<FilingStatus, number>
  ltcg: { single: { zeroTop: number; fifteenTop: number }; mfj: { zeroTop: number; fifteenTop: number }; hoh: { zeroTop: number; fifteenTop: number } }
  irmaaSingle: IrmaaRow[]
  rmdDivisor: Record<number, number> // age → Uniform Lifetime divisor
  niitRate: number
  niitThreshold: Record<FilingStatus, number>
  estateExemption: Record<FilingStatus, number>
  estateTopRate: number
}

export const DEFAULT_TAX_PARAMS: TaxParams = {
  year: 2026,
  brackets: {
    single: [
      { upTo: 12_000, rate: 0.1 }, { upTo: 48_900, rate: 0.12 }, { upTo: 104_100, rate: 0.22 },
      { upTo: 198_800, rate: 0.24 }, { upTo: 252_400, rate: 0.32 }, { upTo: 630_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    mfj: [
      { upTo: 24_000, rate: 0.1 }, { upTo: 97_800, rate: 0.12 }, { upTo: 208_300, rate: 0.22 },
      { upTo: 397_650, rate: 0.24 }, { upTo: 504_900, rate: 0.32 }, { upTo: 757_000, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    hoh: [
      { upTo: 17_150, rate: 0.1 }, { upTo: 65_400, rate: 0.12 }, { upTo: 104_100, rate: 0.22 },
      { upTo: 198_800, rate: 0.24 }, { upTo: 252_400, rate: 0.32 }, { upTo: 630_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
  standardDeduction: { single: 15_750, mfs: 15_750, mfj: 31_500, qw: 31_500, hoh: 23_600 },
  ltcg: {
    single: { zeroTop: 49_000, fifteenTop: 545_000 },
    mfj: { zeroTop: 98_000, fifteenTop: 613_000 },
    hoh: { zeroTop: 66_000, fifteenTop: 579_000 },
  },
  irmaaSingle: [
    { magiUpTo: 109_000, monthlySurcharge: 0 },
    { magiUpTo: 137_000, monthlySurcharge: 86 },
    { magiUpTo: 171_000, monthlySurcharge: 215 },
    { magiUpTo: 205_000, monthlySurcharge: 344 },
    { magiUpTo: 500_000, monthlySurcharge: 474 },
    { magiUpTo: Infinity, monthlySurcharge: 515 },
  ],
  rmdDivisor: {
    73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5,
    83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
    93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  },
  niitRate: 0.038,
  niitThreshold: { single: 200_000, hoh: 200_000, mfs: 125_000, mfj: 250_000, qw: 250_000 },
  estateExemption: { single: 15_000_000, mfs: 15_000_000, mfj: 30_000_000, qw: 15_000_000, hoh: 15_000_000 },
  estateTopRate: 0.4,
}

// ── JSON (de)serialization for the DB jsonb / editor — Infinity ↔ null ──────────
const BIG = 1e15
export function paramsToJson(p: TaxParams): string {
  return JSON.stringify(p, (_k, v) => (v === Infinity ? null : v), 2)
}
/** Parse editor/DB JSON back to TaxParams, restoring nulls in `upTo`/`magiUpTo` to Infinity. */
export function paramsFromJson(raw: unknown): TaxParams {
  const p = (typeof raw === 'string' ? JSON.parse(raw) : raw) as TaxParams
  for (const f of ['single', 'mfj', 'hoh'] as const) {
    for (const b of p.brackets[f]) if (b.upTo == null || b.upTo >= BIG) b.upTo = Infinity
  }
  for (const t of p.irmaaSingle) if (t.magiUpTo == null || t.magiUpTo >= BIG) t.magiUpTo = Infinity
  return p
}
