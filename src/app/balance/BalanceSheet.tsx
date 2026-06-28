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
        <button
          type="button"
          onClick={refreshQuotes}
          disabled={refreshing}
          className="micro-label text-faint hover:text-muted disabled:opacity-50"
        >
          {refreshing ? 'Refreshing…' : 'Refresh quotes'}
        </button>
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
