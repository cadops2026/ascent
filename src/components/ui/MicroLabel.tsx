import type { ReactNode } from 'react'

/** Uppercase, letter-spaced micro-label (spec §6). */
export function MicroLabel({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`micro-label ${className}`}>{children}</div>
}
