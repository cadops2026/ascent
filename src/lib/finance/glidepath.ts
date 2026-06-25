import { monteCarlo } from './montecarlo'
import type { ClassCma } from './cma'
import type { InflationCurve } from './inflation'

/**
 * Work glide-path = solve-mode of the Monte Carlo. The headline is "years of full
 * work remaining" — the minimum years you must keep working (full income +
 * contributions) so the plan funds spending at your chosen confidence. Three
 * phases: full work → downshift bridge (partial income) → drawdown, with a
 * healthcare bridge before Medicare. Success probability is monotonic in years of
 * work, so we binary-search it.
 */
export interface GlideInput {
  initialWealth: number
  weights: Record<string, number>
  currentAge: number
  planToAge: number
  spending: number // annual retirement spending, today's $
  contribution: number // annual while fully working, today's $
  confidenceTarget: number // e.g. 0.85
  bridgeYears: number // downshift bridge length after full work
  phase2IncomeFrac: number // fraction of spending covered by partial income during the bridge
  healthcareAnnual: number // extra cost before Medicare while not fully working
  medicareAge: number // 65
  sims?: number
}

function buildCashFlow(inp: GlideInput, fullWorkYears: number): (y: number) => number {
  const bridgeIncome = inp.phase2IncomeFrac * inp.spending
  return (y: number): number => {
    const age = inp.currentAge + y
    let cf = 0
    if (y <= fullWorkYears) cf += inp.contribution
    else if (y <= fullWorkYears + inp.bridgeYears) cf -= Math.max(0, inp.spending - bridgeIncome)
    else cf -= inp.spending
    if (y > fullWorkYears && age < inp.medicareAge) cf -= inp.healthcareAnnual
    return cf
  }
}

function run(
  cma: Record<string, ClassCma>,
  infl: InflationCurve,
  inp: GlideInput,
  fullWorkYears: number,
  legacyTarget = 0,
) {
  return monteCarlo(cma, infl, {
    initialWealth: inp.initialWealth,
    weights: inp.weights,
    horizonYears: Math.max(1, inp.planToAge - inp.currentAge),
    cashFlow: buildCashFlow(inp, fullWorkYears),
    legacyTarget,
    sims: inp.sims ?? 800,
  })
}

export interface GlideSolution {
  years: number
  success: number
  feasible: boolean
}

/**
 * Shared binary search: smallest full-work years where success ≥ confidence
 * target, where success = (not ruined) AND (terminal ≥ legacyTarget). Monotonic
 * in years of work. legacyTarget=0 → "fund spending"; legacyTarget=initialWealth
 * → "maintain wealth" (a strictly harder goal at the same confidence).
 */
function solveForConfidence(
  cma: Record<string, ClassCma>,
  infl: InflationCurve,
  inp: GlideInput,
  legacyTarget: number,
): GlideSolution {
  const maxYears = Math.max(0, inp.planToAge - inp.currentAge)
  const atMax = run(cma, infl, inp, maxYears, legacyTarget).successProbability
  if (atMax < inp.confidenceTarget) return { years: maxYears, success: atMax, feasible: false }

  const at0 = run(cma, infl, inp, 0, legacyTarget).successProbability
  if (at0 >= inp.confidenceTarget) return { years: 0, success: at0, feasible: true }

  let lo = 0
  let hi = maxYears
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (run(cma, infl, inp, mid, legacyTarget).successProbability >= inp.confidenceTarget) hi = mid
    else lo = mid
  }
  return { years: hi, success: run(cma, infl, inp, hi, legacyTarget).successProbability, feasible: true }
}

/** Min full-work years so the plan funds spending at the confidence target. */
export function solveYearsOfWork(cma: Record<string, ClassCma>, infl: InflationCurve, inp: GlideInput): GlideSolution {
  return solveForConfidence(cma, infl, inp, 0)
}

/** Min full-work years so end wealth stays ≥ today's (real) at the same confidence — the maintain-wealth fork. */
export function solveMaintainWealth(cma: Record<string, ClassCma>, infl: InflationCurve, inp: GlideInput): GlideSolution {
  return solveForConfidence(cma, infl, inp, inp.initialWealth)
}

function shiftReturns(cma: Record<string, ClassCma>, delta: number): Record<string, ClassCma> {
  const out: Record<string, ClassCma> = {}
  for (const k of Object.keys(cma)) out[k] = { ...cma[k]!, expectedReturn: cma[k]!.expectedReturn + delta }
  return out
}

export interface Sensitivity {
  label: string
  deltaYears: number
}

/** How the years-of-work headline shifts under stress (the sensitivity strip). */
export function sensitivityStrip(
  cma: Record<string, ClassCma>,
  infl: InflationCurve,
  inp: GlideInput,
  baseYears: number,
): Sensitivity[] {
  const d = (y: number) => y - baseYears
  return [
    { label: 'Spend +10%', deltaYears: d(solveYearsOfWork(cma, infl, { ...inp, spending: inp.spending * 1.1 }).years) },
    { label: 'Returns −1%', deltaYears: d(solveYearsOfWork(shiftReturns(cma, -0.01), infl, inp).years) },
    { label: 'Live +5yr', deltaYears: d(solveYearsOfWork(cma, infl, { ...inp, planToAge: inp.planToAge + 5 }).years) },
  ]
}

// ── Principles overlay ──────────────────────────────────────────────────────
// Deterministic: a principle is *attached* to the current state; it explains,
// never originates or overrides — the math already decided (invariant #8).
export interface Principle {
  author: string
  text: string
}

export function principleFor(state: {
  yearsOfWork: number
  feasible: boolean
  singleNamePct: number
  cryptoPct: number
}): Principle {
  if (!state.feasible)
    return {
      author: 'Graham',
      text: 'A plan that needs everything to go right has no margin of safety. Lower spending or risk before leaning on luck.',
    }
  if (state.yearsOfWork <= 0)
    return {
      author: 'Bogle',
      text: "When you've won the game, stop playing. Take only the risk you still need to take.",
    }
  if (state.singleNamePct >= 0.2)
    return {
      author: 'Munger',
      text: 'The first rule is to avoid ruin. A fortune already made need not be re-risked on a single position.',
    }
  if (state.cryptoPct >= 0.15)
    return {
      author: 'Graham',
      text: 'Invest with a margin of safety; speculate only with money you could lose without changing your life.',
    }
  if (state.yearsOfWork >= 10)
    return {
      author: 'Buffett',
      text: 'The market transfers money from the impatient to the patient. Keep saving and let it compound.',
    }
  return {
    author: 'Bogle',
    text: 'Stay the course. The plan — not the market — is what funds your retirement.',
  }
}
