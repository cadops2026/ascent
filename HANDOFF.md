# HANDOFF — after P0 (Foundation)

_Updated at the end of each phase (CLAUDE.md). Current phase: **P7 (Estate & Protection) core BUILT +
verified — see below. P6 (Risk + alerts), the spine P0–P4, and a hardening pass precede it. P5 Tax was
skipped per spec §8 (least differentiated). Awaiting review.**_

## P7 — Estate & Protection (core BUILT)

Builds out the full tab from the P1 net-to-heirs card. All green (`tsc -b`, `vite build`, `oxlint`);
exposure-not-advice throughout (invariant #9 — model + flag + prompt the professional, never draft/file).
- **Engines** (pure, tsx-verified, verifier deleted): `liquidity.ts` (liquid/marketable assets, SBLOC
  capacity = 50% of *taxable* stock+ETF, estate-tax liquidity coverage/shortfall — borrow-don't-sell),
  `insurance.ts` (per-kind coverage vs a rough modeled need → gap flags: term-life/umbrella amount-modeled,
  disability/LTC/entity presence/age flags), `estatedocs.ts` (6-doc checklist + 3-yr review staleness +
  gap count). Reuses `estate.ts` (net-to-heirs, OBBBA $15M/$30M, NJ $0). Verified: $42M MFJ → $4.8M tax →
  $37.2M heirs; liquid $26M + $9M SBLOC covers it; umbrella gap $42M vs $5M; will reviewed 2020 → stale.
- **Estate & Protection tab** (live): `app/estate/EstateProtectionTab.tsx` (container) + `ProtectionPanels.tsx`
  (presentational, render-tested via throwaway harness with real engine output — all readouts paint).
  Read-outs: estate-tax exposure + net-to-heirs, liquidity & SBLOC (covers-the-bill check), insurance-gap
  table, 529 balance. Editors: filing status (→`profiles`), estate-doc checklist (per-row status +
  last_reviewed → `estate_docs`, with stale badges), insurance policies add/remove (→`insurance_policies`).
  Verified end-to-end (nav→shell→lazy import mounts; filing selector + empty-state OK).
- **No migration** — consumes existing P0 tables (`insurance_policies`, `estate_docs`) + `accounts.tax_type`
  ('529', 'taxable'). Added `InsurancePolicy`/`EstateDoc` type aliases to `lib/db.ts`.
- **Deferred (flagged):** the **encrypted file vault upload** for estate docs needs a Storage bucket +
  RLS (a migration, like the `statements` bucket) — the checklist tracks `file_ref` but upload is a
  follow-up. Insurance editing is add/remove (inline edit is a follow-up). Liquidity SBLOC excludes
  crypto/cash collateral by design.

## P6 — Risk & Exposure + alert engine (core BUILT)

The "measure exposure, stay calm" surface. All green (`tsc -b`, `vite build`, `oxlint`). Self-checked
against the invariants (notably #1 one alert engine, #5 never forecast, #7 alerts never price-triggered,
#11 residence out of stress).
- **Engines** (pure, tsx-verified, then verifier deleted):
  - `drawdownstress.ts` — four historical *analog* shocks (dot-com −41%, GFC −49%, 2022 rate, crypto
    winter) applied per class to the investable portfolio → blast radius. Residence not stressed (#11).
  - `exposure.ts` — single-name blast radius, factor exposure (equity-beta = corr-weighted share, read
    from `asset_class_universe` not hardcoded — #3), and a **deterministic** narrative (templated, never
    a forecast — #5). The *LLM* narration stays leashed to P8; this is the math layer it sits on.
  - `mortgagebond.ts` — mortgage as a short bond: balance, rate, and Macaulay duration from the remaining
    amortization stream; counsels against killing a sub-4% loan (spec §8).
  - `alertengine.ts` — the one alert evaluator (#1): rebalance-band drift vs target, single-name ceiling,
    theme/crypto ceiling, mortgage-payoff event. **Pre-committed thresholds; nothing reads a price delta
    (#7).** Pure (no React/Supabase) so a future cron imports the same logic.
- **Risk & Exposure tab** (live): `app/risk/RiskExposureTab.tsx` (data container) + `ExposurePanels.tsx`
  (presentational, render-tested via a throwaway harness with real engine output — band/bars/digest all
  paint). Surfaces: plain-terms exposure narrative, blast radius, factor exposure, drawdown-stress bars,
  mortgage-as-short-bond, an editable **alert-threshold + target-allocation config** (writes
  `target_allocation` + `alert_rules`), and a live-evaluated **monthly digest** with dismiss. Verified:
  NVDA 25% blast −7.5%, GFC −49% deepest, mortgage duration 10.7y, 6 pre-committed alerts, dismiss works.
- **No migration needed** — consumes existing P0 tables (`alert_rules`, `alerts`, `target_allocation`,
  `rebalance_bands`). **Deferred (the remaining P6 piece):** the `evaluate-alerts` **cron** Edge Function
  (server-side evaluation + persistence to `alerts` + scheduled push) — needs the pure `alertengine.ts`
  vendored under `supabase/functions/_shared/` so it reuses the engine, not a re-implementation (#1).
  Also still deferred: **sector** concentration (needs a company→sector source; crypto is the theme proxy
  for now). Per-class rebalance-band overrides exist in the engine but the UI sets one global band.

## Hardening pass (post-spine, 2026-06-25)
Before adding new surface area, hardened the spine (all green: `tsc -b`, `vite build`, `oxlint`):
- **Charts render-tested.** Extracted `app/projection/WealthPathChart.tsx` + `app/glidepath/PhaseBar.tsx`
  as presentational components, then drove the *real* chart code with *real* engine output on synthetic
  inputs (temporary dev harness, since the live UI is RLS-gated and renders empty under anon) —
  screenshot-confirmed the P10–P90 band fan, teal median line, and three-phase bar paint correctly.
  Closes the P3/P4 "populated charts not render-tested" note. Harness removed; extractions kept. (The
  user's *own* live-data view still only they can confirm in an authed session.)
- **Recharts code-split.** `AppShell` now `React.lazy` + `Suspense` per tab → initial bundle
  806→408 kB (233→117 kB gz); Recharts is a separate ~84 kB-gz chunk loaded only when a chart tab opens
  (off the sign-in path). Closes the bundle-size follow-up.
- **Settings export + delete-all (invariant #10).** New `lib/userData.ts`: export all 16 user-scoped
  tables → JSON download; confirm-gated (type `DELETE`) delete-all of rows + statement files. Shared
  reference/cache tables deliberately excluded. Full *account* deletion (auth user) still needs a
  service-role Edge Function — flagged in TODO.

## P4 — Work Glide-Path + principles overlay (BUILT)

Solve-mode of the Monte Carlo. Completes the spine.
- **Engine** `glidepath.ts` (pure, verified via tsx): binary-searches the minimum **years of full work**
  so success ≥ confidence (monotonic). Three-phase cash flow (full work → downshift bridge with partial
  income → drawdown) + healthcare bridge before Medicare, fed via a new optional `cashFlow` callback on
  the Monte Carlo (backward-compatible). **Maintain-wealth fork** = same search with
  `legacyTarget = initial wealth` (correctly stricter — verified 27yr vs 18yr to fund spending).
  **Sensitivity strip** re-solves under spend +10% / returns −1% / live +5yr. **Principles overlay** is
  deterministic — a Bogle/Munger/Graham/Buffett principle attached to the state; explains, never overrides
  (invariant #8).
- **Work Glide-Path tab** (live): editable assumptions, **"years of full work remaining" hero @confidence**
  + sensitivity strip, three-phase timeline bar, maintain-wealth fork, sequence-risk readout, principle card.
  Heavy solve guarded by `useDeferredValue` so typing stays smooth.
- Verified: $1.5M/70-30/spend 90k/+40k → 18yr to fund @85%; spend 180k → 28yr (more, correct);
  maintain-wealth 27yr (stricter, correct).

## Spine status (P0–P4) — COMPLETE
P0 foundation · P1 balance sheet (+ P1.5 import) · P2 look-through · P3 projection · P4 glide-path +
principles. Live tabs: Dashboard, Balance Sheet, Look-through, Projection, Work Glide-Path, Settings.
Remaining: P5 Tax & Withdrawal · P6 Risk & Exposure + alerts/digest · P7 Estate & Protection (incl. the
full estate tab beyond the P1 net-to-heirs card) · P8 aggregation/AI overlays. Plus the P2 deferrals
(sector, fees, TWR/IRR, dividends, diversification scanner) as their data arrives.

## P3 — Projection (BUILT)

The spine's centerpiece. Runs for testing with **no keys** (seeded reference data); FRED key sharpens
the inflation curve.
- **Seed migration**: `asset_class_universe` (vol + corr-to-equity, single-factor model), `cma_sources`
  (5 houses × asset classes, median + dispersion), default inflation curve (fractions). Idempotent.
- **Engines** (pure, verified via tsx):
  - `inflation.ts` — horizon-matched curve; prefers live EXPINF → breakeven → default seed (invariant #2).
  - `cma.ts` — consensus median + dispersion, net of cost; vol/corr from the universe (invariant #3).
  - `montecarlo.ts` — single-factor correlated returns; **crypto idiosyncratic shock is Student-t df=4**
    (invariant #12); real-dollar (deflated each year by the curve); contributions→withdrawals; percentile
    bands + success probability. Verified: 60/40 plan → 88% success, ordered P10/P50/P90; 100% crypto →
    fat-tailed ruin-with-lottery-upside (vol drag punishes concentration, as it should).
- **Projection tab** (live): editable assumptions (age/retire/plan-to/contrib/spend), **success-probability
  hero + 25th-pct end wealth as a band** (invariant #4), Recharts P10–P90 wealth-path band + median line,
  bear/base/bull terminals, and visible per-class CMA assumptions.
- **`refresh-inflation`** Edge Function (FRED EXPINF 1–30yr + breakevens → fractions; built by background
  agent, deployed). Needs `FRED_API_KEY`; until then the seeded default curve is used.

**Deployed Edge Functions** (all 5): refresh-quotes, refresh-crypto, refresh-etf-holdings,
parse-statements, refresh-inflation.

**Note**: the projection wealth *chart* (Recharts ComposedChart) wasn't render-tested with live data
(needs an authed session + holdings); the math is tsx-verified and the chart uses the same Recharts
patterns as the working allocation pie. The user is testing the product live.

## P2 — Look-through (core BUILT)

- **Engine** `lib/finance/lookthrough.ts` (pure, verified via tsx): decomposes holdings into single-name
  exposure — direct stocks/crypto map to themselves, ETFs explode into constituents (value × weight)
  when `etf_holdings` data exists (unexplained remainder shown as opaque), **private/founder + collectible
  stakes count as concentrated single names**, residence excluded from investable (invariant #11) but
  tracked as a real-estate factor. Verified: a Cadence founder stake surfaced at 56.2% of investable;
  AAPL correctly aggregated direct + VOO look-through.
- **Look-through tab** (`app/lookthrough/`, live): largest single-name exposure (flags > 10% of
  investable), real-estate factor, top-10 underlying companies (with opaque/unresolved markers), and a
  "Refresh ETF holdings" action.
- **`refresh-etf-holdings`** Edge Function (FMP, deployed — built by a background subagent): FMP stable
  `/etf/holdings`, `weightPercentage/100` → fraction, delete-then-insert per ETF. Needs `FMP_API_KEY` in
  secrets; until then ETFs show as opaque single lines (handled gracefully).

**Deferred within P2** (need data we don't have yet, will revisit): sector concentration (needs a
company→sector source), fee/expense-ratio analyzer (needs expense ratios), TWR/IRR (needs a dated
transactions table — only cost-basis gain/loss is computable today), dividends, and the full
diversification-gap scanner (needs the CMA/correlation data from P3). Flagged so we sequence them with
their data.

## P1.5 — Assisted statement import (BUILT)

Drop statements → parse with Claude → review → import. **Import-first**: the drop zone sits atop the
Balance Sheet; manual entry stays as fallback.
- **Storage**: private `statements` bucket, RLS-locked to `<uid>/…` (owner-only read/insert/delete).
- **`statement_imports`** table (review queue) — RLS owner-only; tracks status
  uploaded→parsing→parsed→committed/error/dismissed, `candidates` + `summary` jsonb.
- **`parse-statements`** Edge Function (deployed): verifies caller owns the import, downloads the file
  (service role), sends PDF/image/CSV to **Claude `claude-opus-4-8`** with an `output_config.format`
  JSON schema, writes candidate rows. Browser never calls Anthropic (invariant #10). Model overridable
  via `ANTHROPIC_MODEL`; no thinking (keeps latency in the edge-function window; schema prevents prose).
- **UI** (`ImportSection.tsx`): drag-drop / file / folder upload → poll → **review-and-confirm** (per-row
  include toggles + confidence) → commit inserts holdings/liabilities (and an account from the
  statement's institution) into the one balance sheet. Nothing auto-commits.
- **Needs from you**: `supabase secrets set ANTHROPIC_API_KEY=sk-ant-…` (Anthropic Console). Until set,
  uploads succeed but parsing returns an error row (handled gracefully, with Retry).
- **Not yet runtime-tested** (no API key during the build); types + build + UI render verified.

Project: **Ascent Financial** (ref `rhpdjuigivbwfvzoljsa`, East US Ohio, dedicated org separate from
Jamzli). Linked via CLI; `.env.local` written with the live URL + anon key.

## P1 — Balance Sheet (DONE)

**Finance engines** (pure, verified with sample data via tsx): `lib/finance/amortization.ts`
(payment, current balance, payoff date, principal/interest paid), `lib/finance/networth.ts` (holding
values w/ pending-quote handling, allocation by class, net worth incl. residence vs. investable
excl. residence — invariant #11), `lib/finance/estate.ts` (net-to-heirs under OBBBA exemption + 40%,
NJ $0). Verified: amortization $3,940.59/mo & $597k balance after 60mo; investable correctly excludes
residence; $40M married estate → $4M tax → $36M to heirs.

**UI** (`app/balance/`): typed data hook (`useBalanceSheet`), calm net-worth header (no daily delta —
invariant #6), Recharts allocation donut, **net-to-heirs card** (filing-status editable inline),
holdings section (accounts + holdings; ticker/shares or manual-amount; per-holding proj growth;
pending-quote state), property section (real estate + mortgage amortization readout + liabilities),
spending baseline. Dashboard rewired to real net worth + allocation (hero exposure/success-prob shown
as honest "arrives P2/P3" placeholders — no fabricated numbers). Form controls added to the UI kit.

**Edge Functions** (`supabase/functions/`, deployed to the project): `refresh-quotes` (Finnhub,
equity/ETF, ~15m TTL) and `refresh-crypto` (CoinGecko, keyless free tier). Browser invokes them via
`supabase.functions.invoke` — never calls Finnhub/CoinGecko directly (invariant #10). Service-role
write to `quote_cache`.

**Typed schema**: `lib/database.types.ts` generated from the live project; client is `createClient<Database>`.

**Verified**: production build green (strict TS); finance math correct (tsx); full UI mounts/renders
(screenshots). No new migration needed — P1 uses the P0 tables. Recharts pushes the bundle to ~721 kB
(211 kB gz) — code-split candidate later, not blocking.

## What's built (P0)

**Frontend scaffold** — React 19 + Vite 8 + TypeScript (strict, incl. `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`) + Tailwind v4. Production build passes (`npm run build`).

**Design system ("deep instrument", spec §6)** — tokens as Tailwind v4 `@theme` variables in
`src/index.css` (surfaces, ink/muted/faint, teal/indigo/amber/coral accents, the radii). Fonts
loaded via Google Fonts: IBM Plex Mono (numerals, the hero), Space Grotesk (display), Inter (body).
`.tnum` tabular figures + `.micro-label` helpers.

**Component kit** (`src/components/ui/`) —
- `Figure` — the hero numeral; **always carries its band + confidence** when a projection (invariant #4).
- `StatCard` — panel around one Figure; deliberately **no daily-delta slot** (invariant #6).
- `Panel`, `MicroLabel`, `AlertStrip` (sparse, dismissible — invariant #7).

**App shell** (`src/app/`) — header + responsive nav (left rail on desktop, scroll bar on mobile)
across the 8 spec tabs + Settings, each badged with its arrival phase. `Wordmark` (teal peak mark).
Dashboard ships as an honest **foundation preview** (all figures tagged `SAMPLE`); Settings shows
live Supabase connection state; other tabs are honest "arrives in P_" placeholders. **No future
phases scaffolded.**

**Auth** (`src/auth/`) — `AuthProvider` (session context via `supabase.auth`) + magic-link
`SignIn` (`signInWithOtp`). `App.tsx` gates: not-configured → "connect Supabase" screen; no session
→ sign-in; session → shell.

**Supabase client** (`src/lib/supabase.ts`) — single client; **browser → Supabase only** (invariant
#10). Env via `src/lib/env.ts` (only the two public `VITE_SUPABASE_*` vars; no data-API keys client-side).

**Visually verified** via dev-server screenshots: sign-in screen + full cockpit render correctly;
fixed a band-formatting bug (success-prob band now reads `71.0% – 93.0%`, not `$1 – $1`).

## Schema state

`supabase/migrations/20260625161351_init.sql` — **applied to remote** (local = remote, synced).
Verified: all 22 tables served by the REST API; anon writes rejected with `42501 row-level security`
(RLS confirmed protective). Every table from spec §4:
- **User-scoped** (RLS: `auth.uid() = user_id`, `FOR ALL`): profiles, accounts, holdings,
  real_estate, liabilities, spending_baseline, target_allocation, rebalance_bands, scenarios,
  phase_plan, alert_rules, alerts, net_worth_snapshots, insurance_policies, estate_docs.
- **Shared cache/reference** (RLS: authenticated `SELECT` only; Edge Functions write via
  service_role): quote_cache, etf_holdings, cpi_cache, infl_expectations_cache, nowcast_cache,
  cma_sources, asset_class_universe.
- Data integrity: `holdings` CHECK enforces shares-mode↔shares / amount-mode↔amount; `on delete
  cascade` from `auth.users` everywhere (supports data deletion, invariant #10); `updated_at`
  triggers; per-`user_id` indexes.
- Notes: `share_with[]` column present but **sharing policies deferred to P8** (owner-only for now);
  `label` added to real_estate/liabilities for the balance-sheet UI.

## Env / secrets set

- `.env.local` written (gitignored) with `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (the public
  anon key — gated by RLS). `.env.example` documents both; `.gitignore` blocks `.env*` (keeps
  `.env.example`), `node_modules`, `dist`, Supabase local artifacts.
- Project linked (`supabase/.temp`). **No** service-role key or db secret stored in the repo.
- No third-party data-API keys yet (those are P1, and live in Supabase secrets).

## P0 wiring — DONE

`.env.local` written · project linked · migration pushed (synced) · RLS verified · app boots to
sign-in against the live project.

Auth redirect config (Site URL + Redirect URLs → `http://localhost:5173`) set in the dashboard by
the user — magic-link sign-in path is complete. **P0 is fully closed.**

## What P1 needs (next phase — do not start until you confirm)

- Edge Functions `refresh-quotes` (Finnhub) + `refresh-crypto` (CoinGecko), keys in Supabase
  secrets, writing `quote_cache` (TTL ~15m). **Browser never calls these APIs directly.**
- Balance Sheet UI: manual holdings (ticker/shares or manual-amount + per-holding proj growth);
  real estate + mortgage (amortization, payoff date, residence vs investment split); private/founder
  equity + collectibles; allocation pie (Recharts — first use, within locked stack); calm net-worth
  view; spending-baseline input.
- Recharts to be installed in P1 (locked stack; deferred from P0 to keep it lean).
- **Net-to-heirs snapshot** (user call, 2026-06-25): a small "Estate snapshot" card on the Balance
  Sheet — gross estate (incl. residence, invariant #11) − federal estate tax on the amount above the
  OBBBA exemption ($15M single / $30M married by filing status; 40% top rate) − liabilities =
  net-to-heirs. NJ adds $0 (no estate tax; Class A exempt). Point estimate today; consumes the single
  balance sheet (invariant #1); assumptions visible + editable; labeled exposure-not-advice (invariant
  #9). The projected-legacy **band** and the full Estate & Protection tab remain at P3/P7.

## Open questions

- **Auth method:** I chose passwordless **magic link**. On hosted Supabase the built-in email works
  out of the box but is rate-limited and may hit spam. Switch to email+password if you prefer
  (one-line change). Tell me your preference before P1.
- **Account-type tag set:** I seeded a HNW-flavored `tax_type` list (taxable, trad/roth 401k & IRA,
  hsa, sep, solo401k, 529, cash_balance_db, trust, other). Flag any missing.
- **One Supabase project vs. shared with Jamzli:** I assumed a **dedicated** ASCENT project. Confirm.

## Forward decisions

- **Assisted statement import → P1.5** (user call, 2026-06-25; now in spec §3/§5/§7). Drop statements
  (PDF/CSV/scans) → **RLS-locked Supabase Storage** → server-side `parse-statements` Edge Function
  using **Claude** (extraction engine chosen over in-house/local — best accuracy across formats;
  document content goes to Anthropic for the read-the-document step only) → **review-and-confirm queue,
  no auto-commit** → writes into P1's balance sheet (invariant #1). New pieces when built: a private
  Storage bucket, an **Anthropic API key in Supabase secrets**, a `statement_imports` table, and the
  drop-zone + review UI. "Folder" = drag a directory of files in the browser; a true watch-folder would
  be an optional local helper script. Follows P1 because it writes into P1's model.

## Forward decisions (beyond P1)

- **AI / macro-context overlay → P8, calm-leashed** (user call, 2026-06-25; now in spec §2/§7/§8).
  Two layers: (1) a **grounded AI overlay** that narrates *your own* exposure + answers plan
  questions (Edge Function → Claude, key in Supabase secrets, browser→Supabase only) — explains,
  never forecasts; (2) an optional **macro-context overlay** that is *context, not signal* —
  low-frequency, on-demand, never an alert, never a trade implication, "what major houses think"
  enters only structurally via the CMA engine, never as tactical sentiment. Guiding principle: **the
  biggest risk is a large reactive move, not a wrong number — every surface dampens reactivity.**
