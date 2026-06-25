import { useState } from 'react'
import { TABS } from './nav'
import type { TabId } from './nav'
import { Wordmark } from './Wordmark'
import { useAuth } from '../auth/AuthProvider'
import { Dashboard } from './tabs/Dashboard'
import { Settings } from './tabs/Settings'
import { PhasePlaceholder } from './tabs/PhasePlaceholder'
import { BalanceSheet } from './balance/BalanceSheet'
import { LookThroughTab } from './lookthrough/LookThroughTab'
import { ProjectionTab } from './projection/ProjectionTab'
import { WorkGlidePathTab } from './glidepath/WorkGlidePathTab'

export function AppShell() {
  const [active, setActive] = useState<TabId>('dashboard')
  const { session, signOut } = useAuth()
  const tab = TABS.find((t) => t.id === active) ?? TABS[0]!

  const navButton = (id: TabId, label: string, live: boolean) => {
    const isActive = id === active
    return (
      <button
        key={id}
        type="button"
        onClick={() => setActive(id)}
        className={`whitespace-nowrap rounded-lg px-3 py-2 text-left text-sm transition-colors ${
          isActive ? 'bg-panel-hi text-ink' : 'text-muted hover:text-ink'
        }`}
      >
        <span className="flex items-center gap-2">
          {label}
          {!live && (
            <span className="micro-label rounded bg-panel px-1.5 py-0.5 text-[0.6rem] text-faint">
              {TABS.find((t) => t.id === id)?.phase}
            </span>
          )}
        </span>
      </button>
    )
  }

  return (
    <div className="min-h-dvh bg-bg text-ink">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-line px-5 py-3.5">
        <Wordmark />
        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-xs text-faint sm:inline">
            {session?.user.email}
          </span>
          <button
            type="button"
            onClick={signOut}
            className="micro-label text-faint transition-colors hover:text-muted"
          >
            Sign out
          </button>
        </div>
      </header>

      {/* Mobile tab bar — glance-first */}
      <nav className="flex gap-1 overflow-x-auto border-b border-line px-3 py-2 md:hidden">
        {TABS.map((t) => navButton(t.id, t.label, t.live))}
      </nav>

      <div className="mx-auto flex w-full max-w-[1400px]">
        {/* Desktop left rail */}
        <nav className="hidden w-56 shrink-0 flex-col gap-1 border-r border-line p-3 md:flex">
          {TABS.map((t) => navButton(t.id, t.label, t.live))}
        </nav>

        {/* Content */}
        <main className="min-w-0 flex-1 p-5 md:p-8">
          {tab.id === 'dashboard' ? (
            <Dashboard />
          ) : tab.id === 'balance' ? (
            <BalanceSheet />
          ) : tab.id === 'lookthrough' ? (
            <LookThroughTab />
          ) : tab.id === 'projection' ? (
            <ProjectionTab />
          ) : tab.id === 'glide' ? (
            <WorkGlidePathTab />
          ) : tab.id === 'settings' ? (
            <Settings />
          ) : (
            <PhasePlaceholder def={tab} />
          )}
        </main>
      </div>
    </div>
  )
}
