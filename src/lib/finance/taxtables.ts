import type { FilingStatus } from '../db'
import { DEFAULT_TAX_PARAMS } from './taxparams'
import type { TaxParams, BracketRow } from './taxparams'

/**
 * Pure tax math over a TaxParams object (the statutory tables). Every function
 * takes `p`, defaulting to DEFAULT_TAX_PARAMS, so existing callers behave exactly
 * as before while the app can override with DB-loaded, user-maintained values for
 * the current year. Directional analysis, not a filed return (invariant #9).
 */
function bracketKey(filing: FilingStatus): 'single' | 'mfj' | 'hoh' {
  return filing === 'mfj' || filing === 'qw' ? 'mfj' : filing === 'hoh' ? 'hoh' : 'single'
}

/** mfs ≈ single thresholds; qw ≈ mfj (a simplification; flagged in the UI). */
export function bracketsFor(filing: FilingStatus, p: TaxParams = DEFAULT_TAX_PARAMS): BracketRow[] {
  return p.brackets[bracketKey(filing)]
}

export function standardDeduction(filing: FilingStatus, p: TaxParams = DEFAULT_TAX_PARAMS): number {
  return p.standardDeduction[filing]
}

/** Marginal ordinary rate at a given taxable income. */
export function marginalRate(taxableIncome: number, filing: FilingStatus, p: TaxParams = DEFAULT_TAX_PARAMS): number {
  const b = bracketsFor(filing, p)
  for (const t of b) if (taxableIncome <= t.upTo) return t.rate
  return b[b.length - 1]!.rate
}

/** The bracket your income currently sits in (its rate + headroom to the next). */
export function bracketAt(
  taxableIncome: number,
  filing: FilingStatus,
  p: TaxParams = DEFAULT_TAX_PARAMS,
): { rate: number; ceiling: number } {
  const b = bracketsFor(filing, p)
  for (const t of b) if (taxableIncome <= t.upTo) return { rate: t.rate, ceiling: t.upTo }
  const top = b[b.length - 1]!
  return { rate: top.rate, ceiling: top.upTo }
}

// ── IRMAA (Medicare Part B/D surcharge tiers; MAGI from 2 years prior) ──────────
export function irmaaTier(
  magi: number,
  filing: FilingStatus,
  p: TaxParams = DEFAULT_TAX_PARAMS,
): { index: number; surcharge: number; threshold: number } {
  const married = filing === 'mfj' || filing === 'qw'
  const tiers = p.irmaaSingle
  for (let i = 0; i < tiers.length; i++) {
    const t = tiers[i]!
    const bound = t.magiUpTo === Infinity ? Infinity : married ? t.magiUpTo * 2 : t.magiUpTo
    if (magi <= bound) return { index: i, surcharge: t.monthlySurcharge, threshold: bound }
  }
  const last = tiers[tiers.length - 1]!
  return { index: tiers.length - 1, surcharge: last.monthlySurcharge, threshold: Infinity }
}

// ── RMD (Uniform Lifetime Table; SECURE 2.0 start age) ──────────────────────────
export function rmdDivisor(age: number, p: TaxParams = DEFAULT_TAX_PARAMS): number | null {
  if (age < 73) return null
  const table = p.rmdDivisor
  return table[Math.min(100, age)] ?? table[100] ?? null
}

/** SECURE 2.0: born 1951–59 → 73; born 1960+ → 75 (statute — not a yearly figure). */
export function rmdStartAge(birthYear: number): number {
  return birthYear >= 1960 ? 75 : 73
}

/**
 * Progressive ordinary-income tax on `taxableIncome` (income already net of the
 * standard deduction). Sums each bracket's slice × its rate — the correct
 * piecewise computation, so the incremental tax of an extra dollar equals the
 * marginal rate there, and a withdrawal spanning brackets is taxed correctly.
 */
export function ordinaryTax(taxableIncome: number, filing: FilingStatus, p: TaxParams = DEFAULT_TAX_PARAMS): number {
  if (taxableIncome <= 0) return 0
  let tax = 0
  let prev = 0
  for (const t of bracketsFor(filing, p)) {
    const lo = prev
    const hi = Math.min(taxableIncome, t.upTo)
    if (hi > lo) tax += (hi - lo) * t.rate
    prev = t.upTo
    if (prev >= taxableIncome) break
  }
  return tax
}

/**
 * Tax on `gain` of long-term capital gains, correctly STACKED on top of
 * `ordinaryTaxableIncome`: the 0/15/20% brackets are filled by ordinary income
 * first, so only the portion of the gain landing in each band is taxed at that
 * band's rate. (A flat LTCG rate would mis-tax a large gain relative to the bands.)
 */
export function ltcgTax(
  ordinaryTaxableIncome: number,
  gain: number,
  filing: FilingStatus,
  p: TaxParams = DEFAULT_TAX_PARAMS,
): number {
  if (gain <= 0) return 0
  const { zeroTop, fifteenTop } = p.ltcg[bracketKey(filing)]
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
