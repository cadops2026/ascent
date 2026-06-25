import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Wordmark } from '../app/Wordmark'

/**
 * Passwordless sign-in via magic link (signInWithOtp). Calm, single-input.
 * The redirect must be allowlisted in the Supabase dashboard (Auth → URL config).
 */
export function SignIn() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('sending')
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    })
    if (error) {
      setError(error.message)
      setStatus('error')
    } else {
      setStatus('sent')
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Wordmark size="lg" />
          <p className="text-sm text-muted">
            Measure exposure, steer toward intent, stay calm.
          </p>
        </div>

        {status === 'sent' ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-6 text-center">
            <div className="micro-label mb-2 text-teal">Check your email</div>
            <p className="text-sm text-muted">
              A sign-in link is on its way to{' '}
              <span className="font-mono text-ink">{email}</span>. Open it on this device.
            </p>
          </div>
        ) : (
          <form
            onSubmit={onSubmit}
            className="rounded-[var(--radius-panel)] border border-line bg-panel p-6"
          >
            <label className="micro-label mb-2 block" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="mb-4 w-full rounded-lg border border-line bg-panel-hi px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-teal/60"
            />
            <button
              type="submit"
              disabled={status === 'sending'}
              className="w-full rounded-lg bg-teal/15 px-3 py-2.5 text-sm font-medium text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
            >
              {status === 'sending' ? 'Sending…' : 'Send magic link'}
            </button>
            {error && <p className="mt-3 text-sm text-coral">{error}</p>}
          </form>
        )}
      </div>
    </div>
  )
}
