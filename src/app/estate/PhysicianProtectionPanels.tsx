import { Panel, Figure, MicroLabel } from '../../components/ui'
import { fmtMoney, fmtMoneyCompact, fmtPct } from '../../lib/format'
import type { DisabilityView, ProtectionFlag, OwnOccTier } from '../../lib/finance/disability'
import {
  OWN_OCC_LABEL,
  OWN_OCC_NOTE,
  BENEFIT_TAX_LABEL,
  HUMAN_CAPITAL_REAL_DISCOUNT,
  HUMAN_CAPITAL_DISCOUNT_SPREAD,
} from '../../lib/finance/disability'
import type { AssetProtectionView, ProtectionTier } from '../../lib/finance/assetprotection'
import { TIER_LABEL } from '../../lib/finance/assetprotection'
import type { AlertSeverity } from '../../lib/finance/alertengine'

/**
 * The two protection readouts a high-earning professional needs and a
 * presence-based insurance checklist misses: whether the disability policy would
 * actually pay, and which dollars a liability claim could actually reach.
 *
 * Presentational and pure — all math arrives as props from the engines. Calm by
 * default (invariant #6): no alarm colouring beyond what severity earns, and
 * every readout ends by pointing at the professional, never at a product (#9).
 */

const SEV_STYLE: Record<AlertSeverity, string> = {
  high: 'border-coral/30 bg-coral/[0.06] text-coral',
  caution: 'border-amber/30 bg-amber/[0.06] text-amber',
  info: 'border-indigo/30 bg-indigo/[0.06] text-indigo',
}

const TIER_STYLE: Record<ProtectionTier, string> = {
  strong: 'text-teal',
  capped: 'text-indigo',
  state: 'text-amber',
  depends: 'text-amber',
  exposed: 'text-coral',
}

const TIER_BAR: Record<ProtectionTier, string> = {
  strong: 'bg-teal',
  capped: 'bg-indigo',
  state: 'bg-amber',
  depends: 'bg-amber/70',
  exposed: 'bg-coral',
}

const OWN_OCC_STYLE: Record<OwnOccTier, string> = {
  specialty_own_occ: 'text-teal',
  own_occ: 'text-teal',
  modified_own_occ: 'text-amber',
  any_occ: 'text-coral',
  unknown: 'text-faint',
}

function Flags({ flags }: { flags: ProtectionFlag[] }) {
  if (flags.length === 0) return null
  return (
    <ul className="mt-4 space-y-2">
      {flags.map((f, i) => (
        <li key={i} className={`rounded-[var(--radius-panel)] border px-3 py-2 ${SEV_STYLE[f.severity]}`}>
          <div className="text-sm font-medium">{f.title}</div>
          <div className="mt-0.5 text-xs leading-relaxed opacity-80">{f.detail}</div>
        </li>
      ))}
    </ul>
  )
}

function Line({ label, value, tone = 'muted' }: { label: string; value: string; tone?: 'muted' | 'coral' | 'ink' | 'teal' }) {
  const v = tone === 'coral' ? 'text-coral' : tone === 'ink' ? 'text-ink' : tone === 'teal' ? 'text-teal' : 'text-muted'
  return (
    <div className="flex items-center justify-between border-b border-line py-2 last:border-0">
      <span className="text-sm text-muted">{label}</span>
      <span className={`tnum font-mono text-sm ${v}`}>{value}</span>
    </div>
  )
}

export function IncomeProtectionPanel({ view, hasIncome }: { view: DisabilityView; hasIncome: boolean }) {
  const d = view
  const confidence = `discount ${fmtPct(HUMAN_CAPITAL_REAL_DISCOUNT - HUMAN_CAPITAL_DISCOUNT_SPREAD, 1)}–${fmtPct(
    HUMAN_CAPITAL_REAL_DISCOUNT + HUMAN_CAPITAL_DISCOUNT_SPREAD,
    1,
  )} real`

  return (
    <Panel
      label="Income protection — own-occupation readout"
      right={
        <MicroLabel className={d.status === 'covered' ? 'text-teal' : d.status === 'gap' ? 'text-coral' : 'text-amber'}>
          {d.status === 'covered' ? 'covered' : d.status === 'gap' ? 'gap' : d.status === 'review' ? 'review terms' : '—'}
        </MicroLabel>
      }
    >
      {!hasIncome ? (
        <p className="py-6 text-center text-sm text-faint">
          Add your gross earned income below to model the income this insures — the largest asset on most
          balance sheets before the portfolio catches up.
        </p>
      ) : (
        <>
          <Figure
            label="Future earnings at risk"
            value={d.humanCapital.mid}
            format="moneyCompact"
            accent={d.status === 'covered' ? 'teal' : 'amber'}
            size="hero"
            band={{ low: d.humanCapital.low, high: d.humanCapital.high }}
            confidence={confidence}
            sublabel={`Present value of ${Math.round(d.yearsToRetire)} more working years, after tax — what a disability policy exists to replace.`}
          />

          <div className="mt-5 grid gap-5 sm:grid-cols-3">
            <Figure
              label="Benefit after tax"
              value={d.effectiveMonthlyBenefit}
              format="money"
              accent={d.gapToSpending > 0 ? 'coral' : 'teal'}
              size="md"
              sublabel="per month, as it would arrive"
            />
            <Figure label="Monthly spending" value={d.monthlySpending} format="money" accent="ink" size="md" sublabel="the floor it has to clear" />
            <Figure
              label="After-tax income"
              value={d.afterTaxIncomeMonthly}
              format="money"
              accent="indigo"
              size="md"
              sublabel="full replacement — stays on plan"
            />
          </div>

          <div className="mt-5">
            <Line label="Stated benefit (before tax)" value={`${fmtMoney(d.grossMonthlyBenefit)} / mo`} tone="ink" />
            <Line
              label="Gap to spending"
              value={d.gapToSpending > 0 ? `${fmtMoney(d.gapToSpending)} / mo` : 'none'}
              tone={d.gapToSpending > 0 ? 'coral' : 'teal'}
            />
            <Line
              label="Gap to full income"
              value={d.gapToIncome > 0 ? `${fmtMoney(d.gapToIncome)} / mo` : 'none'}
              tone={d.gapToIncome > 0 ? 'muted' : 'teal'}
            />
            <Line label="Weakest definition in force" value={OWN_OCC_LABEL[d.weakestDefinition]} tone="ink" />
          </div>

          {d.policies.length > 0 && (
            <div className="mt-5 space-y-3">
              <MicroLabel className="text-faint">Policy by policy</MicroLabel>
              {d.policies.map((p) => (
                <div key={p.id} className="rounded-[var(--radius-panel)] border border-line px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-sm text-ink">
                      {p.carrier}
                      {p.group && <span className="micro-label ml-2 rounded bg-faint/10 px-1.5 py-0.5 text-[0.6rem] text-faint">group</span>}
                    </span>
                    <span className="tnum font-mono text-sm text-muted">
                      {fmtMoney(p.monthlyBenefit)}/mo
                      {p.effectiveMonthly !== p.monthlyBenefit && (
                        <span className="text-coral"> → {fmtMoney(p.effectiveMonthly)} after tax</span>
                      )}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                    <span className={OWN_OCC_STYLE[p.ownOcc]}>{OWN_OCC_LABEL[p.ownOcc]}</span>
                    <span className="text-faint">{BENEFIT_TAX_LABEL[p.benefitTax]}</span>
                    {p.benefitYearsFromNow != null && (
                      <span className="text-faint">benefit ~{Math.round(p.benefitYearsFromNow)} yrs</span>
                    )}
                  </div>
                  {p.weaknesses.length > 0 && (
                    <ul className="mt-2 space-y-0.5">
                      {p.weaknesses.map((w, i) => (
                        <li key={i} className="text-xs leading-relaxed text-faint">
                          · {w}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          )}

          <Flags flags={d.flags} />

          <p className="mt-4 text-xs leading-relaxed text-faint">
            {OWN_OCC_NOTE.specialty_own_occ} That definition, the tax character of the benefit, and the benefit
            period decide what a policy is worth — not the headline amount. Exposure and gaps only: ASCENT never
            recommends a policy, carrier or amount (invariant #9).
          </p>
        </>
      )}
    </Panel>
  )
}

export function CreditorExposurePanel({ view }: { view: AssetProtectionView }) {
  const a = view
  const mp = a.malpractice

  return (
    <Panel
      label="Creditor exposure — what a claim can reach"
      right={<MicroLabel className="text-faint">{fmtPct(a.reachablePct, 0)} reachable</MicroLabel>}
    >
      <div className="grid gap-5 sm:grid-cols-3">
        <Figure label="Reachable" value={a.reachable} format="moneyCompact" accent="coral" size="md" sublabel="Taxable, IRA, state-law buckets" />
        <Figure label="Well protected" value={a.wellProtected} format="moneyCompact" accent="teal" size="md" sublabel="ERISA employer plans" />
        <Figure
          label="Umbrella cover"
          value={a.umbrellaCoverage}
          format="moneyCompact"
          accent={a.umbrellaGap > 0 ? 'amber' : 'teal'}
          size="md"
          sublabel={a.umbrellaGap > 0 ? `${fmtMoneyCompact(a.umbrellaGap)} above the limit` : 'covers reachable assets'}
        />
      </div>

      {a.total > 0 && (
        <div className="mt-5">
          <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
            {a.buckets.map((b) => (
              <div key={b.key} className={TIER_BAR[b.tier]} style={{ width: `${(b.value / a.total) * 100}%` }} title={`${b.label} — ${TIER_LABEL[b.tier]}`} />
            ))}
          </div>
          <ul className="mt-3 space-y-1.5">
            {a.buckets.map((b) => (
              <li key={b.key} className="border-b border-line py-2 last:border-0">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-ink">{b.label}</span>
                  <span className="flex items-baseline gap-3">
                    <span className="tnum font-mono text-sm text-muted">{fmtMoneyCompact(b.value)}</span>
                    <span className={`w-40 text-right text-xs ${TIER_STYLE[b.tier]}`}>{TIER_LABEL[b.tier]}</span>
                  </span>
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-faint">{b.note}</p>
              </li>
            ))}
          </ul>
        </div>
      )}

      {mp && (
        <div className="mt-5 rounded-[var(--radius-panel)] border border-line px-3 py-2.5">
          <MicroLabel className="text-faint">Professional liability</MicroLabel>
          <div className="mt-2">
            <Line
              label="Policy form"
              value={mp.form === 'occurrence' ? 'Occurrence' : mp.form === 'claims_made' ? 'Claims-made' : 'Not recorded'}
              tone={mp.form === 'occurrence' ? 'teal' : mp.form === 'claims_made' ? 'coral' : 'muted'}
            />
            {mp.form === 'claims_made' && (
              <Line
                label="Tail (extended reporting)"
                value={mp.tailSecured === true ? 'Secured' : mp.tailSecured === false ? 'Not secured' : 'Not recorded'}
                tone={mp.tailSecured === true ? 'teal' : 'coral'}
              />
            )}
            {mp.perClaim > 0 && <Line label="Per-claim limit" value={fmtMoney(mp.perClaim)} tone="ink" />}
            {mp.aggregate > 0 && <Line label="Aggregate limit" value={fmtMoney(mp.aggregate)} />}
            <Line label="Provided by" value={mp.employerProvided ? 'Employer' : 'Individually held'} />
          </div>
        </div>
      )}

      <Flags flags={a.flags} />

      <p className="mt-4 text-xs leading-relaxed text-faint">
        <span className="text-muted">Where you live changes this.</span> {a.stateNote}
      </p>
      <p className="mt-2 text-xs leading-relaxed text-faint">
        General framework only — not legal advice and not a legal conclusion. Creditor protection turns on the
        state, the type of claim, bankruptcy versus not, how title is held, and the timing of transfers. ASCENT
        models exposure and flags gaps; structuring is for counsel (invariant #9).
      </p>
    </Panel>
  )
}
