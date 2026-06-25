import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, Field, Input, Select, MicroLabel } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import { computeBalanceSheet, holdingValue } from '../../lib/finance/networth'
import {
  taxBuckets, withdrawalSequence, assetLocation, tlhOpportunities, rmdProjection,
  rothConversion, coordinatePrompts, bucketForTaxType,
} from '../../lib/finance/tax'
import { buildCma, applyCmaOverride } from '../../lib/finance/cma'
import { useCmaParams } from '../../lib/useCmaParams'
import { buildInflationCurve } from '../../lib/finance/inflation'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import type { InflRow } from '../../lib/finance/inflation'
import { FILING_STATUSES, FILING_LABEL } from '../../lib/db'
import type { FilingStatus } from '../../lib/db'
import { TaxPanels } from './TaxPanels'
import { WithdrawalPlanner } from './WithdrawalPlanner'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { useTaxParams } from '../../lib/useTaxParams'

const CLASS_MAP: Record<string, string> = {
  Equities: 'us_equity', Crypto: 'crypto', Cash: 'cash',
  Private: 'private_equity', Collectibles: 'collectibles', 'Real estate': 'real_estate',
}

export function TaxWithdrawalTab() {
  const { data, loading } = useBalanceSheet()
  const { params: taxParams } = useTaxParams()
  const [cmaRows, setCmaRows] = useState<CmaSourceRow[]>([])
  const [uniRows, setUniRows] = useState<UniverseRow[]>([])
  const [inflRows, setInflRows] = useState<InflRow[]>([])

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

  const buckets = useMemo(() => taxBuckets(data.accounts, data.holdings, data.quotes), [data.accounts, data.holdings, data.quotes])
  const sequence = useMemo(() => withdrawalSequence(buckets.byBucket), [buckets.byBucket])
  const location = useMemo(() => assetLocation(data.accounts, data.holdings, data.quotes), [data.accounts, data.holdings, data.quotes])
  const tlh = useMemo(() => tlhOpportunities(data.accounts, data.holdings, data.quotes), [data.accounts, data.holdings, data.quotes])
  const rmd = useMemo(() => rmdProjection(buckets.byBucket.tax_deferred, data.profile?.dob, taxParams), [buckets.byBucket.tax_deferred, data.profile?.dob, taxParams])

  const prompts = useMemo(() => {
    const age = data.profile?.dob ? Math.floor((Date.now() - new Date(data.profile.dob).getTime()) / (365.25 * 864e5)) : null
    const hasBusiness =
      data.holdings.some((h) => h.kind === 'private') ||
      data.accounts.some((a) => ['solo_401k', 'sep_ira', 'cash_balance_db'].includes(a.tax_type))
    const taxableAcctIds = new Set(data.accounts.filter((a) => bucketForTaxType(a.tax_type) === 'taxable').map((a) => a.id))
    const hasAppreciatedTaxable = data.holdings.some((h) => {
      const v = holdingValue(h, data.quotes)
      return v != null && h.cost_basis != null && v > h.cost_basis && (!h.account_id || taxableAcctIds.has(h.account_id))
    })
    return coordinatePrompts({ age, hasTaxDeferred: buckets.byBucket.tax_deferred > 0, hasBusiness, hasAppreciatedTaxable })
  }, [data.accounts, data.holdings, data.quotes, data.profile, buckets.byBucket.tax_deferred])

  // Roth conversion explorer (interactive — income is an editable assumption).
  const [filing, setFiling] = useState<FilingStatus>('mfj')
  const [income, setIncome] = useState(150_000)
  const [amount, setAmount] = useState(50_000)
  const roth = useMemo(() => rothConversion(income, amount, filing, taxParams), [income, amount, filing, taxParams])

  // Withdrawal planner inputs (reuses the consensus-CMA + inflation engines).
  const { params: cmaOverride } = useCmaParams()
  const cma = useMemo(() => applyCmaOverride(buildCma(cmaRows, uniRows), cmaOverride), [cmaRows, uniRows, cmaOverride])
  const infl = useMemo(() => buildInflationCurve(inflRows), [inflRows])
  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data.holdings, data.realEstate, data.liabilities, data.quotes],
  )
  const weights = useMemo(() => {
    const w: Record<string, number> = {}
    for (const s of bs.byClass) {
      const k = CLASS_MAP[s.class]
      if (k) w[k] = (w[k] ?? 0) + s.value
    }
    return w
  }, [bs.byClass])
  const gainFractionDefault = useMemo(() => {
    let val = 0
    let gain = 0
    const taxableIds = new Set(data.accounts.filter((a) => bucketForTaxType(a.tax_type) === 'taxable').map((a) => a.id))
    for (const h of data.holdings) {
      if (h.account_id && !taxableIds.has(h.account_id)) continue
      if (h.kind === 'cash') continue
      const v = holdingValue(h, data.quotes)
      if (v == null || v <= 0) continue
      val += v
      gain += h.cost_basis != null ? Math.max(0, v - h.cost_basis) : v * 0.5 // unknown basis ⇒ assume 50% gain
    }
    return val > 0 ? Math.min(1, gain / val) : 0.5
  }, [data.accounts, data.holdings, data.quotes])
  const currentAge = data.profile?.dob
    ? Math.floor((Date.now() - new Date(data.profile.dob).getTime()) / (365.25 * 864e5))
    : 45

  const empty = buckets.total <= 0

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Tax & Withdrawal" />

      {empty ? (
        <Panel>
          <p className="py-8 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add holdings (and tag account types) on the Balance Sheet to model your tax picture.'}
          </p>
        </Panel>
      ) : (
        <>
          <TaxPanels buckets={buckets} sequence={sequence} location={location} rmd={rmd} tlh={tlh} prompts={prompts} />

          <WithdrawalPlanner
            cma={cma}
            infl={infl}
            weights={weights}
            investable={bs.investable}
            taxable={buckets.byBucket.taxable}
            taxDeferred={buckets.byBucket.tax_deferred}
            taxFree={buckets.byBucket.tax_free}
            rmd={rmd.active ? (rmd.projectedRmd ?? 0) : 0}
            filing={filing}
            currentAge={currentAge}
            gainFractionDefault={gainFractionDefault}
            hasReferenceData={uniRows.length > 0}
            taxParams={taxParams}
          />

          {/* Roth conversion explorer */}
          <Panel
            label="Roth conversion explorer"
            right={<MicroLabel className="text-faint">{taxParams.year} brackets · approx</MicroLabel>}
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Field label="Filing status">
                <Select value={filing} onChange={(e) => setFiling(e.target.value as FilingStatus)}>
                  {FILING_STATUSES.map((f) => (
                    <option key={f} value={f}>{FILING_LABEL[f]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Taxable income" hint="your estimate">
                <Input type="number" value={income} onChange={(e) => setIncome(Number(e.target.value))} />
              </Field>
              <Field label="Convert to Roth">
                <Input type="number" value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
              </Field>
            </div>

            <div className="mt-5 grid gap-5 sm:grid-cols-3">
              <Figure
                label="Marginal rate on conversion"
                display={fmtPct(roth.marginalRateOnConversion)}
                accent={roth.endBracket > roth.startBracket ? 'amber' : 'teal'}
                size="md"
                sublabel={`Bracket ${fmtPct(roth.startBracket, 0)} → ${fmtPct(roth.endBracket, 0)}`}
              />
              <Figure
                label="Est. tax on conversion"
                value={roth.estTax}
                format="moneyCompact"
                accent="ink"
                size="md"
                sublabel={`${fmtMoneyCompact(roth.roomToNextBracket)} room left in current bracket`}
              />
              <Figure
                label="IRMAA impact"
                display={roth.irmaaCrossed ? 'crosses tier' : 'same tier'}
                accent={roth.irmaaCrossed ? 'coral' : 'teal'}
                size="md"
                sublabel={
                  roth.irmaaCrossed
                    ? `Medicare surcharge ~$${roth.irmaaBefore}→$${roth.irmaaAfter}/mo (2-yr lookback)`
                    : `No new Medicare surcharge at this income`
                }
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              Converting fills bracket space now to buy tax-free growth later — best in low-income years before
              RMDs. Watch the {taxParams.year} bracket edges and the IRMAA cliffs (your MAGI two years prior sets the
              Medicare surcharge). Figures are approximate and directional — confirm with your CPA (invariant #9).
            </p>
          </Panel>
        </>
      )}
    </div>
  )
}
