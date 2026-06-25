import type { FilingStatus } from '../db'

/**
 * Statutory reference constants for the Tax & Withdrawal tab. These are APPROXIMATE
 * 2026 figures (TCJA rates made permanent under OBBBA, inflation-adjusted) — encoded
 * to drive *directional* analysis (which bracket a conversion fills, whether it crosses
 * an IRMAA tier, roughly how large an RMD is), never to compute a filed return. The UI
 * shows these thresholds so the assumption is visible (design principle #4); a
 * professional confirms the exact current numbers (invariant #9).
 */
export const TAX_YEAR = 2026

export interface Bracket {
  upTo: number // upper bound of this bracket (Infinity for top)
  rate: number // marginal rate as a fraction
}

const BRACKETS: Partial<Record<FilingStatus, Bracket[]>> = {
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
}

/** mfs ≈ single thresholds; qw ≈ mfj (a simplification; flagged in the UI). */
export function bracketsFor(filing: FilingStatus): Bracket[] {
  if (filing === 'mfj' || filing === 'qw') return BRACKETS.mfj!
  if (filing === 'hoh') return BRACKETS.hoh!
  return BRACKETS.single! // single, mfs
}

export const STANDARD_DEDUCTION: Record<FilingStatus, number> = {
  single: 15_750, mfs: 15_750, mfj: 31_500, qw: 31_500, hoh: 23_600,
}

/** Marginal ordinary rate at a given taxable income. */
export function marginalRate(taxableIncome: number, filing: FilingStatus): number {
  const b = bracketsFor(filing)
  for (const t of b) if (taxableIncome <= t.upTo) return t.rate
  return b[b.length - 1]!.rate
}

/** The bracket your income currently sits in (its rate + headroom to the next). */
export function bracketAt(taxableIncome: number, filing: FilingStatus): { rate: number; ceiling: number } {
  const b = bracketsFor(filing)
  for (const t of b) if (taxableIncome <= t.upTo) return { rate: t.rate, ceiling: t.upTo }
  const top = b[b.length - 1]!
  return { rate: top.rate, ceiling: top.upTo }
}

// ── IRMAA (Medicare Part B/D surcharge tiers; MAGI from 2 years prior) ──────────
export interface IrmaaTier {
  magiUpTo: number // upper MAGI bound for this tier (single; mfj is doubled below the top)
  monthlySurcharge: number // approx Part B + D surcharge above base, per person
}
// Single tiers (approx 2026). MFJ uses 2× the MAGI thresholds for all but the top.
const IRMAA_SINGLE: IrmaaTier[] = [
  { magiUpTo: 109_000, monthlySurcharge: 0 },
  { magiUpTo: 137_000, monthlySurcharge: 86 },
  { magiUpTo: 171_000, monthlySurcharge: 215 },
  { magiUpTo: 205_000, monthlySurcharge: 344 },
  { magiUpTo: 500_000, monthlySurcharge: 474 },
  { magiUpTo: Infinity, monthlySurcharge: 515 },
]

export function irmaaTier(magi: number, filing: FilingStatus): { index: number; surcharge: number; threshold: number } {
  const married = filing === 'mfj' || filing === 'qw'
  for (let i = 0; i < IRMAA_SINGLE.length; i++) {
    const t = IRMAA_SINGLE[i]!
    const bound = t.magiUpTo === Infinity ? Infinity : married ? t.magiUpTo * 2 : t.magiUpTo
    if (magi <= bound) return { index: i, surcharge: t.monthlySurcharge, threshold: bound }
  }
  const last = IRMAA_SINGLE[IRMAA_SINGLE.length - 1]!
  return { index: IRMAA_SINGLE.length - 1, surcharge: last.monthlySurcharge, threshold: Infinity }
}

// ── RMD (Uniform Lifetime Table; SECURE 2.0 start age) ──────────────────────────
const RMD_DIVISOR: Record<number, number> = {
  73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7, 77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4, 82: 18.5,
  83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2, 87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5, 92: 10.8,
  93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4, 97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4,
}

export function rmdDivisor(age: number): number | null {
  if (age < 73) return null
  return RMD_DIVISOR[Math.min(100, age)] ?? RMD_DIVISOR[100]!
}

/** SECURE 2.0: born 1951–59 → 73; born 1960+ → 75. */
export function rmdStartAge(birthYear: number): number {
  return birthYear >= 1960 ? 75 : 73
}

export const NIIT_RATE = 0.038
export const NIIT_THRESHOLD: Record<FilingStatus, number> = {
  single: 200_000, hoh: 200_000, mfs: 125_000, mfj: 250_000, qw: 250_000,
}

/**
 * Progressive ordinary-income tax on `taxableIncome` (income already net of the
 * standard deduction). Sums each bracket's slice × its rate — the correct
 * piecewise computation, so the incremental tax of an extra dollar equals the
 * marginal rate there, and a withdrawal spanning brackets is taxed correctly.
 */
export function ordinaryTax(taxableIncome: number, filing: FilingStatus): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  let prev = 0
  for (const t of bracketsFor(filing)) {
    const lo = prev
    const hi = Math.min(taxableIncome, t.upTo)
    if (hi > lo) tax += (hi - lo) * t.rate
    prev = t.upTo
    if (prev >= taxableIncome) break
  }
  return tax
}

// ── Long-term capital gains (0/15/20, stacked on top of ordinary income) ────────
// Taxable-income thresholds where the LTCG rate steps up (approx 2026).
const LTCG_0_TOP: Partial<Record<FilingStatus, number>> = { single: 49_000, mfj: 98_000, hoh: 66_000 }
const LTCG_15_TOP: Partial<Record<FilingStatus, number>> = { single: 545_000, mfj: 613_000, hoh: 579_000 }

function ltcgThresholds(filing: FilingStatus): { zeroTop: number; fifteenTop: number } {
  const key: FilingStatus = filing === 'mfj' || filing === 'qw' ? 'mfj' : filing === 'hoh' ? 'hoh' : 'single'
  return { zeroTop: LTCG_0_TOP[key]!, fifteenTop: LTCG_15_TOP[key]! }
}

/**
 * Tax on `gain` of long-term capital gains, correctly STACKED on top of
 * `ordinaryTaxableIncome`: the 0/15/20% brackets are filled by ordinary income
 * first, so only the portion of the gain landing in each band is taxed at that
 * band's rate. (A flat LTCG rate would mis-tax a large gain relative to the bands.)
 */
export function ltcgTax(ordinaryTaxableIncome: number, gain: number, filing: FilingStatus): number {
  if (gain <= 0) return 0
  const { zeroTop, fifteenTop } = ltcgThresholds(filing)
  let pos = Math.max(0, ordinaryTaxableIncome)
  let remaining = gain
  let tax = 0
  const inZero = Math.max(0, Math.min(remaining, zeroTop - pos))
  pos += inZero; remaining -= inZero // 0% band
  const inFifteen = Math.max(0, Math.min(remaining, fifteenTop - pos))
  tax += inFifteen * 0.15; pos += inFifteen; remaining -= inFifteen // 15% band
  tax += Math.max(0, remaining) * 0.2 // 20% band
  return tax
}
