import { Panel, Figure } from '../../components/ui'
import { fmtPct } from '../../lib/format'
import type { ExposureLine } from '../../lib/finance/exposure'

export interface DashboardHeroProps {
  /** Monte Carlo success probability (0–1). */
  successProbability: number
  sims: number
  planToAge: number
  /** Conservative-case terminal wealth band (real dollars). */
  terminal: { p10: number; p25: number; p90: number }
  /** Largest single-name exposure (share of investable), or null if none. */
  topName: string | null
  topPct: number | null
  /** Deterministic exposure lines (already computed by the shared engine). */
  narrative: ExposureLine[]
}

/**
 * Presentational hero — pure props, so it render-tests in isolation with real
 * engine output (the repo pattern: WealthPathChart / ExposurePanels). It paints
 * the two halves of invariant #6's calm hero (success probability + exposure) and
 * carries the conservative outcome's band (#4). No daily delta lives here (#6);
 * it explains exposure, never forecasts (#5).
 */
export function DashboardHero({
  successProbability,
  sims,
  planToAge,
  terminal,
  topName,
  topPct,
  narrative,
}: DashboardHeroProps) {
  const probAccent =
    successProbability >= 0.8 ? 'teal' : successProbability >= 0.6 ? 'amber' : 'coral'
  const expTone =
    topPct == null ? 'ink' : topPct >= 0.2 ? 'coral' : topPct >= 0.1 ? 'amber' : 'teal'

  return (
    <>
      <Panel className="mt-5" label="Where you stand">
        <div className="grid gap-8 md:grid-cols-2">
          <Figure
            label={`Plan funds spending through age ${planToAge}`}
            display={fmtPct(successProbability, 0)}
            accent={probAccent}
            size="hero"
            sublabel={`Success probability · Monte Carlo, ${sims.toLocaleString()} paths`}
          />
          <Figure
            label="Largest single-name exposure"
            display={topPct != null ? fmtPct(topPct, 0) : '—'}
            accent={expTone}
            size="hero"
            sublabel={topName ? `${topName} · of investable` : 'No concentrated names'}
          />
        </div>

        {/* Conservative outcome carries its band (invariant #4) */}
        <div className="mt-6 border-t border-line pt-5">
          <Figure
            label="Conservative end wealth (P25)"
            value={terminal.p25}
            format="moneyCompact"
            band={{ low: terminal.p10, high: terminal.p90 }}
            confidence="P10–P90"
            accent="indigo"
            size="md"
            sublabel="Real (today's) dollars · the cautious case shown first"
          />
        </div>
      </Panel>

      {/* Narrative exposure — deterministic, grounded, never a forecast (#5) */}
      <Panel className="mt-5" label="Your exposure, in plain terms">
        <ul className="space-y-2.5">
          {narrative.slice(0, 3).map((l, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  l.tone === 'concentrated' ? 'bg-coral' : l.tone === 'watch' ? 'bg-amber' : 'bg-teal'
                }`}
              />
              <span className="text-muted">{l.text}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-faint">
          Exposure, not advice — it quantifies what you hold, never forecasts what will outperform
          (invariant #5). Full stress + blast radius on the Risk &amp; Exposure tab.
        </p>
      </Panel>
    </>
  )
}
