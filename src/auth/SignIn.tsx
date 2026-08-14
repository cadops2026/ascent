import { useState } from 'react'
import type { FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import { Wordmark } from '../app/Wordmark'

/**
 * Sign-in. Email + password is the primary path: it completes in-app with no
 * email round-trip, so it cannot be broken by a stale redirect URL, a consumed
 * one-time token, or the built-in email provider's 2-per-hour project-wide cap.
 *
 * The magic link is kept as a secondary option — it is genuinely useful on a
 * device where you don't want to type a password — but it is no longer the only
 * way in. Calm, single-purpose, one accent (design system §6).
 */

type Mode = 'password' | 'register' | 'link'
type Status = 'idle' | 'working' | 'sent' | 'error'

const MIN_PASSWORD = 8

export function SignIn() {
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const reset = (next: Mode) => {
    setMode(next)
    setStatus('idle')
    setError(null)
    setNotice(null)
  }

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setStatus('working')
    setError(null)
    setNotice(null)

    const addr = email.trim()

    if (mode === 'link') {
      const { error } = await supabase.auth.signInWithOtp({
        email: addr,
        options: { emailRedirectTo: window.location.origin },
      })
      if (error) {
        setError(error.message)
        setStatus('error')
      } else {
        setStatus('sent')
      }
      return
    }

    if (mode === 'register') {
      if (password.length < MIN_PASSWORD) {
        setError(`Use at least ${MIN_PASSWORD} characters.`)
        setStatus('error')
        return
      }
      const { data, error } = await supabase.auth.signUp({ email: addr, password })
      if (error) {
        setError(error.message)
        setStatus('error')
        return
      }
      // With email confirmations ON (the hosted default) signUp returns a user
      // but no session — the account is not usable until the link is opened.
      if (data.session) {
        setStatus('idle') // onAuthStateChange swaps this screen out
      } else {
        setStatus('sent')
        setNotice('Account created. Confirm it from the email we just sent, then sign in with your password.')
      }
      return
    }

    const { error } = await supabase.auth.signInWithPassword({ email: addr, password })
    if (error) {
      // Supabase deliberately returns one ambiguous error for wrong password,
      // unknown account, and an account that has no password set — so say so
      // rather than asserting which it was.
      setError(
        /invalid login credentials/i.test(error.message)
          ? 'That email and password did not match. If this account has only ever used a magic link, it has no password yet — use the link option below.'
          : error.message,
      )
      setStatus('error')
    }
    // On success onAuthStateChange replaces this screen; no state change needed.
  }

  const busy = status === 'working'

  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg px-6">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center gap-3 text-center">
          <Wordmark size="lg" />
          <p className="text-sm text-muted">Measure exposure, steer toward intent, stay calm.</p>
        </div>

        {status === 'sent' ? (
          <div className="rounded-[var(--radius-panel)] border border-line bg-panel p-6 text-center">
            <div className="micro-label mb-2 text-teal">Check your email</div>
            <p className="text-sm text-muted">
              {notice ?? (
                <>
                  A sign-in link is on its way to{' '}
                  <span className="font-mono text-ink">{email}</span>. Open it on this device.
                </>
              )}
            </p>
            <button
              type="button"
              onClick={() => reset('password')}
              className="micro-label mt-4 text-faint transition-colors hover:text-muted"
            >
              ← Back to sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="rounded-[var(--radius-panel)] border border-line bg-panel p-6">
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

            {mode !== 'link' && (
              <>
                <label className="micro-label mb-2 block" htmlFor="password">
                  Password
                </label>
                <input
                  id="password"
                  type="password"
                  required
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'register' ? `at least ${MIN_PASSWORD} characters` : '••••••••'}
                  className="mb-4 w-full rounded-lg border border-line bg-panel-hi px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-faint focus:border-teal/60"
                />
              </>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full rounded-lg bg-teal/15 px-3 py-2.5 text-sm font-medium text-teal transition-colors hover:bg-teal/25 disabled:opacity-50"
            >
              {busy
                ? 'Working…'
                : mode === 'register'
                  ? 'Create account'
                  : mode === 'link'
                    ? 'Send magic link'
                    : 'Sign in'}
            </button>

            {error && <p className="mt-3 text-sm leading-relaxed text-coral">{error}</p>}

            <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 border-t border-line pt-4">
              {mode !== 'password' && (
                <button type="button" onClick={() => reset('password')} className="micro-label text-faint transition-colors hover:text-muted">
                  Sign in with password
                </button>
              )}
              {mode !== 'register' && (
                <button type="button" onClick={() => reset('register')} className="micro-label text-faint transition-colors hover:text-muted">
                  Create account
                </button>
              )}
              {mode !== 'link' && (
                <button type="button" onClick={() => reset('link')} className="micro-label text-faint transition-colors hover:text-muted">
                  Email me a link
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
