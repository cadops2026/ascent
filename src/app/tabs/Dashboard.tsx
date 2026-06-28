import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel } from '../../components/ui'
import { PageHeader } from './PhasePlaceholder'
import type { TabId } from '../nav'
import { useAlerts } from '../../lib/useAlerts'
import { DashboardDigestStrip } from './DashboardDigestStrip'
import { fmtMoneyCompact } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import type { AssetClass } from '../../lib/finance/networth'
import { estateExposure } from '../../lib/finance/estate'
import type { FilingStatus } from '../../lib/db'
import { buildCma, applyCmaOverride, recenterCmaToReal } from '../../lib/finance/cma'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import { useCmaParams } from '../../lib/useCmaParams'
import { buildInflationCurve, flatInflationCurve } from '../../lib/finance/inflation'
import type { InflRow } from '../../lib/finance/inflation'
import { monteCarlo } from '../../lib/finance/montecarlo'
import { buildEtfMap, lookThrough } from '../../lib/finance/lookthrough'
import type { EtfHoldingRow } from '../../lib/finance/lookthrough'
import { runAllStress } from '../../lib/finance/drawdownstress'
import { factorExposure, exposureNarrative } from '../../lib/finance/exposure'
import { DashboardHero } from './DashboardHero'
import { AdvisorPanel } from './AdvisorPanel'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { AllocationPie } from '../balance/AllocationPie'

/** Balance-sheet AssetClass → consensus-CMA / asset-class-universe key. */
const CLASS_MAP: Record<AssetClass, string> = {
  Equities: 'us_equity', Crypto: 'crypto', Cash: 'cash',
  Private: 'private_equity', Collectibles: 'collectibles', 'Real estate': 'real_estate',
}
const SIMS = 3000

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
}

/**
 * Calm by default (invariant #6): the hero IS exposure + success probability.
 * Both halves consume the shared engines verbatim — the Monte Carlo (same call as
 * the Projection tab) and the look-through → factor → narrative chain (same as the
 * Risk tab). Nothing is re-implemented here (invariant #1). No daily red/green delta.
 */
export function Dashboard({ onNavigate }: { onNavigate?: (id: TabId) => void }) {
  const { data, loading } = useBalanceSheet()
  const { open: openAlerts } = useAlerts()
  const [cmaRows, setCmaRows] = useState<CmaSourceRow[]>([])
  const [uniRows, setUniRows] = useState<UniverseRow[]>([])
  const [inflRows, setInflRows] = useState<InflRow[]>([])
  const [etfRows, setEtfRows] = useState<EtfHoldingRow[]>([])
  const [betas, setBetas] = useState<{ class: string; corr_to_us_equity: number | null }[]>([])

  useEffect(() => {
    void (async () => {
      const [c, u, i, etf] = await Promise.all([
        supabase.from('cma_sources').select('asset_class, house, value'),
        supabase.from('asset_class_universe').select('class, cma_premium, vol, corr_to_us_equity, cost_proxy'),
        supabase.from('infl_expectations_cache').select('source, horizon_years, value'),
        supabase.from('etf_holdings').select('etf_symbol, holding_symbol, holding_name, weight'),
      ])
      setCmaRows((c.data ?? []) as CmaSourceRow[])
      setUniRows((u.data ?? []) as UniverseRow[])
      setInflRows((i.data ?? []) as InflRow[])
      setEtfRows((etf.data ?? []) as EtfHoldingRow[])
      setBetas((u.data ?? []).map((r) => ({ class: r.class, corr_to_us_equity: r.corr_to_us_equity })))
    })()
  }, [])

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
  const lt = useMemo(
    () => lookThrough(data.holdings, data.realEstate, data.quotes, buildEtfMap(etfRows)),
    [data, etfRows],
  )
  const filing = (data.profile?.filing_status as FilingStatus | null) ?? 'single'
  const estate = estateExposure(bs.netWorth, filing)

  // Plan assumptions: the dashboard is a glance, so it reads the profile defaults
  // (the Projection tab is where you tune them) — matching Projection's defaults
  // keeps the headline number consistent across the two surfaces.
  const currentAge = ageFromDob(data.profile?.dob) ?? 45
  const planToAge = data.profile?.plan_to_age ?? 85
  const retireAge = data.profile?.retire_age ?? 65
  const withdrawal = data.spending?.annual_amount ?? 0

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

  const mc = useMemo(() => {
    if (bs.investable <= 0 || uniRows.length === 0) return null
    return monteCarlo(cmaEff, infl, {
      initialWealth: bs.investable,
      weights,
      retirementInYears: Math.max(0, retireAge - currentAge),
      horizonYears: Math.max(1, planToAge - currentAge),
      annualContribution: 0,
      annualWithdrawal: withdrawal,
      sims: SIMS,
    })
  }, [cmaEff, infl, weights, bs.investable, retireAge, currentAge, planToAge, withdrawal, uniRows.length])

  // Exposure: same engine chain the Risk tab reads (invariant #1).
  const betaByClass = useMemo(() => {
    const uniMap = new Map(betas.map((b) => [b.class, b.corr_to_us_equity ?? 0]))
    const out: Partial<Record<AssetClass, number>> = {}
    for (const cls of Object.keys(CLASS_MAP) as AssetClass[]) out[cls] = uniMap.get(CLASS_MAP[cls]) ?? 0
    return out
  }, [betas])
  const worst = useMemo(() => {
    const w = runAllStress(bs.byClass, bs.investable).slice().sort((a, b) => b.lossPct - a.lossPct)[0]
    return w ? { name: w.scenario.name, lossPct: w.lossPct } : null
  }, [bs])
  const fx = useMemo(() => factorExposure(bs.byClass, lt, betaByClass), [bs.byClass, lt, betaByClass])
  const narrative = useMemo(() => exposureNarrative(lt, fx, worst), [lt, fx, worst])

  const top = lt.singleNameMax
  const empty = data.holdings.length === 0 && data.realEstate.length === 0

  // Compact, grounded context for the AI overlay — the user's OWN numbers only.
  const r3 = (x: number) => Math.round(x * 1000) / 1000
  const advisorContext = useMemo(() => {
    if (!mc) return null
    return {
      netWorth: Math.round(bs.netWorth),
      investable: Math.round(bs.investable),
      netToHeirs: Math.round(estate.netToHeirs),
      allocation: bs.byClass.map((s) => ({ class: s.class, pctOfInvestable: r3(s.pct) })),
      largestSingleName: top ? { name: top.name, pctOfInvestable: r3(top.pct) } : null,
      topNames: lt.topNames.slice(0, 5).map((n) => ({ name: n.name, pctOfInvestable: r3(n.pct) })),
      successProbability: r3(mc.successProbability),
      endWealthRealDollars: { p10: Math.round(mc.terminal.p10), p25: Math.round(mc.terminal.p25), p90: Math.round(mc.terminal.p90) },
      currentAge,
      retireAge,
      planToAge,
      annualSpendInRetirement: Math.round(withdrawal),
      exposureNarrative: narrative.map((l) => l.text),
      inflationCurveSource: infl.source,
    }
  }, [mc, bs, estate.netToHeirs, top, lt.topNames, currentAge, retireAge, planToAge, withdrawal, narrative, infl.source])

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Dashboard" />

      {/* Calm digest pointer — the delivered (persisted) alerts, sparse (#7) */}
      <DashboardDigestStrip alerts={openAlerts} onNavigate={onNavigate} />

      {/* The hero — exposure + success probability (invariant #6) */}
      {mc ? (
        <DashboardHero
          successProbability={mc.successProbability}
          sims={mc.sims}
          planToAge={planToAge}
          terminal={mc.terminal}
          topName={top?.name ?? null}
          topPct={top?.pct ?? null}
          narrative={narrative}
        />
      ) : (
        <Panel className="mt-5" label="Where you stand">
          <p className="py-8 text-center text-sm text-faint">
            {loading
              ? 'Loading…'
              : 'Add investable holdings on the Balance Sheet to light up success probability and exposure.'}
          </p>
        </Panel>
      )}

      {/* Grounded AI overlay — explains your exposure, never forecasts (#5/#8) */}
      <AdvisorPanel context={advisorContext} />

      {/* Real net worth — calm, no daily delta (invariant #6) */}
      <Panel className="mt-5">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Figure label="Net worth" value={bs.netWorth} format="moneyCompact" accent="ink" size="lg" />
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
