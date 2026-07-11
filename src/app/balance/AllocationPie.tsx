import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { Panel, MicroLabel } from '../../components/ui'
import { fmtMoneyCompact, fmtPct } from '../../lib/format'
import type { ClassSlice, AssetClass } from '../../lib/finance/networth'

const CLASS_COLOR: Record<AssetClass, string> = {
  Equities: 'var(--color-teal)',
  Bonds: '#5E8BC4',
  Crypto: 'var(--color-amber)',
  'Real estate': 'var(--color-indigo)',
  Commodities: '#B98A3C',
  Private: '#6FB1A0',
  Cash: 'var(--color-muted)',
  Collectibles: 'var(--color-coral)',
}

export function AllocationPie({
  slices,
  investable,
  pendingQuotes,
}: {
  slices: ClassSlice[]
  investable: number
  pendingQuotes: number
}) {
  return (
    <Panel
      label="Allocation — investable"
      right={
        pendingQuotes > 0 ? (
          <MicroLabel className="text-amber">
            {pendingQuotes} pending quote{pendingQuotes > 1 ? 's' : ''}
          </MicroLabel>
        ) : undefined
      }
    >
      {investable <= 0 ? (
        <p className="py-10 text-center text-sm text-faint">
          Add holdings to see your allocation.
        </p>
      ) : (
        <div className="flex flex-col items-center gap-6 sm:flex-row">
          <div className="h-44 w-44 shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={slices}
                  dataKey="value"
                  nameKey="class"
                  innerRadius={52}
                  outerRadius={84}
                  startAngle={90}
                  endAngle={-270}
                  stroke="var(--color-bg)"
                  strokeWidth={2}
                  isAnimationActive={false}
                >
                  {slices.map((s) => (
                    <Cell key={s.class} fill={CLASS_COLOR[s.class]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </div>
          <ul className="w-full flex-1 space-y-2">
            {slices.map((s) => (
              <li key={s.class} className="flex items-center gap-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ background: CLASS_COLOR[s.class] }}
                />
                <span className="flex-1 truncate text-sm text-muted">{s.class}</span>
                <span className="tnum font-mono text-sm text-ink">{fmtPct(s.pct)}</span>
                <span className="tnum w-20 text-right font-mono text-xs text-faint">
                  {fmtMoneyCompact(s.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-faint">
        Primary residence excluded from investable allocation (invariant #11).
      </p>
    </Panel>
  )
}
