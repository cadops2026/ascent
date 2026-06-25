# Claude Code — Build Prompt: ASCENT

Paste this into Claude Code, in a fresh repo, alongside `ascent-master-spec.md`.

---

You are building **ASCENT**, a personal wealth cockpit. The full specification is in
`./ascent-master-spec.md` — **read it fully before writing any code; it is the source of truth.**
Build philosophy in one line: *measure exposure, steer toward intent, stay calm.* This is
decision-support, not advice, and not a trade feed.

## Stack (commit to this)
- **Frontend:** React + Vite + TypeScript + Tailwind. Charts: Recharts. (Backend is identical if I
  later switch to Expo; ask before assuming mobile.)
- **Backend:** Supabase — Postgres + Row-Level Security + Edge Functions (Deno) + scheduled functions.
- **Market/econ data:** Finnhub (equity/ETF quotes), CoinGecko (crypto), FMP (ETF holdings),
  FRED + Cleveland Fed (CPI, expected-inflation curve EXPINF*, breakevens, nowcast). **All API keys
  live in Supabase secrets. The browser calls Supabase only — never a third-party data API directly.**

## Hard rules (the invariants — violating any is a bug)
1. One source of truth per primitive (balance sheet, consensus-CMA, inflation curve, Monte Carlo,
   factor/look-through, alert engine, account-type tags). Features consume; never re-implement.
2. Every real-dollar figure reads from the single horizon-matched expected-inflation curve. Never
   hardcode inflation.
3. Every expected return reads from the consensus-CMA engine (full asset universe). Never hardcode
   returns.
4. Every projected number is a band with a confidence level and a visible sensitivity. No
   false-precision single figures.
5. Suggestions steer toward a chosen target; never forecast what will outperform. Allocation =
   contribution-first + tax-aware. 6mo/1yr = projected drift, not signals.
6. Calm by default: net worth present but de-emphasized; prices current (cached ~15-min) but never
   lead with a red/green daily delta; hero = exposure + success probability.
7. Alerts are low-frequency, pre-committed, threshold/event-driven — never price-triggered.
8. Principles overlay explains, never originates or overrides; math wins on conflict.
9. Estate/insurance/advanced-tax: model exposure, flag gaps, prompt the professional — never draft or
   file.
10. Primary residence: in net worth + estate, out of investable allocation; AVM value is a noisy
    manual input that never trips an alert. Crypto draws Student-t in the Monte Carlo, not normal.

## Design (from the spec's design system — follow exactly)
"Deep instrument" theme. IBM Plex Mono numerals as the hero; Space Grotesk display; Inter body;
uppercase micro-labels. One accent per view (teal/indigo/amber/coral as *meaning*, not decoration).
Mono numerals lead; every figure shows its band; assumptions always visible/editable; progressive
disclosure (glance → detail → engine internals); responsive (mobile = glance, desktop = depth);
sparse dismissible alerts; muted percentile-band charts, no animation-on-data.

## How to proceed
Build **one phase at a time, in order (P0 → P8 in the spec). After each phase: stop, summarize what
you built, run a self-check against the invariants, and wait for my confirmation before the next.**
Do not scaffold future phases ahead of time.

**Start now with P0 + P1:**
- P0: initialize the repo (Vite + TS + Tailwind), Supabase project, auth + RLS, the full data-model
  migration from the spec, and the design tokens as Tailwind theme + a small component kit
  (number/figure-with-band, stat card, panel, alert strip).
- P1: the Balance Sheet — manual holdings (ticker/shares or manual-amount + per-holding projected
  growth), real estate + mortgage (compute amortization, payoff date, residence vs investment split),
  private/founder equity + collectibles as manual assets, the `refresh-quotes`/`refresh-crypto` Edge
  Functions with keys in Supabase secrets, the allocation pie, the calm net-worth view, and the
  spending-baseline input.

**Definition of done for P1:** I can enter every asset and liability by hand (including a house with a
mortgage and a private holding), see a correct total net worth and allocation pie, see cached quotes
populate share-based holdings via the Edge Function (not the browser), enter a spending baseline, and
nothing leads with a daily delta. TypeScript strict, no client-side secrets, RLS enforced.

When P1 is done, write a `HANDOFF.md` (what's built, schema state, env/secrets set, what P2 needs,
open questions) and stop for my review.

Ask me before: introducing a new dependency, deviating from the spec, or making a product decision the
spec doesn't cover.
