import { Panel, MicroLabel } from '../../components/ui'
import { PageHeader } from './PhasePlaceholder'
import { supabaseConfigured, env } from '../../lib/env'
import { useAuth } from '../../auth/AuthProvider'

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
  const { session } = useAuth()
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

      <Panel label="Assumptions" className="mt-5">
        <p className="text-sm text-muted">
          Inflation curve, consensus CMA, and Monte Carlo assumptions become visible and editable
          here as the projection engine arrives in <span className="font-mono text-faint">P3</span>.
        </p>
      </Panel>

      <Panel label="Privacy" className="mt-5">
        <p className="text-sm text-muted">
          Read-only connections; data deletion supported. Export &amp; delete-all controls arrive
          with the data layer.
        </p>
      </Panel>
    </div>
  )
}
