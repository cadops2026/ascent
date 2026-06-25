import { Panel, Figure, Select } from '../../components/ui'
import { fmtMoney, fmtMoneyCompact } from '../../lib/format'
import { estateExposure } from '../../lib/finance/estate'
import { FILING_STATUSES, FILING_LABEL } from '../../lib/db'
import type { FilingStatus } from '../../lib/db'

function Line({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'muted' | 'coral' | 'ink' }) {
  const v = tone === 'coral' ? 'text-coral' : tone === 'ink' ? 'text-ink' : 'text-muted'
  return (
    <div className="flex items-center justify-between border-b border-line py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`tnum font-mono text-sm ${v}`}>{value}</span>
    </div>
  )
}

/**
 * Net-to-heirs snapshot — the "quick number." Point estimate today; exposure,
 * not advice (invariant #9). Assumptions (filing status → exemption) are visible
 * and editable inline, per design principle #4.
 */
export function NetToHeirsCard({
  netWorth,
  filing,
  onChangeFiling,
}: {
  netWorth: number
  filing: FilingStatus
  onChangeFiling: (f: FilingStatus) => void
}) {
  const e = estateExposure(netWorth, filing)

  return (
    <Panel
      label="Net-to-heirs — estate snapshot"
      right={
        <Select
          value={filing}
          onChange={(ev) => onChangeFiling(ev.target.value as FilingStatus)}
          className="w-auto! py-1! text-xs"
        >
          {FILING_STATUSES.map((f) => (
            <option key={f} value={f}>
              {FILING_LABEL[f]}
            </option>
          ))}
        </Select>
      }
    >
      <Figure
        label="Reaches your heirs"
        value={e.netToHeirs}
        format="moneyCompact"
        accent={e.overExemption ? 'amber' : 'teal'}
        size="lg"
        sublabel={
          e.overExemption
            ? 'Over the federal exemption — estate tax applies'
            : 'Under the federal exemption — no federal estate tax'
        }
      />

      <div className="mt-4">
        <Line label="Gross estate (incl. residence)" value={fmtMoney(e.grossEstate)} tone="ink" />
        <Line label={`Federal exemption (${FILING_LABEL[filing]})`} value={fmtMoneyCompact(e.exemption)} />
        <Line
          label="Federal estate tax (40%)"
          value={e.federalTax > 0 ? `− ${fmtMoney(e.federalTax)}` : '$0'}
          tone={e.federalTax > 0 ? 'coral' : 'muted'}
        />
        <Line label="NJ estate / inheritance" value="$0" />
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Exposure estimate, not advice (invariant #9). Omits spousal portability, prior gifts, trusts,
        valuation discounts, and settlement costs — a professional layers those on. The projected
        legacy band arrives with the Monte Carlo engine (P3).
      </p>
    </Panel>
  )
}
