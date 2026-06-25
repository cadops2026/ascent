type Size = 'sm' | 'lg'

const markPx: Record<Size, number> = { sm: 22, lg: 34 }
const textClass: Record<Size, string> = { sm: 'text-lg', lg: 'text-2xl' }

/** ASCENT mark — a rising line to a peak — plus the wordmark in Space Grotesk. */
export function Wordmark({ size = 'sm' }: { size?: Size }) {
  const px = markPx[size]
  return (
    <div className="flex items-center gap-2.5">
      <svg width={px} height={px} viewBox="0 0 32 32" aria-hidden="true">
        <rect width="32" height="32" rx="7" fill="var(--color-panel-hi)" />
        <path
          d="M7 23 L16 9 L25 23"
          fill="none"
          stroke="var(--color-teal)"
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
      <span
        className={`font-display font-semibold tracking-[0.18em] text-ink ${textClass[size]}`}
      >
        ASCENT
      </span>
    </div>
  )
}
