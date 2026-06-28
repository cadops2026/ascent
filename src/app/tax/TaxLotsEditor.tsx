import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Field, Input, Button } from '../../components/ui'
import { fmtMoneyCompact } from '../../lib/format'
import { holdingValue } from '../../lib/finance/networth'
import { bucketForTaxType } from '../../lib/finance/tax'
import type { QuoteMap } from '../../lib/finance/networth'
import type { Account, Holding, TaxLot } from '../../lib/db'

/**
 * Tax-lots editor — lets the user record dated purchase lots per taxable holding so
 * harvesting works lot-by-lot and wash-sale risk can be flagged. Optional: with no
 * lots the harvest engine reads a position at its blended basis. Writes go to the
 * owner-scoped `tax_lots` table (RLS); the browser never touches a third party (#10).
 */
export interface TaxLotsEditorProps {
  accounts: Account[]
  holdings: Holding[]
  quotes: QuoteMap
  lots: TaxLot[]
  userId: string | undefined
  onChanged: () => void
}

export function TaxLotsEditor({ accounts, holdings, quotes, lots, userId, onChanged }: TaxLotsEditorProps) {
  const acctBucket = new Map(accounts.map((a) => [a.id, bucketForTaxType(a.tax_type)]))
  const taxable = holdings.filter(
    (h) =>
      h.symbol &&
      h.shares != null &&
      h.kind !== 'cash' &&
      (((h.account_id && acctBucket.get(h.account_id)) || 'taxable') === 'taxable'),
  )
  const lotsByHolding = new Map<string, TaxLot[]>()
  for (const l of lots) lotsByHolding.set(l.holding_id, [...(lotsByHolding.get(l.holding_id) ?? []), l])

  return (
    <Panel label="Tax lots — sharpen harvesting (optional)">
      {taxable.length === 0 ? (
        <p className="py-2 text-sm text-faint">
          Add taxable, share-based holdings on the Balance Sheet to track purchase lots here.
        </p>
      ) : (
        <div className="space-y-4">
          {taxable.map((h) => (
            <HoldingLots
              key={h.id}
              holding={h}
              currentValue={holdingValue(h, quotes)}
              lots={(lotsByHolding.get(h.id) ?? []).slice().sort((a, b) => (a.acquired_on ?? '').localeCompare(b.acquired_on ?? ''))}
              userId={userId}
              onChanged={onChanged}
            />
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-faint">
        A lot is one purchase tranche (shares, total cost, date). Lots let harvesting target the underwater
        tranches of a position and flag wash-sale risk from a recent buy. Leave a holding without lots to read
        it at its single blended basis.
      </p>
    </Panel>
  )
}

function HoldingLots({
  holding,
  currentValue,
  lots,
  userId,
  onChanged,
}: {
  holding: Holding
  currentValue: number | null
  lots: TaxLot[]
  userId: string | undefined
  onChanged: () => void
}) {
  const [shares, setShares] = useState('')
  const [basis, setBasis] = useState('')
  const [acquired, setAcquired] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const pps = holding.shares && holding.shares > 0 && currentValue != null ? currentValue / holding.shares : null
  const lotShares = lots.reduce((s, l) => s + l.shares, 0)
  const coverage = holding.shares != null ? `${lotShares} of ${holding.shares} sh in lots` : null

  const add = async () => {
    if (!userId || !shares || !basis) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase.from('tax_lots').insert({
      user_id: userId,
      holding_id: holding.id,
      shares: Number(shares),
      cost_basis: Number(basis),
      acquired_on: acquired || null,
    })
    setBusy(false)
    if (error) {
      setErr(error.message)
      return
    }
    setShares('')
    setBasis('')
    setAcquired('')
    onChanged()
  }

  const remove = async (id: string) => {
    setBusy(true)
    await supabase.from('tax_lots').delete().eq('id', id)
    setBusy(false)
    onChanged()
  }

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-sm text-ink">
          {holding.symbol} <span className="text-faint">{holding.name && holding.name !== holding.symbol ? holding.name : ''}</span>
        </span>
        <span className="tnum font-mono text-xs text-faint">
          {currentValue != null ? fmtMoneyCompact(currentValue) : '—'}
          {coverage ? ` · ${coverage}` : ''}
        </span>
      </div>

      {lots.length > 0 && (
        <ul className="mb-2 space-y-1">
          {lots.map((l) => {
            const lotVal = pps != null ? l.shares * pps : null
            const gain = lotVal != null ? lotVal - l.cost_basis : null
            return (
              <li key={l.id} className="flex items-center gap-2 text-xs">
                <span className="tnum w-14 font-mono text-muted">{l.shares}sh</span>
                <span className="tnum w-24 font-mono text-faint">basis {fmtMoneyCompact(l.cost_basis)}</span>
                <span className="w-24 text-faint/70">{l.acquired_on ?? 'no date'}</span>
                {gain != null && (
                  <span className={`tnum font-mono ${gain < 0 ? 'text-coral' : 'text-teal'}`}>
                    {gain < 0 ? '−' : '+'}
                    {fmtMoneyCompact(Math.abs(gain))}
                  </span>
                )}
                <button type="button" onClick={() => void remove(l.id)} disabled={busy} className="micro-label ml-auto text-faint hover:text-coral">
                  Remove
                </button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
        <Field label="Shares">
          <Input type="number" value={shares} onChange={(e) => setShares(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Total cost">
          <Input type="number" value={basis} onChange={(e) => setBasis(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Acquired">
          <Input type="date" value={acquired} onChange={(e) => setAcquired(e.target.value)} />
        </Field>
        <div className="pb-1.5">
          <Button onClick={add} disabled={busy || !userId || !shares || !basis}>
            {busy ? '…' : 'Add lot'}
          </Button>
        </div>
      </div>
      {err && <p className="mt-1 text-xs text-coral">{err}</p>}
    </div>
  )
}
