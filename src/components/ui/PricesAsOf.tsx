import { QUOTE_TTL_MS } from '../../lib/finance/quotes'

/** How current the priced figures are. Calm by default (invariant #6): a
 *  timestamp, never a red/green delta. Goes amber only when prices are stale
 *  enough that the numbers on screen may genuinely mislead. */
export function PricesAsOf({
  asOf,
  pricing,
  className = '',
}: {
  asOf: Date | null
  pricing?: boolean
  className?: string
}) {
  if (pricing) return <span className={`micro-label text-faint ${className}`}>Pricing…</span>
  if (!asOf) return null

  const ageMs = Date.now() - asOf.getTime()
  // One TTL is normal (that's the cache working). Flag only well past it, so a
  // quiet weekend or a vendor hiccup reads as "not current" rather than fine.
  const stale = ageMs > QUOTE_TTL_MS * 4
  const sameDay = asOf.toDateString() === new Date().toDateString()
  const when = sameDay
    ? asOf.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : asOf.toLocaleDateString([], { month: 'short', day: 'numeric' })

  return (
    <span className={`micro-label ${stale ? 'text-amber' : 'text-faint'} ${className}`}>
      Prices {when}
    </span>
  )
}
