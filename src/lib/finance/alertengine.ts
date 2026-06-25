import type { ClassSlice } from './networth'
import type { LookThrough } from './lookthrough'

/**
 * The one alert engine (invariant #1). Alerts are low-frequency, pre-committed,
 * threshold/event-driven — NEVER price-triggered (invariant #7). Nothing here
 * reads a daily price delta: it reads allocation drift vs your chosen target,
 * concentration vs your chosen ceiling, and dated events (mortgage payoff). The
 * same pure function powers the in-app digest now and a scheduled evaluate-alerts
 * cron later. Pure — no React, no Supabase — so both can import it.
 */

export interface AlertRuleSet {
  rebalance_band_pt: number | null // absolute drift points that trip a rebalance flag
  single_name_pct: number | null // single-name ceiling (fraction of investable)
  narrative_pct: number | null // narrative/theme ceiling (crypto proxy until sector data)
  tlh_min_loss: number | null // reserved for P5 (tax-loss harvesting)
  cadence: string // 'monthly' | 'weekly' — how often the digest is cut
}

export interface TargetWeight {
  asset_class: string // matches ClassSlice.class labels
  target_pct: number // fraction
}
export interface BandSpec {
  asset_class: string
  abs_pts: number | null // absolute drift points override
  rel_pct: number | null // relative drift (% of target) override
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
}

export type AlertKind = 'rebalance_band' | 'single_name' | 'narrative' | 'mortgage_payoff'
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

  return out
}
