import { useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Select, Button } from '../../components/ui'
import { fmtMoney } from '../../lib/format'
import { holdingValue } from '../../lib/finance/networth'
import { findDuplicateHoldings } from '../../lib/finance/dedup'
import type { DuplicateGroup } from '../../lib/finance/dedup'
import { FUND_COMPOSITION } from '../../lib/finance/lookthrough'
import {
  HOLDING_KINDS,
  HOLDING_KIND_LABEL,
  TAX_TYPES,
  TAX_TYPE_LABEL,
} from '../../lib/db'
import type { Account, Holding, HoldingKind, EntryMode, TaxType } from '../../lib/db'
import type { QuoteMap } from '../../lib/finance/networth'

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))
const TICKER_KINDS: HoldingKind[] = ['stock', 'etf', 'crypto']
const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const compositionFor = (h: Holding) => (h.name && !h.symbol ? FUND_COMPOSITION[normName(h.name)] : undefined)

export function HoldingsSection({
  accounts,
  holdings,
  quotes,
  userId,
  reload,
}: {
  accounts: Account[]
  holdings: Holding[]
  quotes: QuoteMap
  userId: string
  reload: () => Promise<void>
}) {
  const [adding, setAdding] = useState(false)
  const [dupes, setDupes] = useState<DuplicateGroup[] | null>(null)
  const [dedupeBusy, setDedupeBusy] = useState(false)
  // Holdings deleted in this session, held briefly so an accidental delete can be
  // reversed. In-memory only — a page reload clears it (re-import to restore older
  // deletes). Deletes are otherwise permanent in the DB.
  const [undoRows, setUndoRows] = useState<Holding[] | null>(null)
  const undoTimer = useRef<number | null>(null)
  const accountName = (id: string | null) =>
    id ? (accounts.find((a) => a.id === id)?.name ?? '—') : 'Unassigned'

  // Match across parallel accounts that share a name (re-imports), not just by raw
  // account_id, so duplicate E*TRADE/529 rows in look-alike accounts are caught.
  const accountLabelOf = (id: string | null) =>
    id ? (accounts.find((a) => a.id === id)?.name?.trim().toLowerCase() ?? id) : ''

  const findDuplicates = () => setDupes(findDuplicateHoldings(holdings, accountLabelOf))

  // Arm a ~20s window in which the just-deleted rows can be restored.
  const armUndo = (rows: Holding[]) => {
    setUndoRows(rows)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    undoTimer.current = window.setTimeout(() => setUndoRows(null), 20000)
  }

  // Re-insert the held rows (fresh ids — same ticker/shares/account/basis).
  const undoDelete = async () => {
    if (!undoRows) return
    const rows = undoRows
    setUndoRows(null)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
    await supabase.from('holdings').insert(
      rows.map((h) => ({
        user_id: h.user_id,
        account_id: h.account_id,
        kind: h.kind,
        entry_mode: h.entry_mode,
        symbol: h.symbol,
        name: h.name,
        shares: h.shares,
        manual_amount: h.manual_amount,
        proj_growth: h.proj_growth,
        cost_basis: h.cost_basis,
      })),
    )
    await reload()
  }

  const removeDuplicates = async () => {
    if (!dupes) return
    const rows = dupes.flatMap((g) => g.drop)
    if (!rows.length) {
      setDupes(null)
      return
    }
    setDedupeBusy(true)
    await supabase.from('holdings').delete().in('id', rows.map((h) => h.id))
    setDedupeBusy(false)
    setDupes(null)
    armUndo(rows)
    await reload()
  }

  const remove = async (h: Holding) => {
    await supabase.from('holdings').delete().eq('id', h.id)
    armUndo([h])
    await reload()
  }

  // Move a holding to a different account (or Unassigned). The account's tax type
  // then drives this holding's tax bucket on the Tax tab.
  const moveAccount = async (id: string, accountId: string) => {
    await supabase.from('holdings').update({ account_id: accountId || null }).eq('id', id)
    await reload()
  }

  // Set/fix a holding's ticker (e.g. an imported fund stored under its name).
  // Once it has a real symbol, the next quote refresh prices it.
  const setSymbol = async (h: Holding) => {
    const t = window.prompt(`Ticker for "${h.name || h.symbol || 'holding'}" (e.g. VTSAX):`, h.symbol ?? '')
    if (t == null) return
    await supabase.from('holdings').update({ symbol: t.trim().toUpperCase() || null }).eq('id', h.id)
    await reload()
  }

  // Set a manual dollar value for holdings with no public quote (529 plans, private
  // equity, foreign funds). Switches the row to amount-mode so it's valued directly.
  const setValue = async (h: Holding) => {
    const cur = h.entry_mode === 'amount' && h.manual_amount != null ? String(h.manual_amount) : ''
    const v = window.prompt(`Market value ($) for "${h.symbol || h.name || 'holding'}":`, cur)
    if (v == null) return
    const n = Number(v.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(n) || n < 0) return
    await supabase.from('holdings').update({ entry_mode: 'amount', manual_amount: n }).eq('id', h.id)
    await reload()
  }

  // Composition-priced setup: re-express a name-only fund-of-funds (e.g. a 529
  // portfolio) as effective shares of its underlying ETFs, valued once, then it
  // tracks those underlyings live on every quote refresh — no re-keying.
  const autoPrice = async (h: Holding) => {
    const comp = compositionFor(h)
    if (!comp) return
    const raw = window.prompt(
      `Current market value ($) of "${h.name}" (from your latest statement).\n` +
        `It will then track ${comp.map((c) => c.symbol).join(' + ')} automatically.`,
      '',
    )
    if (raw == null) return
    const value = Number(raw.replace(/[,$\s]/g, ''))
    if (!Number.isFinite(value) || value <= 0) return
    const syms = comp.map((c) => c.symbol)
    // Make sure the underlyings are priced, then read their NAVs.
    await supabase.functions.invoke('refresh-quotes', { body: { symbols: syms } })
    const { data: qrows } = await supabase.from('quote_cache').select('symbol, price').in('symbol', syms)
    const price: Record<string, number> = {}
    for (const r of qrows ?? []) if (r.price != null) price[r.symbol.toUpperCase()] = r.price
    const basket = []
    for (const part of comp) {
      const p = price[part.symbol.toUpperCase()]
      if (!p) {
        window.alert(`Couldn't price ${part.symbol} right now — try again in a moment.`)
        return
      }
      basket.push({ symbol: part.symbol, shares: (value * part.weight) / p })
    }
    await supabase.from('holdings').update({ synthetic_basket: basket }).eq('id', h.id)
    await reload()
  }

  return (
    <Panel
      label="Holdings"
      right={
        <div className="flex items-center gap-3">
          {holdings.length > 0 && (
            <button
              type="button"
              onClick={findDuplicates}
              className="micro-label text-faint hover:text-teal"
            >
              Find duplicates
            </button>
          )}
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="micro-label text-teal hover:text-ink"
          >
            {adding ? 'Close' : '+ Add holding'}
          </button>
        </div>
      }
    >
      {accounts.length === 0 && <AccountForm userId={userId} reload={reload} />}
      {adding && (
        <HoldingForm
          accounts={accounts}
          userId={userId}
          reload={reload}
          done={() => setAdding(false)}
        />
      )}

      {undoRows != null && undoRows.length > 0 && (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-line bg-panel-hi px-4 py-2.5 text-sm">
          <span className="text-muted">
            Removed {undoRows.length === 1 ? (undoRows[0]!.symbol?.toUpperCase() || undoRows[0]!.name || 'holding') : `${undoRows.length} holdings`}.
          </span>
          <button
            type="button"
            onClick={() => void undoDelete()}
            className="micro-label text-teal hover:text-ink"
          >
            Undo
          </button>
        </div>
      )}

      {dupes != null && (
        <DuplicateReview
          dupes={dupes}
          quotes={quotes}
          accountName={accountName}
          busy={dedupeBusy}
          onRemove={() => void removeDuplicates()}
          onCancel={() => setDupes(null)}
        />
      )}

      {holdings.length === 0 ? (
        <p className="py-6 text-center text-sm text-faint">
          No holdings yet. Add one by ticker + shares, or as a manual amount.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {holdings.map((h) => {
            const v = holdingValue(h, quotes)
            return (
              <li key={h.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">
                    {h.symbol ? (
                      <span className="font-mono">{h.symbol.toUpperCase()}</span>
                    ) : (
                      h.name || HOLDING_KIND_LABEL[(h.kind as HoldingKind) ?? 'cash']
                    )}
                    {h.symbol && h.name ? <span className="text-faint"> · {h.name}</span> : null}
                  </div>
                  <div className="text-xs text-faint">
                    {HOLDING_KIND_LABEL[(h.kind as HoldingKind) ?? 'cash']} · {accountName(h.account_id)}
                    {h.entry_mode === 'shares' && h.shares != null
                      ? ` · ${h.shares} sh`
                      : ''}
                  </div>
                </div>
                <div className="tnum w-28 text-right font-mono text-sm">
                  {v == null ? (
                    <span className="text-amber">pending</span>
                  ) : (
                    <span className="text-ink">{fmtMoney(v)}</span>
                  )}
                </div>
                {accounts.length > 0 && (
                  <select
                    value={h.account_id ?? ''}
                    onChange={(e) => void moveAccount(h.id, e.target.value)}
                    title="Account"
                    className="hidden max-w-[10rem] rounded-md border border-line bg-panel-hi px-1.5 py-1 text-xs text-muted outline-none focus:border-teal/60 sm:block"
                  >
                    <option value="">Unassigned</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
                {compositionFor(h) && (
                  <button
                    type="button"
                    onClick={() => void autoPrice(h)}
                    title="Value once, then track the underlying funds automatically"
                    className="micro-label text-teal hover:text-ink"
                  >
                    Auto-price
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void setSymbol(h)}
                  className="micro-label text-faint hover:text-teal"
                >
                  Ticker
                </button>
                <button
                  type="button"
                  onClick={() => void setValue(h)}
                  className="micro-label text-faint hover:text-teal"
                >
                  Value
                </button>
                <button
                  type="button"
                  onClick={() => void remove(h)}
                  className="micro-label text-faint hover:text-coral"
                >
                  Del
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}

function DuplicateReview({
  dupes,
  quotes,
  accountName,
  busy,
  onRemove,
  onCancel,
}: {
  dupes: DuplicateGroup[]
  quotes: QuoteMap
  accountName: (id: string | null) => string
  busy: boolean
  onRemove: () => void
  onCancel: () => void
}) {
  const dropRows = dupes.flatMap((g) => g.drop)
  const dropValue = dropRows.reduce((s, h) => s + (holdingValue(h, quotes) ?? 0), 0)
  const label = (h: Holding) => (h.symbol ? h.symbol.toUpperCase() : h.name || 'holding')

  if (dropRows.length === 0) {
    return (
      <div className="mb-4 flex items-center justify-between rounded-lg border border-line bg-panel-hi px-4 py-3 text-sm">
        <span className="text-muted">No exact duplicates found.</span>
        <button type="button" onClick={onCancel} className="micro-label text-faint hover:text-ink">
          Dismiss
        </button>
      </div>
    )
  }

  return (
    <div className="mb-4 rounded-lg border border-amber/40 bg-amber/5 p-4">
      <div className="text-sm text-ink">
        Found <span className="font-mono">{dropRows.length}</span> duplicate row
        {dropRows.length === 1 ? '' : 's'} worth <span className="font-mono">{fmtMoney(dropValue)}</span>.
        Each is an exact copy — same account, ticker/name, kind, and amount — and the earliest of each is kept.
      </div>
      <ul className="mt-3 max-h-48 space-y-1 overflow-auto">
        {dupes.map((g) =>
          g.drop.map((h) => (
            <li key={h.id} className="flex items-center gap-2 text-xs text-muted">
              <span className="text-coral">remove</span>
              <span className="font-mono text-ink">{label(h)}</span>
              <span className="text-faint">
                · {accountName(h.account_id)}
                {h.entry_mode === 'shares' && h.shares != null ? ` · ${h.shares} sh` : ''}
              </span>
              <span className="tnum ml-auto font-mono text-faint">{fmtMoney(holdingValue(h, quotes) ?? 0)}</span>
            </li>
          )),
        )}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button variant="danger" onClick={onRemove} disabled={busy}>
          Remove {dropRows.length} duplicate{dropRows.length === 1 ? '' : 's'}
        </Button>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function AccountForm({ userId, reload }: { userId: string; reload: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [taxType, setTaxType] = useState<TaxType>('taxable')
  const [institution, setInstitution] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!name.trim()) return
    setBusy(true)
    await supabase
      .from('accounts')
      .insert({ user_id: userId, name: name.trim(), tax_type: taxType, institution: institution.trim() || null })
    setName('')
    setInstitution('')
    setBusy(false)
    await reload()
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-panel-hi p-4">
      <MicroLabel className="mb-3">Create your first account</MicroLabel>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fidelity Brokerage" />
        </Field>
        <Field label="Tax type">
          <Select value={taxType} onChange={(e) => setTaxType(e.target.value as TaxType)}>
            {TAX_TYPES.map((t) => (
              <option key={t} value={t}>
                {TAX_TYPE_LABEL[t]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Institution">
          <Input value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="optional" />
        </Field>
      </div>
      <div className="mt-3">
        <Button onClick={submit} disabled={busy || !name.trim()}>
          Add account
        </Button>
      </div>
    </div>
  )
}

function HoldingForm({
  accounts,
  userId,
  reload,
  done,
}: {
  accounts: Account[]
  userId: string
  reload: () => Promise<void>
  done: () => void
}) {
  const [accountId, setAccountId] = useState<string>('')
  const [kind, setKind] = useState<HoldingKind>('stock')
  const [symbol, setSymbol] = useState('')
  const [name, setName] = useState('')
  const [entryMode, setEntryMode] = useState<EntryMode>('shares')
  const [shares, setShares] = useState('')
  const [amount, setAmount] = useState('')
  const [projGrowth, setProjGrowth] = useState('')
  const [costBasis, setCostBasis] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const isTicker = TICKER_KINDS.includes(kind)

  const onKind = (k: HoldingKind) => {
    setKind(k)
    if (!TICKER_KINDS.includes(k)) setEntryMode('amount')
  }

  const submit = async () => {
    setErr(null)
    if (entryMode === 'shares' && (!symbol.trim() || num(shares) == null)) {
      setErr('Shares mode needs a ticker and a share count.')
      return
    }
    if (entryMode === 'amount' && num(amount) == null) {
      setErr('Amount mode needs a dollar amount.')
      return
    }
    setBusy(true)
    const growth = num(projGrowth)
    const { error } = await supabase.from('holdings').insert({
      user_id: userId,
      account_id: accountId || null,
      kind,
      entry_mode: entryMode,
      symbol: isTicker ? symbol.trim().toUpperCase() || null : null,
      name: name.trim() || null,
      shares: entryMode === 'shares' ? num(shares) : null,
      manual_amount: entryMode === 'amount' ? num(amount) : null,
      proj_growth: growth == null ? null : growth / 100,
      cost_basis: num(costBasis),
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    await reload()
    done()
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-panel-hi p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Kind">
          <Select value={kind} onChange={(e) => onKind(e.target.value as HoldingKind)}>
            {HOLDING_KINDS.map((k) => (
              <option key={k} value={k}>
                {HOLDING_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Account">
          <Select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">Unassigned</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
        {isTicker ? (
          <Field label="Ticker">
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="AAPL, BTC…" />
          </Field>
        ) : (
          <Field label="Name">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Cadence stake" />
          </Field>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {isTicker && (
          <Field label="Entry mode">
            <div className="flex gap-1.5">
              {(['shares', 'amount'] as EntryMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setEntryMode(m)}
                  className={`flex-1 rounded-lg border px-2 py-2 text-sm capitalize transition-colors ${
                    entryMode === m ? 'border-teal/60 text-teal' : 'border-line text-muted hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </Field>
        )}
        {entryMode === 'shares' ? (
          <Field label="Shares">
            <Input type="number" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="100" />
          </Field>
        ) : (
          <Field label="Amount (USD)">
            <Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="50000" />
          </Field>
        )}
        <Field label="Proj. growth %/yr" hint="your assumption — editable">
          <Input type="number" value={projGrowth} onChange={(e) => setProjGrowth(e.target.value)} placeholder="optional" />
        </Field>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Cost basis (USD)">
          <Input type="number" value={costBasis} onChange={(e) => setCostBasis(e.target.value)} placeholder="optional" />
        </Field>
      </div>

      {err && <p className="mt-3 text-sm text-coral">{err}</p>}
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} disabled={busy}>
          Add holding
        </Button>
        <Button variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
