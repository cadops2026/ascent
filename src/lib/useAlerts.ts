import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from './supabase'
import { useAuth } from '../auth/AuthProvider'
import type { AlertSeverity, EvaluatedAlert } from './finance/alertengine'

/**
 * Persisted alerts (the `alerts` table). The evaluate-alerts cron writes the
 * monthly digest here; the app reads it for the Dashboard strip and persists
 * dismisses across sessions. Keyed by `${kind}|${title}` with the same dedupe
 * window the cron uses, so the in-app digest and the scheduled one agree
 * (invariant #1) and a dismissed alert stays quiet for the period (#6/#7).
 */
const DEDUPE_WINDOW_DAYS = 28

export interface PersistedAlert {
  id: string
  kind: string
  severity: AlertSeverity
  title: string
  detail: string
  createdAt: string
  dismissedAt: string | null
}

export const alertKey = (kind: string, title: string) => `${kind}|${title}`

interface AlertRow {
  id: string
  kind: string
  payload: { severity?: AlertSeverity; title?: string; detail?: string } | null
  created_at: string
  dismissed_at: string | null
}

function toAlert(r: AlertRow): PersistedAlert {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.payload?.severity ?? 'info',
    title: r.payload?.title ?? r.kind,
    detail: r.payload?.detail ?? '',
    createdAt: r.created_at,
    dismissedAt: r.dismissed_at,
  }
}

export interface AlertsState {
  /** Open (un-dismissed) persisted alerts — the delivered digest, for the Dashboard. */
  open: PersistedAlert[]
  /** `${kind}|${title}` dismissed within the window — filters the Risk tab's live digest. */
  dismissedKeys: Set<string>
  /** Persist a dismiss (cross-session). Accepts a live or persisted alert. */
  dismiss: (a: EvaluatedAlert | PersistedAlert) => Promise<void>
  loading: boolean
  reload: () => Promise<void>
}

export function useAlerts(): AlertsState {
  const { session } = useAuth()
  const [rows, setRows] = useState<PersistedAlert[]>([])
  const [loading, setLoading] = useState(true)

  const reload = useCallback(async () => {
    try {
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString()
      const { data, error } = await supabase
        .from('alerts')
        .select('id, kind, payload, created_at, dismissed_at')
        .gte('created_at', since)
        .order('created_at', { ascending: false })
      if (error || !data) setRows([])
      else setRows((data as AlertRow[]).map(toAlert))
    } catch {
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const open = useMemo(() => rows.filter((r) => r.dismissedAt == null), [rows])

  const dismissedKeys = useMemo(() => {
    const cutoff = Date.now() - DEDUPE_WINDOW_DAYS * 24 * 3600 * 1000
    const keys = new Set<string>()
    for (const r of rows) {
      if (r.dismissedAt != null && new Date(r.dismissedAt).getTime() >= cutoff) {
        keys.add(alertKey(r.kind, r.title))
      }
    }
    return keys
  }, [rows])

  const dismiss = useCallback(
    async (a: EvaluatedAlert | PersistedAlert) => {
      const uid = session?.user.id
      if (!uid) return
      const nowIso = new Date().toISOString()
      // Optimistic: hide it now; persist a dismissed row so it stays quiet for the
      // period (the cron's window-dedupe then won't re-insert it either).
      setRows((prev) => {
        const next = prev.map((r) =>
          r.kind === a.kind && r.title === a.title && r.dismissedAt == null
            ? { ...r, dismissedAt: nowIso }
            : r,
        )
        const existed = prev.some((r) => r.kind === a.kind && r.title === a.title)
        if (!existed) {
          next.unshift({
            id: `local-${a.kind}-${nowIso}`,
            kind: a.kind,
            severity: a.severity,
            title: a.title,
            detail: a.detail,
            createdAt: nowIso,
            dismissedAt: nowIso,
          })
        }
        return next
      })
      // Resolve an existing open row if present; otherwise record the dismiss.
      const { data: updated } = await supabase
        .from('alerts')
        .update({ dismissed_at: nowIso })
        .eq('kind', a.kind)
        .eq('payload->>title', a.title)
        .is('dismissed_at', null)
        .select('id')
      if (!updated || updated.length === 0) {
        await supabase.from('alerts').insert({
          user_id: uid,
          kind: a.kind,
          payload: { severity: a.severity, title: a.title, detail: a.detail },
          dismissed_at: nowIso,
        })
      }
    },
    [session],
  )

  return { open, dismissedKeys, dismiss, loading, reload }
}
