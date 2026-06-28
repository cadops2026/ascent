import { Panel, Figure, MicroLabel } from '../../components/ui'
import { fmtPct } from '../../lib/format'
import type { MacroContext } from '../../lib/finance/macrocontext'

/**
 * Presentational macro-context card (pure props). Frames the blend's long-run
 * consensus return against the long run — context, not a signal (spec §2). Carries
 * a don't-overreact reminder by design; never an alert, never a trade implication.
 */
export function MacroContextCard({ macro }: { macro: MacroContext }) {
  return (
    <Panel
      label="Macro context — not a signal"
      right={<MicroLabel className="text-faint">structural · long-run</MicroLabel>}
    >
      <div className="grid gap-8 sm:grid-cols-2">
        <Figure
          label="Your blend — consensus expected return"
          display={fmtPct(macro.realReturn)}
          format="percent"
          band={{ low: macro.low, high: macro.high }}
          confidence="house dispersion"
          accent="indigo"
          size="lg"
          sublabel="long-run real · weighted across the major houses"
        />
        <Figure
          label="Implied nominal (with expected inflation)"
          display={fmtPct(macro.nominalReturn)}
          accent="ink"
          size="lg"
          sublabel={`${fmtPct(macro.inflationToHorizon)} expected inflation · ${macro.inflationSource} curve`}
        />
      </div>
      <p className="mt-4 text-xs leading-relaxed text-faint">
        This is a long-run, structural read — the consensus of the major houses entering through the CMA
        engine, not a forecast of the next year and not a signal to act. Markets swing far more than this in
        any given year. The number to act on is your exposure vs. your target, not this one — the biggest risk
        is a large reactive move, not a wrong number.
      </p>
    </Panel>
  )
}
