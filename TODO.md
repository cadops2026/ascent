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

## Next phases
- [ ] **P8 — (optional)**: account aggregation (Plaid/SnapTrade), spouse sharing, **AI overlay**
      (grounded exposure narration + plan Q&A) + **macro-context overlay** (context-not-signal, calm).

## P5 follow-ups
- [ ] Lot-level TLH + **wash-sale** date checks (today: holding-level from `cost_basis`).
- [ ] Wire real income/MAGI (when available) so NIIT/AMT/IRMAA move from prompts to computed.
- [ ] Re-verify the approx 2026 brackets/IRMAA/std-deduction against final IRS/SSA tables.

## P7 follow-ups
- [ ] **Estate-doc encrypted vault upload** — needs a Storage bucket + RLS (a migration, like the
      `statements` bucket); the checklist already tracks `file_ref`, upload UI is the remaining piece.
- [ ] Insurance policy **inline edit** (today: add/remove). Liquidity SBLOC could optionally include a
      crypto haircut (excluded by design today).

## P6 follow-ups
- [ ] **`evaluate-alerts` cron Edge Function** — server-side eval + persist to `alerts` (dismissed_at) +
      scheduled push. Vendor `alertengine.ts` under `supabase/functions/_shared/` so it reuses the one
      engine (invariant #1), never re-implements the thresholds.
- [ ] **Sector concentration** in the alert engine + Risk tab (needs a company→sector source; crypto is the
      theme proxy today). Per-class rebalance-band override UI (engine already supports it; UI sets a global band).
- [ ] **Dashboard hero** can now light up — narrative exposure (P2/P6) + success probability (P3) exist, so
      the "arrives P2/P3" placeholders are stale. Wire the real hero (runs MC + look-through like the tabs do).

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
