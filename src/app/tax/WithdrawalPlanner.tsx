import { useDeferredValue, useMemo, useState } from 'react'
import { Panel, Figure, MicroLabel, Field, Input } from '../../components/ui'
import { fmtMoneyCompact, fmtMoney, fmtPct } from '../../lib/format'
import type { ClassCma } from '../../lib/finance/cma'
import type { InflationCurve } from '../../lib/finance/inflation'
import { solveMaxWithdrawal, guytonKlingerGuardrails, taxAwareSourcing } from '../../lib/finance/withdrawal'
import type { SourceBucket } from '../../lib/finance/withdrawal'
import type { FilingStatus } from '../../lib/db'

const BUCKET_LABEL: Record<SourceBucket, string> = {
  rmd: 'RMD (forced)', taxable: 'Taxable', tax_deferred: 'Tax-deferred', roth: 'Roth (tax-free)',
}

export interface WithdrawalPlannerProps {
  cma: Record<string, ClassCma>
  infl: InflationCurve
  weights: Record<string, number>
  investable: number
  taxable: number
  taxDeferred: number
  taxFree: number
  rmd: number
  filing: FilingStatus
  currentAge: number
  gainFractionDefault: number
  hasReferenceData: boolean // cma/universe loaded
}

export function WithdrawalPlanner(p: WithdrawalPlannerProps) {
  const [retireAge, setRetireAge] = useState(Math.max(p.currentAge, 65))
  const [planToAge, setPlanToAge] = useState(95)
  const [confidence, setConfidence] = useState(85)
  const [spend, setSpend] = useState<number | null>(null) // null ⇒ use solved max
  const [otherIncome, setOtherIncome] = useState(0)
  const [gainPct, setGainPct] = useState(Math.round(p.gainFractionDefault * 100))

  // Defer the heavy solve so typing stays smooth.
  const dq = {
    retire: useDeferredValue(retireAge), plan: useDeferredValue(planToAge), conf: useDeferredValue(confidence),
  }

  const solved = useMemo(() => {
    if (!p.hasReferenceData || p.investable <= 0) return null
    return solveMaxWithdrawal(p.cma, p.infl, {
      initialWealth: p.investable,
      weights: p.weights,
      retirementInYears: Math.max(0, dq.retire - p.currentAge),
      horizonYears: Math.max(1, dq.plan - p.currentAge),
      confidenceTarget: dq.conf / 100,
      sims: 1500,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.cma, p.infl, p.weights, p.investable, p.currentAge, dq.retire, dq.plan, dq.conf, p.hasReferenceData])

  const plannedSpend = spend ?? solved?.withdrawal ?? 0
  const guardrails = useMemo(() => guytonKlingerGuardrails(plannedSpend, p.investable), [plannedSpend, p.investable])
  const sourcing = useMemo(
    () => taxAwareSourcing({
      netNeed: plannedSpend,
      taxable: p.taxable, gainFraction: gainPct / 100,
      taxDeferred: p.taxDeferred, taxFree: p.taxFree,
      rmd: p.rmd, otherOrdinaryIncome: otherIncome, filing: p.filing,
    }),
    [plannedSpend, p.taxable, gainPct, p.taxDeferred, p.taxFree, p.rmd, otherIncome, p.filing],
  )

  return (
    <>
      {/* 1. Safe sustainable withdrawal */}
      <Panel label="Withdrawal planner — how much can you spend?">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Current age"><Input type="number" value={p.currentAge} readOnly className="opacity-70" /></Field>
          <Field label="Retire age"><Input type="number" value={retireAge} onChange={(e) => setRetireAge(Number(e.target.value))} /></Field>
          <Field label="Plan to age"><Input type="number" value={planToAge} onChange={(e) => setPlanToAge(Number(e.target.value))} /></Field>
          <Field label="Confidence %"><Input type="number" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} /></Field>
        </div>
        {!solved ? (
          <p className="py-4 text-sm text-faint">
            {p.hasReferenceData ? 'Add investable holdings to solve a sustainable withdrawal.' : 'Loading market assumptions…'}
          </p>
        ) : (
          <Figure
            label={`Max sustainable spend @ ${confidence}% confidence`}
            value={solved.withdrawal}
            format="moneyCompact"
            accent={solved.feasible ? 'teal' : 'coral'}
            size="hero"
            sublabel={`${fmtPct(solved.rate, 2)} of investable · today's $ · Monte Carlo, real terms`}
          />
        )}
        <p className="mt-3 text-xs text-faint">
          The largest constant inflation-adjusted spend the plan supports at your confidence — the inverse of the
          Projection's success probability. Every figure is a real-dollar estimate, not a guarantee (invariant #4).
        </p>
      </Panel>

      {/* 2. Guyton-Klinger guardrails */}
      <Panel label="Dynamic guardrails (Guyton-Klinger)" right={<MicroLabel className="text-faint">spend {fmtMoneyCompact(plannedSpend)}</MicroLabel>}>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="rounded-lg border border-coral/30 bg-coral/5 p-4">
            <MicroLabel className="text-coral">If the portfolio falls to</MicroLabel>
            <div className="tnum mt-1 font-mono text-2xl text-ink">{fmtMoneyCompact(guardrails.trimPortfolio)}</div>
            <p className="mt-1 text-xs text-muted">trim spending ~10% → <span className="text-ink">{fmtMoneyCompact(guardrails.spendIfTrim)}</span></p>
          </div>
          <div className="rounded-lg border border-teal/30 bg-teal/5 p-4">
            <MicroLabel className="text-teal">If it rises to</MicroLabel>
            <div className="tnum mt-1 font-mono text-2xl text-ink">{fmtMoneyCompact(guardrails.raisePortfolio)}</div>
            <p className="mt-1 text-xs text-muted">you can raise ~10% → <span className="text-ink">{fmtMoneyCompact(guardrails.spendIfRaise)}</span></p>
          </div>
        </div>
        <p className="mt-3 text-xs text-faint">
          Your current rate is {fmtPct(guardrails.initialRate, 2)}. Guyton-Klinger cuts spending 10% if the withdrawal
          rate rises 20% above this, and raises 10% if it falls 20% below — so a −17% portfolio drop trims, a +25%
          gain lifts. Pre-committing to the rails is what keeps a bad year from forcing a panic cut.
        </p>
      </Panel>

      {/* 3. Tax-aware sourcing */}
      <Panel label="Tax-aware sourcing of the withdrawal">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Spend to fund" hint="net, today's $">
            <Input type="number" value={Math.round(plannedSpend)} onChange={(e) => setSpend(Number(e.target.value))} />
          </Field>
          <Field label="Other income" hint="SS/pension, gross">
            <Input type="number" value={otherIncome} onChange={(e) => setOtherIncome(Number(e.target.value))} />
          </Field>
          <Field label="Taxable gain %" hint="of taxable value">
            <Input type="number" value={gainPct} onChange={(e) => setGainPct(Number(e.target.value))} />
          </Field>
        </div>

        <div className="grid gap-5 sm:grid-cols-3">
          <Figure label="Gross to withdraw" value={sourcing.totalGross} format="moneyCompact" accent="ink" size="md" sublabel={`to net ${fmtMoneyCompact(sourcing.netDelivered)}`} />
          <Figure label="Est. tax" value={sourcing.totalTax} format="moneyCompact" accent={sourcing.effectiveRate >= 0.2 ? 'amber' : 'teal'} size="md" sublabel={`${fmtPct(sourcing.effectiveRate)} effective`} />
          <Figure label="Top ordinary bracket" display={fmtPct(sourcing.marginalOrdinaryRate, 0)} accent="ink" size="md" sublabel="reached by ordinary draws" />
        </div>

        <ul className="mt-4 space-y-1.5">
          {sourcing.draws.map((d) => (
            <li key={d.bucket} className="flex items-center gap-3 border-b border-line py-2 last:border-0 text-sm">
              <span className="flex-1 text-ink">{BUCKET_LABEL[d.bucket]}</span>
              <span className="tnum w-24 text-right font-mono text-muted">{fmtMoney(d.gross)}</span>
              <span className="tnum w-20 text-right font-mono text-xs text-coral">{d.tax > 0 ? `−${fmtMoneyCompact(d.tax)}` : '$0'}</span>
              <span className="tnum w-24 text-right font-mono text-xs text-faint">net {fmtMoneyCompact(d.net)}</span>
            </li>
          ))}
        </ul>
        {sourcing.unmet > 0 && (
          <p className="mt-3 text-sm text-coral">Accounts can't cover {fmtMoneyCompact(sourcing.unmet)} of the need — lower the spend or check balances.</p>
        )}
        <p className="mt-4 text-xs leading-relaxed text-faint">
          Sourced taxable → tax-deferred → Roth (RMDs first), with progressive ordinary tax and stacked 0/15/20%
          long-term gains, grossed-up so the net equals your spend. Approximate 2026 rules — directional, not a
          filed return (invariant #9). Use the Roth-conversion explorer above to fill low brackets in lean years.
        </p>
      </Panel>
    </>
  )
}
