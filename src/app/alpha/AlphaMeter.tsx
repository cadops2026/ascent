import { useState } from 'react'
import { Panel, MicroLabel, Figure } from '../../components/ui'
import { fmtPct, fmtMoneyCompact } from '../../lib/format'
import { SIGNAL_SIGMAS, TE_MULTIPLE, MIN_YEARS, underperformers } from '../../lib/finance/alpha'
import type { PortfolioAlpha, HoldingAlpha, AlphaSignal } from '../../lib/finance/alpha'

const signed = (x: number) => `${x > 0 ? '+' : ''}${fmtPct(x)}`

// 'noise' stays ink, never coral: an alpha inside its own error bars is not bad
// news, and colouring it as loss is exactly what provokes a reactive trade.
const ACCENT: Record<AlphaSignal, 'teal' | 'coral' | 'ink'> = {
  ahead: 'teal',
  behind: 'coral',
  noise: 'ink',
}
const TEXT: Record<AlphaSignal, string> = {
  ahead: 'text-teal',
  behind: 'text-coral',
  noise: 'text-muted',
}

function verdict(a: PortfolioAlpha): string {
  const band = SIGNAL_SIGMAS * a.noise
  switch (a.signal) {
    case 'ahead':
      return `Your picks are ahead of their own asset classes by more than the ${fmtPct(band)} that luck alone would explain.`
    case 'behind':
      return `Your picks trail their own asset classes by more than the ${fmtPct(band)} that luck alone would explain.`
    default:
      return `Indistinguishable from luck — the swing luck alone explains (±${fmtPct(band)}) is wider than the result. Treat this as "no evidence either way", not as a score.`
  }
}

/** Glance form (Dashboard): the number, its band, and what it does or doesn't mean. */
export function AlphaMeterCompact({ alpha, loading }: { alpha: PortfolioAlpha; loading?: boolean }) {
  if (loading) {
    return (
      <Panel label="Alpha">
        <p className="text-sm text-faint">Measuring…</p>
      </Panel>
    )
  }
  if (!alpha.measuredValue) {
    return (
      <Panel label="Alpha">
        <p className="text-sm text-faint">
          Nothing measurable yet — alpha needs a cost basis and a purchase date. Add tax lots on the
          Balance Sheet to switch it on.
        </p>
      </Panel>
    )
  }

  return (
    <Panel label="Alpha">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Figure
          label="vs each holding's own class"
          display={`${signed(alpha.alpha)}/yr`}
          format="percent"
          band={{ low: alpha.alpha - SIGNAL_SIGMAS * alpha.noise, high: alpha.alpha + SIGNAL_SIGMAS * alpha.noise }}
          confidence="90% band"
          accent={ACCENT[alpha.signal]}
          size="md"
        />
        <div className="text-right">
          <MicroLabel className="text-faint">Measured on</MicroLabel>
          <div className="tnum font-mono text-sm text-muted">
            {fmtMoneyCompact(alpha.measuredValue)} · {fmtPct(alpha.coverage, 0)} of holdings
          </div>
        </div>
      </div>
      <p className="mt-3 max-w-prose text-sm text-muted">{verdict(alpha)}</p>
    </Panel>
  )
}

function Row({ h }: { h: HoldingAlpha }) {
  return (
    <div className="flex items-baseline gap-3 border-t border-line py-2 text-sm first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-ink">{h.label}</span>
      <span className="micro-label hidden text-faint sm:inline">vs {h.benchmark}</span>
      <span className="tnum w-20 text-right font-mono text-faint">{fmtMoneyCompact(h.value)}</span>
      <span className={`tnum w-20 text-right font-mono ${TEXT[h.signal]}`}>{signed(h.alpha)}</span>
      <span className="tnum hidden w-24 text-right font-mono text-faint sm:inline">
        ±{fmtPct(SIGNAL_SIGMAS * h.noise)}
      </span>
    </div>
  )
}

/** Detail form (Balance Sheet): the number, then every holding behind it. */
export function AlphaMeterPanel({ alpha, loading }: { alpha: PortfolioAlpha; loading?: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const [showHow, setShowHow] = useState(false)

  if (loading) {
    return (
      <Panel label="Alpha">
        <p className="text-sm text-faint">Measuring…</p>
      </Panel>
    )
  }
  if (!alpha.measuredValue) {
    return (
      <Panel label="Alpha">
        <p className="max-w-prose text-sm text-faint">
          Alpha needs a cost basis and a purchase date per position. Add tax lots to a holding below
          and it starts measuring — positions held under {MIN_YEARS * 12} months stay out, since
          annualizing a few weeks produces a headline number that means nothing.
        </p>
      </Panel>
    )
  }

  const behind = underperformers(alpha)
  const rows = showAll ? alpha.holdings : behind

  return (
    <Panel label="Alpha">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <Figure
          label="vs each holding's own class"
          display={`${signed(alpha.alpha)}/yr`}
          format="percent"
          band={{ low: alpha.alpha - SIGNAL_SIGMAS * alpha.noise, high: alpha.alpha + SIGNAL_SIGMAS * alpha.noise }}
          confidence="90% band"
          accent={ACCENT[alpha.signal]}
          size="md"
        />
        <div className="text-right">
          <MicroLabel className="text-faint">Measured on</MicroLabel>
          <div className="tnum font-mono text-sm text-muted">
            {fmtMoneyCompact(alpha.measuredValue)} · {fmtPct(alpha.coverage, 0)} of holdings
          </div>
        </div>
      </div>

      <p className="mt-3 max-w-prose text-sm text-muted">{verdict(alpha)}</p>

      <div className="mt-5">
        <div className="flex items-center justify-between">
          <MicroLabel className="text-faint">
            {showAll ? 'All measured holdings' : `Behind their class · ${behind.length}`}
          </MicroLabel>
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="micro-label text-faint hover:text-teal"
          >
            {showAll ? 'Only underperformers' : 'Show all'}
          </button>
        </div>

        <div className="mt-2">
          {rows.length === 0 ? (
            <p className="max-w-prose py-2 text-sm text-muted">
              Nothing is behind its own asset class by more than luck explains. Holdings that merely
              lagged are listed under “Show all”.
            </p>
          ) : (
            rows.map((h) => <Row key={h.holdingId} h={h} />)
          )}
        </div>

        {behind.length > 0 && !showAll && (
          <p className="mt-3 max-w-prose text-sm text-faint">
            Being behind is a reason to ask why — a strategy you no longer want, a cost drag, a
            concentrated bet that broke — not a reason to sell on its own. Trailing returns don't
            predict the next stretch, and a sale here has a tax bill attached.
          </p>
        )}
      </div>

      {alpha.excluded.length > 0 && (
        <div className="mt-5 border-t border-line pt-3">
          <MicroLabel className="text-faint">
            Not measured · {fmtPct(1 - alpha.coverage, 0)} of holdings
          </MicroLabel>
          <div className="mt-2 space-y-1">
            {alpha.excluded.map((e) => (
              <div key={e.holdingId} className="flex items-baseline gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate text-muted">{e.label}</span>
                <span className="text-faint">{e.reason}</span>
                <span className="tnum w-20 text-right font-mono text-faint">
                  {fmtMoneyCompact(e.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-line pt-3">
        <button
          type="button"
          onClick={() => setShowHow((v) => !v)}
          className="micro-label text-faint hover:text-teal"
        >
          {showHow ? 'Hide assumptions' : 'How this is measured'}
        </button>
        {showHow && (
          <div className="mt-3 max-w-prose space-y-2 text-sm text-muted">
            <p>
              Each position's annualized return since purchase (cost basis vs today's price, per tax
              lot) minus what its <em>own asset class</em> returned over the same window — US equity
              vs VTI, international vs VXUS, bonds vs BND, TIPS vs SCHP, cash vs BIL, real estate vs
              VNQ, commodities vs DJP, crypto vs BTC. Positions are dollar-weighted into the
              portfolio figure.
            </p>
            <p>
              The band is the luck in the estimate: assumed tracking error ÷ √years, at{' '}
              {SIGNAL_SIGMAS} standard errors (~90%). Tracking error is a multiple of each class's
              volatility — {TE_MULTIPLE.etf}× for funds, {TE_MULTIPLE.stock}× for single names. A
              holding is only called ahead or behind once it clears that band.
            </p>
            <p className="text-faint">
              Two limits worth knowing. Returns are price-only: neither side counts dividends or
              distributions, so a holding yielding much more than its benchmark reads low. And
              because every holding is judged against its own class, this measures your{' '}
              <em>selection</em> — it deliberately says nothing about whether the allocation itself
              was right, which is what the target-allocation view is for.
            </p>
          </div>
        )}
      </div>
    </Panel>
  )
}
