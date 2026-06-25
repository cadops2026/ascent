import type { ReactNode } from 'react'
import { MicroLabel } from './MicroLabel'

/**
 * Base container. Hairline border, calm panel surface, breathable padding.
 * Optional micro-label header with an optional right-aligned slot (e.g. assumptions).
 */
export function Panel({
  label,
  right,
  children,
  className = '',
  padded = true,
}: {
  label?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}) {
  return (
    <section
      className={`rounded-[var(--radius-panel)] border border-line bg-panel ${
        padded ? 'p-5' : ''
      } ${className}`}
    >
      {(label || right) && (
        <header className="mb-4 flex items-center justify-between gap-3">
          {label ? <MicroLabel>{label}</MicroLabel> : <span />}
          {right}
        </header>
      )}
      {children}
    </section>
  )
}
