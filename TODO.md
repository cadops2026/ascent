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

## Next phases
- [ ] **P5 — Tax & Withdrawal**: account-type tagging, withdrawal sequencing, Roth conversion explorer
      (IRMAA/ACA), RMDs, lot-level TLH + wash-sale, asset location, NIIT/AMT flags, charitable/DAF,
      cash-balance/QBI flags. *Model + flag + coordinate — never file (invariant #9).*
- [ ] **P6 — Risk & Exposure + alert engine**: narrative exposure + blast radius, factor/sector,
      drawdown stress (2000/2008/2022/crypto-winter), mortgage-as-short-bond, **alert-engine config +
      monthly digest** (pre-committed, threshold/event-driven, never price-triggered — invariant #7).
- [ ] **P7 — Estate & Protection**: full estate-tax exposure + net-to-heirs tab, doc checklist + secure
      vault, insurance-gap readout, liquidity/SBLOC, 529s. (Builds on the P1 net-to-heirs card.)
- [ ] **P8 — (optional)**: account aggregation (Plaid/SnapTrade), spouse sharing, **AI overlay**
      (grounded exposure narration + plan Q&A) + **macro-context overlay** (context-not-signal, calm).

## P2 deferrals (need data we don't hold yet — sequence with their source)
- [ ] Sector concentration (needs a company→sector source, e.g. FMP profiles).
- [ ] Fee / expense-ratio analyzer (needs expense ratios).
- [ ] TWR / IRR (needs a dated transactions table — only cost-basis gain/loss is computable today).
- [ ] Dividends.
- [ ] Diversification-gap scanner (off-dashboard; needs P3 correlation/CMA data — now available).

## Follow-ups / tech debt
- [ ] Live-test the Projection wealth chart + Glide-Path solved UI with a real session (math is tsx-verified;
      the populated charts haven't been render-tested — see `HANDOFF.md` note).
- [ ] Two-stage CMA path (near-term valuation-adjusted → long-run) once near-term data is seeded.
- [ ] Full horizon-matched inflation *forward* rates in the Monte Carlo (currently uses the curve point per year).
- [ ] Confirm exact FMP / FRED endpoint shapes once keys are set (functions read defensively but untested live).
- [ ] Recharts bundle (~720 kB / 211 kB gz) — code-split candidate.
- [ ] Settings: data export + delete-all controls (privacy; deletion supported by `on delete cascade`).
- [ ] Decide auth method (currently magic link) — switch to email+password if preferred.

## Keys to set for full live testing (all optional; graceful without)
- [ ] `supabase secrets set FINNHUB_API_KEY=…` · `FMP_API_KEY=…` · `FRED_API_KEY=…` · `ANTHROPIC_API_KEY=…`
