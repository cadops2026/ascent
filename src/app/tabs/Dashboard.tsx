import { useMemo } from 'react'
import { Panel, Figure, AlertStrip, MicroLabel } from '../../components/ui'
import { PageHeader } from './PhasePlaceholder'
import { fmtMoneyCompact } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import { estateExposure } from '../../lib/finance/estate'
import type { FilingStatus } from '../../lib/db'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { AllocationPie } from '../balance/AllocationPie'

/**
 * Calm by default (invariant #6): the real hero — narrative exposure + success
 * probability — needs the look-through (P2) and Monte Carlo (P3) engines, so it
 * shows as an honest placeholder. Until then the dashboard leads with real net
 * worth + allocation. No daily red/green delta anywhere.
 */
export function Dashboard() {
  const { data, loading } = useBalanceSheet()
  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data],
  )
  const filing = (data.profile?.filing_status as FilingStatus | null) ?? 'single'
  const estate = estateExposure(bs.netWorth, filing)
  const empty = data.holdings.length === 0 && data.realEstate.length === 0

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Dashboard" />

      <div className="mt-5">
        <AlertStrip tone="info">
          Balance Sheet is live. Narrative exposure (P2) and success probability (P3) light up the
          hero next.
        </AlertStrip>
      </div>

      {/* Hero placeholders — no fabricated numbers (invariant #4) */}
      <Panel className="mt-5" label="Hero — arrives with the engines">
        <div className="grid gap-8 md:grid-cols-2">
          <Figure
            label="Success probability"
            display="—"
            accent="ink"
            size="lg"
            sublabel="Monte Carlo · arrives P3"
          />
          <Figure
            label="Narrative exposure"
            display="—"
            accent="ink"
            size="lg"
            sublabel="Factor look-through · arrives P2"
          />
        </div>
      </Panel>

      {/* Real net worth — calm */}
      <Panel className="mt-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Figure
            label="Net worth"
            value={bs.netWorth}
            format="moneyCompact"
            accent="ink"
            size="lg"
          />
          <div className="flex gap-6">
            <Mini label="Investable" value={fmtMoneyCompact(bs.investable)} />
            <Mini label="Net-to-heirs" value={fmtMoneyCompact(estate.netToHeirs)} />
          </div>
        </div>
      </Panel>

      {empty ? (
        <Panel className="mt-5">
          <p className="py-6 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add holdings on the Balance Sheet to populate your cockpit.'}
          </p>
        </Panel>
      ) : (
        <div className="mt-5">
          <AllocationPie slices={bs.byClass} investable={bs.investable} pendingQuotes={bs.pendingQuotes} />
        </div>
      )}

      <div className="mt-8">
        <MicroLabel className="text-faint">
          Calm by default — no daily delta · every projection carries its band
        </MicroLabel>
      </div>
    </div>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <MicroLabel>{label}</MicroLabel>
      <div className="tnum mt-1 font-mono text-lg text-muted">{value}</div>
    </div>
  )
}
