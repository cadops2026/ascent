import { Panel, Figure, MicroLabel, AlertStrip } from '../../components/ui'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import type { ExposureLine, BlastRadius, FactorExposure } from '../../lib/finance/exposure'
import type { StressResult } from '../../lib/finance/drawdownstress'
import type { MortgageBondView } from '../../lib/finance/mortgagebond'
import type { EvaluatedAlert } from '../../lib/finance/alertengine'

const sevTone = (s: EvaluatedAlert['severity']) => (s === 'high' ? 'negative' : s === 'caution' ? 'caution' : 'info')

export interface ExposurePanelsProps {
  narrative: ExposureLine[]
  blast: BlastRadius
  factor: FactorExposure
  stress: StressResult[]
  mortgageBonds: MortgageBondView
  alerts: EvaluatedAlert[]
  cadence: string
  dismissed: Set<string>
  onDismiss: (key: string) => void
}

/**
 * Presentational read-only exposure panels (pure props) — separated from the data
 * container so they render-test in isolation. Calm, deterministic, exposure-not-advice.
 */
export function ExposurePanels({
  narrative,
  blast,
  factor,
  stress,
  mortgageBonds,
  alerts,
  cadence,
  dismissed,
  onDismiss,
}: ExposurePanelsProps) {
  const maxLoss = Math.max(...stress.map((s) => s.lossPct), 0.0001)
  const visibleAlerts = alerts.filter((a) => !dismissed.has(a.kind + a.title))

  return (
    <>
      {/* Narrative exposure — deterministic, grounded, never a forecast */}
      <Panel label="Your exposure, in plain terms">
        <ul className="space-y-2.5">
          {narrative.map((l, i) => (
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
          Exposure, not advice — grounded in your own balance sheet. It quantifies what you hold; it never
          forecasts what will outperform (invariant #5).
        </p>
      </Panel>

      {/* Blast radius + factor exposure */}
      <div className="grid gap-5 md:grid-cols-2">
        <Panel label={`Blast radius — ${blast.name ?? 'top name'} −${fmtPct(blast.shockPct, 0)}`}>
          <Figure
            label="Investable impact"
            display={`−${fmtPct(blast.impactPct)}`}
            accent={blast.impactPct >= 0.1 ? 'coral' : 'amber'}
            size="lg"
            sublabel={`−${fmtMoneyCompact(blast.impactAmount)} · ${blast.name ?? '—'} is ${fmtPct(blast.pct, 0)} of investable`}
          />
          <p className="mt-3 text-xs text-faint">Illustrative single-name shock — what one position can do to the whole.</p>
        </Panel>

        <Panel label="Factor exposure">
          <div className="grid grid-cols-2 gap-4">
            <Mini label="Equity beta" value={factor.equityBeta.toFixed(2)} amber={factor.equityBeta >= 0.8} />
            <Mini label="Top-5 names" value={fmtPct(factor.top5Pct, 0)} amber={factor.top5Pct >= 0.5} />
            <Mini label="Crypto" value={fmtPct(factor.cryptoPct, 0)} amber={factor.cryptoPct >= 0.15} />
            <Mini label="Cash buffer" value={fmtPct(factor.cashPct, 0)} amber={false} />
          </div>
          <p className="mt-3 text-xs text-faint">
            Equity beta = correlation-weighted share moving with broad equities (from the asset-class universe).
          </p>
        </Panel>
      </div>

      {/* Drawdown stress */}
      <Panel label="Drawdown stress — historical analogs, not forecasts">
        <ul className="space-y-3">
          {stress.map((r) => (
            <li key={r.scenario.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-ink">
                  {r.scenario.name} <span className="text-faint">· {r.scenario.period}</span>
                </span>
                <span className="tnum font-mono text-sm text-coral">
                  −{fmtPct(r.lossPct)} · −{fmtMoneyCompact(r.lossAmount)}
                </span>
              </div>
              <div className="mt-1.5 h-2 overflow-hidden rounded bg-panel-hi">
                <div className="h-full bg-coral/70" style={{ width: `${(r.lossPct / maxLoss) * 100}%` }} />
              </div>
              <div className="mt-1 text-xs text-faint">
                {r.scenario.note} → investable ~{fmtMoneyCompact(r.afterValue)} after.
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-faint">
          The primary residence isn't stressed here — it's out of the investable math and its AVM is noisy (invariant #11).
        </p>
      </Panel>

      {/* Mortgage-as-short-bond */}
      {mortgageBonds.positions.length > 0 && (
        <Panel label="Mortgage as a short bond">
          <div className="grid gap-5 md:grid-cols-3">
            <Figure
              label="Total short-bond"
              value={mortgageBonds.totalShortBond}
              format="moneyCompact"
              accent="indigo"
              size="md"
              sublabel={`${fmtPct(mortgageBonds.weightedRate)} avg rate · ${mortgageBonds.weightedDuration.toFixed(1)}y duration`}
            />
            <div className="md:col-span-2">
              <ul className="space-y-1.5">
                {mortgageBonds.positions.map((p, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 text-muted">{p.label}</span>
                    <span className="tnum font-mono text-ink">{fmtMoneyCompact(p.balance)}</span>
                    <span className="tnum w-16 text-right font-mono text-xs text-faint">{fmtPct(p.rate)}</span>
                    <span className="tnum w-16 text-right font-mono text-xs text-faint">{p.durationYears.toFixed(1)}y</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-3 text-xs text-faint">
            A fixed mortgage is economically a bond you're short: its value moves inversely to rates. A low-rate loan is
            cheap leverage — don't reflexively pay off a sub-4% mortgage (spec §8).
          </p>
        </Panel>
      )}

      {/* This month's digest — pre-committed, threshold/event-driven */}
      <Panel label="This month's digest" right={<MicroLabel className="text-faint">{cadence} · evaluated live</MicroLabel>}>
        {visibleAlerts.length === 0 ? (
          <p className="py-4 text-sm text-teal">
            Nothing to flag — you're inside every pre-committed threshold. Calm is the default.
          </p>
        ) : (
          <div className="space-y-2">
            {visibleAlerts.map((a) => (
              <AlertStrip key={a.kind + a.title} tone={sevTone(a.severity)} onDismiss={() => onDismiss(a.kind + a.title)}>
                <span className="text-ink">{a.title}.</span> <span className="text-muted">{a.detail}</span>
              </AlertStrip>
            ))}
          </div>
        )}
        <p className="mt-4 text-xs text-faint">
          Alerts are low-frequency and pre-committed — allocation drift, concentration, and dated events. Never a daily
          price move (invariant #7). Scheduled delivery arrives with the evaluate-alerts cron.
        </p>
      </Panel>
    </>
  )
}

function Mini({ label, value, amber }: { label: string; value: string; amber: boolean }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className={`tnum mt-1 font-mono text-2xl ${amber ? 'text-amber' : 'text-ink'}`}>{value}</div>
    </div>
  )
}
