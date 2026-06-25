import { AuthProvider, useAuth } from './auth/AuthProvider'
import { SignIn } from './auth/SignIn'
import { AppShell } from './app/AppShell'
import { Wordmark } from './app/Wordmark'
import { supabaseConfigured } from './lib/env'

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <div className="animate-pulse">
        <Wordmark size="lg" />
      </div>
    </div>
  )
}

function NotConfigured() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md text-center">
        <div className="mb-8 flex justify-center">
          <Wordmark size="lg" />
        </div>
        <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-6 text-left">
          <div className="micro-label mb-3 text-amber">Connect Supabase</div>
          <p className="mb-4 text-sm text-muted">
            Create <span className="font-mono text-ink">.env.local</span> from{' '}
            <span className="font-mono text-ink">.env.example</span> and set:
          </p>
          <pre className="overflow-x-auto rounded-lg border border-line bg-panel-hi p-3 font-mono text-xs text-muted">
            {`VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>`}
          </pre>
          <p className="mt-4 text-xs text-faint">
            Both are public — the anon key is gated by Row-Level Security. Then restart the dev
            server.
          </p>
        </div>
      </div>
    </div>
  )
}

function Gate() {
  const { session, loading } = useAuth()
  if (loading) return <Splash />
  return session ? <AppShell /> : <SignIn />
}

export default function App() {
  if (!supabaseConfigured) return <NotConfigured />
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  )
}
