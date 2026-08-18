// The one price-refresh path for the whole app (invariant #1). Every tab loads
// the balance sheet through useBalanceSheet, which drives this; nothing else
// should assemble symbol lists or invoke the quote functions itself.
import { supabase } from '../supabase'
import type { Holding, BasketLeg } from '../db'

/** Mirrors the server-side TTL in refresh-quotes / refresh-crypto (~15 min).
 *  Calm by default: honest "recent", never tick-by-tick (invariant #6). */
export const QUOTE_TTL_MS = 15 * 60 * 1000

/** The symbols a holding set needs priced, split by vendor. */
export function quoteSymbols(holdings: Holding[]): { equities: string[]; crypto: string[] } {
  const tickers = holdings.filter((h) => h.entry_mode === 'shares' && h.symbol)
  // Composition-priced holdings (e.g. 529 portfolios) are valued off their
  // underlying ETF legs, so those legs need quotes too.
  const basketSyms = holdings.flatMap((h) =>
    ((h.synthetic_basket as BasketLeg[] | null) ?? []).map((l) => l.symbol.toUpperCase()),
  )
  const equities = [
    ...new Set([
      // 'cash' covers money-market funds held as shares (e.g. VMFXX) — they have
      // a NAV ticker and must be priced like equities, not skipped as plain cash.
      ...tickers
        .filter((h) => h.kind === 'stock' || h.kind === 'etf' || h.kind === 'cash')
        .map((h) => h.symbol!.toUpperCase()),
      ...basketSyms,
    ]),
  ]
  const crypto = [
    ...new Set(tickers.filter((h) => h.kind === 'crypto').map((h) => h.symbol!.toUpperCase())),
  ]
  return { equities, crypto }
}

/** Fetch fresh prices for every priceable holding. The server skips symbols
 *  cached within the TTL, so repeat calls are cheap. Throws on transport error. */
export async function refreshHoldingQuotes(holdings: Holding[]): Promise<number> {
  const { equities, crypto } = quoteSymbols(holdings)
  if (equities.length) {
    const { error } = await supabase.functions.invoke('refresh-quotes', { body: { symbols: equities } })
    if (error) throw error
  }
  if (crypto.length) {
    const { error } = await supabase.functions.invoke('refresh-crypto', { body: { symbols: crypto } })
    if (error) throw error
  }
  return equities.length + crypto.length
}

/** True if any needed symbol is unpriced or priced longer ago than the TTL. */
export function quotesAreStale(
  holdings: Holding[],
  quoteAsOf: Record<string, number>,
  now = Date.now(),
): boolean {
  const { equities, crypto } = quoteSymbols(holdings)
  return [...equities, ...crypto].some((s) => {
    const t = quoteAsOf[s]
    return t == null || now - t >= QUOTE_TTL_MS
  })
}

/** How current the numbers actually are: the OLDEST quote backing this holding
 *  set, so the figure is a floor ("everything here is at least this current")
 *  rather than a flattering max. Null when nothing priceable is priced yet. */
export function pricesAsOf(holdings: Holding[], quoteAsOf: Record<string, number>): Date | null {
  const { equities, crypto } = quoteSymbols(holdings)
  const stamps = [...equities, ...crypto].map((s) => quoteAsOf[s]).filter((t): t is number => t != null)
  return stamps.length ? new Date(Math.min(...stamps)) : null
}

// Auto-refresh runs on whichever tab loads first, so the guard has to be
// module-level, not per-component: a symbol the vendors can't price (bad ticker,
// delisted) never becomes fresh and would otherwise refetch on every tab switch.
let lastAttempt = 0

/** Claim the once-per-TTL auto-refresh slot. Returns false if it's already taken. */
export function claimAutoRefresh(now = Date.now()): boolean {
  if (now - lastAttempt < QUOTE_TTL_MS) return false
  lastAttempt = now
  return true
}

/** Release the slot so an explicit user-initiated refresh isn't throttled. */
export function resetAutoRefresh(): void {
  lastAttempt = 0
}
