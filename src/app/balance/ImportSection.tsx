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

export function ImportSection({ userId, reload }: { userId: string; reload: () => Promise<void> }) {
  const [imports, setImports] = useState<StatementImport[]>([])
  const [uploading, setUploading] = useState(false)
  const [excluded, setExcluded] = useState<Record<string, Set<number>>>({})
  const folderRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('statement_imports')
      .select('*')
      .neq('status', 'dismissed')
      .order('created_at', { ascending: false })
    setImports(data ?? [])
  }, [])

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
      void supabase.functions.invoke('parse-statements', { body: { import_id: ins.id } })
    }
    setUploading(false)
    await load()
  }

  const toggle = (importId: string, idx: number) =>
    setExcluded((prev) => {
      const set = new Set(prev[importId] ?? [])
      if (set.has(idx)) set.delete(idx)
      else set.add(idx)
      return { ...prev, [importId]: set }
    })

  const commit = async (imp: StatementImport) => {
    const cands = (imp.candidates as unknown as ImportCandidate[]) ?? []
    const ex = excluded[imp.id] ?? new Set<number>()
    const summary = imp.summary as Summary

    let accountId: string | null = null
    if (summary?.institution) {
      const tax: TaxType = (TAX_TYPES as readonly string[]).includes(summary.account_type ?? '')
        ? (summary.account_type as TaxType)
        : 'taxable'
      const { data: acc } = await supabase
        .from('accounts')
        .insert({ user_id: userId, name: summary.institution, tax_type: tax })
        .select('id')
        .single()
      accountId = acc?.id ?? null
    }

    for (let i = 0; i < cands.length; i++) {
      if (ex.has(i)) continue
      const c = cands[i]
      if (!c) continue
      if (c.row_type === 'holding') {
        const hasShares = c.shares != null
        const hasAmount = c.amount != null
        if (!hasShares && !hasAmount) continue
        await supabase.from('holdings').insert({
          user_id: userId,
          account_id: accountId,
          kind: c.kind,
          entry_mode: hasShares ? 'shares' : 'amount',
          symbol: c.symbol ? c.symbol.toUpperCase() : null,
          name: c.name ?? null,
          shares: hasShares ? c.shares! : null,
          manual_amount: hasShares ? null : c.amount!,
          cost_basis: c.cost_basis ?? null,
        })
      } else {
        await supabase.from('liabilities').insert({
          user_id: userId,
          label: c.label ?? 'Imported liability',
          kind: c.kind,
          orig_balance: c.balance ?? 0,
          rate: c.rate ?? null,
        })
      }
    }
    await supabase.from('statement_imports').update({ status: 'committed' }).eq('id', imp.id)
    await load()
    await reload()
  }

  const setStatus = async (imp: StatementImport, status: string) => {
    await supabase.from('statement_imports').update({ status }).eq('id', imp.id)
    await load()
  }
  const retry = async (imp: StatementImport) => {
    await supabase.from('statement_imports').update({ status: 'parsing', error: null }).eq('id', imp.id)
    void supabase.functions.invoke('parse-statements', { body: { import_id: imp.id } })
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

      {imports.length > 0 && (
        <ul className="mt-4 space-y-3">
          {imports.map((imp) => (
            <li key={imp.id} className="rounded-lg border border-line bg-panel-hi p-4">
              <ImportHeader imp={imp} onRetry={() => retry(imp)} onDismiss={() => setStatus(imp, 'dismissed')} />
              {imp.status === 'parsed' && (
                <Review
                  imp={imp}
                  excluded={excluded[imp.id] ?? new Set()}
                  onToggle={(idx) => toggle(imp.id, idx)}
                  onCommit={() => commit(imp)}
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
  const tone =
    imp.status === 'error' ? 'text-coral' : imp.status === 'committed' ? 'text-teal' : 'text-muted'
  const label =
    imp.status === 'uploaded' || imp.status === 'parsing'
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
      </div>
      <div className="flex items-center gap-3">
        <span className={`micro-label ${tone}`}>{label}</span>
        {imp.status === 'error' && (
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
  onToggle,
  onCommit,
  onDismiss,
}: {
  imp: StatementImport
  excluded: Set<number>
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
        <Button onClick={onCommit} disabled={included === 0}>
          Import {included} {included === 1 ? 'row' : 'rows'}
        </Button>
        <Button variant="ghost" onClick={onDismiss}>
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
  if (h.shares != null) return `${h.shares} sh`
  if (h.amount != null) return fmtMoney(h.amount)
  return '—'
}
