/**
 * Full cross-class correlation matrix + Cholesky factor for the Monte Carlo
 * (Layer 2 of Ascent DOCS/MONTE-CARLO-MODEL-SPEC.md). Replaces the single-market-
 * factor model — which forced corr(i,j) = corrᵢ·corrⱼ and so badly understated the
 * co-movement of the safe-asset block (it implied bonds↔TIPS ≈ 0.015 when it is
 * really ~0.8). A proper pairwise matrix is what the leading engines use (cf. the
 * Kitces "correlation matrix" piece, MSCI, the academic GWN/covariance model).
 *
 * The consensus pairwise correlations below are long-run estimates among the 10
 * CMA classes; the us_equity row matches the seeded asset_class_universe
 * corr_to_us_equity so the two stay consistent (invariant #3). Values are
 * relatively stable and live here as engine reference data (like the CMA started
 * seeded); they can move to a DB table later without changing this interface.
 */

/** Upper-triangular consensus correlations; symmetric lookup fills the rest. */
const CONSENSUS: Record<string, Record<string, number>> = {
  us_equity: { intl_equity: 0.85, bonds: 0.15, tips: 0.1, cash: 0.0, real_estate: 0.6, commodities: 0.3, private_equity: 0.75, collectibles: 0.25, crypto: 0.4 },
  intl_equity: { bonds: 0.15, tips: 0.1, cash: 0.0, real_estate: 0.55, commodities: 0.35, private_equity: 0.65, collectibles: 0.25, crypto: 0.4 },
  bonds: { tips: 0.8, cash: 0.3, real_estate: 0.2, commodities: -0.05, private_equity: 0.1, collectibles: 0.05, crypto: 0.05 },
  tips: { cash: 0.25, real_estate: 0.25, commodities: 0.3, private_equity: 0.1, collectibles: 0.15, crypto: 0.05 },
  cash: { real_estate: 0.0, commodities: 0.0, private_equity: 0.0, collectibles: 0.0, crypto: 0.0 },
  real_estate: { commodities: 0.25, private_equity: 0.55, collectibles: 0.3, crypto: 0.25 },
  commodities: { private_equity: 0.25, collectibles: 0.2, crypto: 0.25 },
  private_equity: { collectibles: 0.25, crypto: 0.4 },
  collectibles: { crypto: 0.25 },
}

/** Consensus correlation between two classes; falls back to the single-factor
 *  product corrToUsᵢ·corrToUsⱼ for any pair not in the table (unusual classes). */
export function classCorrelation(a: string, b: string, corrToUsA: number, corrToUsB: number): number {
  if (a === b) return 1
  const v = CONSENSUS[a]?.[b] ?? CONSENSUS[b]?.[a]
  const raw = v ?? corrToUsA * corrToUsB
  return Math.max(-0.999, Math.min(0.999, raw))
}

/** Build the N×N correlation matrix for an ordered class list. `corrToUs[i]` is
 *  each class's correlation to US equity (the single-factor fallback anchor). */
export function buildCorrelationMatrix(classes: string[], corrToUs: number[]): number[][] {
  const n = classes.length
  const m: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    m[i]![i] = 1
    for (let j = i + 1; j < n; j++) {
      const c = classCorrelation(classes[i]!, classes[j]!, corrToUs[i]!, corrToUs[j]!)
      m[i]![j] = c
      m[j]![i] = c
    }
  }
  return m
}

/**
 * Cholesky factor L (lower-triangular, L·Lᵀ = A) of a correlation matrix. Hand-set
 * consensus matrices can be marginally non-PSD, so this adds an increasing diagonal
 * ridge until the decomposition succeeds (a standard "jittered Cholesky"); a valid
 * matrix returns with zero ridge. Returns L for an ordered class list; callers draw
 * a unit-variance independent vector g and use z = L·g to get correlated shocks.
 */
export function cholesky(A: number[][]): number[][] {
  const n = A.length
  for (let attempt = 0; attempt < 8; attempt++) {
    const ridge = attempt === 0 ? 0 : Math.pow(10, -10 + attempt) // 1e-9, 1e-8, …
    const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    let ok = true
    for (let i = 0; i < n && ok; i++) {
      for (let j = 0; j <= i; j++) {
        let sum = 0
        for (let k = 0; k < j; k++) sum += L[i]![k]! * L[j]![k]!
        if (i === j) {
          const d = A[i]![i]! + ridge - sum
          if (d <= 0) { ok = false; break }
          L[i]![j] = Math.sqrt(d)
        } else {
          L[i]![j] = (A[i]![j]! - sum) / L[j]![j]!
        }
      }
    }
    if (ok) return L
  }
  // Degenerate fallback: treat classes as uncorrelated (identity). Should not happen.
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
}
