import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel, Field, Input } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtPct } from '../../lib/format'
import { computeBalanceSheet, holdingValue } from '../../lib/finance/networth'
import { buildCma, applyCmaOverride, recenterCmaToReal } from '../../lib/finance/cma'
import { useCmaParams } from '../../lib/useCmaParams'
import { buildInflationCurve, flatInflationCurve } from '../../lib/finance/inflation'
import { solveYearsOfWork, solveMaintainWealth, sensitivityStrip, principleFor } from '../../lib/finance/glidepath'
import type { GlideInput } from '../../lib/finance/glidepath'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import type { InflRow } from '../../lib/finance/inflation'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { PhaseBar } from './PhaseBar'

const CLASS_MAP: Record<string, string> = {
  Equities: 'us_equity', Crypto: 'crypto', Cash: 'cash',
  Private: 'private_equity', Collectibles: 'collectibles', 'Real estate': 'real_estate',
}
const MEDICARE_AGE = 65

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
}

export function WorkGlidePathTab() {
  const { data, loading } = useBalanceSheet()
  const [cmaRows, setCmaRows] = useState<CmaSourceRow[]>([])
  const [uniRows, setUniRows] = useState<UniverseRow[]>([])
  const [inflRows, setInflRows] = useState<InflRow[]>([])

  const [inited, setInited] = useState(false)
  const [currentAge, setCurrentAge] = useState(45)
  const [planToAge, setPlanToAge] = useState(95)
  const [spending, setSpending] = useState(0)
  const [contribution, setContribution] = useState(0)
  const [confidence, setConfidence] = useState(85)
  const [bridgeYears, setBridgeYears] = useState(0)
  const [phase2Income, setPhase2Income] = useState(50)
  const [healthcare, setHealthcare] = useState(0)

  useEffect(() => {
    void (async () => {
      const [c, u, i] = await Promise.all([
        supabase.from('cma_sources').select('asset_class, house, value'),
        supabase.from('asset_class_universe').select('class, cma_premium, vol, corr_to_us_equity, cost_proxy'),
        supabase.from('infl_expectations_cache').select('source, horizon_years, value'),
      ])
      setCmaRows((c.data ?? []) as CmaSourceRow[])
      setUniRows((u.data ?? []) as UniverseRow[])
      setInflRows((i.data ?? []) as InflRow[])
    })()
  }, [])

  useEffect(() => {
    if (inited || loading) return
    setCurrentAge(ageFromDob(data.profile?.dob) ?? 45)
    setPlanToAge(data.profile?.plan_to_age ?? 95)
    setSpending(data.spending?.annual_amount ?? 0)
    setInited(true)
  }, [loading, data, inited])

  const { params: cmaOverride } = useCmaParams()
  const cma = useMemo(() => applyCmaOverride(buildCma(cmaRows, uniRows), cmaOverride), [cmaRows, uniRows, cmaOverride])
  const inflOverride = data.profile?.inflation_override ?? null
  const growthOverride = data.profile?.real_growth_override ?? null
  const infl = useMemo(
    () => (inflOverride != null ? flatInflationCurve(inflOverride) : buildInflationCurve(inflRows)),
    [inflRows, inflOverride],
  )
  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data],
  )
  const weights = useMemo(() => {
    const w: Record<string, number> = {}
    for (const s of bs.byClass) {
      const k = CLASS_MAP[s.class]
      if (k) w[k] = (w[k] ?? 0) + s.value
    }
    return w
  }, [bs])
  const cmaEff = useMemo(
    () => (growthOverride != null ? recenterCmaToReal(cma, weights, growthOverride) : cma),
    [cma, weights, growthOverride],
  )

  const singleNamePct = useMemo(() => {
    let mx = 0
    for (const h of data.holdings) {
      if (h.kind === 'cash') continue
      const v = holdingValue(h, data.quotes)
      if (v) mx = Math.max(mx, v)
    }
    return bs.investable > 0 ? mx / bs.investable : 0
  }, [data.holdings, data.quotes, bs.investable])
  const cryptoPct = bs.investable > 0 ? (bs.byClass.find((c) => c.class === 'Crypto')?.value ?? 0) / bs.investable : 0

  // Defer the solve inputs so typing stays smooth while the (heavy) search runs.
  const dq = {
    age: useDeferredValue(currentAge), plan: useDeferredValue(planToAge), spend: useDeferredValue(spending),
    contrib: useDeferredValue(contribution), conf: useDeferredValue(confidence), bridge: useDeferredValue(bridgeYears),
    p2: useDeferredValue(phase2Income), hc: useDeferredValue(healthcare),
  }

  const glide = useMemo(() => {
    if (bs.investable <= 0 || uniRows.length === 0) return null
    const inp: GlideInput = {
      initialWealth: bs.investable, weights,
      currentAge: dq.age, planToAge: dq.plan, spending: dq.spend, contribution: dq.contrib,
      confidenceTarget: dq.conf / 100, bridgeYears: dq.bridge, phase2IncomeFrac: dq.p2 / 100,
      healthcareAnnual: dq.hc, medicareAge: MEDICARE_AGE, sims: 700,
    }
    const sol = solveYearsOfWork(cmaEff, infl, inp)
    const maintain = solveMaintainWealth(cmaEff, infl, inp)
    const sens = sol.feasible ? sensitivityStrip(cmaEff, infl, inp, sol.years) : []
    const principle = principleFor({ yearsOfWork: sol.years, feasible: sol.feasible, singleNamePct, cryptoPct })
    return { inp, sol, maintain, sens, principle }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cmaEff, infl, weights, bs.investable, dq.age, dq.plan, dq.spend, dq.contrib, dq.conf, dq.bridge, dq.p2, dq.hc, singleNamePct, cryptoPct, uniRows.length])

  const horizon = Math.max(1, dq.plan - dq.age)

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Work Glide-Path" />

      <Panel label="Assumptions">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Current age"><Input type="number" value={currentAge} onChange={(e) => setCurrentAge(Number(e.target.value))} /></Field>
          <Field label="Plan to age"><Input type="number" value={planToAge} onChange={(e) => setPlanToAge(Number(e.target.value))} /></Field>
          <Field label="Spend/yr"><Input type="number" value={spending} onChange={(e) => setSpending(Number(e.target.value))} /></Field>
          <Field label="Contrib./yr"><Input type="number" value={contribution} onChange={(e) => setContribution(Number(e.target.value))} /></Field>
          <Field label="Confidence %"><Input type="number" value={confidence} onChange={(e) => setConfidence(Number(e.target.value))} /></Field>
          <Field label="Downshift yrs" hint="partial-income bridge"><Input type="number" value={bridgeYears} onChange={(e) => setBridgeYears(Number(e.target.value))} /></Field>
          <Field label="Bridge income %"><Input type="number" value={phase2Income} onChange={(e) => setPhase2Income(Number(e.target.value))} /></Field>
          <Field label="Healthcare/yr" hint="pre-Medicare"><Input type="number" value={healthcare} onChange={(e) => setHealthcare(Number(e.target.value))} /></Field>
        </div>
      </Panel>

      {!glide ? (
        <Panel>
          <p className="py-8 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add investable holdings + a spending baseline to solve your glide-path.'}
          </p>
        </Panel>
      ) : (
        <>
          {/* Headline: years of full work remaining @confidence */}
          <Panel label={`Years of full work remaining @ ${confidence}% confidence`}>
            <div className="grid gap-8 md:grid-cols-2">
              <Figure
                label={glide.sol.feasible ? 'Until you can stop full work' : 'Plan not fundable at this confidence'}
                display={glide.sol.feasible ? String(glide.sol.years) : '—'}
                accent={glide.sol.feasible ? (glide.sol.years <= 0 ? 'teal' : 'teal') : 'coral'}
                size="hero"
                sublabel={
                  glide.sol.feasible
                    ? `Retire at ~${dq.age + glide.sol.years} · ${fmtPct(glide.sol.success, 0)} success at solution`
                    : `Even working to ${dq.plan}, success peaks at ${fmtPct(glide.sol.success, 0)}`
                }
              />
              <Figure
                label="To also maintain wealth (leave it intact)"
                display={glide.maintain.feasible ? `${glide.maintain.years} yrs` : '—'}
                accent="indigo"
                size="lg"
                sublabel="Median end wealth ≥ today's, in real terms"
              />
            </div>
            {/* Sensitivity strip */}
            {glide.sens.length > 0 && (
              <div className="mt-5 flex flex-wrap gap-2">
                {glide.sens.map((s) => (
                  <span key={s.label} className="rounded-lg border border-line bg-panel-hi px-3 py-1.5 text-xs">
                    <span className="text-muted">{s.label}</span>{' '}
                    <span className={`tnum font-mono ${s.deltaYears > 0 ? 'text-coral' : s.deltaYears < 0 ? 'text-teal' : 'text-faint'}`}>
                      {s.deltaYears > 0 ? '+' : ''}{s.deltaYears} yr
                    </span>
                  </span>
                ))}
              </div>
            )}
          </Panel>

          {/* Three-phase timeline */}
          {glide.sol.feasible && (
            <Panel label="Three phases">
              <PhaseBar fullWork={glide.sol.years} bridge={dq.bridge} horizon={horizon} startAge={dq.age} />
            </Panel>
          )}

          {/* Sequence risk + principles overlay */}
          <div className="grid gap-5 md:grid-cols-2">
            <Panel label="Sequence risk">
              <p className="text-sm leading-relaxed text-muted">
                A weak first decade of returns matters far more than a weak later one — you'd be withdrawing
                from a shrunken base. The <span className="text-coral">P10 path</span> already prices in poor
                early years; the {confidence}% confidence target is what keeps a bad start from breaking the plan.
              </p>
            </Panel>
            <Panel label="Principle">
              <p className="text-sm leading-relaxed text-ink">{glide.principle.text}</p>
              <MicroLabel className="mt-3 text-teal">— {glide.principle.author}</MicroLabel>
              <p className="mt-2 text-xs text-faint">Explains your state; it never overrides the math (invariant #8).</p>
            </Panel>
          </div>
        </>
      )}
    </div>
  )
}
