import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Button } from '../../components/ui'
import { fmtMoney } from '../../lib/format'
import { TAX_TYPES, HOLDING_KIND_LABEL } from '../../lib/db'
import type {
  StatementImport,
  ImportCandidate,
  HoldingCandidate,
  TaxType,
  HoldingKind,
} from '../../lib/db'

type Summary = { institution?: string; account_type?: string; statement_date?: string } | null
const ACCEPT = '.pdf,.csv,.txt,.png,.jpg,.jpeg,.webp'

const confColor: Record<'high' | 'medium' | 'low', string> = {
  high: 'text-teal',
  medium: 'text-amber',
  low: 'text-faint',
}

// ── Dedup keys ────────────────────────────────────────────────────────────────
// A position is "the same" — and must not be imported twice — when it shares the
// account, symbol, kind, entry mode, and amount (shares or value). Amount is part
// of the key on purpose ("same amounts don't get imported twice"); the same ticker
// at a different amount or in a different account is a distinct position and still
// imports. Account is part of the key, and accounts are reused by name on re-import,
// so re-running the same statement collapses onto the existing rows instead of dup'ing.
const roundShares = (n: number) => Math.round(n * 1e4) / 1e4
const roundAmt = (n: number) => Math.round(n * 100) / 100
const holdingKey = (account: string | null, label: string, kind: string, mode: 'shares' | 'amount', val: number) =>
  `${account ?? ''}|${label.trim().toUpperCase()}|${kind}|${mode}|${mode === 'shares' ? roundShares(val) : roundAmt(val)}`
const liabilityKey = (label: string, kind: string, balance: number) =>
  `${label.trim().toLowerCase()}|${kind}|${roundAmt(balance)}`

export function ImportSection({ userId, reload }: { userId: string; reload: () => Promise<void> }) {
  const [imports, setImports] = useState<StatementImport[]>([])
  const [uploading, setUploading] = useState(false)
  const [excluded, setExcluded] = useState<Record<string, Set<number>>>({})
  const [commitNotes, setCommitNotes] = useState<Record<string, string>>({})
  const [committing, setCommitting] = useState<string | null>(null)
  const committingRef = useRef(false) // synchronous guard — state updates lag a tick
  const folderRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('statement_imports')
      .select('*')
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
    setImports(data ?? [])
  }, [])

  // Invoke the parser and await the call. If the invocation itself fails — the
  // function never started, returned 5xx, or hit the Edge Function wall-clock
  // limit on a large statement — and the row is still 'parsing' (the function
  // didn't record its own error), mark it errored so it can't hang in "Parsing…"
  // forever. The function sets 'parsed'/'error' itself on the happy/handled paths;
  // this only backstops the cases where it never gets to.
  const invokeParse = useCallback(
    async (id: string) => {
      try {
        const { error } = await supabase.functions.invoke('parse-statements', { body: { import_id: id } })
        if (error) {
          const { data: cur } = await supabase.from('statement_imports').select('status').eq('id', id).single()
          if (cur && (cur.status === 'parsing' || cur.status === 'uploaded')) {
            await supabase
              .from('statement_imports')
              .update({ status: 'error', error: `Couldn't finish parsing (the file may be too large and timed out): ${error.message}` })
              .eq('id', id)
          }
        }
      } catch (e) {
        await supabase
          .from('statement_imports')
          .update({ status: 'error', error: `Parse request failed: ${String(e)}` })
          .eq('id', id)
      } finally {
        await load()
      }
    },
    [load],
  )

  // Parse a batch of imports with bounded concurrency. Firing every file at once
  // stampedes the parser (concurrent model calls throttle, and some never finish),
  // which is how a folder of statements ends up with rows stuck "pending".
  const parseQueue = useCallback(
    async (ids: string[]) => {
      const CONCURRENCY = 3
      let next = 0
      const worker = async () => {
        while (next < ids.length) {
          const id = ids[next++]
          if (id) await invokeParse(id)
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker))
    },
    [invokeParse],
  )

  useEffect(() => {
    void load()
  }, [load])

  // Poll while anything is still parsing.
  useEffect(() => {
    if (!imports.some((i) => i.status === 'parsing' || i.status === 'uploaded')) return
    const t = setInterval(() => void load(), 3000)
    return () => clearInterval(t)
  }, [imports, load])

  // Enable directory selection on the folder picker (typed-around attribute).
  useEffect(() => {
    folderRef.current?.setAttribute('webkitdirectory', '')
  }, [])

  const upload = async (files: FileList | File[]) => {
    setUploading(true)
    const toParse: string[] = []
    for (const file of Array.from(files)) {
      const { data: ins } = await supabase
        .from('statement_imports')
        .insert({ user_id: userId, file_name: file.name, file_path: 'pending', status: 'uploaded' })
        .select('id')
        .single()
      if (!ins) continue
      const path = `${userId}/${ins.id}/${file.name}`
      const up = await supabase.storage.from('statements').upload(path, file, { upsert: true })
      if (up.error) {
        await supabase.from('statement_imports').update({ status: 'error', error: up.error.message }).eq('id', ins.id)
        continue
      }
      await supabase.from('statement_imports').update({ file_path: path, status: 'parsing' }).eq('id', ins.id)
      toParse.push(ins.id)
    }
    setUploading(false)
    await load()
    void parseQueue(toParse) // bounded concurrency — no stampede
  }

  const toggle = (importId: string, idx: number) =>
    setExcluded((prev) => {
      const set = new Set(prev[importId] ?? [])
      if (set.has(idx)) set.delete(idx)
      else set.add(idx)
      return { ...prev, [importId]: set }
    })

  // One commit at a time. Concurrent commits each read the pre-insert state, so the
  // seen-set dedup below can't stop a double-click on "Import" — three racing commits
  // once created three identical accounts. The lock closes the concurrent path; the
  // seen-set handles the sequential one.
  const commit = async (imp: StatementImport) => {
    if (committingRef.current) return
    committingRef.current = true
    setCommitting(imp.id)
    try {
      await commitInner(imp)
    } finally {
      committingRef.current = false
      setCommitting(null)
    }
  }

  const commitInner = async (imp: StatementImport) => {
    const cands = (imp.candidates as unknown as ImportCandidate[]) ?? []
    const ex = excluded[imp.id] ?? new Set<number>()
    const summary = imp.summary as Summary
    const institution = summary?.institution ?? null
    const defaultTax: TaxType = (TAX_TYPES as readonly string[]).includes(summary?.account_type ?? '')
      ? (summary!.account_type as TaxType)
      : 'taxable'

    // Account resolution, lazy + cached. A consolidated statement splits into one
    // account per (name, tax_type): a per-holding account_label/account_type overrides
    // the statement default, so e.g. "Roth IRA"-labeled rows land in a roth_ira account
    // ("{institution} Roth IRA") instead of collapsing into one taxable account.
    const acctCache = new Map<string, string | null>()
    const resolveAccount = async (name: string | null, tax: TaxType): Promise<string | null> => {
      if (!name) return null
      const cacheKey = `${name}|${tax}`
      if (acctCache.has(cacheKey)) return acctCache.get(cacheKey) ?? null
      const { data: existing } = await supabase
        .from('accounts')
        .select('id')
        .eq('name', name)
        .eq('tax_type', tax)
        .limit(1)
        .maybeSingle()
      let id: string | null
      if (existing) id = existing.id
      else {
        const { data: acc } = await supabase
          .from('accounts')
          .insert({ user_id: userId, name, tax_type: tax, institution })
          .select('id')
          .single()
        id = acc?.id ?? null
      }
      acctCache.set(cacheKey, id)
      return id
    }
    const accountNameFor = (c: HoldingCandidate): string | null => {
      const label = c.account_label?.trim()
      return label ? (institution ? `${institution} ${label}` : label) : institution
    }
    const accountTaxFor = (c: HoldingCandidate): TaxType =>
      (TAX_TYPES as readonly string[]).includes(c.account_type ?? '') ? (c.account_type as TaxType) : defaultTax

    // Dedup keys on the account NAME (not the raw id) so re-imports collapse onto
    // existing rows even if a look-alike account row exists. The Set grows as we
    // insert, collapsing duplicate rows within one statement too.
    const nameKey = (s: string | null) => (s ?? '').trim().toLowerCase()
    const [{ data: exH }, { data: exL }, { data: exAcc }] = await Promise.all([
      supabase.from('holdings').select('account_id, symbol, name, kind, entry_mode, shares, manual_amount'),
      supabase.from('liabilities').select('label, kind, orig_balance'),
      supabase.from('accounts').select('id, name'),
    ])
    const acctNameById = new Map((exAcc ?? []).map((a) => [a.id, nameKey(a.name)]))
    const seenH = new Set<string>()
    for (const h of exH ?? []) {
      const label = (h.symbol || h.name || '').toString()
      if (!label) continue
      const mode = h.entry_mode === 'shares' ? 'shares' : 'amount'
      const acctName = h.account_id ? (acctNameById.get(h.account_id) ?? '') : ''
      seenH.add(holdingKey(acctName, label, h.kind, mode, (mode === 'shares' ? h.shares : h.manual_amount) ?? 0))
    }
    const seenL = new Set<string>()
    for (const l of exL ?? []) seenL.add(liabilityKey((l.label ?? '').toString(), l.kind, l.orig_balance ?? 0))

    let imported = 0
    let skipped = 0
    for (let i = 0; i < cands.length; i++) {
      if (ex.has(i)) continue
      const c = cands[i]
      if (!c) continue
      if (c.row_type === 'holding') {
        const hasShares = c.shares != null
        const hasAmount = c.amount != null
        if (!hasShares && !hasAmount) continue
        const label = (c.symbol || c.name || '').toString()
        const mode = hasShares ? 'shares' : 'amount'
        const acctName = accountNameFor(c)
        const key = holdingKey(nameKey(acctName), label, c.kind, mode, (hasShares ? c.shares : c.amount) ?? 0)
        if (seenH.has(key)) {
          skipped++
          continue
        }
        seenH.add(key)
        const accountId = await resolveAccount(acctName, accountTaxFor(c))
        await supabase.from('holdings').insert({
          user_id: userId,
          account_id: accountId,
          kind: c.kind,
          entry_mode: mode,
          symbol: c.symbol ? c.symbol.toUpperCase() : null,
          name: c.name ?? null,
          shares: hasShares ? c.shares! : null,
          manual_amount: hasShares ? null : c.amount!,
          cost_basis: c.cost_basis ?? null,
        })
        imported++
      } else {
        const label = c.label ?? 'Imported liability'
        const key = liabilityKey(label, c.kind, c.balance ?? 0)
        if (seenL.has(key)) {
          skipped++
          continue
        }
        seenL.add(key)
        await supabase.from('liabilities').insert({
          user_id: userId,
          label,
          kind: c.kind,
          orig_balance: c.balance ?? 0,
          rate: c.rate ?? null,
        })
        imported++
      }
    }
    await supabase.from('statement_imports').update({ status: 'committed' }).eq('id', imp.id)
    setCommitNotes((n) => ({
      ...n,
      [imp.id]: `Imported ${imported}${skipped ? ` · skipped ${skipped} duplicate${skipped === 1 ? '' : 's'} already in your holdings` : ''}`,
    }))
    await load()
    await reload()
  }

  const setStatus = async (imp: StatementImport, status: string) => {
    await supabase.from('statement_imports').update({ status }).eq('id', imp.id)
    await load()
  }
  const retry = async (imp: StatementImport) => {
    await supabase.from('statement_imports').update({ status: 'parsing', error: null }).eq('id', imp.id)
    await load()
    void invokeParse(imp.id)
  }

  // Rows that aren't done: still in flight, or errored. (Not 'parsed' — those are
  // awaiting your review — and not 'committed'.) Bulk-retry or clear them at once.
  const stuck = imports.filter((i) => i.status === 'uploaded' || i.status === 'parsing' || i.status === 'error')
  const bulkRetry = async () => {
    const ids = stuck.map((i) => i.id)
    if (ids.length === 0) return
    await supabase.from('statement_imports').update({ status: 'parsing', error: null }).in('id', ids)
    await load()
    void parseQueue(ids)
  }
  const bulkClear = async () => {
    const ids = stuck.map((i) => i.id)
    if (ids.length === 0) return
    await supabase.from('statement_imports').update({ status: 'dismissed' }).in('id', ids)
    await load()
  }

  return (
    <Panel label="Import statements" right={<MicroLabel className="text-faint">Claude · review before import</MicroLabel>}>
      <DropZone
        uploading={uploading}
        onFiles={upload}
        onPickFolder={() => folderRef.current?.click()}
      />
      <input
        ref={folderRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => e.target.files && upload(e.target.files)}
      />

      {stuck.length > 1 && (
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-line bg-panel-hi px-3 py-2 text-xs">
          <span className="text-muted">{stuck.length} pending or stuck</span>
          <button type="button" onClick={() => void bulkRetry()} className="micro-label text-teal hover:text-ink">
            Retry all
          </button>
          <button type="button" onClick={() => void bulkClear()} className="micro-label text-faint hover:text-coral">
            Clear all
          </button>
        </div>
      )}

      {imports.length > 0 && (
        <ul className="mt-4 space-y-3">
          {imports.map((imp) => (
            <li key={imp.id} className="rounded-lg border border-line bg-panel-hi p-4">
              <ImportHeader imp={imp} onRetry={() => retry(imp)} onDismiss={() => setStatus(imp, 'dismissed')} />
              {imp.status === 'committed' && commitNotes[imp.id] && (
                <div className="mt-1 text-xs text-muted">{commitNotes[imp.id]}</div>
              )}
              {imp.status === 'parsed' && (
                <Review
                  imp={imp}
                  excluded={excluded[imp.id] ?? new Set()}
                  busy={committing === imp.id}
                  onToggle={(idx) => toggle(imp.id, idx)}
                  onCommit={() => void commit(imp)}
                  onDismiss={() => setStatus(imp, 'dismissed')}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

function DropZone({
  uploading,
  onFiles,
  onPickFolder,
}: {
  uploading: boolean
  onFiles: (f: FileList | File[]) => void
  onPickFolder: () => void
}) {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (e.dataTransfer.files.length) onFiles(e.dataTransfer.files)
      }}
      className={`rounded-lg border border-dashed p-6 text-center transition-colors ${
        over ? 'border-teal/60 bg-teal/5' : 'border-line'
      }`}
    >
      <p className="text-sm text-muted">
        {uploading ? 'Uploading…' : 'Drag statements here (PDF, CSV, scans)'}
      </p>
      <div className="mt-3 flex justify-center gap-2">
        <Button onClick={() => inputRef.current?.click()} disabled={uploading}>
          Choose files
        </Button>
        <Button variant="ghost" onClick={onPickFolder} disabled={uploading}>
          Choose a folder
        </Button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(e) => e.target.files && onFiles(e.target.files)}
      />
      <p className="mt-3 text-xs text-faint">
        Files go to your private storage; parsed by Claude server-side; you confirm before anything imports.
      </p>
    </div>
  )
}

function ImportHeader({
  imp,
  onRetry,
  onDismiss,
}: {
  imp: StatementImport
  onRetry: () => void
  onDismiss: () => void
}) {
  // A row in 'parsing'/'uploaded' past the Edge Function wall-clock limit is
  // effectively stuck — the parser can no longer be running — so treat it as
  // stalled and offer a retry, even if the function never recorded an error.
  const PARSE_STALE_MS = 150_000
  const inFlight = imp.status === 'uploaded' || imp.status === 'parsing'
  const stale = inFlight && Date.now() - new Date(imp.updated_at).getTime() > PARSE_STALE_MS

  const tone = imp.status === 'error' || stale
    ? 'text-coral'
    : imp.status === 'committed'
      ? 'text-teal'
      : 'text-muted'
  const label = stale
    ? 'Stalled'
    : inFlight
      ? 'Parsing…'
      : imp.status === 'parsed'
        ? 'Review'
        : imp.status === 'committed'
          ? 'Imported ✓'
          : imp.status === 'error'
            ? 'Error'
            : imp.status
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="truncate text-sm text-ink">{imp.file_name}</div>
        {imp.status === 'error' && imp.error && (
          <div className="mt-0.5 text-xs text-coral">{imp.error}</div>
        )}
        {stale && (
          <div className="mt-0.5 text-xs text-coral">Parsing didn't finish — large files can time out. Retry, or remove and split it up.</div>
        )}
      </div>
      <div className="flex items-center gap-3">
        <span className={`micro-label ${tone}`}>{label}</span>
        {(imp.status === 'error' || stale) && (
          <button type="button" onClick={onRetry} className="micro-label text-teal hover:text-ink">
            Retry
          </button>
        )}
        {imp.status !== 'parsed' && (
          <button type="button" onClick={onDismiss} className="micro-label text-faint hover:text-coral">
            Remove
          </button>
        )}
      </div>
    </div>
  )
}

function Review({
  imp,
  excluded,
  busy,
  onToggle,
  onCommit,
  onDismiss,
}: {
  imp: StatementImport
  excluded: Set<number>
  busy: boolean
  onToggle: (idx: number) => void
  onCommit: () => void
  onDismiss: () => void
}) {
  const cands = (imp.candidates as unknown as ImportCandidate[]) ?? []
  const summary = imp.summary as Summary
  const included = cands.length - excluded.size

  return (
    <div className="mt-3 border-t border-line pt-3">
      {summary?.institution && (
        <div className="mb-2 text-xs text-faint">
          {summary.institution}
          {summary.account_type ? ` · ${summary.account_type}` : ''}
          {summary.statement_date ? ` · ${summary.statement_date}` : ''}
        </div>
      )}
      <ul className="space-y-1.5">
        {cands.map((c, i) => {
          const on = !excluded.has(i)
          return (
            <li key={i} className="flex items-center gap-3">
              <input type="checkbox" checked={on} onChange={() => onToggle(i)} className="accent-teal" />
              <div className="min-w-0 flex-1">
                <span className="text-sm text-ink">{candLabel(c)}</span>
                <span className="ml-2 text-xs text-faint">{candDetail(c)}</span>
              </div>
              <span className={`micro-label ${confColor[c.confidence]}`}>{c.confidence}</span>
            </li>
          )
        })}
      </ul>
      <div className="mt-3 flex gap-2">
        <Button onClick={onCommit} disabled={included === 0 || busy}>
          {busy ? 'Importing…' : `Import ${included} ${included === 1 ? 'row' : 'rows'}`}
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={busy}>
          Discard
        </Button>
      </div>
    </div>
  )
}

function candLabel(c: ImportCandidate): string {
  if (c.row_type === 'liability') return c.label || (c.kind === 'mortgage' ? 'Mortgage' : 'Debt')
  const h = c as HoldingCandidate
  return h.symbol ? h.symbol.toUpperCase() : h.name || HOLDING_KIND_LABEL[(h.kind as HoldingKind) ?? 'cash']
}
function candDetail(c: ImportCandidate): string {
  if (c.row_type === 'liability') return c.balance != null ? fmtMoney(c.balance) : '—'
  const h = c as HoldingCandidate
  const amt = h.shares != null ? `${h.shares} sh` : h.amount != null ? fmtMoney(h.amount) : '—'
  return h.account_label ? `${amt} · ${h.account_label}` : amt
}
