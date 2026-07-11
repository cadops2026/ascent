import { Panel, Figure, MicroLabel } from '../../components/ui'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import { BUCKET_LABEL } from '../../lib/finance/tax'
import type { BucketSlice, SequenceStep, LocationFlag, RmdView, LotHarvestResult, CoordinatePrompt } from '../../lib/finance/tax'
import type { TaxAdvantagedReview } from '../../lib/finance/taxadvantaged'

export interface TaxPanelsProps {
  buckets: { slices: BucketSlice[]; total: number }
  advantaged: TaxAdvantagedReview
  sequence: SequenceStep[]
  location: LocationFlag[]
  rmd: RmdView
  tlh: LotHarvestResult
  prompts: CoordinatePrompt[]
}

const TERM_LABEL: Record<'short' | 'long' | 'unknown', string> = { short: 'ST', long: 'LT', unknown: '' }

const BUCKET_COLOR: Record<string, string> = {
  taxable: 'bg-amber', tax_deferred: 'bg-indigo', tax_free: 'bg-teal', hsa: 'bg-teal/60', other: 'bg-faint',
}

/**
 * Presentational read-only tax readouts (pure props): account map by tax treatment,
 * withdrawal sequence, asset location, RMDs, harvest opportunities, CPA prompts.
 * Model + flag + coordinate — never files a return or gives individualized advice (#9).
 */
export function TaxPanels({ buckets, advantaged, sequence, location, rmd, tlh, prompts }: TaxPanelsProps) {
  return (
    <>
      {/* Tax-advantaged space — the high earner's #1 lever */}
      <Panel label="Tax-advantaged space — fill every sheltered dollar">
        <ul className="space-y-1.5">
          {advantaged.vehicles.map((v) => (
            <li key={v.key} className="flex items-center gap-3 text-sm">
              <span className={`micro-label w-10 shrink-0 ${v.present ? 'text-teal' : 'text-faint'}`}>
                {v.present ? 'have' : 'add'}
              </span>
              <span className="flex-1 text-muted">{v.label}</span>
              <span className="tnum font-mono text-ink">{fmtMoneyCompact(v.limit)}</span>
              <span className="w-44 text-right text-xs text-faint">{v.note}</span>
            </li>
          ))}
        </ul>
        <ul className="mt-4 space-y-3 border-t border-line pt-4">
          {advantaged.opportunities.map((o, i) => (
            <li key={i} className="flex gap-3">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${o.tone === 'watch' ? 'bg-amber' : 'bg-teal'}`} />
              <div>
                <div className="text-sm font-medium text-ink">{o.title}</div>
                <div className="text-xs leading-relaxed text-muted">{o.text}</div>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">
          Coverage + opportunities, with this year&rsquo;s limits — not a contributed-so-far gauge (the app holds
          balances, not contributions). &ldquo;have/add&rdquo; reflects which account types you&rsquo;ve tagged.
        </p>
      </Panel>

      {/* Accounts by tax treatment */}
      <Panel label="Accounts by tax treatment">
        <div className="mb-4 flex h-3 overflow-hidden rounded">
          {buckets.slices.map((s) => (
            <div key={s.bucket} className={BUCKET_COLOR[s.bucket]} style={{ width: `${s.pct * 100}%` }} title={BUCKET_LABEL[s.bucket]} />
          ))}
        </div>
        <ul className="space-y-1.5">
          {buckets.slices.map((s) => (
            <li key={s.bucket} className="flex items-center gap-3 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_COLOR[s.bucket]}`} />
              <span className="flex-1 text-muted">{BUCKET_LABEL[s.bucket]}</span>
              <span className="tnum font-mono text-ink">{fmtMoneyCompact(s.value)}</span>
              <span className="tnum w-12 text-right font-mono text-xs text-faint">{fmtPct(s.pct, 0)}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-faint">
          The three buckets — taxable, tax-deferred, tax-free — are the levers for everything below.
          Untagged holdings count as taxable. Tag accounts on the Balance Sheet.
        </p>
      </Panel>

      {/* Withdrawal sequence */}
      <Panel label="Tax-efficient withdrawal sequence">
        <ol className="space-y-3">
          {sequence.map((s, i) => (
            <li key={s.bucket} className="flex gap-3">
              <span className="tnum mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel-hi font-mono text-xs text-teal">{i + 1}</span>
              <div>
                <div className="text-sm font-medium text-ink">{BUCKET_LABEL[s.bucket]}</div>
                <div className="text-xs leading-relaxed text-muted">{s.rationale}</div>
              </div>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs text-faint">The general order — your CPA tailors it for bracket management, ACA/IRMAA, and heirs.</p>
      </Panel>

      {/* Asset location */}
      <Panel label="Asset location">
        <ul className="space-y-2">
          {location.map((f, i) => (
            <li key={i} className="flex gap-3 text-sm leading-relaxed">
              <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${f.tone === 'watch' ? 'bg-amber' : 'bg-teal'}`} />
              <span className="text-muted">{f.text}</span>
            </li>
          ))}
        </ul>
      </Panel>

      {/* RMDs */}
      <Panel label="Required minimum distributions">
        {rmd.active ? (
          <Figure
            label="Projected RMD this year"
            value={rmd.projectedRmd ?? 0}
            format="moneyCompact"
            accent="amber"
            size="lg"
            sublabel={`Age ${rmd.currentAge} · tax-deferred ÷ ${rmd.divisor} (Uniform Lifetime)`}
          />
        ) : (
          <Figure
            label="First RMD"
            display={rmd.yearsUntil != null ? `age ${rmd.startAge}` : `age ${rmd.startAge}`}
            accent="ink"
            size="lg"
            sublabel={
              rmd.yearsUntil != null
                ? `${rmd.yearsUntil} years away · ~${fmtMoneyCompact(rmd.projectedRmd ?? 0)} at today's balance`
                : `~${fmtMoneyCompact(rmd.projectedRmd ?? 0)} at today's balance`
            }
          />
        )}
        <p className="mt-3 text-xs text-faint">
          SECURE 2.0 start age {rmd.startAge}. RMDs are ordinary income — the window before they begin is the
          prime time for Roth conversions to drain tax-deferred balances at lower rates.
        </p>
      </Panel>

      {/* Tax-loss harvesting — lot-aware */}
      <Panel
        label="Tax-loss harvesting"
        right={
          tlh.totalHarvestable > 0 ? (
            <MicroLabel className="text-teal">{fmtMoneyCompact(tlh.totalHarvestable)} harvestable</MicroLabel>
          ) : undefined
        }
      >
        {tlh.positions.length === 0 ? (
          <p className="py-2 text-sm text-faint">No taxable positions are trading below cost basis right now.</p>
        ) : (
          <ul className="space-y-2.5">
            {tlh.positions.map((p) => (
              <li key={p.symbol} className="border-b border-line pb-2.5 last:border-0">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="text-ink">
                    {p.name}
                    {p.recentBuy && (
                      <span className="ml-2 micro-label rounded bg-amber/15 px-1.5 py-0.5 text-[0.6rem] text-amber">wash-sale risk</span>
                    )}
                  </span>
                  <span className={`tnum font-mono ${p.recentBuy ? 'text-amber' : 'text-coral'}`}>
                    −{fmtMoneyCompact(p.recentBuy ? p.washBlockedLoss : p.harvestableLoss)}
                  </span>
                </div>
                {p.hasLots && (
                  <ul className="mt-1 space-y-0.5">
                    {p.losingLots.map((l, i) => (
                      <li key={i} className="flex items-center gap-2 pl-3 text-xs text-faint">
                        <span className="tnum w-14 font-mono">{l.shares}sh</span>
                        {l.term !== 'unknown' && <span className="micro-label text-[0.6rem]">{TERM_LABEL[l.term]}</span>}
                        {l.acquiredOn && <span className="text-faint/70">{l.acquiredOn}</span>}
                        <span className="tnum ml-auto font-mono text-coral">−{fmtMoneyCompact(l.unrealizedLoss)}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {!p.hasLots && <div className="mt-0.5 pl-3 text-xs text-faint/70">blended basis — add lots below for lot-level detail</div>}
              </li>
            ))}
          </ul>
        )}
        {tlh.totalWashBlocked > 0 && (
          <p className="mt-3 text-xs text-amber">
            {fmtMoneyCompact(tlh.totalWashBlocked)} of losses sit behind a purchase in the last 30 days — harvesting now
            would wash the loss. Waiting out the window (or selling a non-replacement lot) preserves it.
          </p>
        )}
        <p className="mt-3 text-xs text-faint">
          Harvesting realizes losses to offset gains (and up to $3k of income). The <span className="text-ink">wash-sale</span> rule
          disallows a loss if you rebuy a substantially identical security within 30 days. Lots sharpen this; without them a
          position is read at its blended basis. Advisory — confirm lots and timing with your CPA before selling (#9).
        </p>
      </Panel>

      {/* Coordinate prompts */}
      <Panel label="Coordinate with your CPA">
        <ul className="space-y-3">
          {prompts.map((p, i) => (
            <li key={i}>
              <div className="text-sm font-medium text-ink">{p.title}</div>
              <div className="text-xs leading-relaxed text-muted">{p.note}</div>
            </li>
          ))}
        </ul>
      </Panel>

      <MicroLabel className="text-faint">Model exposure · flag the lever · coordinate with a professional — ASCENT never files a return (invariant #9)</MicroLabel>
    </>
  )
}
