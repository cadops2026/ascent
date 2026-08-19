import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, ReferenceLine } from 'recharts'
import { Panel, MicroLabel } from '../../components/ui'
import { fmtPct } from '../../lib/format'
import { PERIODS } from '../../lib/finance/youindex'
import type { YouIndex, PeriodKey } from '../../lib/finance/youindex'

const signed = (x: number) => `${x > 0 ? '+' : ''}${fmtPct(x)}`

export function YouIndexPanel({
  index,
  period,
  onPeriod,
  loading,
}: {
  index: YouIndex
  period: PeriodKey
  onPeriod: (p: PeriodKey) => void
  loading?: boolean
}) {
  const ahead = index.you >= index.bench

  return (
    <Panel
      label="You Index"
      right={
        <div className="flex gap-2">
          {PERIODS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => onPeriod(p.key)}
              className={`micro-label ${period === p.key ? 'text-teal' : 'text-faint hover:text-muted'}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      }
    >
      {loading ? (
        <p className="py-8 text-sm text-faint">Loading…</p>
      ) : !index.points.length ? (
        <p className="max-w-prose py-6 text-sm text-faint">
          No price history yet for your holdings — it builds on the next refresh.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-10">
            <div>
              <MicroLabel className="text-faint">You</MicroLabel>
              <div
                className={`tnum font-mono text-4xl font-medium leading-none ${ahead ? 'text-teal' : 'text-ink'}`}
              >
                {signed(index.you)}
              </div>
            </div>
            <div>
              <MicroLabel className="text-faint">{index.benchmark}</MicroLabel>
              <div className="tnum font-mono text-2xl leading-none text-muted">
                {signed(index.bench)}
              </div>
            </div>
          </div>

          <div className="mt-5 h-56 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={index.points} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
                <XAxis
                  dataKey="date"
                  stroke="var(--color-faint)"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  minTickGap={48}
                  tickFormatter={(d: string) => d.slice(5)}
                />
                <YAxis
                  stroke="var(--color-faint)"
                  tick={{ fontSize: 11 }}
                  tickLine={false}
                  width={48}
                  tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
                />
                <ReferenceLine y={0} stroke="var(--color-line)" />
                <Line
                  dataKey="bench"
                  stroke="var(--color-faint)"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  dataKey="you"
                  stroke="var(--color-teal)"
                  strokeWidth={2}
                  dot={false}
                  isAnimationActive={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <p className="mt-3 text-sm text-faint">
            Your {index.covered} priced holdings at today's share counts, versus {index.benchmark}
            {index.live ? ', current to the last price refresh' : ', through the last daily close'}.
            Shows how what you hold now would have tracked — not a record of your past trades.
            {index.skipped > 0 && ` ${index.skipped} without full history left out.`}
          </p>
        </>
      )}
    </Panel>
  )
}
