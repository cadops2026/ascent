// Structural row types for the vendored finance engines (Deno edge runtime).
// These mirror the columns the engines actually read from the app's DB rows —
// kept minimal on purpose. The browser uses the generated `Row<'…'>` types from
// src/lib/database.types; the pure engine logic only needs these fields.

export type QuoteMap = Record<string, number>

export interface Holding {
  symbol: string | null
  name: string | null
  kind: string // stock | etf | crypto | cash | private | collectible | real_estate
  entry_mode: 'shares' | 'amount'
  shares: number | null
  manual_amount: number | null
}

export interface RealEstate {
  kind: 'residence' | 'investment'
  market_value: number
}

export interface Liability {
  label: string | null
  kind: 'mortgage' | 'other'
  orig_balance: number
  rate: number | null
  term_months: number | null
  start_date: string | null
}
