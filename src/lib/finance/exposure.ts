import type { AssetClass, ClassSlice } from './networth'
import type { LookThrough } from './lookthrough'

/**
 * Exposure read-outs for the Risk tab. Deterministic and grounded in the user's
 * own balance sheet + look-through — it explains and quantifies exposure, it never
 * forecasts (invariant #5) and never originates a view. The *LLM* narration is a
 * separate, leashed P8 overlay; this is the math layer it would sit on.
 */

export interface BlastRadius {
  name: string | null
  pct: number // single-name share of investable
  shockPct: number // assumed drop applied (illustrative)
  impactPct: number // investable hit if the name fell shockPct
  impactAmount: number
}

/** If your largest single name fell `shockPct`, what does investable lose? */
export function blastRadius(lt: LookThrough, shockPct = 0.3): BlastRadius {
  const n = lt.singleNameMax
  const impactAmount = (n?.value ?? 0) * shockPct
  return {
    name: n?.name ?? null,
    pct: n?.pct ?? 0,
    shockPct,
    impactPct: lt.investable > 0 ? impactAmount / lt.investable : 0,
    impactAmount,
  }
}

export interface FactorExposure {
  /** Weighted correlation-to-US-equity across classes (a beta proxy, 0–1+). */
  equityBeta: number
  cryptoPct: number
  realEstatePct: number
  cashPct: number
  /** Top-5 single-name concentration (of investable). */
  top5Pct: number
}

/**
 * Factor exposure. `betaByClass` carries each class's correlation-to-US-equity
 * from the asset-class universe (invariant #3 — read it, don't hardcode); the
 * caller maps universe rows to the balance-sheet's AssetClass labels.
 */
export function factorExposure(
  byClass: ClassSlice[],
  lt: LookThrough,
  betaByClass: Partial<Record<AssetClass, number>>,
): FactorExposure {
  let equityBeta = 0
  let cryptoPct = 0
  let realEstatePct = 0
  let cashPct = 0
  for (const s of byClass) {
    equityBeta += s.pct * (betaByClass[s.class] ?? 0)
    if (s.class === 'Crypto') cryptoPct += s.pct
    if (s.class === 'Real estate') realEstatePct += s.pct
    if (s.class === 'Cash') cashPct += s.pct
  }
  const top5Pct = lt.topNames.slice(0, 5).reduce((sum, n) => sum + n.pct, 0)
  return { equityBeta, cryptoPct, realEstatePct, cashPct, top5Pct }
}

export interface ExposureLine {
  tone: 'calm' | 'watch' | 'concentrated'
  text: string
}

/**
 * Deterministic narrative lines — templated from the numbers, framed as exposure,
 * never advice. Calm by default: it surfaces what you're exposed to so a surprise
 * never drives a reactive move.
 */
export function exposureNarrative(
  lt: LookThrough,
  fx: FactorExposure,
  worstStress: { name: string; lossPct: number } | null,
): ExposureLine[] {
  const lines: ExposureLine[] = []
  const top = lt.singleNameMax
  if (top) {
    const tone = top.pct >= 0.2 ? 'concentrated' : top.pct >= 0.1 ? 'watch' : 'calm'
    lines.push({
      tone,
      text:
        `Your largest single name, ${top.name}, is ${(top.pct * 100).toFixed(0)}% of investable. ` +
        (tone === 'concentrated'
          ? 'That is a concentrated position — a shock here moves your whole plan.'
          : tone === 'watch'
            ? 'Worth watching, not acting on by itself.'
            : 'Well within a diversified range.'),
    })
  }
  if (fx.cryptoPct > 0) {
    lines.push({
      tone: fx.cryptoPct >= 0.15 ? 'watch' : 'calm',
      text: `Crypto is ${(fx.cryptoPct * 100).toFixed(0)}% of investable and draws a fat-tailed distribution — sized to lose without changing your life is the test, not its day-to-day price.`,
    })
  }
  lines.push({
    tone: fx.equityBeta >= 0.8 ? 'watch' : 'calm',
    text: `Effective equity beta ≈ ${fx.equityBeta.toFixed(2)}: that share of your investable moves with broad equities. Real-estate factor ${(fx.realEstatePct * 100).toFixed(0)}%, cash buffer ${(fx.cashPct * 100).toFixed(0)}%.`,
  })
  if (worstStress) {
    lines.push({
      tone: worstStress.lossPct >= 0.4 ? 'watch' : 'calm',
      text: `Your deepest historical analog (${worstStress.name}) would draw investable down ~${(worstStress.lossPct * 100).toFixed(0)}%. Knowing the number in advance is what keeps it from forcing a sale at the bottom.`,
    })
  }
  return lines
}
