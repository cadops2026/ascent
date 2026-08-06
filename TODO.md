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

## Next phases — P8 (optional)
- [x] **AI overlay (grounded)** — `advisor` Edge Function → Claude (`claude-opus-4-8`, overridable;
      ANTHROPIC_KEY in secrets; browser→Supabase only #10). Auth-gated. System prompt enforces the
      invariants: explains/quantifies the user's OWN context, never forecasts (#5), never overrides the
      math (#8), calm/anti-reactive, prompts the professional for tax/estate (#9). `AdvisorPanel` on the
      Dashboard assembles a compact grounded context (alloc, top names, success prob, end-wealth band,
      ages/spend, narrative) + Ask / "Explain my exposure". Degrades gracefully with no key. Deno-checked;
      AdvisorView render-tested (idle/answer/no-key). **ACTIVATION:** `supabase functions deploy advisor`
      + `supabase secrets set ANTHROPIC_API_KEY=…`.
- [x] **Macro-context overlay** (context-not-signal, calm) — `macrocontext.ts` computes the blend's
      portfolio-weighted consensus expected return (nominal + house-dispersion band + real after the
      horizon-matched inflation curve); `MacroContextCard` on the Projection tab frames it as long-run
      structural context with a don't-overreact reminder. Deterministic — consensus enters only via the
      CMA engine, never live sentiment; never an alert/signal (#5/#7/#8). Engine hand-verified (6.7% nom /
      4.2% real on a 60/18/12/10 blend); card render-tested.
- [ ] **Account aggregation** (Plaid/SnapTrade) — deferred MVP; needs the provider OAuth + a `sync-accounts`
      function. Blocked on you (provider account/keys).
- [ ] **Spouse sharing** — the `share_with[]` column exists; needs RLS share policies + invite UI.

## P5 follow-ups
- [x] **Lot-level TLH + wash-sale date checks** — new `tax_lots` table (RLS owner-only; migration
      `20260628000000`, graceful — degrades to the blended `cost_basis`). Engine `tlhLotOpportunities`
      values each dated lot at the holding's current price-per-share, surfaces underwater lots with
      short/long-term character, and flags **wash-sale risk** when a same-security lot was acquired within
      30 days (separating harvestable losses from wash-blocked). Tax tab: lot-aware TLH panel + a
      `TaxLotsEditor` (add/remove dated lots per taxable holding). Engine hand-verified via tsx
      (harvestable 5000 / wash-blocked 2000; flips to 7000/0 with no recent buy; IRA skipped); panel
      render-tested (screenshot). `tax_lots` added to the data export/delete list (#10). **ACTIVATION:**
      `supabase db push` to create the table (until then lots can't be saved; harvesting still works at the
      blended basis).
- [ ] Wire real income/MAGI (when available) so NIIT/AMT/IRMAA move from prompts to computed.
- [x] **Re-verify the 2026 brackets/IRMAA/std-deduction vs final tables** — done against IRS Rev. Proc.
      2025-32 + CMS/SSA 2026. Corrected all bracket thresholds (3 schedules), standard deduction
      (16,100/32,200/24,150), LTCG breakpoints, and Part B IRMAA surcharges. Fixed a real bug: the married
      IRMAA top-finite tier is $750k, not 2×$500k=$1M (added an explicit `magiUpToMarried`). RMD table +
      NIIT + estate exemption already correct. Engine-verified (ordinaryTax/ltcg/irmaa hand-calcs).

## P7 follow-ups
- [x] **Physician protection readout** — the two engines a presence-based insurance checklist misses.
      `disability.ts` (`disabilityView`): human capital = PV of remaining after-tax earnings to retirement,
      **banded** by discount rate (#4); reads each policy's *terms* rather than its amount — own-occ
      definition tier (specialty/true/modified/any-occ), benefit tax character (employer-paid ⇒ taxable, so
      a group benefit is discounted at the marginal rate), benefit period vs the working horizon, residual/
      COLA/non-cancelable riders — and measures the gap against BOTH the spending floor and full after-tax
      income. Shortfall severity scales with the size of the hole, not its existence (#6 — a 99%-covered
      near-miss must not shout). `assetprotection.ts` (`assetProtectionView`): sorts the balance sheet into
      creditor-exposure tiers by `accounts.tax_type` (ERISA employer plan = strong · IRA = capped · HSA/529/
      residence = state law · **solo-401(k) = depends**, since an owner-only plan is generally not ERISA ·
      taxable/rental = reachable), sizes umbrella against *reachable* assets, and reads the professional-
      liability form (**claims-made with no tail = high flag**, the classic missed exposure) + reachable
      assets above the per-claim limit. State note is NJ-specific where known, generic otherwise.
      **Invariant #1 honored:** `insuranceGaps` now takes `reachableAssets` + `disabilityStatus` so the
      summary line can never contradict the detail panel (tested both ways). Model exposure + flag gaps +
      prompt counsel; asserts no legal conclusion (#9). New `PhysicianProtectionPanels` (presentational,
      pure props) + policy-terms editor behind a disclosure + `profiles.earned_income` input.
      **24 new tests (51 total)**, engine numbers hand-verified, and both panels render-verified end-to-end
      against a stub backend. **ACTIVATION:** `supabase db push` for migration `20260806000000` (adds
      `insurance_policies.details` jsonb + `profiles.earned_income`) — degrades with a clear in-UI message
      until then.
- [ ] Wire real disability *elimination-period* bridge against the cash buffer (needs the emergency-fund split).
- [x] **Estate-doc encrypted vault upload** — private `estate-docs` Storage bucket + owner-only RLS
      (migration `20260625210000`, mirrors the `statements` bucket). DocRow in the Estate tab now uploads to
      `<uid>/<doc_type>/<file>`, records `estate_docs.file_ref`, and offers signed-URL **View** / **Remove**
      (replace removes the old object). Model + store, never draft/file (#9/#10). Render-verified (upload vs
      file-present states). **ACTIVATION:** `supabase db push` to create the bucket+policies (degrades
      gracefully — upload shows a clear error until then).
- [x] **Insurance policy inline edit** — Estate tab policy rows are now editable in place (`PolicyRow`:
      type / carrier / coverage / premium, dirty-tracked Save + Remove) instead of add/remove only.
      No schema change. tsc/build/lint green.
- [ ] Liquidity SBLOC could optionally include a crypto haircut (excluded by design today).

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
      theme proxy today).
- [x] **Per-class rebalance-band override UI** — Risk tab now loads/saves the `rebalance_bands` table (RLS
      owner-only; no migration needed) and renders a per-class drift-points input (blank = the global band).
      The overrides flow as `BandSpec[]` into BOTH the alert digest and the diversification map, so a tighter
      band on a volatile sleeve flags sooner everywhere at once (invariant #1). Save replaces the band set
      wholesale so clearing reverts to global. Verified end-to-end via tsx: a per-class band flips the breach
      in both consumers and they always agree. tsc/build/lint green.
- [x] **Dashboard hero** — lit up. `DashboardHero` (presentational, render-tested via throwaway harness
      with real engine output) shows **success probability** (reuses the Projection Monte Carlo call) +
      **largest single-name exposure** + the conservative P25 band (#4), plus the deterministic exposure
      narrative (reuses the Risk look-through→factor→narrative chain, #1). Calm, no daily delta (#6).

## P2 deferrals (need data we don't hold yet — sequence with their source)
- [ ] Sector concentration (needs a company→sector source, e.g. FMP profiles).
- [ ] Fee / expense-ratio analyzer (needs expense ratios).
- [ ] TWR / IRR (needs a dated transactions table — only cost-basis gain/loss is computable today).
- [ ] Dividends.
- [x] **Diversification-gap scanner** — `diversification.ts` `diversificationScan(byClass, targets, bands,
      rules)`: per-class over/under gap vs the chosen target, unfilled target slots (intended but unheld),
      uncovered exposure (held with no target), an alignment score (1 − total-variation distance), and the
      band-breach count. Reuses the alert engine's exact drift predicate (extracted `evalClassDrift`,
      invariant #1) so its "beyond band" tag can never contradict the digest. `DiversificationPanel` on the
      Risk tab (center-anchored over/under bars; context-not-signal, #5/#7). Engine hand-verified (alignment
      0.75, holes/uncovered correct, alert-engine output unchanged after the refactor); panel render-tested
      across drifted/aligned/no-target states; vendored alertengine mirror `deno check`-clean. tsc/build/lint green.

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
- [x] **Full horizon-matched inflation *forward* rates in the Monte Carlo** — `InflationCurve` now exposes
      `forwardRate(y)` (marginal one-year rate for year y, implied by the average curve via the cumulative
      factors C(y)/C(y−1)−1); the MC deflates each year by that instead of the average-to-horizon rate.
      By construction ∏(1+forward) = (1+avg_H)^H, so cumulative real wealth is exact on a sloped curve.
      Flat curve → forwards == average, so the default seeded case is byte-identical (no regression).
      Verified against the real engine (identity to 1e-9; flat-curve MC unchanged). `rateForHorizon` kept
      for single end-value deflation (macro-context). tsc/build/lint green.
- [ ] Confirm exact FMP / FRED endpoint shapes once keys are set (functions read defensively but untested live).
- [x] **Full account deletion (auth user + cascade)** — `delete-account` Edge Function (auth-gated;
      recursively removes the user's Storage objects in both buckets, then `admin.auth.admin.deleteUser`
      → cascades every user-scoped row). Settings "Delete my account" now calls it (graceful fallback to
      the client data-wipe if the function isn't deployed). Completes invariant #10. **ACTIVATION:**
      `supabase functions deploy delete-account`.
- [ ] Decide auth method (currently magic link) — switch to email+password if preferred.

## Keys to set for full live testing (all optional; graceful without)
- [ ] `supabase secrets set FINNHUB_API_KEY=…` · `FMP_API_KEY=…` · `FRED_API_KEY=…` · `ANTHROPIC_API_KEY=…`
