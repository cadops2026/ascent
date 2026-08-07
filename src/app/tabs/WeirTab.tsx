// WEIR tab — frames the standalone WEIR research dashboard (owner decision 2026-08-07,
// recorded in WEIR's CLAUDE.md + ascent-weir-bridge.md). Browser-level composition, not
// integration: separate repo, separate Supabase account, separate login. ASCENT holds
// this URL and nothing else — nothing rendered in the frame enters ASCENT's data,
// engines, or alerts, and adopting any position remains a manual act by the user.
const WEIR_URL = 'http://localhost:5180'

export function WeirTab() {
  return (
    <div className="flex h-[calc(100dvh-170px)] min-h-[480px] flex-col gap-3">
      <div>
        <h1 className="text-lg font-semibold">WEIR</h1>
        <p className="text-sm text-muted">
          Research instrument in its own app, own login. It proposes; nothing here touches the
          portfolio — adoption stays a deliberate manual act.
        </p>
      </div>
      <iframe
        src={WEIR_URL}
        title="WEIR dashboard"
        className="w-full flex-1 rounded-lg border border-line bg-panel"
      />
      <p className="text-xs text-faint">
        Blank frame? The WEIR dashboard is local-first — start it on this Mac (it serves on
        localhost:5180), then reopen this tab.
      </p>
    </div>
  )
}
