import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Select, Button } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtPct } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import type { AssetClass } from '../../lib/finance/networth'
import { buildEtfMap, lookThrough } from '../../lib/finance/lookthrough'
import type { EtfHoldingRow } from '../../lib/finance/lookthrough'
import { runAllStress } from '../../lib/finance/drawdownstress'
import { blastRadius, factorExposure, exposureNarrative } from '../../lib/finance/exposure'
import { mortgageAsShortBond } from '../../lib/finance/mortgagebond'
import { evaluateAlerts } from '../../lib/finance/alertengine'
import type { BandSpec } from '../../lib/finance/alertengine'
import { diversificationScan } from '../../lib/finance/diversification'
import { amortize } from '../../lib/finance/amortization'
import { ExposurePanels } from './ExposurePanels'
import { DiversificationPanel } from './DiversificationPanel'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { useTaxParams } from '../../lib/useTaxParams'
import { useCmaParams } from '../../lib/useCmaParams'
import { useAlerts } from '../../lib/useAlerts'
import { useAuth } from '../../auth/AuthProvider'

/** AssetClass → asset_class_universe key (corr_to_us_equity lives there, invariant #3). */
const CLASS_TO_UNI: Record<AssetClass, string> = {
  Equities: 'us_equity', Crypto: 'crypto', Cash: 'cash',
  Private: 'private_equity', Collectibles: 'collectibles', 'Real estate': 'real_estate',
}

interface UniBeta { class: string; corr_to_us_equity: number | null }
interface TargetRow { asset_class: string; target_pct: number | null }
interface BandRow { asset_class: string; abs_pts: number | null; rel_pct: number | null }
interface RulesRow {
  rebalance_band_pt: number | null
  single_name_pct: number | null
  narrative_pct: number | null
  cadence: string
}

export function RiskExposureTab() {
  const { data, loading } = useBalanceSheet()
  const { session } = useAuth()
  const { storedYear: taxParamsYear } = useTaxParams()
  const { storedYear: cmaParamsYear } = useCmaParams()
  const [etfRows, setEtfRows] = useState<EtfHoldingRow[]>([])
  const [betas, setBetas] = useState<UniBeta[]>([])

  // Editable alert config (pre-committed thresholds). Loaded from DB, saved on demand.
  const [targets, setTargets] = useState<Record<string, number>>({}) // class -> target %
  const [classBands, setClassBands] = useState<Record<string, string>>({}) // class -> abs drift-pt override ('' = use global)
  const [bandPt, setBandPt] = useState(5)
  const [singleNamePct, setSingleNamePct] = useState(10)
  const [narrativePct, setNarrativePct] = useState(20)
  const [cadence, setCadence] = useState('monthly')
  const [cfgLoaded, setCfgLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const { dismissedKeys, dismiss } = useAlerts() // dismisses persist across sessions

  useEffect(() => {
    void (async () => {
      const [etf, uni, tgt, band, rule] = await Promise.all([
        supabase.from('etf_holdings').select('etf_symbol, holding_symbol, holding_name, weight'),
        supabase.from('asset_class_universe').select('class, corr_to_us_equity'),
        supabase.from('target_allocation').select('asset_class, target_pct'),
        supabase.from('rebalance_bands').select('asset_class, abs_pts, rel_pct'),
        supabase.from('alert_rules').select('rebalance_band_pt, single_name_pct, narrative_pct, cadence').maybeSingle(),
      ])
      setEtfRows((etf.data ?? []) as EtfHoldingRow[])
      setBetas((uni.data ?? []) as UniBeta[])
      const tRows = (tgt.data ?? []) as TargetRow[]
      if (tRows.length > 0) {
        const t: Record<string, number> = {}
        for (const r of tRows) if (r.target_pct != null) t[r.asset_class] = Math.round(r.target_pct * 1000) / 10
        setTargets(t)
      }
      const bRows = (band.data ?? []) as BandRow[]
      if (bRows.length > 0) {
        const cb: Record<string, string> = {}
        for (const r of bRows) if (r.abs_pts != null) cb[r.asset_class] = String(r.abs_pts)
        setClassBands(cb)
      }
      const r = rule.data as RulesRow | null
      if (r) {
        if (r.rebalance_band_pt != null) setBandPt(r.rebalance_band_pt)
        if (r.single_name_pct != null) setSingleNamePct(Math.round(r.single_name_pct * 1000) / 10)
        if (r.narrative_pct != null) setNarrativePct(Math.round(r.narrative_pct * 1000) / 10)
        if (r.cadence) setCadence(r.cadence)
      }
      setCfgLoaded(true)
    })()
  }, [])

  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data],
  )
  const lt = useMemo(
    () => lookThrough(data.holdings, data.realEstate, data.quotes, buildEtfMap(etfRows)),
    [data, etfRows],
  )

  // Seed targets from current allocation the first time, if none saved yet.
  useEffect(() => {
    if (!cfgLoaded || loading || bs.byClass.length === 0) return
    setTargets((prev) => {
      if (Object.keys(prev).length > 0) return prev
      const t: Record<string, number> = {}
      for (const s of bs.byClass) t[s.class] = Math.round(s.pct * 1000) / 10
      return t
    })
  }, [cfgLoaded, loading, bs.byClass])

  const betaByClass = useMemo(() => {
    const uniMap = new Map(betas.map((b) => [b.class, b.corr_to_us_equity ?? 0]))
    const out: Partial<Record<AssetClass, number>> = {}
    for (const cls of Object.keys(CLASS_TO_UNI) as AssetClass[]) out[cls] = uniMap.get(CLASS_TO_UNI[cls]) ?? 0
    return out
  }, [betas])

  const stress = useMemo(() => runAllStress(bs.byClass, bs.investable), [bs])
  const worst = useMemo(() => {
    const w = stress.slice().sort((a, b) => b.lossPct - a.lossPct)[0]
    return w ? { name: w.scenario.name, lossPct: w.lossPct } : null
  }, [stress])
  const br = useMemo(() => blastRadius(lt, 0.3), [lt])
  const fx = useMemo(() => factorExposure(bs.byClass, lt, betaByClass), [bs.byClass, lt, betaByClass])
  const narrative = useMemo(() => exposureNarrative(lt, fx, worst), [lt, fx, worst])
  const mortgageBonds = useMemo(() => mortgageAsShortBond(data.liabilities), [data.liabilities])

  // Per-class drift-band overrides (blank → fall back to the global rebalance_band_pt).
  const bandSpecs = useMemo<BandSpec[]>(
    () =>
      Object.entries(classBands)
        .map(([asset_class, raw]) => ({ asset_class, abs: raw.trim() === '' ? NaN : Number(raw) }))
        .filter(({ abs }) => Number.isFinite(abs) && abs > 0)
        .map(({ asset_class, abs }) => ({ asset_class, abs_pts: abs, rel_pct: null })),
    [classBands],
  )

  const alerts = useMemo(() => {
    const mortgages = data.liabilities
      .filter((l) => l.kind === 'mortgage')
      .map((l) => {
        const st = amortize({ origBalance: l.orig_balance, annualRate: l.rate, termMonths: l.term_months, startDate: l.start_date })
        return { label: l.label ?? 'Mortgage', monthsToPayoff: st.valid ? st.monthsRemaining : null }
      })
    return evaluateAlerts({
      byClass: bs.byClass,
      investable: bs.investable,
      lookThrough: lt,
      targets: Object.entries(targets).map(([asset_class, pct]) => ({ asset_class, target_pct: pct / 100 })),
      bands: bandSpecs,
      rules: {
        rebalance_band_pt: bandPt,
        single_name_pct: singleNamePct / 100,
        narrative_pct: narrativePct / 100,
        tlh_min_loss: null,
        cadence,
      },
      mortgages,
      taxParamsYear,
      cmaParamsYear,
      currentYear: new Date().getFullYear(),
    })
  }, [bs, lt, targets, bandSpecs, bandPt, singleNamePct, narrativePct, cadence, data.liabilities, taxParamsYear, cmaParamsYear])

  // Diversification context map — same targets/bands/rules as the digest, so the
  // "beyond band" tag it shows can never disagree with the alert above (invariant #1).
  const diversification = useMemo(
    () =>
      diversificationScan(
        bs.byClass,
        Object.entries(targets).map(([asset_class, pct]) => ({ asset_class, target_pct: pct / 100 })),
        bandSpecs,
        {
          rebalance_band_pt: bandPt,
          single_name_pct: singleNamePct / 100,
          narrative_pct: narrativePct / 100,
          tlh_min_loss: null,
          cadence,
        },
      ),
    [bs.byClass, targets, bandSpecs, bandPt, singleNamePct, narrativePct, cadence],
  )

  const save = async () => {
    if (!session) return
    setSaving(true)
    setSaveNote(null)
    try {
      const uid = session.user.id
      const targetRows = Object.entries(targets).map(([asset_class, pct]) => ({ user_id: uid, asset_class, target_pct: pct / 100 }))
      const [{ error: tErr }, { error: rErr }] = await Promise.all([
        targetRows.length
          ? supabase.from('target_allocation').upsert(targetRows, { onConflict: 'user_id,asset_class' })
          : Promise.resolve({ error: null }),
        supabase.from('alert_rules').upsert(
          {
            user_id: uid,
            rebalance_band_pt: bandPt,
            single_name_pct: singleNamePct / 100,
            narrative_pct: narrativePct / 100,
            cadence,
          },
          { onConflict: 'user_id' },
        ),
      ])
      if (tErr || rErr) throw tErr ?? rErr

      // Per-class bands: replace the set wholesale (small, owner-scoped table) so
      // clearing an override reverts that class to the global band.
      const { error: dErr } = await supabase.from('rebalance_bands').delete().eq('user_id', uid)
      if (dErr) throw dErr
      const bandRows = bandSpecs.map((b) => ({ user_id: uid, asset_class: b.asset_class, abs_pts: b.abs_pts, rel_pct: b.rel_pct }))
      if (bandRows.length) {
        const { error: bErr } = await supabase.from('rebalance_bands').insert(bandRows)
        if (bErr) throw bErr
      }

      setSaveNote('Saved — your pre-committed thresholds are set.')
    } catch (e) {
      setSaveNote(e instanceof Error ? e.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const empty = bs.investable <= 0

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Risk & Exposure" />

      {empty ? (
        <Panel>
          <p className="py-8 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add investable holdings on the Balance Sheet to read your exposure.'}
          </p>
        </Panel>
      ) : (
        <>
          <ExposurePanels
            narrative={narrative}
            blast={br}
            factor={fx}
            stress={stress}
            mortgageBonds={mortgageBonds}
            alerts={alerts}
            cadence={cadence}
            dismissed={dismissedKeys}
            onDismiss={(a) => void dismiss(a)}
          />

          <DiversificationPanel scan={diversification} />

          {/* Alert-engine config — your pre-committed thresholds */}
          <Panel label="Alert thresholds & targets">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label="Rebalance band" hint="drift points">
                <Input type="number" value={bandPt} onChange={(e) => setBandPt(Number(e.target.value))} />
              </Field>
              <Field label="Single-name ceiling" hint="% of investable">
                <Input type="number" value={singleNamePct} onChange={(e) => setSingleNamePct(Number(e.target.value))} />
              </Field>
              <Field label="Theme ceiling" hint="% (crypto for now)">
                <Input type="number" value={narrativePct} onChange={(e) => setNarrativePct(Number(e.target.value))} />
              </Field>
              <Field label="Digest cadence">
                <Select value={cadence} onChange={(e) => setCadence(e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </Field>
            </div>

            <MicroLabel className="mt-5 mb-2 text-faint">Target allocation (drift is measured against this)</MicroLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {bs.byClass.map((s) => (
                <Field key={s.class} label={s.class} hint={`now ${fmtPct(s.pct, 0)}`}>
                  <Input
                    type="number"
                    value={targets[s.class] ?? 0}
                    onChange={(e) => setTargets((t) => ({ ...t, [s.class]: Number(e.target.value) }))}
                  />
                </Field>
              ))}
            </div>

            <MicroLabel className="mt-5 mb-2 text-faint">
              Per-class rebalance bands — drift points; blank uses the {bandPt}-pt global
            </MicroLabel>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {bs.byClass.map((s) => (
                <Field key={s.class} label={s.class} hint="override (pts)">
                  <Input
                    type="number"
                    value={classBands[s.class] ?? ''}
                    placeholder={`${bandPt} (global)`}
                    onChange={(e) => setClassBands((b) => ({ ...b, [s.class]: e.target.value }))}
                  />
                </Field>
              ))}
            </div>
            <p className="mt-2 text-xs text-faint">
              A tighter band on a volatile sleeve (say crypto) flags drift sooner; a wider one tolerates more
              before nudging. The same bands feed the digest and the diversification map above (invariant #1).
            </p>

            <div className="mt-5 flex items-center gap-3">
              <Button onClick={save} disabled={saving || !session}>
                {saving ? 'Saving…' : 'Save thresholds'}
              </Button>
              {saveNote && <span className="text-xs text-muted">{saveNote}</span>}
            </div>
          </Panel>
        </>
      )}
    </div>
  )
}
