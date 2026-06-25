# ASCENT

A personal wealth cockpit. *Measure exposure, steer toward intent, stay calm.* Decision-support,
not advice; not a trade feed.

- **Spec (source of truth):** [`ascent-master-spec.md`](./ascent-master-spec.md)
- **Build directive:** [`ascent-claude-code-prompt.md`](./ascent-claude-code-prompt.md)
- **Project rules for Claude Code:** [`CLAUDE.md`](./CLAUDE.md)
- **Resume state / phase log:** [`HANDOFF.md`](./HANDOFF.md) · **Roadmap:** [`TODO.md`](./TODO.md)

**Stack:** React 19 + Vite + TypeScript (strict) + Tailwind v4 (Recharts) · Supabase (Postgres + RLS
+ Edge Functions, Deno). Manual-entry-first MVP with assisted statement import; account aggregation
deferred.

## Status — the differentiated spine (P0–P4) is complete

Live tabs: **Dashboard · Balance Sheet (+ statement import) · Look-through · Projection · Work
Glide-Path · Settings**. Five Edge Functions deployed (quotes, crypto, ETF holdings, statement
parsing, inflation). Remaining: P5 Tax & Withdrawal · P6 Risk & Exposure + alerts · P7 Estate &
Protection · P8 aggregation/AI — see [`TODO.md`](./TODO.md).

## Develop

```bash
npm install
cp .env.example .env.local   # set VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY (public, RLS-gated)
npm run dev                  # http://localhost:5173
npm run build                # tsc -b + vite build (strict)
```

Third-party data-API keys never touch the browser — they live in Supabase secrets and are read only
by Edge Functions (invariant #10). Optional, all graceful when absent:

```bash
supabase secrets set FINNHUB_API_KEY=…   # stock/ETF quotes
supabase secrets set FMP_API_KEY=…       # ETF look-through
supabase secrets set FRED_API_KEY=…      # live inflation curve
supabase secrets set ANTHROPIC_API_KEY=… # statement parsing
```

## Layout

- `src/lib/finance/` — pure engines (amortization, net worth/allocation, estate, look-through, CMA,
  inflation, Monte Carlo, glide-path). Verified with throwaway `tsx` scripts.
- `src/app/` — tabs (balance, lookthrough, projection, glidepath) + shell/nav; `src/components/ui/`
  the design-system kit.
- `supabase/migrations/` — schema + RLS + seed CMAs/inflation; `supabase/functions/` — Edge Functions.

Built in phases P0 → P8 (spec §7), one phase at a time with verification between each.
