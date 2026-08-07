import { lazy, Suspense, useState } from 'react'
import { TABS } from './nav'
import type { TabId } from './nav'
import { Wordmark } from './Wordmark'
import { useAuth } from '../auth/AuthProvider'
import { PhasePlaceholder } from './tabs/PhasePlaceholder'

// Lazy-loaded so the chart-heavy tabs (Recharts) and their engines stay out of
// the initial/sign-in bundle — each tab is fetched only when first opened.
const Dashboard = lazy(() => import('./tabs/Dashboard').then((m) => ({ default: m.Dashboard })))
const Settings = lazy(() => import('./tabs/Settings').then((m) => ({ default: m.Settings })))
const BalanceSheet = lazy(() => import('./balance/BalanceSheet').then((m) => ({ default: m.BalanceSheet })))
const LookThroughTab = lazy(() => import('./lookthrough/LookThroughTab').then((m) => ({ default: m.LookThroughTab })))
const ProjectionTab = lazy(() => import('./projection/ProjectionTab').then((m) => ({ default: m.ProjectionTab })))
const WorkGlidePathTab = lazy(() => import('./glidepath/WorkGlidePathTab').then((m) => ({ default: m.WorkGlidePathTab })))
const RiskExposureTab = lazy(() => import('./risk/RiskExposureTab').then((m) => ({ default: m.RiskExposureTab })))
const EstateProtectionTab = lazy(() => import('./estate/EstateProtectionTab').then((m) => ({ default: m.EstateProtectionTab })))
const TaxWithdrawalTab = lazy(() => import('./tax/TaxWithdrawalTab').then((m) => ({ default: m.TaxWithdrawalTab })))
const WeirTab = lazy(() => import('./tabs/WeirTab').then((m) => ({ default: m.WeirTab })))

function TabFallback() {
  return <p className="py-16 text-center text-sm text-faint">Loading…</p>
}

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
          <Suspense fallback={<TabFallback />}>
            {tab.id === 'dashboard' ? (
              <Dashboard onNavigate={setActive} />
            ) : tab.id === 'balance' ? (
              <BalanceSheet />
            ) : tab.id === 'lookthrough' ? (
              <LookThroughTab />
            ) : tab.id === 'projection' ? (
              <ProjectionTab />
            ) : tab.id === 'glide' ? (
              <WorkGlidePathTab />
            ) : tab.id === 'risk' ? (
              <RiskExposureTab />
            ) : tab.id === 'estate' ? (
              <EstateProtectionTab />
            ) : tab.id === 'tax' ? (
              <TaxWithdrawalTab />
            ) : tab.id === 'weir' ? (
              <WeirTab />
            ) : tab.id === 'settings' ? (
              <Settings />
            ) : (
              <PhasePlaceholder def={tab} />
            )}
          </Suspense>
        </main>
      </div>
    </div>
  )
}
