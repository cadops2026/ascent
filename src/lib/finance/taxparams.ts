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
  magiUpTo: number // single MAGI threshold (Infinity = top tier)
  /** mfj threshold when it isn't simply 2× the single one (the top finite tier:
   *  single $500k → married $750k, not $1M). Falls back to 2× when omitted. */
  magiUpToMarried?: number
  monthlySurcharge: number // Part B monthly IRMAA surcharge (total premium − base)
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
  /** Alternative Minimum Tax (parallel system). exemption + phaseout start per
   *  filing; the 26%/28% breakpoint; phaseout 25¢/$ over the start. */
  amt: {
    exemption: Record<FilingStatus, number>
    phaseoutStart: Record<FilingStatus, number>
    rate28Threshold: number // AMTI above this taxed at 28% (else 26%); halved for mfs
  }
  estateExemption: Record<FilingStatus, number>
  estateTopRate: number
  /** Annual tax-advantaged contribution limits (the maximizer reference). */
  contributionLimits: {
    electiveDeferral: number // 401(k)/403(b) employee deferral
    catchUp50: number // additional, age 50+
    total415c: number // DC-plan annual additions (employee + employer + after-tax)
    govt457: number // governmental 457(b) deferral — STACKS on the 401(k)/403(b)
    ira: number // traditional/Roth IRA
    iraCatchUp: number // additional, age 50+
    hsaSelf: number
    hsaFamily: number
    hsaCatchUp55: number
  }
}

// Verified against IRS Rev. Proc. 2025-32 (tax-year-2026 inflation adjustments,
// post-OBBBA) and CMS/SSA 2026 Medicare figures. Brackets store each band's upper
// bound; LTCG store the 0%/15% ceilings; IRMAA store single thresholds + Part B
// surcharge. Re-verify each fall when the next Rev. Proc. / CMS notice publishes.
export const DEFAULT_TAX_PARAMS: TaxParams = {
  year: 2026,
  brackets: {
    single: [
      { upTo: 12_400, rate: 0.1 }, { upTo: 50_400, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 }, { upTo: 256_225, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    mfj: [
      { upTo: 24_800, rate: 0.1 }, { upTo: 100_800, rate: 0.12 }, { upTo: 211_400, rate: 0.22 },
      { upTo: 403_550, rate: 0.24 }, { upTo: 512_450, rate: 0.32 }, { upTo: 768_700, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
    hoh: [
      { upTo: 17_700, rate: 0.1 }, { upTo: 67_450, rate: 0.12 }, { upTo: 105_700, rate: 0.22 },
      { upTo: 201_775, rate: 0.24 }, { upTo: 256_200, rate: 0.32 }, { upTo: 640_600, rate: 0.35 },
      { upTo: Infinity, rate: 0.37 },
    ],
  },
  standardDeduction: { single: 16_100, mfs: 16_100, mfj: 32_200, qw: 32_200, hoh: 24_150 },
  ltcg: {
    single: { zeroTop: 49_450, fifteenTop: 545_500 },
    mfj: { zeroTop: 98_900, fifteenTop: 613_700 },
    hoh: { zeroTop: 66_200, fifteenTop: 579_600 },
  },
  // Part B surcharge = total premium − $202.90 base (1.4×/2.0×/2.6×/3.2×/3.4×).
  irmaaSingle: [
    { magiUpTo: 109_000, monthlySurcharge: 0 },
    { magiUpTo: 137_000, monthlySurcharge: 81.2 },
    { magiUpTo: 171_000, monthlySurcharge: 202.9 },
    { magiUpTo: 205_000, monthlySurcharge: 324.6 },
    { magiUpTo: 500_000, magiUpToMarried: 750_000, monthlySurcharge: 446.4 },
    { magiUpTo: Infinity, monthlySurcharge: 487 },
  ],
  rmdDivisor: {
    73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5,
    83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
    93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
  },
  niitRate: 0.038,
  niitThreshold: { single: 200_000, hoh: 200_000, mfs: 125_000, mfj: 250_000, qw: 250_000 },
  // AMT 2026 estimates (Rev. Proc. 2025-32); re-verify each fall.
  amt: {
    exemption: { single: 90_100, hoh: 90_100, mfs: 70_100, mfj: 140_200, qw: 140_200 },
    phaseoutStart: { single: 639_300, hoh: 639_300, mfs: 639_300, mfj: 1_278_575, qw: 1_278_575 },
    rate28Threshold: 244_500,
  },
  estateExemption: { single: 15_000_000, mfs: 15_000_000, mfj: 30_000_000, qw: 15_000_000, hoh: 15_000_000 },
  estateTopRate: 0.4,
  // 2026 estimates (post-SECURE 2.0); re-verify against the IRS notice each fall.
  contributionLimits: {
    electiveDeferral: 24_500,
    catchUp50: 8_000,
    total415c: 72_000,
    govt457: 24_500,
    ira: 7_500,
    iraCatchUp: 1_100,
    hsaSelf: 4_400,
    hsaFamily: 8_750,
    hsaCatchUp55: 1_000,
  },
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
