import { Panel, MicroLabel } from '../../components/ui'
import { fmtPct } from '../../lib/format'
import type { ClassGap, DiversificationScan } from '../../lib/finance/diversification'

/**
 * Diversification vs target — presentational context map (pure props), separated
 * from the data container so it render-tests in isolation. Calm: it shows where
 * your mix sits vs the intent you chose, never a buy/sell signal (invariants #5/#7).
 */
export interface DiversificationPanelProps {
  scan: DiversificationScan
}

const ALIGN_ACCENT = (a: number): 'on' | 'drift' | 'breach' =>
  a >= 0.95 ? 'on' : a >= 0.85 ? 'drift' : 'breach'

/** Tone of a single class gap: outside band → coral; a notable in-band drift → amber; else calm teal. */
function gapTone(g: ClassGap): 'on' | 'drift' | 'breach' {
  if (g.outsideBand) return 'breach'
  if (Math.abs(g.gapPts) >= 2) return 'drift'
  return 'on'
}

const TONE_DOT: Record<'on' | 'drift' | 'breach', string> = {
  on: 'bg-teal',
  drift: 'bg-amber',
  breach: 'bg-coral',
}
const TONE_TEXT: Record<'on' | 'drift' | 'breach', string> = {
  on: 'text-teal',
  drift: 'text-amber',
  breach: 'text-coral',
}

function signed(gapPts: number): string {
  const s = gapPts > 0 ? '+' : gapPts < 0 ? '−' : '±'
  return `${s}${Math.abs(gapPts).toFixed(1)} pts`
}

export function DiversificationPanel({ scan }: DiversificationPanelProps) {
  if (!scan.hasTargets) {
    return (
      <Panel label="Diversification vs your target">
        <p className="py-3 text-sm text-muted">
          Set a target allocation below and this maps where your mix sits against it — over- and
          under-weights, unfilled slots, and uncovered exposure.
        </p>
      </Panel>
    )
  }

  const alignPct = Math.round(scan.alignment * 100)
  const alignClass = TONE_TEXT[ALIGN_ACCENT(scan.alignment)]
  // Widest bar in the list, for scaling. At least the applicable band so an in-band drift never fills the bar.
  const maxAbs = Math.max(
    0.5,
    ...scan.classes.map((c) => Math.max(Math.abs(c.gapPts), (c.bandPts ?? 0) + 0.001)),
  )

  return (
    <Panel
      label="Diversification vs your target"
      right={
        <MicroLabel className={alignClass}>
          {alignPct}% aligned{scan.outsideBandCount > 0 ? ` · ${scan.outsideBandCount} beyond band` : ''}
        </MicroLabel>
      }
    >
      <ul className="space-y-3">
        {scan.classes.map((c) => {
          const tone = gapTone(c)
          const onTarget = c.direction === 'on'
          // Center-anchored drift bar: under-weight grows left, over-weight grows right.
          const widthPct = Math.min(50, (Math.abs(c.gapPts) / maxAbs) * 50)
          return (
            <li key={c.asset_class}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 text-ink">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[tone]}`} />
                  {c.asset_class}
                </span>
                <span className="tnum font-mono text-faint">
                  {fmtPct(c.current, 0)} <span className="text-faint/60">/ {fmtPct(c.target, 0)}</span>
                  <span className={`ml-2 ${onTarget ? 'text-faint' : TONE_TEXT[tone]}`}>
                    {onTarget ? 'on target' : signed(c.gapPts)}
                  </span>
                </span>
              </div>
              {/* Center line = on target; the bar grows under (left) or over (right). */}
              <div className="relative mt-1.5 h-2 rounded bg-panel-hi">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <div
                  className={`absolute inset-y-0 rounded ${tone === 'breach' ? 'bg-coral/70' : tone === 'drift' ? 'bg-amber/70' : 'bg-teal/60'}`}
                  style={
                    c.direction === 'under'
                      ? { right: '50%', width: `${widthPct}%` }
                      : { left: '50%', width: `${widthPct}%` }
                  }
                />
              </div>
              {c.outsideBand && (
                <div className="mt-1 text-xs text-coral">
                  Beyond your {c.bandPts != null ? `${c.bandPts}-pt ` : ''}rebalance band — this is what the digest flags.
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {scan.unfilled.length > 0 && (
        <p className="mt-4 text-xs text-amber">
          Unfilled target slots: {scan.unfilled.map((c) => `${c.asset_class} (${fmtPct(c.target, 0)} target)`).join(', ')}
          {' '}— diversification you intended but aren't yet holding.
        </p>
      )}
      {scan.untargeted.length > 0 && (
        <p className="mt-2 text-xs text-faint">
          Held without a target: {scan.untargeted.map((c) => `${c.asset_class} (${fmtPct(c.current, 0)})`).join(', ')}
          {' '}— set a target so drift here is measured too.
        </p>
      )}

      <p className="mt-4 text-xs text-faint">
        Context, not a signal — it maps your mix against the intent you chose. Steer with contributions
        first; only a band breach (above) is a pre-committed flag (invariants #5/#7).
      </p>
    </Panel>
  )
}
