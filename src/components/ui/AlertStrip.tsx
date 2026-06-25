import type { ReactNode } from 'react'

type AlertTone = 'info' | 'caution' | 'negative'

const toneRing: Record<AlertTone, string> = {
  info: 'border-indigo/40',
  caution: 'border-amber/40',
  negative: 'border-coral/40',
}
const toneDot: Record<AlertTone, string> = {
  info: 'bg-indigo',
  caution: 'bg-amber',
  negative: 'bg-coral',
}

/**
 * A single sparse, dismissible alert row. Alerts are low-frequency,
 * pre-committed and threshold/event-driven — never price-triggered (invariant #7).
 */
export function AlertStrip({
  tone = 'info',
  children,
  onDismiss,
}: {
  tone?: AlertTone
  children: ReactNode
  onDismiss?: () => void
}) {
  return (
    <div
      className={`flex items-center gap-3 rounded-[var(--radius-panel)] border ${toneRing[tone]} bg-panel-hi px-4 py-3`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${toneDot[tone]}`} />
      <div className="flex-1 text-sm text-ink">{children}</div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="micro-label text-faint transition-colors hover:text-muted"
        >
          Dismiss
        </button>
      )}
    </div>
  )
}
