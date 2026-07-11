import { ComposedChart, Area, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts'
import { fmtMoneyCompact } from '../../lib/format'

/** One point on the real-dollar wealth path: an age, the P10 floor (`lo`),
 *  the P10→P90 `span` stacked above it, the median (`p50`), and the 1-in-100
 *  deep-tail floor (`p01`) — where the fat-tailed years show up. */
export interface WealthPathPoint {
  age: number
  lo: number
  span: number
  p50: number
  p01: number
}

/**
 * Presentational P10–P90 wealth-path band + median line. Pure props in, no data
 * fetching — so it render-tests in isolation (the band is a stacked Area: a
 * transparent `lo` floor with the filled `span` on top). Muted, no
 * animation-on-data (design system §6).
 */
export function WealthPathChart({ data }: { data: WealthPathPoint[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
          <XAxis dataKey="age" stroke="var(--color-faint)" tick={{ fontSize: 11 }} tickLine={false} />
          <YAxis
            stroke="var(--color-faint)"
            tick={{ fontSize: 11 }}
            tickLine={false}
            width={52}
            tickFormatter={(v: number) => fmtMoneyCompact(v)}
          />
          <Area dataKey="lo" stackId="band" stroke="none" fill="transparent" isAnimationActive={false} />
          <Area dataKey="span" stackId="band" stroke="none" fill="var(--color-indigo-soft)" isAnimationActive={false} />
          <Line dataKey="p50" stroke="var(--color-teal)" strokeWidth={2} dot={false} isAnimationActive={false} />
          {/* 1-in-100 deep-tail floor — where the fat tails show (below the P10 band). */}
          <Line
            dataKey="p01"
            stroke="var(--color-coral)"
            strokeWidth={1}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
