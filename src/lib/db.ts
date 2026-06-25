import type { Database } from './database.types'

type Tables = Database['public']['Tables']
export type Row<T extends keyof Tables> = Tables[T]['Row']
export type Insert<T extends keyof Tables> = Tables[T]['Insert']
export type Update<T extends keyof Tables> = Tables[T]['Update']

export type Account = Row<'accounts'>
export type Holding = Row<'holdings'>
export type RealEstate = Row<'real_estate'>
export type Liability = Row<'liabilities'>
export type SpendingBaseline = Row<'spending_baseline'>
export type Profile = Row<'profiles'>
export type QuoteCache = Row<'quote_cache'>
export type StatementImport = Row<'statement_imports'>

/* Shape of one extracted candidate row in statement_imports.candidates (jsonb). */
export interface HoldingCandidate {
  row_type: 'holding'
  symbol?: string
  name?: string
  kind: HoldingKind
  shares?: number
  amount?: number
  cost_basis?: number
  confidence: 'high' | 'medium' | 'low'
}
export interface LiabilityCandidate {
  row_type: 'liability'
  label?: string
  kind: 'mortgage' | 'other'
  balance?: number
  rate?: number
  confidence: 'high' | 'medium' | 'low'
}
export type ImportCandidate = HoldingCandidate | LiabilityCandidate

/* Domain enums — SQL CHECK constraints generate as plain `string`, so narrow here. */
export const HOLDING_KINDS = ['stock', 'etf', 'crypto', 'cash', 'private', 'collectible'] as const
export type HoldingKind = (typeof HOLDING_KINDS)[number]

export const ENTRY_MODES = ['shares', 'amount'] as const
export type EntryMode = (typeof ENTRY_MODES)[number]

export const TAX_TYPES = [
  'taxable', 'trad_401k', 'roth_401k', 'trad_ira', 'roth_ira', 'hsa',
  'sep_ira', 'solo_401k', '529', 'cash_balance_db', 'trust', 'other',
] as const
export type TaxType = (typeof TAX_TYPES)[number]

export const RE_KINDS = ['residence', 'investment'] as const
export type ReKind = (typeof RE_KINDS)[number]

export const FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh', 'qw'] as const
export type FilingStatus = (typeof FILING_STATUSES)[number]

export const HOLDING_KIND_LABEL: Record<HoldingKind, string> = {
  stock: 'Stock',
  etf: 'ETF',
  crypto: 'Crypto',
  cash: 'Cash',
  private: 'Private / founder',
  collectible: 'Collectible',
}

export const TAX_TYPE_LABEL: Record<TaxType, string> = {
  taxable: 'Taxable',
  trad_401k: 'Traditional 401(k)',
  roth_401k: 'Roth 401(k)',
  trad_ira: 'Traditional IRA',
  roth_ira: 'Roth IRA',
  hsa: 'HSA',
  sep_ira: 'SEP IRA',
  solo_401k: 'Solo 401(k)',
  '529': '529',
  cash_balance_db: 'Cash-balance / DB',
  trust: 'Trust',
  other: 'Other',
}

export const FILING_LABEL: Record<FilingStatus, string> = {
  single: 'Single',
  mfj: 'Married filing jointly',
  mfs: 'Married filing separately',
  hoh: 'Head of household',
  qw: 'Qualifying widow(er)',
}
