export type TabId =
  | 'dashboard'
  | 'balance'
  | 'lookthrough'
  | 'projection'
  | 'glide'
  | 'tax'
  | 'risk'
  | 'estate'
  | 'weir'
  | 'settings'

export interface TabDef {
  id: TabId
  label: string
  /** Phase the tab's real content arrives in (spec §7). */
  phase: string
  /** True once the tab has shipped real content. */
  live: boolean
  /** One-line description of what the tab does (spec §3). */
  blurb: string
}

export const TABS: TabDef[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    phase: 'P1',
    live: false,
    blurb: 'Hero = exposure + success probability; net worth, calm; sparse alerts.',
  },
  {
    id: 'balance',
    label: 'Balance Sheet',
    phase: 'P1',
    live: true,
    blurb: 'Manual holdings, real estate + mortgage, private equity; allocation; spending baseline.',
  },
  {
    id: 'lookthrough',
    label: 'Look-through',
    phase: 'P2',
    live: true,
    blurb: 'Top-10 underlying companies (direct + inside ETFs); single-name + sector concentration.',
  },
  {
    id: 'projection',
    label: 'Projection',
    phase: 'P3',
    live: true,
    blurb: 'Consensus CMA + two-stage, inflation curve, Monte Carlo success probability, scenarios.',
  },
  {
    id: 'glide',
    label: 'Work Glide-Path',
    phase: 'P4',
    live: true,
    blurb: 'Years of full work remaining @confidence; three phases; sequence-risk.',
  },
  {
    id: 'tax',
    label: 'Tax & Withdrawal',
    phase: 'P5',
    live: true,
    blurb: 'Account tagging, withdrawal sequencing, Roth/RMD/TLH, asset location. Model + flag, not file.',
  },
  {
    id: 'risk',
    label: 'Risk & Exposure',
    phase: 'P6',
    live: true,
    blurb: 'Narrative exposure + blast radius, factor/sector, drawdown stress, alert-engine config.',
  },
  {
    id: 'estate',
    label: 'Estate & Protection',
    phase: 'P7',
    live: true,
    blurb: 'Estate-tax exposure, doc checklist + vault, insurance-gap readout, liquidity/SBLOC, 529s.',
  },
  {
    id: 'weir',
    label: 'WEIR',
    phase: '—',
    live: true,
    blurb: 'Framed read-only research instrument (separate app + login); it proposes, adoption stays manual.',
  },
  {
    id: 'settings',
    label: 'Settings',
    phase: 'P0',
    live: true,
    blurb: 'Data sources, assumptions, sharing, privacy.',
  },
]
