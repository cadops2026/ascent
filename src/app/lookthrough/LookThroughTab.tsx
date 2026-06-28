import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel, AlertStrip } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { buildEtfMap, lookThrough, perPositionLookThrough, LOOKTHROUGH_PROXY, compositionEtfs } from '../../lib/finance/lookthrough'
import type { EtfHoldingRow, PositionLookThrough } from '../../lib/finance/lookthrough'

const SINGLE_NAME_FLAG = 0.1 // flag any single name > 10% of investable

export function LookThroughTab() {
  const { data, loading } = useBalanceSheet()
  const [etfRows, setEtfRows] = useState<EtfHoldingRow[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const loadEtf = async () => {
    const { data: rows } = await supabase
      .from('etf_holdings')
      .select('etf_symbol, holding_symbol, holding_name, weight')
    setEtfRows((rows ?? []) as EtfHoldingRow[])
  }
  useEffect(() => {
    void loadEtf()
  }, [])

  const etfMap = useMemo(() => buildEtfMap(etfRows), [etfRows])
  const lt = useMemo(
    () => lookThrough(data.holdings, data.realEstate, data.quotes, etfMap),
    [data, etfMap],
  )
  const nested = useMemo(
    () => perPositionLookThrough(data.holdings, data.realEstate, data.quotes, etfMap, LOOKTHROUGH_PROXY),
    [data, etfMap],
  )

  const refreshEtf = async () => {
    setRefreshing(true)
    setNote(null)
    // Resolve held ETFs plus the ETF share-class proxies for any held mutual funds
    // (VIGAX→VUG, VTSAX→VTI…) so the nested look-through can explode them.
    const held = data.holdings.filter((h) => h.kind === 'etf' && h.symbol).map((h) => h.symbol!.toUpperCase())
    const proxies = held.map((s) => LOOKTHROUGH_PROXY[s]).filter((s): s is string => Boolean(s))
    // Plus the underlying ETFs of any name-only fund-of-funds (529 portfolios).
    const etfs = [...new Set([...held, ...proxies, ...compositionEtfs()])]
    if (!etfs.length) {
      setNote('No ETFs to resolve.')
      setRefreshing(false)
      return
    }
    try {
      const { data: res, error } = await supabase.functions.invoke('refresh-etf-holdings', { body: { etfs } })
      if (error) throw error
      await loadEtf()
      if (res && typeof res.updated === 'number' && res.updated === 0) {
        setNote('Couldn’t load fund holdings just now — the keyless source (Yahoo) may be rate-limiting. Try again in a moment.')
      }
    } catch {
      setNote(
        'Fund holdings unavailable — make sure the refresh-etf-holdings function is deployed. It works keyless via Yahoo; set an FMP key in Supabase secrets for more reliability.',
      )
    } finally {
      setRefreshing(false)
    }
  }

  const top = lt.topNames[0]
  const maxFlag = lt.singleNameMax != null && lt.singleNameMax.pct >= SINGLE_NAME_FLAG

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex items-center justify-between">
        <PageHeader title="Look-through" />
        <button
          type="button"
          onClick={refreshEtf}
          disabled={refreshing}
          className="micro-label text-faint hover:text-muted disabled:opacity-50"
        >
          {refreshing ? 'Resolving…' : 'Refresh ETF holdings'}
        </button>
      </div>

      {note && (
        <AlertStrip tone="caution" onDismiss={() => setNote(null)}>
          {note}
        </AlertStrip>
      )}

      <div className="grid gap-5 md:grid-cols-2">
        <Panel label="Largest single-name exposure">
          {lt.singleNameMax ? (
            <Figure
              label={lt.singleNameMax.name}
              display={fmtPct(lt.singleNameMax.pct)}
              accent={maxFlag ? 'amber' : 'teal'}
              size="lg"
              sublabel={`${fmtMoneyCompact(lt.singleNameMax.value)} · of investable`}
            />
          ) : (
            <p className="py-6 text-sm text-faint">
              {loading ? 'Loading…' : 'Add holdings to see exposure.'}
            </p>
          )}
          {maxFlag && (
            <p className="mt-3 text-xs text-amber">Above 10% of investable — concentration to watch.</p>
          )}
        </Panel>

        <Panel label="Real-estate factor">
          <Figure
            label="Property exposure"
            value={lt.realEstateFactor}
            format="moneyCompact"
            accent="indigo"
            size="lg"
            sublabel="Home + investment property (look-through factor)"
          />
        </Panel>
      </div>

      <Panel
        label="Top 10 of your top 10"
        right={
          lt.unresolvedEtfs.length ? (
            <MicroLabel className="text-amber">Refresh ETF holdings to resolve funds</MicroLabel>
          ) : undefined
        }
      >
        {nested.positions.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add holdings to see exposure.'}
          </p>
        ) : (
          <ul className="space-y-3">
            {nested.positions.map((p, i) => (
              <PositionBlock key={`${p.symbol}-${i}`} p={p} rank={i + 1} />
            ))}
          </ul>
        )}
        <p className="mt-4 text-xs text-faint">
          Each of your ten largest positions, expanded into its own ten largest underlyings. Mutual funds
          borrow their ETF share-class holdings (shown as “via …”); active, bond, and target-date
          funds have no clean proxy and read as opaque.
        </p>
      </Panel>

      <Panel
        label="Top 10 underlying companies"
        right={
          lt.unresolvedEtfs.length ? (
            <MicroLabel className="text-amber">
              {lt.unresolvedEtfs.length} ETF{lt.unresolvedEtfs.length > 1 ? 's' : ''} unresolved
            </MicroLabel>
          ) : undefined
        }
      >
        {lt.topNames.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">No single-name exposure yet.</p>
        ) : (
          <ul className="space-y-1">
            {lt.topNames.map((n, i) => (
              <li key={n.symbol} className="flex items-center gap-3 py-1.5">
                <span className="tnum w-5 text-right font-mono text-xs text-faint">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <span className="text-sm text-ink">{n.name}</span>
                  {!n.resolved && <span className="micro-label ml-2 text-faint">opaque</span>}
                </div>
                <div className="hidden h-1.5 w-24 overflow-hidden rounded bg-panel sm:block">
                  <div
                    className="h-full bg-teal"
                    style={{ width: `${(n.pct / (top?.pct || 1)) * 100}%` }}
                  />
                </div>
                <span className="tnum w-14 text-right font-mono text-sm text-ink">{fmtPct(n.pct)}</span>
                <span className="tnum w-20 text-right font-mono text-xs text-faint">
                  {fmtMoneyCompact(n.value)}
                </span>
              </li>
            ))}
          </ul>
        )}
        {lt.unresolvedEtfs.length > 0 && (
          <p className="mt-4 text-xs text-faint">
            Unresolved ETFs ({lt.unresolvedEtfs.join(', ')}) count as opaque single lines until you
            Refresh ETF holdings (needs an FMP key).
          </p>
        )}
      </Panel>

      <MicroLabel className="text-faint">
        Founder/private stakes count as concentrated single names · home enters as a real-estate factor
      </MicroLabel>
    </div>
  )
}

function StatusTag({ p }: { p: PositionLookThrough }) {
  if (p.status === 'proxy')
    return <span className="micro-label ml-2 text-faint">via {p.proxySymbol}</span>
  if (p.status === 'opaque') return <span className="micro-label ml-2 text-amber">opaque</span>
  if (p.status === 'cash') return <span className="micro-label ml-2 text-faint">cash</span>
  if (p.status === 'self') return <span className="micro-label ml-2 text-faint">direct</span>
  return null
}

function PositionBlock({ p, rank }: { p: PositionLookThrough; rank: number }) {
  return (
    <li className="rounded-lg border border-line bg-panel-hi p-3">
      <div className="flex items-baseline gap-3">
        <span className="tnum w-5 text-right font-mono text-xs text-faint">{rank}</span>
        <div className="min-w-0 flex-1">
          <span className="font-mono text-sm text-ink">{p.symbol}</span>
          {p.name && p.name !== p.symbol && <span className="text-xs text-faint"> · {p.name}</span>}
          <StatusTag p={p} />
        </div>
        <span className="tnum w-14 text-right font-mono text-sm text-ink">{fmtPct(p.pct)}</span>
        <span className="tnum w-20 text-right font-mono text-xs text-faint">{fmtMoneyCompact(p.value)}</span>
      </div>

      {p.status === 'self' && (
        <p className="mt-1.5 pl-8 text-xs text-faint">Direct holding — counts as a single company.</p>
      )}
      {p.status === 'cash' && (
        <p className="mt-1.5 pl-8 text-xs text-faint">Cash — no underlying holdings.</p>
      )}
      {p.status === 'opaque' && (
        <p className="mt-1.5 pl-8 text-xs text-faint">
          No look-through data — Refresh ETF holdings (needs an FMP key), or no proxy exists for this fund.
        </p>
      )}
      {(p.status === 'resolved' || p.status === 'proxy') && (
        <ul className="mt-2 space-y-0.5">
          {p.constituents.map((c, i) => (
            <li key={`${c.symbol}-${i}`} className="flex items-center gap-2 pl-8 text-xs">
              <span className="tnum w-4 text-right font-mono text-faint/70">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-muted">{c.name}</span>
              <span className="tnum w-12 text-right font-mono text-faint">{fmtPct(c.weight)}</span>
              <span className="tnum w-16 text-right font-mono text-faint">{fmtMoneyCompact(c.value)}</span>
            </li>
          ))}
          {p.remainder > 0.0005 && (
            <li className="flex items-center gap-2 pl-8 text-xs italic">
              <span className="w-4" />
              <span className="min-w-0 flex-1 truncate text-faint/70">Rest of fund</span>
              <span className="tnum w-12 text-right font-mono text-faint/70">{fmtPct(p.remainder)}</span>
              <span className="tnum w-16 text-right font-mono text-faint/70">
                {fmtMoneyCompact(p.value * p.remainder)}
              </span>
            </li>
          )}
        </ul>
      )}
    </li>
  )
}
