import { fmtMoney, fmtMoneyCompact, fmtPct } from '../../lib/format'
import { MicroLabel } from './MicroLabel'

type FigFormat = 'money' | 'moneyCompact' | 'percent' | 'raw'
type Accent = 'ink' | 'teal' | 'indigo' | 'amber' | 'coral'
type Size = 'sm' | 'md' | 'lg' | 'hero'

const accentClass: Record<Accent, string> = {
  ink: 'text-ink',
  teal: 'text-teal',
  indigo: 'text-indigo',
  amber: 'text-amber',
  coral: 'text-coral',
}

const sizeClass: Record<Size, string> = {
  sm: 'text-xl',
  md: 'text-3xl',
  lg: 'text-5xl',
  hero: 'text-6xl md:text-7xl',
}

function render(value: number, format: FigFormat): string {
  switch (format) {
    case 'money':
      return fmtMoney(value)
    case 'moneyCompact':
      return fmtMoneyCompact(value)
    case 'percent':
      return fmtPct(value)
    case 'raw':
      return String(value)
  }
}

/**
 * The hero of the design system: a mono numeral that, by invariant #4, ALWAYS
 * carries its band + confidence when the figure is a projection. For a measured
 * (not projected) figure, omit `band` — measured ≠ projected.
 */
export function Figure({
  label,
  value,
  display,
  format = 'money',
  band,
  confidence,
  accent = 'ink',
  size = 'lg',
  sublabel,
}: {
  /** Uppercase micro-label above the numeral. */
  label?: string
  /** Numeric value; ignored if `display` is given. */
  value?: number
  /** Pre-formatted string to show instead of formatting `value`. */
  display?: string
  format?: FigFormat
  /** Confidence band — its presence signals "this is a projection". */
  band?: { low: number; high: number }
  /** e.g. "P25–P75" or "80% confidence". Shown beside the band. */
  confidence?: string
  accent?: Accent
  size?: Size
  sublabel?: string
}) {
  const main = display ?? (value !== undefined ? render(value, format) : '—')

  return (
    <div className="flex flex-col gap-1.5">
      {label && <MicroLabel>{label}</MicroLabel>}
      <div className={`tnum font-mono font-medium leading-none ${accentClass[accent]} ${sizeClass[size]}`}>
        {main}
      </div>

      {band && (
        <div className="mt-1 flex items-baseline gap-2 text-sm">
          <span className="tnum font-mono text-muted">
            {render(band.low, format)} – {render(band.high, format)}
          </span>
          {confidence && <span className="micro-label text-faint">{confidence}</span>}
        </div>
      )}

      {sublabel && <div className="text-sm text-muted">{sublabel}</div>}
    </div>
  )
}
