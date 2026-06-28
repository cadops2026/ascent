import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Select, Button } from '../../components/ui'
import { fmtMoney } from '../../lib/format'
import { holdingValue } from '../../lib/finance/networth'
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
  const accountName = (id: string | null) =>
    id ? (accounts.find((a) => a.id === id)?.name ?? '—') : 'Unassigned'

  const remove = async (id: string) => {
    await supabase.from('holdings').delete().eq('id', id)
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

  const removeAll = async () => {
    if (!window.confirm(`Remove all ${holdings.length} holdings? This can't be undone.`)) return
    await supabase.from('holdings').delete().eq('user_id', userId)
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
              onClick={() => void removeAll()}
              className="micro-label text-faint hover:text-coral"
            >
              Clear all
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
                  onClick={() => remove(h.id)}
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
