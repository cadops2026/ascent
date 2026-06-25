import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Select, Button } from '../../components/ui'
import { fmtMoney, fmtPct } from '../../lib/format'
import { amortize } from '../../lib/finance/amortization'
import { liabilityBalance } from '../../lib/finance/networth'
import { RE_KINDS } from '../../lib/db'
import type { RealEstate, Liability, ReKind } from '../../lib/db'

const num = (s: string): number | null => (s.trim() === '' ? null : Number(s))

export function PropertySection({
  realEstate,
  liabilities,
  userId,
  reload,
}: {
  realEstate: RealEstate[]
  liabilities: Liability[]
  userId: string
  reload: () => Promise<void>
}) {
  const [addProp, setAddProp] = useState(false)
  const [addDebt, setAddDebt] = useState(false)

  const mortgageFor = (propId: string) =>
    liabilities.find((l) => l.kind === 'mortgage' && l.property_id === propId)

  const removeProp = async (id: string) => {
    await supabase.from('real_estate').delete().eq('id', id)
    await reload()
  }
  const removeDebt = async (id: string) => {
    await supabase.from('liabilities').delete().eq('id', id)
    await reload()
  }

  return (
    <div className="space-y-5">
      <Panel
        label="Real estate"
        right={
          <button type="button" onClick={() => setAddProp((v) => !v)} className="micro-label text-teal hover:text-ink">
            {addProp ? 'Close' : '+ Add property'}
          </button>
        }
      >
        {addProp && <PropertyForm userId={userId} reload={reload} done={() => setAddProp(false)} />}
        {realEstate.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">No property yet.</p>
        ) : (
          <ul className="space-y-3">
            {realEstate.map((p) => {
              const m = mortgageFor(p.id)
              const am = m
                ? amortize({ origBalance: m.orig_balance, annualRate: m.rate, termMonths: m.term_months, startDate: m.start_date })
                : null
              return (
                <li key={p.id} className="rounded-lg border border-line bg-panel-hi p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-sm text-ink">
                        {p.label || (p.kind === 'residence' ? 'Primary residence' : 'Investment property')}
                        <span className="ml-2 rounded bg-panel px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-faint">
                          {p.kind}
                        </span>
                      </div>
                      <div className="mt-0.5 text-xs text-faint">
                        Value source: {p.value_source}
                        {p.as_of ? ` · as of ${p.as_of}` : ''}
                        {p.kind === 'residence' ? ' · out of investable (inv. #11)' : ''}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="tnum font-mono text-sm text-ink">{fmtMoney(p.market_value)}</div>
                      <button type="button" onClick={() => removeProp(p.id)} className="micro-label text-faint hover:text-coral">
                        Del
                      </button>
                    </div>
                  </div>

                  {am && am.valid && (
                    <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 border-t border-line pt-3 sm:grid-cols-4">
                      <Stat label="Mortgage bal." value={fmtMoney(am.currentBalance)} />
                      <Stat label="Monthly" value={fmtMoney(am.monthlyPayment)} />
                      <Stat label="Payoff" value={am.payoffDate ?? '—'} />
                      <Stat label="Paid off" value={fmtPct(am.monthsElapsed / (am.monthsElapsed + am.monthsRemaining || 1), 0)} />
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      <Panel
        label="Liabilities"
        right={
          <button type="button" onClick={() => setAddDebt((v) => !v)} className="micro-label text-teal hover:text-ink">
            {addDebt ? 'Close' : '+ Add liability'}
          </button>
        }
      >
        {addDebt && <LiabilityForm realEstate={realEstate} userId={userId} reload={reload} done={() => setAddDebt(false)} />}
        {liabilities.length === 0 ? (
          <p className="py-6 text-center text-sm text-faint">No liabilities yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {liabilities.map((l) => (
              <li key={l.id} className="flex items-center gap-3 py-3">
                <div className="flex-1">
                  <div className="text-sm text-ink">{l.label || (l.kind === 'mortgage' ? 'Mortgage' : 'Debt')}</div>
                  <div className="text-xs text-faint">
                    {l.kind}
                    {l.rate != null ? ` · ${fmtPct(l.rate)} APR` : ''}
                  </div>
                </div>
                <div className="tnum w-28 text-right font-mono text-sm text-coral">
                  {fmtMoney(liabilityBalance(l))}
                </div>
                <button type="button" onClick={() => removeDebt(l.id)} className="micro-label text-faint hover:text-coral">
                  Del
                </button>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <MicroLabel>{label}</MicroLabel>
      <div className="tnum mt-0.5 font-mono text-sm text-ink">{value}</div>
    </div>
  )
}

function PropertyForm({ userId, reload, done }: { userId: string; reload: () => Promise<void>; done: () => void }) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<ReKind>('residence')
  const [value, setValue] = useState('')
  const [source, setSource] = useState<'manual' | 'avm'>('manual')
  const [asOf, setAsOf] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (num(value) == null) return
    setBusy(true)
    await supabase.from('real_estate').insert({
      user_id: userId,
      label: label.trim() || null,
      kind,
      market_value: Number(value),
      value_source: source,
      as_of: asOf || null,
    })
    setBusy(false)
    await reload()
    done()
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-panel-hi p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Home" />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as ReKind)}>
            {RE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Market value (USD)">
          <Input type="number" value={value} onChange={(e) => setValue(e.target.value)} placeholder="850000" />
        </Field>
        <Field label="Value source">
          <Select value={source} onChange={(e) => setSource(e.target.value as 'manual' | 'avm')}>
            <option value="manual">manual</option>
            <option value="avm">avm</option>
          </Select>
        </Field>
        <Field label="As of">
          <Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} disabled={busy || num(value) == null}>
          Add property
        </Button>
        <Button variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function LiabilityForm({
  realEstate,
  userId,
  reload,
  done,
}: {
  realEstate: RealEstate[]
  userId: string
  reload: () => Promise<void>
  done: () => void
}) {
  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<'mortgage' | 'other'>('mortgage')
  const [orig, setOrig] = useState('')
  const [rate, setRate] = useState('')
  const [term, setTerm] = useState('')
  const [start, setStart] = useState('')
  const [propertyId, setPropertyId] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (num(orig) == null) return
    setBusy(true)
    const r = num(rate)
    await supabase.from('liabilities').insert({
      user_id: userId,
      label: label.trim() || null,
      kind,
      orig_balance: Number(orig),
      rate: r == null ? null : r / 100,
      term_months: num(term),
      start_date: start || null,
      property_id: kind === 'mortgage' && propertyId ? propertyId : null,
    })
    setBusy(false)
    await reload()
    done()
  }

  return (
    <div className="mb-4 rounded-lg border border-line bg-panel-hi p-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Home mortgage" />
        </Field>
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as 'mortgage' | 'other')}>
            <option value="mortgage">mortgage</option>
            <option value="other">other</option>
          </Select>
        </Field>
        <Field label="Original balance (USD)">
          <Input type="number" value={orig} onChange={(e) => setOrig(e.target.value)} placeholder="640000" />
        </Field>
      </div>
      {kind === 'mortgage' && (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
          <Field label="Rate %/yr">
            <Input type="number" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="6.25" />
          </Field>
          <Field label="Term (months)">
            <Input type="number" value={term} onChange={(e) => setTerm(e.target.value)} placeholder="360" />
          </Field>
          <Field label="Start date">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Property">
            <Select value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
              <option value="">none</option>
              {realEstate.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label || p.kind}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      )}
      <div className="mt-3 flex gap-2">
        <Button onClick={submit} disabled={busy || num(orig) == null}>
          Add liability
        </Button>
        <Button variant="ghost" onClick={done}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
