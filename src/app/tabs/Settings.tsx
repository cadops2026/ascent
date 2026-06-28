import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel } from '../../components/ui'
import { Button, Input } from '../../components/ui'
import { PageHeader } from './PhasePlaceholder'
import { supabaseConfigured, env } from '../../lib/env'
import { useAuth } from '../../auth/AuthProvider'
import { exportUserData, deleteAllUserData, deleteAccount } from '../../lib/userData'
import { TaxParamsEditor } from '../tax/TaxParamsEditor'
import { CmaParamsEditor } from '../tax/CmaParamsEditor'
import { MacroAssumptionsEditor } from '../tax/MacroAssumptionsEditor'

function Row({ label, value, tone = 'ink' }: { label: string; value: string; tone?: 'ink' | 'teal' | 'amber' }) {
  const toneClass = tone === 'teal' ? 'text-teal' : tone === 'amber' ? 'text-amber' : 'text-ink'
  return (
    <div className="flex items-center justify-between border-b border-line py-2.5 last:border-0">
      <MicroLabel>{label}</MicroLabel>
      <span className={`font-mono text-sm ${toneClass}`}>{value}</span>
    </div>
  )
}

export function Settings() {
  const { session, signOut } = useAuth()
  const host = supabaseConfigured ? new URL(env.supabaseUrl).host : '—'

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Settings" phase="P0" />

      <Panel label="Data sources" className="mt-6">
        <Row label="Supabase" value={supabaseConfigured ? 'Connected' : 'Not configured'} tone={supabaseConfigured ? 'teal' : 'amber'} />
        <Row label="Project host" value={host} />
        <Row label="Signed in as" value={session?.user.email ?? '—'} />
        <p className="mt-4 text-xs leading-relaxed text-faint">
          The browser talks to Supabase only. Market &amp; econ data keys (Finnhub, CoinGecko, FMP,
          FRED) live in Supabase secrets and are read solely by Edge Functions — never shipped to
          the client. Account aggregation is deferred (manual-entry-first).
        </p>
      </Panel>

      <div className="mt-5">
        <TaxParamsEditor />
      </div>

      <div className="mt-5">
        <CmaParamsEditor />
      </div>

      <div className="mt-5">
        <MacroAssumptionsEditor />
      </div>

      <Panel label="Holdings data" className="mt-5">
        <p className="text-sm leading-relaxed text-muted">
          Clear every holding to start the balance sheet over. Accounts, properties, and plans are kept —
          only holdings are removed. This can&rsquo;t be undone, so it takes two steps.
        </p>
        <ClearHoldings userId={session?.user.id} />
      </Panel>

      <Panel label="Privacy" className="mt-5">
        <p className="text-sm leading-relaxed text-muted">
          Read-only connections; the browser talks to Supabase only. You own your data — export a
          full copy anytime, or delete all of it (invariant #10).
        </p>
        <PrivacyControls
          email={session?.user.email}
          userId={session?.user.id}
          onDeleted={signOut}
        />
      </Panel>
    </div>
  )
}

function ClearHoldings({ userId }: { userId: string | undefined }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const clear = async () => {
    if (!userId) return
    setBusy(true)
    setError(null)
    const { error } = await supabase.from('holdings').delete().eq('user_id', userId)
    setBusy(false)
    if (error) {
      setError(error.message)
      return
    }
    setConfirming(false)
    setDone(true)
  }

  if (done) {
    return <p className="mt-4 text-sm text-teal">All holdings removed — re-open the Balance Sheet to confirm.</p>
  }

  return (
    <div className="mt-4">
      {!confirming ? (
        <Button variant="danger" onClick={() => setConfirming(true)} disabled={!userId}>
          Clear all holdings
        </Button>
      ) : (
        <div className="rounded-lg border border-coral/40 bg-coral/5 p-4">
          <p className="text-sm text-ink">
            Remove every holding? Accounts, properties, and plans stay — only holdings are deleted. This
            can&rsquo;t be undone.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <Button variant="danger" onClick={() => void clear()} disabled={busy}>
              {busy ? 'Removing…' : 'Yes, remove all holdings'}
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
          {error && <p className="mt-3 text-sm text-coral">{error}</p>}
        </div>
      )}
    </div>
  )
}

function PrivacyControls({
  email,
  userId,
  onDeleted,
}: {
  email: string | undefined
  userId: string | undefined
  onDeleted: () => void
}) {
  const [busy, setBusy] = useState<null | 'export' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmText, setConfirmText] = useState('')

  const onExport = async () => {
    setError(null)
    setBusy('export')
    try {
      await exportUserData(email)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setBusy(null)
    }
  }

  const onDelete = async () => {
    if (!userId) return
    setError(null)
    setBusy('delete')
    try {
      // Full deletion (storage + rows + login). If the function isn't deployed,
      // fall back to wiping the data rows + files so nothing is left behind.
      try {
        await deleteAccount()
      } catch {
        await deleteAllUserData(userId)
      }
      onDeleted() // sign out — the account/data is gone
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={onExport} disabled={busy !== null}>
          {busy === 'export' ? 'Exporting…' : 'Export my data (JSON)'}
        </Button>
        {!confirming ? (
          <Button variant="danger" onClick={() => setConfirming(true)} disabled={busy !== null}>
            Delete my account
          </Button>
        ) : null}
      </div>

      {confirming && (
        <div className="rounded-lg border border-coral/40 bg-coral/5 p-4">
          <p className="text-sm text-ink">
            This permanently deletes your account and all of it — every holding, account, property, plan,
            alert, uploaded file, and your login itself. This can't be undone.
          </p>
          <p className="mt-3">
            <MicroLabel className="text-faint">
              Type <span className="font-mono text-coral">DELETE</span> to confirm
            </MicroLabel>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="max-w-[10rem]"
            />
            <Button
              variant="danger"
              onClick={onDelete}
              disabled={confirmText !== 'DELETE' || busy !== null}
            >
              {busy === 'delete' ? 'Deleting…' : 'Permanently delete'}
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setConfirming(false)
                setConfirmText('')
              }}
              disabled={busy !== null}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="text-sm text-coral">{error}</p>}
    </div>
  )
}
