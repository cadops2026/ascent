# ASCENT — Roadmap / TODO

Phase-by-phase plan is in `ascent-master-spec.md` §7; resume state + build details in `HANDOFF.md`.
This is the actionable checklist. Build discipline: one phase at a time, verify, then confirm.

## Done — the spine (P0–P4)
- [x] **P0** Foundation — Vite+TS+Tailwind, design system + kit, Supabase auth/RLS, full data model.
- [x] **P1** Balance Sheet — holdings, real estate + mortgage amortization, liabilities, allocation,
      calm net worth, spending baseline, net-to-heirs snapshot. Quote Edge Functions.
- [x] **P1.5** Assisted statement import — Storage + `parse-statements` (Claude) + review-and-commit.
- [x] **P2 (core)** Look-through — single-name concentration, top-10, real-estate factor, `refresh-etf-holdings`.
- [x] **P3** Projection — consensus-CMA + inflation curve + Monte Carlo (Student-t crypto) + success prob.
- [x] **P4** Work Glide-Path — years-of-work solver, sensitivity, maintain-wealth fork, principles overlay.

## Done — P6 (Risk & Exposure + alert engine) — core
- [x] **P6 (core)** — drawdown-stress / exposure+blast-radius / mortgage-as-short-bond / alert engines;
      Risk & Exposure tab (narrative, blast radius, factor, stress, mortgage-bond, target+threshold config,
      live monthly digest w/ dismiss). Pre-committed, never price-triggered (#7); deterministic narrative (#5).
      *Remaining P6 piece:* the `evaluate-alerts` cron (below).

## Done — P7 (Estate & Protection) — core
- [x] **P7 (core)** — liquidity/SBLOC, insurance-gap, estate-doc-checklist engines; Estate & Protection
      tab (estate-tax exposure + net-to-heirs, liquidity-to-pay, insurance-gap readout, 529s, doc checklist
      w/ staleness, insurance add/remove). Model + flag + prompt the professional — never draft/file (#9).
      *Remaining P7 piece:* the encrypted file-vault upload (below).

## Done — P5 (Tax & Withdrawal) — core
- [x] **P5 (core)** — tax-bucket map, withdrawal sequencing, asset location, RMD projection, holding-level
      TLH, Roth-conversion/IRMAA explorer, CPA coordinate-prompts. Approx 2026 statutory constants, shown
      in-UI. Model + flag + coordinate — never file (#9). **All 8 tabs now live (feature-complete).**

## Done — Withdrawal Planner (feature on top of P5)
- [x] `withdrawal.ts` — **solveMaxWithdrawal** (binary-search the MC inverse), **Guyton-Klinger guardrails**
      (rate ±20% → spend ∓10%), **taxAwareSourcing** (RMD→taxable→deferred→Roth; progressive ordinary tax +
      stacked 0/15/20% LTCG; grossed-up to net). Surfaced in the Tax tab via `WithdrawalPlanner`. Formulas
      verified against hand calcs (browser harness). Follow-ups: lot-level basis for sourcing; fill-the-bracket
      conversion optimizer; pull other-income / RMD age automatically from the profile.

## Done — DB-backed tax parameters (feature)
- [x] `taxparams.ts` (TaxParams + DEFAULT_TAX_PARAMS + JSON I/O); engine refactor (taxtables/estate/tax/
      withdrawal take params, defaults preserve outputs — regression-verified); `tax_parameters` table +
      migration + `useTaxParams`; Settings `TaxParamsEditor` (yearly entry); `tax_params_stale` reminder in
      the alert digest. **ACTION: run `supabase db push` to apply the migration** (saves degrade gracefully
      until then), then regenerate `database.types.ts` (a tax_parameters block was hand-added).
- [x] **CMA editor + refresh** — `cmaparams.ts` + `applyCmaOverride` + `cma_params` table/migration +
      `useCmaParams` + Settings `CmaParamsEditor` (per-class er/vol/corr) + `cma_params_stale` reminder;
      override flows into Projection / Glide / Withdrawal Planner. **Run `supabase db push` to apply the
      cma_params migration.** Remaining: verify the approx-2026 tax figures vs final IRS/SSA tables.

## Next phases
- [ ] **P8 — (optional)**: account aggregation (Plaid/SnapTrade), spouse sharing, **AI overlay**
      (grounded exposure narration + plan Q&A) + **macro-context overlay** (context-not-signal, calm).

## P5 follow-ups
- [ ] Lot-level TLH + **wash-sale** date checks (today: holding-level from `cost_basis`).
- [ ] Wire real income/MAGI (when available) so NIIT/AMT/IRMAA move from prompts to computed.
- [x] **Re-verify the 2026 brackets/IRMAA/std-deduction vs final tables** — done against IRS Rev. Proc.
      2025-32 + CMS/SSA 2026. Corrected all bracket thresholds (3 schedules), standard deduction
      (16,100/32,200/24,150), LTCG breakpoints, and Part B IRMAA surcharges. Fixed a real bug: the married
      IRMAA top-finite tier is $750k, not 2×$500k=$1M (added an explicit `magiUpToMarried`). RMD table +
      NIIT + estate exemption already correct. Engine-verified (ordinaryTax/ltcg/irmaa hand-calcs).

## P7 follow-ups
- [x] **Estate-doc encrypted vault upload** — private `estate-docs` Storage bucket + owner-only RLS
      (migration `20260625210000`, mirrors the `statements` bucket). DocRow in the Estate tab now uploads to
      `<uid>/<doc_type>/<file>`, records `estate_docs.file_ref`, and offers signed-URL **View** / **Remove**
      (replace removes the old object). Model + store, never draft/file (#9/#10). Render-verified (upload vs
      file-present states). **ACTIVATION:** `supabase db push` to create the bucket+policies (degrades
      gracefully — upload shows a clear error until then).
- [ ] Insurance policy **inline edit** (today: add/remove). Liquidity SBLOC could optionally include a
      crypto haircut (excluded by design today).

## P6 follow-ups
- [x] **`evaluate-alerts` cron Edge Function** — built. Vendors the pure engines (amortization/networth/
      lookthrough/alertengine) under `supabase/functions/_shared/finance/` (invariant #1 — same engine,
      Deno-faithful copy; `deno check` clean + engine path run-verified on a synthetic portfolio). The
      function gates on `CRON_SECRET`, iterates opted-in users (those with an `alert_rules` row), rebuilds
      each balance sheet + look-through from current holdings, runs `evaluateAlerts`, and persists the
      breaching set to `alerts` with calm window-dedupe (won't re-nag a dismissed alert within its cadence)
      + auto-resolve (clears alerts that no longer breach). `schedule.sql` template + activation steps in
      HANDOFF. **ACTIVATION:** deploy the function, `supabase secrets set CRON_SECRET=…`, mirror it into
      Vault, then run `schedule.sql`. **Deferred (need a product call):** actual *push delivery* (email/web-
      push channel — ask).
- [x] **Read persisted alerts in-app** — `useAlerts` hook reads the `alerts` table (RLS-scoped). Risk tab
      keeps live eval but now filters by **persisted dismisses** and writes a dismiss to `alerts.dismissed_at`
      (cross-session; replaces the in-memory Set). Dashboard shows a calm `DashboardDigestStrip` from the
      persisted *open* alerts (tone by max severity, links to Risk), sparse/silent when empty (#7). Same
      `${kind}|${title}` keying + 28-day window as the cron, so the in-app and scheduled digests agree (#1).
      Render-verified via throwaway harness (high→coral / info→indigo / empty→silent). **Follow-up:** dismiss
      uses a `payload->>title` match + insert-if-none; lot-level history pruning is a later concern.
- [ ] **Sector concentration** in the alert engine + Risk tab (needs a company→sector source; crypto is the
      theme proxy today). Per-class rebalance-band override UI (engine already supports it; UI sets a global band).
- [x] **Dashboard hero** — lit up. `DashboardHero` (presentational, render-tested via throwaway harness
      with real engine output) shows **success probability** (reuses the Projection Monte Carlo call) +
      **largest single-name exposure** + the conservative P25 band (#4), plus the deterministic exposure
      narrative (reuses the Risk look-through→factor→narrative chain, #1). Calm, no daily delta (#6).

## P2 deferrals (need data we don't hold yet — sequence with their source)
- [ ] Sector concentration (needs a company→sector source, e.g. FMP profiles).
- [ ] Fee / expense-ratio analyzer (needs expense ratios).
- [ ] TWR / IRR (needs a dated transactions table — only cost-basis gain/loss is computable today).
- [ ] Dividends.
- [ ] Diversification-gap scanner (off-dashboard; needs P3 correlation/CMA data — now available).

## Hardening pass (spine, 2026-06-25) — DONE
- [x] **Render-test the populated charts** — extracted `WealthPathChart` (Projection) + `PhaseBar`
      (Glide-Path) as presentational components; drove the *real* chart code with *real* engine output
      (monteCarlo/solveYearsOfWork on synthetic inputs) via a temporary dev harness; screenshot-confirmed
      the P10–P90 band fan + teal median line + three-phase bar render. Harness removed; extractions kept.
      *(Still open: confirm with the user's own live holdings in an authed session — only they can.)*
- [x] **Code-split Recharts** — `React.lazy` + `Suspense` per tab in `AppShell`; initial bundle
      806→408 kB (233→117 kB gz). Recharts is now a separate ~84 kB-gz chunk, off the sign-in path.
- [x] **Settings: data export + delete-all** (invariant #10) — `lib/userData.ts`: export all 16
      user-scoped tables → JSON download; confirm-gated (type DELETE) delete-all of rows + statement
      files. Mount-verified; shared-cache tables deliberately excluded.

## Follow-ups / tech debt
- [ ] Two-stage CMA path (near-term valuation-adjusted → long-run) once near-term data is seeded.
- [ ] Full horizon-matched inflation *forward* rates in the Monte Carlo (currently uses the curve point per year).
- [ ] Confirm exact FMP / FRED endpoint shapes once keys are set (functions read defensively but untested live).
- [ ] Full account deletion (auth user + cascade) — needs a service-role Edge Function; client delete-all
      wipes data rows + files but leaves the (empty) login.
- [ ] Decide auth method (currently magic link) — switch to email+password if preferred.

## Keys to set for full live testing (all optional; graceful without)
- [ ] `supabase secrets set FINNHUB_API_KEY=…` · `FMP_API_KEY=…` · `FRED_API_KEY=…` · `ANTHROPIC_API_KEY=…`
