import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Figure, MicroLabel, AlertStrip } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { buildEtfMap, lookThrough } from '../../lib/finance/lookthrough'
import type { EtfHoldingRow } from '../../lib/finance/lookthrough'

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

  const lt = useMemo(
    () => lookThrough(data.holdings, data.realEstate, data.quotes, buildEtfMap(etfRows)),
    [data, etfRows],
  )

  const refreshEtf = async () => {
    setRefreshing(true)
    setNote(null)
    const etfs = [
      ...new Set(
        data.holdings.filter((h) => h.kind === 'etf' && h.symbol).map((h) => h.symbol!.toUpperCase()),
      ),
    ]
    if (!etfs.length) {
      setNote('No ETFs to resolve.')
      setRefreshing(false)
      return
    }
    try {
      const { error } = await supabase.functions.invoke('refresh-etf-holdings', { body: { etfs } })
      if (error) throw error
      await loadEtf()
    } catch {
      setNote(
        'ETF look-through unavailable — needs the refresh-etf-holdings function deployed + an FMP key in Supabase secrets.',
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
