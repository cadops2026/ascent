import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../auth/AuthProvider'
import { Panel, Figure, MicroLabel, AlertStrip, Input, Button, PricesAsOf } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtMoneyCompact } from '../../lib/format'
import { computeBalanceSheet } from '../../lib/finance/networth'
import type { FilingStatus } from '../../lib/db'
import { useBalanceSheet } from './useBalanceSheet'
import { useAlpha } from '../alpha/useAlpha'
import { AlphaMeterPanel } from '../alpha/AlphaMeter'
import { refreshHoldingQuotes, resetAutoRefresh } from '../../lib/finance/quotes'
import { AllocationPie } from './AllocationPie'
import { NetToHeirsCard } from './NetToHeirsCard'
import { ImportSection } from './ImportSection'
import { AccountsSection } from './AccountsSection'
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
  'vanguard tgt rmt 2050 inv fund': 'VFIFX',
  'vanguard target retirement 2050': 'VFIFX',
  'invesco main st sm cap r6': 'OSSIX',
  'jp morgan mid cap eq r6': 'JPPEX',
  'fidelity 500 index fund': 'FXAIX',
}
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export function BalanceSheet() {
  const { session } = useAuth()
  const userId = session?.user.id ?? ''
  const { data, loading, pricing, asOf, error, reload } = useBalanceSheet()
  const { alpha, loading: alphaLoading } = useAlpha(data.holdings, data.quotes)
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

  // Explicit "Refresh quotes" — same path the auto-refresh uses, minus the
  // once-per-TTL throttle, since the user asked for it directly.
  const refreshQuotes = async () => {
    setRefreshing(true)
    setRefreshNote(null)
    try {
      resetAutoRefresh()
      const requested = await refreshHoldingQuotes(data.holdings)
      if (!requested) setRefreshNote('No ticker/share holdings to price.')
      await reload()
    } catch (e) {
      setRefreshNote(`Quote refresh failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setRefreshing(false)
    }
  }

  // One-click: set tickers on imported funds that came in name-only (no symbol),
  // using the verified alias map, then price them. Avoids per-row typing. `silent`
  // suppresses the status note when run from the auto-pricing effect (calm by default).
  const resolveFundTickers = async (silent = false) => {
    setRefreshing(true)
    if (!silent) setRefreshNote(null)
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
      if (!silent) setRefreshNote(`Resolve failed: ${e instanceof Error ? e.message : String(e)}`)
      setRefreshing(false)
      return
    }
    setRefreshing(false)
    if (silent) return
    const unknown = nameOnly.length - setSyms.length
    setRefreshNote(
      setSyms.length
        ? `Resolved ${setSyms.length} fund holding${setSyms.length > 1 ? 's' : ''}.${unknown ? ` ${unknown} unrecognized — use Ticker/Value on those rows.` : ''}`
        : 'No recognized fund names to resolve — use the Ticker or Value button on each row.',
    )
  }

  // Pricing itself is handled by useBalanceSheet (stale quotes re-fetch on any
  // tab). What's Balance-Sheet-specific is repairing imported funds that landed
  // name-only: set their ticker from the verified alias map so they can price at
  // all, rather than sitting "pending" forever. Runs once per mount.
  useEffect(() => {
    if (loading || autoRefreshed.current) return
    const hasResolvableNames = data.holdings.some(
      (h) => !h.symbol && h.name && h.entry_mode === 'shares' && FUND_ALIASES[normName(h.name)],
    )
    if (!hasResolvableNames) return
    autoRefreshed.current = true
    void resolveFundTickers(true)
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
          <PricesAsOf asOf={asOf} pricing={pricing || refreshing} />
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

      {/* Realized selection alpha, with the per-holding detail behind it. */}
      <AlphaMeterPanel alpha={alpha} loading={loading || alphaLoading} />

      <ImportSection userId={userId} reload={reload} />

      {data.accounts.length > 0 && (
        <AccountsSection
          accounts={data.accounts}
          holdings={data.holdings}
          quotes={data.quotes}
          userId={userId}
          reload={reload}
        />
      )}

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
