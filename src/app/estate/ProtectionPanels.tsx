import { Panel, Figure, MicroLabel } from '../../components/ui'
import { fmtMoney, fmtMoneyCompact } from '../../lib/format'
import type { EstateExposure } from '../../lib/finance/estate'
import type { LiquidityView } from '../../lib/finance/liquidity'
import type { InsuranceLine, GapStatus } from '../../lib/finance/insurance'

export interface ProtectionPanelsProps {
  exposure: EstateExposure
  filingLabel: string
  liquidity: LiquidityView
  insuranceLines: InsuranceLine[]
  c529: number
}

const STATUS_STYLE: Record<GapStatus, string> = {
  covered: 'text-teal',
  gap: 'text-coral',
  review: 'text-amber',
  'n/a': 'text-faint',
}
const STATUS_LABEL: Record<GapStatus, string> = { covered: 'Covered', gap: 'Gap', review: 'Review', 'n/a': '—' }

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
 * Presentational read-only protection readouts (pure props) — estate-tax exposure,
 * liquidity-to-pay, insurance gaps, 529s. Exposure-not-advice (invariant #9):
 * it models exposure and flags gaps; it never drafts documents or recommends products.
 */
export function ProtectionPanels({ exposure: e, filingLabel, liquidity: lq, insuranceLines, c529 }: ProtectionPanelsProps) {
  return (
    <>
      {/* Estate-tax exposure + net-to-heirs */}
      <Panel label="Estate-tax exposure — net to heirs">
        <Figure
          label="Reaches your heirs"
          value={e.netToHeirs}
          format="moneyCompact"
          accent={e.overExemption ? 'amber' : 'teal'}
          size="hero"
          sublabel={
            e.overExemption
              ? 'Over the federal exemption — estate tax applies'
              : 'Under the federal exemption — no federal estate tax'
          }
        />
        <div className="mt-4">
          <Line label="Gross estate (incl. residence)" value={fmtMoney(e.grossEstate)} tone="ink" />
          <Line label={`Federal exemption (${filingLabel})`} value={fmtMoneyCompact(e.exemption)} />
          <Line
            label="Federal estate tax (40%)"
            value={e.federalTax > 0 ? `− ${fmtMoney(e.federalTax)}` : '$0'}
            tone={e.federalTax > 0 ? 'coral' : 'muted'}
          />
          <Line label="NJ estate / inheritance" value="$0" />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Exposure estimate, not advice (invariant #9). Omits spousal portability, prior gifts, trusts, valuation
          discounts, and settlement costs — a professional layers those on.
        </p>
      </Panel>

      {/* Liquidity & SBLOC */}
      <Panel label="Liquidity & SBLOC — borrow, don't fire-sale">
        <div className="grid gap-5 sm:grid-cols-3">
          <Figure label="Liquid assets" value={lq.liquidAssets} format="moneyCompact" accent="ink" size="md" sublabel="Cash + marketable securities" />
          <Figure label="SBLOC capacity" value={lq.sblocCapacity} format="moneyCompact" accent="indigo" size="md" sublabel="50% of taxable securities" />
          <Figure
            label="Available to cover"
            value={lq.totalAvailable}
            format="moneyCompact"
            accent={lq.needToCover > 0 ? (lq.covered ? 'teal' : 'coral') : 'ink'}
            size="md"
            sublabel="Liquid + borrow-don't-sell"
          />
        </div>
        {lq.needToCover > 0 && (
          <p className={`mt-4 text-sm ${lq.covered ? 'text-teal' : 'text-coral'}`}>
            {lq.covered
              ? `Covers the ${fmtMoneyCompact(lq.needToCover)} estate-tax bill without selling illiquid assets.`
              : `Short ${fmtMoneyCompact(lq.shortfall)} against the ${fmtMoneyCompact(lq.needToCover)} estate-tax bill — heirs could face a forced sale. A T-bill ladder or SBLOC line pre-empts that.`}
          </p>
        )}
        <p className="mt-3 text-xs text-faint">
          Borrowing against marketable securities (SBLOC) or laddered T-bills can fund a liquidity event without
          triggering capital gains or a fire sale. Crypto and cash are excluded from SBLOC collateral here.
        </p>
      </Panel>

      {/* Insurance-gap readout */}
      <Panel label="Insurance-gap readout">
        <ul className="space-y-1.5">
          {insuranceLines.map((l) => (
            <li key={l.kind} className="flex items-center gap-3 border-b border-line py-2 last:border-0">
              <span className="flex-1 text-sm text-ink">{l.label}</span>
              <span className="tnum hidden w-28 text-right font-mono text-xs text-faint sm:inline">
                {l.modeledNeed > 0 ? `need ${fmtMoneyCompact(l.modeledNeed)}` : 'presence'}
              </span>
              <span className="tnum w-24 text-right font-mono text-xs text-muted">
                {l.coverage > 0 ? fmtMoneyCompact(l.coverage) : '—'}
              </span>
              <span className={`w-16 text-right text-xs font-medium ${STATUS_STYLE[l.status]}`}>{STATUS_LABEL[l.status]}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Modeled needs are deliberately rough — they flag an obvious hole, not a recommended amount. Model + flag +
          coordinate with a professional; never a product pitch (invariant #9).
        </p>
      </Panel>

      {/* 529s */}
      {c529 > 0 && (
        <Panel label="Education — 529 plans">
          <Figure label="529 balance" value={c529} format="moneyCompact" accent="teal" size="md" sublabel="Tax-advantaged education savings" />
          <p className="mt-3 text-xs text-faint">
            529s grow tax-free for qualified education; superfunding (5-yr gift averaging) and beneficiary changes are
            worth a professional review.
          </p>
        </Panel>
      )}

      <MicroLabel className="text-faint">Model exposure · flag gaps · prompt the professional — ASCENT never drafts or files (invariant #9)</MicroLabel>
    </>
  )
}
