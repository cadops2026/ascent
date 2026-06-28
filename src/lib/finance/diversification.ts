import type { ClassSlice } from './networth'
import { evalClassDrift } from './alertengine'
import type { AlertRuleSet, BandSpec, TargetWeight } from './alertengine'

/**
 * Diversification-gap scanner — the always-on *context map* of where your mix sits
 * versus the target you chose. It maps over/under exposure per class, the target
 * slots you aren't filling, and exposure you hold without a target. It is context,
 * NOT a signal (invariants #5/#7): it never forecasts and never originates an alert.
 * The pre-committed band-breach *signal* stays solely in the alert engine — this
 * reuses that engine's exact drift predicate (`evalClassDrift`, invariant #1), so
 * the panel's "beyond your band" tag can never contradict the digest.
 */

export type GapDirection = 'over' | 'under' | 'on'

export interface ClassGap {
  asset_class: string
  current: number // fraction of investable
  target: number // fraction
  gapPts: number // signed (current − target) × 100: + over / − under
  direction: GapDirection
  bandPts: number | null // the absolute band that applies (context for the gap)
  outsideBand: boolean // exactly the alert engine's rebalance_band breach condition
  held: boolean // you currently hold a meaningful amount of this class
}

export interface UntargetedClass {
  asset_class: string
  current: number // fraction of investable
}

export interface DiversificationScan {
  /** Every targeted class, sorted by absolute gap (largest drift first). */
  classes: ClassGap[]
  /** Target classes you hold ~nothing of — unfilled diversification slots. */
  unfilled: ClassGap[]
  /** Classes you hold meaningfully but set no target for — uncovered exposure. */
  untargeted: UntargetedClass[]
  /** How many classes are currently outside their band (matches the digest). */
  outsideBandCount: number
  /** 0–1 alignment of the current mix to target = 1 − ½·Σ|current−target|
   *  (1 − total-variation distance). 1 = perfectly on target. */
  alignment: number
  /** Largest-gap targeted class (the first thing to steer), or null. */
  worst: ClassGap | null
  hasTargets: boolean
}

/** Below this fraction of investable a class is effectively not held / not targeted. */
const HELD_EPS = 0.005

export function diversificationScan(
  byClass: ClassSlice[],
  targets: TargetWeight[],
  bands: BandSpec[],
  rules: AlertRuleSet,
): DiversificationScan {
  const curByClass = new Map(byClass.map((s) => [s.class as string, s.pct]))
  const targeted = targets.filter((t) => t.target_pct != null)
  const targetClasses = new Set(targeted.map((t) => t.asset_class))

  const classes: ClassGap[] = []
  for (const t of targeted) {
    const current = curByClass.get(t.asset_class) ?? 0
    const band = bands.find((b) => b.asset_class === t.asset_class)
    const { breach, absLimit } = evalClassDrift(current, t.target_pct, band, rules)
    const gapPts = (current - t.target_pct) * 100
    const direction: GapDirection = Math.abs(gapPts) < 0.05 ? 'on' : gapPts > 0 ? 'over' : 'under'
    classes.push({
      asset_class: t.asset_class,
      current,
      target: t.target_pct,
      gapPts,
      direction,
      bandPts: absLimit,
      outsideBand: breach,
      held: current >= HELD_EPS,
    })
  }
  classes.sort((a, b) => Math.abs(b.gapPts) - Math.abs(a.gapPts))

  const unfilled = classes.filter((c) => c.target >= HELD_EPS && !c.held)

  const untargeted: UntargetedClass[] = byClass
    .filter((s) => s.pct >= HELD_EPS && !targetClasses.has(s.class as string))
    .map((s) => ({ asset_class: s.class as string, current: s.pct }))
    .sort((a, b) => b.current - a.current)

  const outsideBandCount = classes.filter((c) => c.outsideBand).length

  // Total-variation distance over the union of targeted ∪ held classes.
  const union = new Set<string>([...targetClasses, ...byClass.map((s) => s.class as string)])
  let tv = 0
  for (const cls of union) {
    const cur = curByClass.get(cls) ?? 0
    const tgt = targeted.find((t) => t.asset_class === cls)?.target_pct ?? 0
    tv += Math.abs(cur - tgt)
  }
  const alignment = Math.max(0, Math.min(1, 1 - tv / 2))

  return {
    classes,
    unfilled,
    untargeted,
    outsideBandCount,
    alignment,
    worst: classes[0] ?? null,
    hasTargets: classes.length > 0,
  }
}
