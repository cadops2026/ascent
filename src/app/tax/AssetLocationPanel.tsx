import { useMemo, useState } from 'react'
import { Panel, MicroLabel, Figure } from '../../components/ui'
import { fmtMoneyCompact, fmtPct, fmtMoney } from '../../lib/format'
import { assetLocation, DEFAULT_YIELD_THRESHOLD } from '../../lib/finance/assetlocation'
import type { YieldMap, LocationRow } from '../../lib/finance/assetlocation'
import type { Holding, Account } from '../../lib/db'
import { TAX_TYPE_LABEL } from '../../lib/db'
import type { TaxType } from '../../lib/db'
import type { QuoteMap } from '../../lib/finance/networth'

const TOP_N = 20

function Row({ r }: { r: LocationRow }) {
  const flagged = r.placement === 'better-sheltered' || r.placement === 'ordinary-income'
  const ordinary = r.placement === 'ordinary-income'
  return (
    <div className="flex items-baseline gap-3 border-t border-line py-2 text-sm first:border-t-0">
      <span className="min-w-0 flex-1 truncate text-ink">{r.label}</span>
      <span className="hidden min-w-0 max-w-[9rem] truncate text-faint sm:inline">
        {r.taxType ? TAX_TYPE_LABEL[r.taxType as TaxType] ?? r.taxType : 'Untagged'}
      </span>
      <span className="tnum w-20 text-right font-mono text-faint">{fmtMoneyCompact(r.value)}</span>
      <span className={`tnum w-16 text-right font-mono ${flagged ? 'text-amber' : 'text-muted'}`}>
        {ordinary ? 'ord.' : r.yieldPct == null ? '—' : fmtPct(r.yieldPct, 2)}
      </span>
      <span className="tnum hidden w-20 text-right font-mono text-faint sm:inline">
        {r.taxExempt ? (
          <span className="text-teal">tax-free</span>
        ) : ordinary ? (
          <span className="text-amber">ordinary</span>
        ) : r.annualIncome > 0 ? (
          `${fmtMoney(r.annualIncome)}/yr`
        ) : (
          '—'
        )}
      </span>
    </div>
  )
}

/**
 * Which holdings suit a taxable account. Ranked by trailing dividend yield,
 * because that income is taxed as it arrives whether or not you want it.
 * Ranks and flags only — it never suggests what to buy (invariant #5).
 */
export function AssetLocationPanel({
  holdings,
  accounts,
  quotes,
  yields,
  loading,
}: {
  holdings: Holding[]
  accounts: Account[]
  quotes: QuoteMap
  yields: YieldMap
  loading?: boolean
}) {
  const [threshold, setThreshold] = useState(DEFAULT_YIELD_THRESHOLD)
  const [view, setView] = useState<'best' | 'flagged'>('best')

  const loc = useMemo(
    () => assetLocation(holdings, accounts, quotes, yields, threshold),
    [holdings, accounts, quotes, yields, threshold],
  )

  const rows = view === 'best' ? loc.bestForTaxable.slice(0, TOP_N) : loc.misplaced.slice(0, TOP_N)

  return (
    <Panel
      label="Asset location"
      right={
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setView('best')}
            className={`micro-label ${view === 'best' ? 'text-teal' : 'text-faint hover:text-muted'}`}
          >
            Best for taxable
          </button>
          <button
            type="button"
            onClick={() => setView('flagged')}
            className={`micro-label ${view === 'flagged' ? 'text-teal' : 'text-faint hover:text-muted'}`}
          >
            Better sheltered · {loc.misplaced.length}
          </button>
        </div>
      }
    >
      {loading ? (
        <p className="py-6 text-sm text-faint">Loading…</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-6">
            <Figure
              label="Dividend income landing in taxable"
              value={loc.taxableIncome}
              format="money"
              accent={loc.taxableIncome > 0 ? 'amber' : 'ink'}
              size="md"
              sublabel="Taxed as it arrives, whether or not you spend it."
            />
            <label className="flex items-center gap-2">
              <MicroLabel className="text-faint">Shelter above</MicroLabel>
              <select
                value={threshold}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="rounded border border-line bg-panel-hi px-2 py-1 font-mono text-sm text-ink"
              >
                {[0.005, 0.01, 0.015, 0.02, 0.03].map((t) => (
                  <option key={t} value={t}>
                    {fmtPct(t, 1)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="mt-5">
            <div className="flex items-baseline gap-3 pb-1 text-sm">
              <span className="micro-label min-w-0 flex-1 text-faint">
                {view === 'best' ? `Lowest yield first · top ${TOP_N}` : 'Highest income first'}
              </span>
              <span className="micro-label hidden text-faint sm:inline">Account</span>
              <span className="micro-label w-20 text-right text-faint">Value</span>
              <span className="micro-label w-16 text-right text-faint">Yield</span>
              <span className="micro-label hidden w-20 text-right text-faint sm:inline">Income</span>
            </div>
            {rows.length === 0 ? (
              <p className="max-w-prose py-3 text-sm text-muted">
                {view === 'flagged'
                  ? `Nothing in a taxable account yields above ${fmtPct(threshold, 1)}.`
                  : 'No dividend data yet — it loads on the next refresh.'}
              </p>
            ) : (
              rows.map((r) => <Row key={r.holdingId} r={r} />)
            )}
          </div>

          <p className="mt-4 max-w-prose text-sm text-faint">
            Ranked by trailing 12-month distributions ÷ current price — what actually hit a 1099,
            not a forward estimate. Municipal funds are marked tax-free and count as zero: their
            income is exempt, so a high yield is a reason to KEEP them here, not shelter them.
            Money-market and cash funds are marked ordinary and listed to move: the price feeds
            publish no dividend events for them, so a naive reading scores them 0.00% when their
            income is fully taxable interest. Crypto is left out entirely — it pays nothing and
            cannot sit in a tax-deferred account, so there is no placement decision to make.
            Yield is one input to asset location, not the whole decision:
            a fund's capital-gains distributions and your own turnover matter too, and moving a
            position in a taxable account realizes gains. This ranks and flags; it never moves
            anything.
            {loc.unknownValue > 0 &&
              ` ${fmtMoneyCompact(loc.unknownValue)} has no dividend data and is left out rather than assumed to yield zero.`}
          </p>
        </>
      )}
    </Panel>
  )
}
