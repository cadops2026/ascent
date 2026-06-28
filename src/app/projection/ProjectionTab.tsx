import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel, Field, Input } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { WealthPathChart } from './WealthPathChart'
import { fmtPct } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import { buildCma, applyCmaOverride, recenterCmaToReal } from '../../lib/finance/cma'
import { useCmaParams } from '../../lib/useCmaParams'
import { buildInflationCurve, flatInflationCurve } from '../../lib/finance/inflation'
import { monteCarlo } from '../../lib/finance/montecarlo'
import { macroContext } from '../../lib/finance/macrocontext'
import { MacroContextCard } from './MacroContextCard'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import type { InflRow } from '../../lib/finance/inflation'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { useAuth } from '../../auth/AuthProvider'

const CLASS_MAP: Record<string, string> = {
  Equities: 'us_equity',
  Crypto: 'crypto',
  Cash: 'cash',
  Private: 'private_equity',
  Collectibles: 'collectibles',
  'Real estate': 'real_estate',
}
const SIMS = 3000

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
}

export function ProjectionTab() {
  const { data, loading } = useBalanceSheet()
  const { session } = useAuth()
  const [cmaRows, setCmaRows] = useState<CmaSourceRow[]>([])
  const [uniRows, setUniRows] = useState<UniverseRow[]>([])
  const [inflRows, setInflRows] = useState<InflRow[]>([])

  const [inited, setInited] = useState(false)
  // Date of birth drives current age, which then auto-increases with time.
  const [dob, setDob] = useState('')
  const currentAge = ageFromDob(dob) ?? 45
  const [retireAge, setRetireAge] = useState(65)
  const [planToAge, setPlanToAge] = useState(85)
  // Contribution schedule: back-to-back intervals of (years, $/month, today's $).
  const [contribSchedule, setContribSchedule] = useState<{ years: number; monthly: number }[]>([])
  const [withdrawal, setWithdrawal] = useState(0)

  const addInterval = () => setContribSchedule((s) => [...s, { years: 5, monthly: 0 }])
  const updateInterval = (i: number, patch: Partial<{ years: number; monthly: number }>) =>
    setContribSchedule((s) => s.map((seg, j) => (j === i ? { ...seg, ...patch } : seg)))
  const removeInterval = (i: number) => setContribSchedule((s) => s.filter((_, j) => j !== i))

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
    setDob(data.profile?.dob ?? '')
    setRetireAge(data.profile?.retire_age ?? 65)
    setPlanToAge(data.profile?.plan_to_age ?? 85)
    setWithdrawal(data.spending?.annual_amount ?? 0)
    setInited(true)
  }, [loading, data, inited])

  // Persist DOB so current age is computed (and auto-increases) everywhere.
  const saveDob = async (d: string) => {
    setDob(d)
    if (session?.user.id && d) await supabase.from('profiles').upsert({ user_id: session.user.id, dob: d })
  }

  const { params: cmaOverride } = useCmaParams()
  const cma = useMemo(() => applyCmaOverride(buildCma(cmaRows, uniRows), cmaOverride), [cmaRows, uniRows, cmaOverride])
  // Settings inflation override → flat curve; else the EXPINF/seeded curve.
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
  // Settings global real-growth override → re-center the blend; else per-class CMA.
  const cmaEff = useMemo(
    () => (growthOverride != null ? recenterCmaToReal(cma, weights, growthOverride) : cma),
    [cma, weights, growthOverride],
  )

  const mc = useMemo(() => {
    if (bs.investable <= 0 || uniRows.length === 0) return null
    const retirementInYears = Math.max(0, retireAge - currentAge)
    // Net real cash flow per year: scheduled monthly contributions (×12) less
    // retirement spending once it begins. Intervals run back-to-back from now.
    const cashFlow = (year: number): number => {
      let acc = 0
      let monthly = 0
      for (const seg of contribSchedule) {
        if (year > acc && year <= acc + seg.years) {
          monthly = seg.monthly
          break
        }
        acc += seg.years
      }
      const spend = year > retirementInYears ? withdrawal : 0
      return monthly * 12 - spend
    }
    return monteCarlo(cmaEff, infl, {
      initialWealth: bs.investable,
      weights,
      horizonYears: Math.max(1, planToAge - currentAge),
      cashFlow,
      sims: SIMS,
    })
  }, [cmaEff, infl, weights, bs.investable, retireAge, currentAge, planToAge, contribSchedule, withdrawal, uniRows.length])

  const chartData = useMemo(
    () =>
      mc?.bands.map((b) => ({ age: currentAge + b.year, lo: b.p10, span: b.p90 - b.p10, p50: b.p50 })) ?? [],
    [mc, currentAge],
  )

  const accent = !mc ? 'ink' : mc.successProbability >= 0.8 ? 'teal' : mc.successProbability >= 0.6 ? 'amber' : 'coral'
  const allocClasses = bs.byClass.map((s) => CLASS_MAP[s.class]).filter((c): c is string => !!c)
  const macro = useMemo(
    () => macroContext(cmaEff, weights, infl, Math.max(1, planToAge - currentAge)),
    [cmaEff, weights, infl, planToAge, currentAge],
  )

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Projection" />

      {/* Editable assumptions (design principle #4) */}
      <Panel label="Assumptions">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Date of birth" hint={dob ? `age ${currentAge} · auto-updates` : 'sets your age'}>
            <Input type="date" value={dob} onChange={(e) => void saveDob(e.target.value)} />
          </Field>
          <Field label="Retire age">
            <Input type="number" value={retireAge} onChange={(e) => setRetireAge(Number(e.target.value))} />
          </Field>
          <Field label="Plan to age">
            <Input type="number" value={planToAge} onChange={(e) => setPlanToAge(Number(e.target.value))} />
          </Field>
          <Field label="Spend/yr" hint="in retirement">
            <Input type="number" value={withdrawal} onChange={(e) => setWithdrawal(Number(e.target.value))} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-faint">
          Returns from the consensus-CMA engine (Vanguard/JPM/Invesco/BlackRock/MS); inflation from the{' '}
          <span className="font-mono">{infl.source}</span> curve. Real (today's) dollars.
        </p>
      </Panel>

      {/* Contribution schedule — back-to-back intervals of (years, $/month) */}
      <Panel
        label="Contributions"
        right={
          <button type="button" onClick={addInterval} className="micro-label text-teal hover:text-ink">
            + Add interval
          </button>
        }
      >
        {contribSchedule.length === 0 ? (
          <p className="py-2 text-sm text-faint">
            No contributions yet. Add an interval to model monthly contributions over time — e.g. $5,000/mo for
            3 years, then $3,000/mo for 2 years.
          </p>
        ) : (
          <ul className="space-y-2">
            {contribSchedule.map((seg, i) => {
              const startYear = contribSchedule.slice(0, i).reduce((a, s) => a + (s.years || 0), 0)
              const fromAge = currentAge + startYear
              const toAge = fromAge + (seg.years || 0)
              return (
                <li key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted">For</span>
                  <Input
                    type="number"
                    value={seg.years}
                    onChange={(e) => updateInterval(i, { years: Math.max(0, Number(e.target.value)) })}
                    className="w-16 py-1.5! text-right"
                  />
                  <span className="text-muted">years, contribute $</span>
                  <Input
                    type="number"
                    value={seg.monthly}
                    onChange={(e) => updateInterval(i, { monthly: Math.max(0, Number(e.target.value)) })}
                    className="w-28 py-1.5! text-right"
                  />
                  <span className="text-muted">/month</span>
                  <span className="tnum text-xs text-faint">· age {fromAge}–{toAge}</span>
                  <button
                    type="button"
                    onClick={() => removeInterval(i)}
                    className="micro-label ml-auto text-faint hover:text-coral"
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-faint">
          Today&rsquo;s dollars. Intervals run back-to-back starting now. After the schedule ends, contributions
          stop; retirement spending begins at the retire age above.
        </p>
      </Panel>

      {!mc ? (
        <Panel>
          <p className="py-8 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add investable holdings on the Balance Sheet to run the projection.'}
          </p>
        </Panel>
      ) : (
        <>
          {/* Hero: success probability + 25th-pct outcome (invariant #4) */}
          <Panel label="Success probability">
            <div className="grid gap-8 md:grid-cols-2">
              <Figure
                label={`Plan funds spending through age ${planToAge}`}
                display={fmtPct(mc.successProbability, 0)}
                accent={accent}
                size="hero"
                sublabel={`Monte Carlo · ${mc.sims.toLocaleString()} paths`}
              />
              <Figure
                label="25th-percentile end wealth"
                value={mc.terminal.p25}
                format="moneyCompact"
                band={{ low: mc.terminal.p10, high: mc.terminal.p90 }}
                confidence="P10–P90"
                accent="indigo"
                size="lg"
                sublabel="Conservative case shown first"
              />
            </div>
          </Panel>

          {/* Percentile-band wealth path */}
          <Panel label="Wealth path — real dollars, P10–P90 band">
            <WealthPathChart data={chartData} />
          </Panel>

          {/* Scenario terminals */}
          <div className="grid gap-5 sm:grid-cols-3">
            <Scenario label="Bear (P10)" value={mc.terminal.p10} accent="coral" />
            <Scenario label="Base (median)" value={mc.terminal.p50} accent="teal" />
            <Scenario label="Bull (P90)" value={mc.terminal.p90} accent="indigo" />
          </div>

          {/* Visible engine assumptions */}
          <Panel label="Per-class assumptions (consensus CMA · real returns)">
            <ul className="space-y-1.5">
              {[...new Set(allocClasses)].map((c) => {
                const k = cmaEff[c]
                if (!k) return null
                return (
                  <li key={c} className="flex items-center gap-3 text-sm">
                    <span className="flex-1 text-muted">{c.replace(/_/g, ' ')}</span>
                    <span className="tnum font-mono text-ink">{fmtPct(k.expectedReturn)}</span>
                    <span className="tnum w-28 text-right font-mono text-xs text-faint">
                      range {fmtPct(k.low)}–{fmtPct(k.high)}
                    </span>
                    <span className="tnum w-20 text-right font-mono text-xs text-faint">vol {fmtPct(k.vol, 0)}</span>
                  </li>
                )
              })}
            </ul>
            <p className="mt-3 text-xs text-faint">
              Crypto draws a fat-tailed Student-t distribution in the simulation (invariant #12). Every figure
              is a band; nothing is a single false-precision number.
            </p>
          </Panel>

          {/* Macro context — structural, calm, not a signal (spec §2) */}
          {macro && <MacroContextCard macro={macro} />}
        </>
      )}
    </div>
  )
}

function Scenario({ label, value, accent }: { label: string; value: number; accent: 'coral' | 'teal' | 'indigo' }) {
  return (
    <Panel>
      <Figure label={label} value={value} format="moneyCompact" accent={accent} size="md" />
      <MicroLabel className="mt-2 text-faint">end wealth · today's $</MicroLabel>
    </Panel>
  )
}
