import type { ReactNode } from 'react'
import { Panel } from './Panel'
import { Figure } from './Figure'

/**
 * A panel built around one Figure. Calm by default: there is deliberately no
 * red/green daily-delta slot here (invariant #6). Use `note` for a quiet,
 * neutral sublabel and `right` for assumptions/controls.
 */
export function StatCard({
  label,
  value,
  display,
  format,
  band,
  confidence,
  accent,
  size = 'md',
  note,
  right,
}: {
  label: string
  value?: number
  display?: string
  format?: 'money' | 'moneyCompact' | 'percent' | 'raw'
  band?: { low: number; high: number }
  confidence?: string
  accent?: 'ink' | 'teal' | 'indigo' | 'amber' | 'coral'
  size?: 'sm' | 'md' | 'lg' | 'hero'
  note?: string
  right?: ReactNode
}) {
  return (
    <Panel>
      <div className="flex items-start justify-between gap-3">
        <Figure
          label={label}
          {...(value !== undefined ? { value } : {})}
          {...(display !== undefined ? { display } : {})}
          {...(format !== undefined ? { format } : {})}
          {...(band !== undefined ? { band } : {})}
          {...(confidence !== undefined ? { confidence } : {})}
          {...(accent !== undefined ? { accent } : {})}
          size={size}
          {...(note !== undefined ? { sublabel: note } : {})}
        />
        {right}
      </div>
    </Panel>
  )
}
