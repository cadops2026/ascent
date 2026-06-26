// Vendored copy of src/lib/finance/alertengine.ts for the Deno edge runtime.
// The SAME pure engine the in-app digest uses (invariant #1) — the cron must
// reuse these thresholds, never re-implement them (invariant #7: low-frequency,
// pre-committed, threshold/event-driven, NEVER price-triggered). Keep in sync.
import type { ClassSlice } from './networth.ts'
import type { LookThrough } from './lookthrough.ts'

export interface AlertRuleSet {
  rebalance_band_pt: number | null
  single_name_pct: number | null
  narrative_pct: number | null
  tlh_min_loss: number | null
  cadence: string // 'monthly' | 'weekly' | 'event'
}

export interface TargetWeight {
  asset_class: string
  target_pct: number
}
export interface BandSpec {
  asset_class: string
  abs_pts: number | null
  rel_pct: number | null
}
export interface MortgageEvent {
  label: string
  monthsToPayoff: number | null
}

export interface EvalInput {
  byClass: ClassSlice[]
  investable: number
  lookThrough: LookThrough
  targets: TargetWeight[]
  bands: BandSpec[]
  rules: AlertRuleSet
  mortgages: MortgageEvent[]
  taxParamsYear?: number | null
  cmaParamsYear?: number | null
  currentYear?: number
}

export type AlertKind =
  | 'rebalance_band'
  | 'single_name'
  | 'narrative'
  | 'mortgage_payoff'
  | 'tax_params_stale'
  | 'cma_params_stale'
export type AlertSeverity = 'info' | 'caution' | 'high'

export interface EvaluatedAlert {
  kind: AlertKind
  severity: AlertSeverity
  title: string
  detail: string
}

const PAYOFF_WINDOW_MONTHS = 12

export function evaluateAlerts(input: EvalInput): EvaluatedAlert[] {
  const out: EvaluatedAlert[] = []
  const { byClass, lookThrough: lt, targets, bands, rules } = input

  // 1) Rebalance-band drift — pre-committed threshold on *allocation*, not price.
  if (targets.length > 0) {
    const currentByClass = new Map(byClass.map((s) => [s.class, s.pct]))
    for (const t of targets) {
      if (t.target_pct == null) continue
      const cur = currentByClass.get(t.asset_class as ClassSlice['class']) ?? 0
      const driftPts = Math.abs(cur - t.target_pct) * 100
      const band = bands.find((b) => b.asset_class === t.asset_class)
      const absLimit = band?.abs_pts ?? rules.rebalance_band_pt ?? null
      const relLimit = band?.rel_pct ?? null
      const breachAbs = absLimit != null && driftPts > absLimit
      const breachRel = relLimit != null && t.target_pct > 0 && driftPts / (t.target_pct * 100) > relLimit / 100
      if (breachAbs || breachRel) {
        out.push({
          kind: 'rebalance_band',
          severity: 'caution',
          title: `${t.asset_class} drifted ${driftPts.toFixed(1)} pts from target`,
          detail: `Now ${(cur * 100).toFixed(0)}% vs target ${(t.target_pct * 100).toFixed(0)}%. Steer with contributions first; trim only on a band breach.`,
        })
      }
    }
  }

  // 2) Single-name concentration ceiling.
  if (rules.single_name_pct != null && lt.singleNameMax && lt.singleNameMax.pct > rules.single_name_pct) {
    out.push({
      kind: 'single_name',
      severity: lt.singleNameMax.pct >= 2 * rules.single_name_pct ? 'high' : 'caution',
      title: `${lt.singleNameMax.name} is ${(lt.singleNameMax.pct * 100).toFixed(0)}% of investable`,
      detail: `Above your ${(rules.single_name_pct * 100).toFixed(0)}% single-name ceiling. Concentration, not the price, is the trigger.`,
    })
  }

  // 3) Narrative/theme ceiling (crypto as the proxy theme until sector data lands).
  if (rules.narrative_pct != null) {
    const crypto = byClass.find((s) => s.class === 'Crypto')?.pct ?? 0
    if (crypto > rules.narrative_pct) {
      out.push({
        kind: 'narrative',
        severity: 'caution',
        title: `Crypto theme is ${(crypto * 100).toFixed(0)}% of investable`,
        detail: `Above your ${(rules.narrative_pct * 100).toFixed(0)}% theme ceiling. (Sector themes join this once a sector source is wired.)`,
      })
    }
  }

  // 4) Mortgage payoff — a dated event, not a market move.
  for (const m of input.mortgages) {
    if (m.monthsToPayoff != null && m.monthsToPayoff >= 0 && m.monthsToPayoff <= PAYOFF_WINDOW_MONTHS) {
      out.push({
        kind: 'mortgage_payoff',
        severity: 'info',
        title: `${m.label} pays off in ${m.monthsToPayoff} month${m.monthsToPayoff === 1 ? '' : 's'}`,
        detail: 'Freed cash flow ahead — plan where it routes (contributions, reserves) before it arrives.',
      })
    }
  }

  // 5) Tax-parameter freshness — a dated reminder to enter this year's statutory
  //    figures (IRS Rev. Proc.), so projections use current law. Not a market move.
  if (input.currentYear != null) {
    const y = input.taxParamsYear
    if (y == null || y < input.currentYear) {
      out.push({
        kind: 'tax_params_stale',
        severity: 'info',
        title: y == null ? 'Tax parameters not set for this year' : `Tax parameters are from ${y}`,
        detail: `Enter ${input.currentYear} brackets, IRMAA, RMD, and estate figures in Settings so tax, withdrawal, and estate numbers use current law. Update once a year when the IRS Revenue Procedure publishes.`,
      })
    }
    // CMA override freshness — only nudge once one has been set (null = using the
    // seeded consensus, which is fine; we don't badger before they've opted in).
    const c = input.cmaParamsYear
    if (c != null && c < input.currentYear) {
      out.push({
        kind: 'cma_params_stale',
        severity: 'info',
        title: `Capital-market assumptions are from ${c}`,
        detail: `Refresh expected returns / vol / correlation in Settings as the major houses republish, so projections use current views.`,
      })
    }
  }

  return out
}
