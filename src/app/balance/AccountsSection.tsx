import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Select } from '../../components/ui'
import { fmtMoneyCompact } from '../../lib/format'
import { holdingValue } from '../../lib/finance/networth'
import { bucketForTaxType, BUCKET_LABEL } from '../../lib/finance/tax'
import { TAX_TYPES, TAX_TYPE_LABEL } from '../../lib/db'
import type { Account, Holding, TaxType } from '../../lib/db'
import type { QuoteMap } from '../../lib/finance/networth'

// Holdings whose name still carries the brokerage's account tag, e.g.
// "VANGUARD 500 INDEX ADMIRAL CL (Roth IRA)". Consolidated statements collapse
// several real accounts into one; the model tagged the Roth rows by name but they
// all imported into one (taxable) account, so the Roth money is mis-bucketed.
const ROTH_SUFFIX = /\s*\((?:roth ira|roth)\)\s*$/i

const bucketTone: Record<string, string> = {
  taxable: 'text-amber',
  tax_deferred: 'text-indigo',
  tax_free: 'text-teal',
  hsa: 'text-teal',
  other: 'text-faint',
}

/**
 * Account roster with inline tax-treatment editing — the lever that makes the Tax
 * tab's buckets correct. Plus a one-click "Split Roth holdings" that pulls
 * name-tagged Roth positions into a real roth_ira account so they read as tax-free.
 */
export function AccountsSection({
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
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const stats = (accountId: string) => {
    let value = 0
    let count = 0
    for (const h of holdings) {
      if (h.account_id !== accountId) continue
      count += 1
      value += holdingValue(h, quotes) ?? 0
    }
    return { value, count }
  }

  const setTaxType = async (id: string, taxType: TaxType) => {
    setBusy(true)
    await supabase.from('accounts').update({ tax_type: taxType }).eq('id', id)
    setBusy(false)
    await reload()
  }

  // Move every "(Roth IRA)"-tagged holding into a roth_ira account at the same
  // institution, stripping the tag from the name. Reuses an existing Roth account
  // by name+type so re-running is idempotent.
  const splitRoth = async () => {
    const targets = holdings.filter((h) => h.name && ROTH_SUFFIX.test(h.name))
    if (!targets.length) {
      setNote('No "(Roth IRA)" holdings to split — your Roth rows may already be in a Roth account.')
      return
    }
    setBusy(true)
    setNote(null)
    try {
      const acctName = (id: string | null) => (id ? accounts.find((a) => a.id === id)?.name ?? null : null)
      const rothAcctByName = new Map<string, string>() // target account name -> id
      let moved = 0
      for (const h of targets) {
        const inst = acctName(h.account_id)
        const targetName = inst ? `${inst} Roth IRA` : 'Roth IRA'
        let targetId = rothAcctByName.get(targetName)
        if (!targetId) {
          const { data: existing } = await supabase
            .from('accounts')
            .select('id')
            .eq('name', targetName)
            .eq('tax_type', 'roth_ira')
            .limit(1)
            .maybeSingle()
          if (existing) targetId = existing.id
          else {
            const { data: acc } = await supabase
              .from('accounts')
              .insert({ user_id: userId, name: targetName, tax_type: 'roth_ira', institution: inst })
              .select('id')
              .single()
            targetId = acc?.id
          }
          if (targetId) rothAcctByName.set(targetName, targetId)
        }
        if (!targetId) continue
        const cleanName = h.name!.replace(ROTH_SUFFIX, '').trim() || null
        await supabase.from('holdings').update({ account_id: targetId, name: cleanName }).eq('id', h.id)
        moved += 1
      }
      await reload()
      setNote(`Moved ${moved} holding${moved === 1 ? '' : 's'} into a Roth IRA account — now tax-free.`)
    } catch (e) {
      setNote(`Split failed: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(false)
    }
  }

  const hasRoth = holdings.some((h) => h.name && ROTH_SUFFIX.test(h.name))

  return (
    <Panel
      label="Accounts & tax treatment"
      right={
        hasRoth ? (
          <button
            type="button"
            onClick={() => void splitRoth()}
            disabled={busy}
            className="micro-label text-teal hover:text-ink disabled:opacity-50"
          >
            Split Roth holdings
          </button>
        ) : undefined
      }
    >
      {note && <div className="mb-3 text-xs text-muted">{note}</div>}
      {accounts.length === 0 ? (
        <p className="py-4 text-center text-sm text-faint">
          No accounts yet. Import a statement or add a holding to an account.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((a) => {
            const { value, count } = stats(a.id)
            const bucket = bucketForTaxType(a.tax_type)
            return (
              <li key={a.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-ink">{a.name}</div>
                  <div className="truncate text-xs text-faint">
                    <span className={bucketTone[bucket]}>{BUCKET_LABEL[bucket]}</span>
                    {' · '}
                    {count} holding{count === 1 ? '' : 's'}
                    {a.institution ? ` · ${a.institution}` : ''}
                  </div>
                </div>
                <div className="tnum w-24 text-right font-mono text-sm text-muted">
                  {fmtMoneyCompact(value)}
                </div>
                <Select
                  value={a.tax_type}
                  onChange={(e) => void setTaxType(a.id, e.target.value as TaxType)}
                  disabled={busy}
                  className="w-44"
                >
                  {TAX_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TAX_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
              </li>
            )
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-faint">
        Tax type drives the three buckets — taxable, tax-deferred, tax-free — on the Tax tab. Untagged
        holdings count as taxable.
      </p>
    </Panel>
  )
}
