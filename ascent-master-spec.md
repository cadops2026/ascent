# ASCENT — Master Build Spec (v1)
*Single source of truth. Supersedes the main spec + addenda 01–06 + the HNW/real-estate notes.*

---

## 0. What this is
A personal wealth cockpit for a HNW self-directed investor. It measures what you're exposed to,
steers you toward a target you chose, and keeps almost everything else quiet. **Decision-support,
not advice; not a trade feed.** The spine: *measure exposure, steer toward intent, stay calm.*

---

## 1. Invariants (the rules that keep the build consistent — never violate)
1. **One source of truth per primitive.** One balance-sheet/holdings store, one consensus-CMA engine,
   one inflation curve, one factor/look-through engine, one Monte Carlo, one alert engine, one
   account-type tag set. Features *consume* these; nothing re-implements them.
2. **Every real-dollar figure** reads from the single **horizon-matched expected-inflation curve**.
   No module hardcodes inflation.
3. **Every expected-return input** reads from the **consensus-CMA engine** (covers the full asset
   universe incl. real estate, commodities, TIPS, private). No module hardcodes returns.
4. **Every projected number is a band** with a confidence level and a visible sensitivity. No
   false-precision single figures anywhere.
5. **Suggestions steer toward a chosen target; they never forecast what will outperform.** Allocation
   = contribution-first + tax-aware. Diversification = correlation-gap, not timing. 6mo/1yr views =
   projected drift, not signals.
6. **Calm by default.** Net worth is present and complete but de-emphasized; prices are current
   (cached ~15-min) but the UI never leads with a red/green daily delta; the hero is
   exposure-to-your-own-risk + success probability.
7. **Alerts are low-frequency, pre-committed, threshold/event-driven — never price-triggered.** One
   engine → the digest.
8. **The principles overlay explains; it never originates or overrides.** Math wins on conflict.
9. **For estate / insurance / advanced tax: model exposure, flag gaps, sharpen the professional
   conversation.** Never draft documents or file returns.
10. **Security/privacy.** All third-party data keys live server-side (Supabase Edge Functions); the
    browser calls Supabase only; aggregation is opt-in and deferred (manual-entry-first MVP);
    read-only connections; data deletion supported.
11. **The primary residence** counts in net worth and estate but is held **out of the
    investable-allocation math**; investment property is a real allocation; AVM value is a noisy
    manual input that never trips an alert.
12. **Fat-tailed sleeves** (crypto) draw from class-specific distributions (Student-t) in the Monte
    Carlo — not all-normal.

---

## 2. Shared engines
- **Balance sheet** — all assets/liabilities: linked + manual; public securities, crypto, real
  estate, private/founder equity (founder stakes), collectibles, cash; mortgages and other debt;
  unfunded capital commitments as liabilities. Feeds every other module.
- **Consensus-CMA engine** — forward expected returns per asset class blended across Vanguard /
  J.P. Morgan / Invesco / BlackRock / Morgan Stanley, with visible dispersion; two-stage path
  (near-term valuation-adjusted → long-run after ~yr 10); covers the full asset universe.
- **Inflation curve** — Cleveland Fed model-based expected inflation (1–30yr, FRED EXPINF*),
  risk-premium-stripped; daily nowcast for the front; breakevens + surveys as cross-checks. Every
  deflator is horizon-matched off this curve.
- **Monte Carlo** — ≥1,000 sims (allow 10k); per-asset-class distributions (Student-t for crypto);
  produces percentile bands at any horizon; powers success probability, scenario bands, work-glide.
- **Factor / look-through engine** — decomposes holdings (direct + inside ETFs, + home as RE factor)
  into single-name, sector, and factor exposure. Feeds AI-narrative exposure, concentration alerts,
  diversification scan, allocation drift.
- **Allocation/rebalancing** — drift to target; contribution-first routing; tax-aware trims on band
  breach only; concentration overrides.
- **Alert engine** — pre-committed thresholds (rebalance bands, single-name + narrative ceilings, TLH
  windows, plan-input changes, mortgage-payoff events, insurance gaps, estate-doc staleness) →
  monthly digest + event-driven. Never price-triggered.
- **Principles overlay** — Bogle/Graham/Munger/advice-Buffett, attached deterministically to states;
  explains only; sparse.
- **AI overlay (grounded, calm)** — narrates *your own* exposure (look-through themes, blast radius)
  and answers plan questions, grounded in the balance sheet + engines; explains and quantifies,
  never forecasts or originates a view (invariants #5, #8). Backed server-side (Edge Function → LLM,
  default Claude; key in Supabase secrets; browser → Supabase only, invariant #10).
- **Macro-context overlay (context-not-signal)** — optional, low-frequency, on-demand read that
  frames current conditions against *your* exposure and the *long-run* CMA, explicitly as context,
  not a signal: it never emits an alert, never implies a trade, and always carries a don't-overreact
  reminder. Consensus from the major houses enters only *structurally* (the CMA engine + inflation
  curve), never as tactical sentiment. Deliberately sized to **dampen reactivity — the single biggest
  risk is a large reactive move.**

---

## 3. Tabs (consolidated)
1. **Dashboard** — hero = AI-narrative exposure + success probability; net worth (complete, calm) +
   trend; sparse alert strip; allocation snapshot. Mobile = glance.
2. **Balance Sheet / Holdings** — linked + manual + **assisted import**; ticker/shares or
   manual-amount + per-holding projected growth; **real estate + mortgage** (amortization computed;
   residence vs investment split; payoff date); private/founder equity; collectibles; cached prices;
   allocation pie; **spending baseline**; TWR + IRR; fee/expense-ratio analyzer; dividends.
   **Assisted import:** drop statements (PDF/CSV/scans) into an RLS-locked Storage bucket → server-side
   `parse-statements` (Claude) extracts accounts/holdings/cost-basis/liabilities → **review-and-confirm
   before anything writes to the balance sheet** (parsed numbers never silently trusted). Feeds the one
   balance sheet (invariant #1); raw files are owner-only and deletable (invariant #10). A middle path
   between manual entry and the deferred P8 live aggregation.
3. **Look-through** — top-10 underlying companies (direct + inside ETFs), single-name + sector
   concentration; home as RE-factor exposure.
4. **Projection (ASCENT)** — consensus CMA + two-stage; horizon-matched inflation; Monte Carlo
   success probability (25th-pct shown); accumulation→decumulation; **scenario horizons**
   (bear/base/bull at 6mo–15yr, percentile-based); **dynamic withdrawal guardrails** (Guyton-Klinger);
   what-if + side-by-side compare; historical backtest; Sankey cash-flow; optional retirement
   **bucketing** view.
5. **Work Glide-Path** — three phases (full work → downshift/partial-draw bridge → pure drawdown);
   headline = **years of full work remaining** @confidence with sensitivity strip; maintain-wealth
   fork; healthcare bridge; sequence-risk surfaced. Solve-mode of the projection engine.
6. **Tax & Withdrawal** — account-type tagging; tax-efficient withdrawal sequencing; Roth conversion
   explorer (IRMAA/ACA effects); RMDs; lot-level TLH + wash-sale; asset location; NIIT/AMT flags;
   charitable/DAF (appreciated-stock, QCD); **cash-balance/DB plan + Solo401k/SEP + QBI** flags.
   *(Model + flag + coordinate — not file.)*
7. **Risk & Exposure** — AI-narrative exposure + blast radius; factor/sector; drawdown stress
   (2000/2008/2022/custom + crypto-winter); **mortgage-as-short-bond**; the alert-engine config.
8. **Estate & Protection** — estate-tax exposure (federal $15M/$30M permanent per OBBBA; NJ no estate
   tax, Class A exempt) + net-to-heirs; **doc checklist + secure vault** (revocable trust, POA,
   healthcare directive, guardianship, beneficiary/titling audit); **insurance-gap readout**
   (disability, umbrella, term life, LTC, entity/LLC protection); **liquidity & SBLOC**
   (T-bill ladders, borrow-don't-sell); **529s**.
   *(Plus Reports/digest + Settings: data sources, assumptions, sharing, privacy.)*

**Diversification-gap scanner** lives as a low-frequency readout feeding the *target* (Risk/Settings),
**off the daily dashboard**: favorability = correlation-benefit × premium ÷ cost; recognizes existing
exposure (home included); biases cheap/liquid/simple; usually says "adequately diversified."

---

## 4. Data model (Postgres / Supabase; RLS = auth.uid())
```
profiles(user_id, dob, retire_age, plan_to_age, filing_status, state, share_with[])
accounts(id, user_id, name, tax_type[taxable|trad_401k|roth|hsa|...], institution, aggregator_ref, balance_cached, updated_at)
holdings(id, user_id, account_id, symbol, name, kind[stock|etf|crypto|real_estate|private|collectible|cash],
         entry_mode[shares|amount], shares, manual_amount, proj_growth, cost_basis)
real_estate(id, user_id, kind[residence|investment], market_value, value_source, as_of)
liabilities(id, user_id, kind[mortgage|other], orig_balance, rate, term_months, start_date, property_id)
spending_baseline(user_id, annual_amount, by_category jsonb, source[manual|linked])
quote_cache(symbol, price, prev_close, updated_at)                 -- equity/etf/crypto; edge-fn write
etf_holdings(etf_symbol, holding_symbol, holding_name, weight, asof)
cpi_cache(series, asof_month, index_value)
infl_expectations_cache(horizon_years, value, source, asof)        -- EXPINF*, breakevens
nowcast_cache(index, asof_day, value)
cma_sources(asset_class, house, value, exact, asof)
asset_class_universe(class, cma_premium, vol, corr_to_us_equity, cost_proxy, liquidity, gate)
target_allocation(user_id, asset_class, target_pct, glide jsonb)
rebalance_bands(user_id, asset_class, abs_pts, rel_pct)
scenarios(id, user_id, name, params jsonb, is_base)
phase_plan(user_id, downshift_age, retire_age, phase2_income_frac, phase2_years, maintain_mode,
           legacy_target, confidence_target, withdrawal_guardrails jsonb, lifestyle_by_phase jsonb)
alert_rules(user_id, rebalance_band_pt, single_name_pct, narrative_pct, tlh_min_loss, cadence)
alerts(id, user_id, kind, payload jsonb, created_at, dismissed_at)
net_worth_snapshots(user_id, asof_date, total, by_class jsonb)
insurance_policies(user_id, kind, carrier, coverage, premium, owner, beneficiary)
estate_docs(user_id, doc_type, status, last_reviewed, file_ref)
```

---

## 5. Backend — Edge Functions (Deno) + cron. Keys in Supabase secrets. **Browser → Supabase only.**
```
refresh-quotes(symbols[])      Finnhub (equity/etf) → quote_cache; TTL ~15m; rate-limit
refresh-crypto(symbols[])      CoinGecko → quote_cache
refresh-etf-holdings(etfs[])   FMP top ~25 by weight → etf_holdings; weekly
refresh-inflation()            FRED: daily breakevens + Cleveland nowcast; monthly CPI + EXPINF curve (CPI-release day)
snapshot-networth              daily cron → net_worth_snapshots
evaluate-alerts                daily/weekly cron → alert_rules diff → alerts
parse-statements(import_id)    Storage (RLS) → Claude → structured candidate rows → review queue (no auto-commit)
sync-accounts (deferred)       Plaid/SnapTrade read-only → accounts/holdings
```
Statement import adds a **private Storage bucket** (RLS = owner only) + an **Anthropic (Claude) key in
Supabase secrets** + a `statement_imports` review table. Browser uploads to Storage and reads the
review queue; only the Edge Function calls Claude. Raw files are deletable.
Providers: **Finnhub** (quotes, free tier ok for one user) · **CoinGecko** (crypto, free) · **FMP**
(ETF holdings; verify exact endpoints) · **FRED/Cleveland Fed** (CPI, EXPINF*, breakevens, nowcast —
free). Aggregation **deferred** (Plaid/SnapTrade) — manual-entry-first MVP.

---

## 6. Design system + UI principles ("deep instrument")
**Tokens** — bg #0B0F14 · panel #111922 / #161F2A · border #232E3B · text #E8EEF4 · muted #93A1B2 ·
faint #5C6878 · teal #36C6B0 (primary/median/positive) · indigo #7C93E8 (secondary/band) ·
amber #E6A84B (caution) · coral #EB6A52 (negative). Optional light theme.
**Type** — Space Grotesk (display) · IBM Plex Mono (all numerals/data, the hero) · Inter (body);
uppercase micro-labels with letter-spacing.
**Principles** — (1) mono numerals lead; (2) color = meaning, one accent per view; (3) every figure
shows its band; (4) assumptions always visible + editable; (5) progressive disclosure: glance →
detail → engine internals; (6) calm by default (no daily-delta dopamine); (7) responsive — mobile =
glance (hero + alerts), desktop = depth; (8) alerts sparse, dismissible, pre-committed.
Charts = percentile bands + markers, muted, no animation-on-data. Data-dense but breathable;
hairline separators.

---

## 7. Phased build plan (incremental, testable; stop + confirm between phases)
- **P0 Foundation** — repo, Supabase, auth/RLS, data model, design tokens.
- **P1 Balance sheet** — manual holdings + real estate/mortgage (amortization, residence/investment
  split) + private/passion assets + cached quotes (Finnhub/CoinGecko) + allocation pie + net worth
  (calm) + spending baseline. *(P1 also ships the net-to-heirs snapshot card.)*
- **P1.5 Assisted import** — drop statements (PDF/CSV/scans) → RLS-locked Storage → `parse-statements`
  (Claude, server-side) → review-and-confirm → balance sheet. Cuts the manual-entry burden; writes
  into P1's model, so it follows P1.
- **P2 Analysis** — look-through top-10 + factor/concentration (home as RE factor) + fee analyzer +
  TWR/IRR + benchmark + dividends + diversification-gap scanner (off dashboard).
- **P3 Projection** — consensus CMA + two-stage + inflation curve (FRED/Cleveland) + Monte Carlo
  (per-class dists, crypto Student-t) + scenario horizons + success prob + dynamic-withdrawal
  guardrails + what-if/compare + backtest.
- **P4 Work glide-path + principles overlay.**
- **P5 Tax & withdrawal** (account tags, sequencing, Roth, RMD, TLH/wash-sale, IRMAA, asset location,
  NIIT/AMT, charitable/DAF, cash-balance/QBI flags).
- **P6 Risk & exposure + alert engine + reports/digest.**
- **P7 Estate + insurance/protection + liquidity/SBLOC + 529s.**
- **P8 (optional)** aggregation (Plaid/SnapTrade), spouse sharing, **AI overlay** (grounded exposure
  narration + plan Q&A), **macro-context overlay** (context-not-signal, calm, low-frequency), polish.

Build the spine (P0–P4) first — it's the differentiated core.

---

## 8. Honest cautions
- **Build-vs-buy:** Boldin / ProjectionLab already do deep withdrawal sequencing, Roth windows,
  RMD/IRMAA/ACA well (~$120–144/yr). Treat P5 as build-if-you-want; the spine (P0–P4) and the
  exposure/estate/insurance layers are where this app is unique.
- **Manual-entry-first MVP** — defer account aggregation; 90% of the value, none of the OAuth/cost/
  security surface.
- **"Real-time" is ~15-min delayed.** Label honestly; never imply tick-by-tick.
- **AVM home value is noisy** (±5–10%, revises constantly) — manual, optionally refreshed, never
  trips an alert. Don't over-financialize the home; don't reflexively kill a sub-4% mortgage.
- **Estate/tax/insurance = model + flag + coordinate**, not draft/file. Not investment advice.
- **The biggest risk is a large reactive move, not a wrong number.** Every surface — AI overlay,
  macro context, alerts, the dashboard itself — is sized to *reduce* reactivity, never manufacture
  it: context not signals, bands not single figures, calm by default. An AI/market layer that fed
  live sentiment would invert the entire thesis; it stays grounded (your data) or structural (CMA),
  never tactical.
```
