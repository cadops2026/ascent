import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel, Field, Input } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { WealthPathChart } from './WealthPathChart'
import { fmtPct } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import { buildCma } from '../../lib/finance/cma'
import { buildInflationCurve } from '../../lib/finance/inflation'
import { monteCarlo } from '../../lib/finance/montecarlo'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import type { InflRow } from '../../lib/finance/inflation'
import { useBalanceSheet } from '../balance/useBalanceSheet'

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
  const [cmaRows, setCmaRows] = useState<CmaSourceRow[]>([])
  const [uniRows, setUniRows] = useState<UniverseRow[]>([])
  const [inflRows, setInflRows] = useState<InflRow[]>([])

  const [inited, setInited] = useState(false)
  const [currentAge, setCurrentAge] = useState(45)
  const [retireAge, setRetireAge] = useState(65)
  const [planToAge, setPlanToAge] = useState(95)
  const [contribution, setContribution] = useState(0)
  const [withdrawal, setWithdrawal] = useState(0)

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
    setRetireAge(data.profile?.retire_age ?? 65)
    setPlanToAge(data.profile?.plan_to_age ?? 95)
    setWithdrawal(data.spending?.annual_amount ?? 0)
    setInited(true)
  }, [loading, data, inited])

  const cma = useMemo(() => buildCma(cmaRows, uniRows), [cmaRows, uniRows])
  const infl = useMemo(() => buildInflationCurve(inflRows), [inflRows])
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

  const mc = useMemo(() => {
    if (bs.investable <= 0 || uniRows.length === 0) return null
    return monteCarlo(cma, infl, {
      initialWealth: bs.investable,
      weights,
      retirementInYears: Math.max(0, retireAge - currentAge),
      horizonYears: Math.max(1, planToAge - currentAge),
      annualContribution: contribution,
      annualWithdrawal: withdrawal,
      sims: SIMS,
    })
  }, [cma, infl, weights, bs.investable, retireAge, currentAge, planToAge, contribution, withdrawal, uniRows.length])

  const chartData = useMemo(
    () =>
      mc?.bands.map((b) => ({ age: currentAge + b.year, lo: b.p10, span: b.p90 - b.p10, p50: b.p50 })) ?? [],
    [mc, currentAge],
  )

  const accent = !mc ? 'ink' : mc.successProbability >= 0.8 ? 'teal' : mc.successProbability >= 0.6 ? 'amber' : 'coral'
  const allocClasses = bs.byClass.map((s) => CLASS_MAP[s.class]).filter((c): c is string => !!c)

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Projection" />

      {/* Editable assumptions (design principle #4) */}
      <Panel label="Assumptions">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Field label="Current age">
            <Input type="number" value={currentAge} onChange={(e) => setCurrentAge(Number(e.target.value))} />
          </Field>
          <Field label="Retire age">
            <Input type="number" value={retireAge} onChange={(e) => setRetireAge(Number(e.target.value))} />
          </Field>
          <Field label="Plan to age">
            <Input type="number" value={planToAge} onChange={(e) => setPlanToAge(Number(e.target.value))} />
          </Field>
          <Field label="Contrib./yr" hint="today's $">
            <Input type="number" value={contribution} onChange={(e) => setContribution(Number(e.target.value))} />
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
          <Panel label="Per-class assumptions (consensus CMA)">
            <ul className="space-y-1.5">
              {[...new Set(allocClasses)].map((c) => {
                const k = cma[c]
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
