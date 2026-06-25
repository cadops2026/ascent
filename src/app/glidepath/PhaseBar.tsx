/**
 * Three-phase timeline bar: full work → downshift bridge → drawdown, sized by
 * years. Presentational (pure props) so it render-tests in isolation. Teal =
 * earning, amber = bridge/caution, indigo = drawdown (one accent role each,
 * design system §6).
 */
export function PhaseBar({
  fullWork,
  bridge,
  horizon,
  startAge,
}: {
  fullWork: number
  bridge: number
  horizon: number
  startAge: number
}) {
  const drawdown = Math.max(0, horizon - fullWork - bridge)
  const seg = (label: string, yrs: number, color: string, fromAge: number) =>
    yrs > 0 ? (
      <div className="min-w-0" style={{ flexGrow: yrs }}>
        <div className={`h-2 rounded ${color}`} />
        <div className="mt-1.5 truncate text-xs text-muted">{label}</div>
        <div className="tnum font-mono text-[0.65rem] text-faint">age {fromAge} · {yrs}y</div>
      </div>
    ) : null
  return (
    <div className="flex gap-1.5">
      {seg('Full work', fullWork, 'bg-teal', startAge)}
      {seg('Downshift bridge', bridge, 'bg-amber', startAge + fullWork)}
      {seg('Drawdown', drawdown, 'bg-indigo', startAge + fullWork + bridge)}
    </div>
  )
}
