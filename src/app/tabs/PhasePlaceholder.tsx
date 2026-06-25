import type { TabDef } from '../nav'
import { Panel, MicroLabel } from '../../components/ui'

/** Honest placeholder for a tab whose real content arrives in a later phase. */
export function PhasePlaceholder({ def }: { def: TabDef }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={def.label} phase={def.phase} />
      <Panel className="mt-6">
        <p className="text-sm leading-relaxed text-muted">{def.blurb}</p>
        <div className="mt-5 flex items-center gap-2">
          <span className="h-1.5 w-1.5 rounded-full bg-amber" />
          <span className="text-sm text-faint">
            Arrives in <span className="font-mono text-muted">{def.phase}</span>. Built one phase
            at a time — the spine (P0–P4) comes first.
          </span>
        </div>
      </Panel>
    </div>
  )
}

export function PageHeader({ title, phase }: { title: string; phase?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <h1 className="font-display text-2xl font-semibold text-ink">{title}</h1>
      {phase && <MicroLabel className="text-faint">{phase}</MicroLabel>}
    </div>
  )
}
