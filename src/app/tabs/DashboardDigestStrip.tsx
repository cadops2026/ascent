import { AlertStrip } from '../../components/ui'
import type { TabId } from '../nav'
import type { PersistedAlert } from '../../lib/useAlerts'

const SEV_RANK = { high: 3, caution: 2, info: 1 } as const

/**
 * Calm digest pointer for the Dashboard — the delivered (persisted) alerts,
 * sparse and never a price move (invariant #7). Presentational (pure props) so
 * it render-tests in isolation. The full digest + dismiss live on the Risk tab.
 */
export function DashboardDigestStrip({
  alerts,
  onNavigate,
}: {
  alerts: PersistedAlert[]
  onNavigate?: ((id: TabId) => void) | undefined
}) {
  if (alerts.length === 0) return null
  const top = [...alerts].sort((a, b) => SEV_RANK[b.severity] - SEV_RANK[a.severity])[0]!
  const tone = top.severity === 'high' ? 'negative' : top.severity === 'caution' ? 'caution' : 'info'

  return (
    <div className="mt-5">
      <AlertStrip tone={tone}>
        <span className="text-ink">
          {alerts.length} {alerts.length === 1 ? 'item' : 'items'} in your digest
        </span>{' '}
        <span className="text-muted">— {top.title}.</span>{' '}
        {onNavigate && (
          <button
            type="button"
            onClick={() => onNavigate('risk')}
            className="micro-label text-faint transition-colors hover:text-muted"
          >
            Review on Risk &amp; Exposure →
          </button>
        )}
      </AlertStrip>
    </div>
  )
}
