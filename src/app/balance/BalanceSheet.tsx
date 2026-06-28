import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Panel, Figure, MicroLabel, AlertStrip, Input, Button } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtMoneyCompact } from '../../lib/format'
import { computeBalanceSheet, holdingValue } from '../../lib/finance/networth'
import type { FilingStatus } from '../../lib/db'
import { useBalanceSheet } from './useBalanceSheet'
import { AllocationPie } from './AllocationPie'
import { NetToHeirsCard } from './NetToHeirsCard'
import { ImportSection } from './ImportSection'
import { HoldingsSection } from './HoldingsSection'
import { PropertySection } from './PropertySection'

// Verified fund-name → ticker map for imports that land with no ticker (brokerage
// abbreviations like "Inst Plus" / "Idx Inst" don't search reliably, and some — e.g.
// Cohen & Steers Realty — mis-resolve via open search). Each confirmed against its
// live NAV. Keys are normName(name).
const FUND_ALIASES: Record<string, string> = {
  'vanguard explorer adm': 'VEXRX',
  'vanguard institutional index inst plus': 'VIIIX',
  'vanguard primecap adm': 'VPMAX',
  'vanguard russell 1000 growth idx inst': 'VRGWX',
  'cohen steers realty': 'CSRSX',
  'john hancock dis v mc r6': 'JVMRX',
  'vanguard total stock market index': 'VTSAX',
  'vanguard total international stock index': 'VTIAX',
  'vanguard growth index': 'VIGAX',
}
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function BalanceSheet() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const { data, loading, error, reload } = useBalanceSheet()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshNote, setRefreshNote] = useState<string | null>(null)
  const autoRefreshed = useRef(false)

  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data],
  )
  const filing = (data.profile?.filing_status as FilingStatus | null) ?? 'single'

  const onChangeFiling = async (f: FilingStatus) => {
    await supabase.from('profiles').upsert({ user_id: userId, filing_status: f })
    await reload()
  }

  const refreshQuotes = async () => {
    setRefreshing(true)
    setRefreshNote(null)
    const tickers = data.holdings.filter((h) => h.entry_mode === 'shares' && h.symbol)
    // 'cash' covers money-market funds held as shares (e.g. VMFXX) — they have a
    // NAV ticker and must be priced like equities, not skipped as plain cash.
    const equities = tickers
      .filter((h) => h.kind === 'stock' || h.kind === 'etf' || h.kind === 'cash')
      .map((h) => h.symbol!.toUpperCase())
    const crypto = tickers.filter((h) => h.kind === 'crypto').map((h) => h.symbol!.toUpperCase())
    try {
      if (equities.length) {
        const { error } = await supabase.functions.invoke('refresh-quotes', { body: { symbols: equities } })
        if (error) throw error
      }
      if (crypto.length) {
        const { error } = await supabase.functions.invoke('refresh-crypto', { body: { symbols: crypto } })
        if (error) throw error
      }
      if (!equities.length && !crypto.length) setRefreshNote('No ticker/share holdings to price.')
      await reload()
    } catch (e) {
      setRefreshNote(`Quote refresh failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  // One-click: set tickers on imported funds that came in name-only (no symbol),
  // using the verified alias map, then price them. Avoids per-row typing.
  const resolveFundTickers = async () => {
    setRefreshing(true)
    setRefreshNote(null)
    const nameOnly = data.holdings.filter((h) => !h.symbol && h.name && h.entry_mode === 'shares')
    const setSyms: string[] = []
    try {
      for (const h of nameOnly) {
        const t = FUND_ALIASES[normName(h.name!)]
        if (!t) continue
        await supabase.from('holdings').update({ symbol: t }).eq('id', h.id)
        setSyms.push(t)
      }
      if (setSyms.length) {
        await supabase.functions.invoke('refresh-quotes', { body: { symbols: [...new Set(setSyms)] } })
      }
      await reload()
    } catch (e) {
      setRefreshNote(`Resolve failed: ${e instanceof Error ? e.message : String(e)}`)
      setRefreshing(false)
      return
    }
    setRefreshing(false)
    const unknown = nameOnly.length - setSyms.length
    setRefreshNote(
      setSyms.length
        ? `Resolved ${setSyms.length} fund holding${setSyms.length > 1 ? 's' : ''}.${unknown ? ` ${unknown} unrecognized — use Ticker/Value on those rows.` : ''}`
        : 'No recognized fund names to resolve — use the Ticker or Value button on each row.',
    )
  }

  // Auto-fetch quotes once after load so holdings price without a manual click.
  // refresh-quotes only fetches symbols whose cached quote is stale, so this is
  // cheap on repeat mounts; the ref guard prevents a reload→refresh loop.
  useEffect(() => {
    if (loading || autoRefreshed.current) return
    const needsPricing = data.holdings.some(
      (h) =>
        h.entry_mode === 'shares' &&
        h.symbol &&
        ['stock', 'etf', 'crypto', 'cash'].includes(h.kind) &&
        holdingValue(h, data.quotes) == null,
    )
    if (!needsPricing) return
    autoRefreshed.current = true
    void refreshQuotes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, data.holdings])

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeader title="Balance Sheet" phase="P1" />
        <p className="mt-8 text-sm text-faint">Loading…</p>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex items-center justify-between">
        <PageHeader title="Balance Sheet" />
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => void resolveFundTickers()}
            disabled={refreshing}
            className="micro-label text-faint hover:text-muted disabled:opacity-50"
          >
            Resolve fund tickers
          </button>
          <button
            type="button"
            onClick={refreshQuotes}
            disabled={refreshing}
            className="micro-label text-faint hover:text-muted disabled:opacity-50"
          >
            {refreshing ? 'Refreshing…' : 'Refresh quotes'}
          </button>
        </div>
      </div>

      {error && <AlertStrip tone="negative">{error}</AlertStrip>}
      {refreshNote && (
        <AlertStrip tone="caution" onDismiss={() => setRefreshNote(null)}>
          {refreshNote}
        </AlertStrip>
      )}

      {/* Net worth — present, complete, de-emphasized (invariant #6: no daily delta) */}
      <Panel>
        <div className="flex flex-wrap items-end justify-between gap-6">
          <Figure label="Net worth" value={bs.netWorth} format="moneyCompact" accent="ink" size="lg" />
          <div className="flex gap-6">
            <Mini label="Assets" value={fmtMoneyCompact(bs.totalAssets)} />
            <Mini label="Liabilities" value={fmtMoneyCompact(bs.totalLiabilities)} />
            <Mini label="Investable" value={fmtMoneyCompact(bs.investable)} />
          </div>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <AllocationPie slices={bs.byClass} investable={bs.investable} pendingQuotes={bs.pendingQuotes} />
        <NetToHeirsCard netWorth={bs.netWorth} filing={filing} onChangeFiling={onChangeFiling} />
      </div>

      <ImportSection userId={userId} reload={reload} />

      <HoldingsSection
        accounts={data.accounts}
        holdings={data.holdings}
        quotes={data.quotes}
        userId={userId}
        reload={reload}
      />

      <PropertySection
        realEstate={data.realEstate}
        liabilities={data.liabilities}
        userId={userId}
        reload={reload}
      />

      <SpendingBaseline
        current={data.spending?.annual_amount ?? null}
        userId={userId}
        reload={reload}
      />
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

function SpendingBaseline({
  current,
  userId,
  reload,
}: {
  current: number | null
  userId: string
  reload: () => Promise<void>
}) {
  const [val, setVal] = useState(current != null ? String(current) : '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (val.trim() === '') return
    setBusy(true)
    await supabase.from('spending_baseline').upsert({ user_id: userId, annual_amount: Number(val), source: 'manual' })
    setBusy(false)
    await reload()
  }

  return (
    <Panel label="Spending baseline">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex-1">
          <Figure
            label="Annual spending"
            value={current ?? 0}
            format="money"
            accent="ink"
            size="md"
            sublabel="Feeds the projection & work glide-path (P3/P4)"
          />
        </div>
        <div className="flex items-end gap-2">
          <Input
            type="number"
            value={val}
            onChange={(e) => setVal(e.target.value)}
            placeholder="180000"
            className="w-40"
          />
          <Button onClick={save} disabled={busy || val.trim() === ''}>
            Save
          </Button>
        </div>
      </div>
    </Panel>
  )
}
