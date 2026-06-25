# CLAUDE.md — ASCENT

Guidance for Claude Code working in this repository. These rules are durable across every
session; the build prompt (`ascent-claude-code-prompt.md`) is a one-time directive, this file
persists.

## What ASCENT is

A personal wealth cockpit for a HNW self-directed investor. It **measures exposure, steers toward
a target you chose, and keeps everything else quiet.** Decision-support, *not* advice; *not* a
trade feed. The spine: *measure exposure, steer toward intent, stay calm.*

**`ascent-master-spec.md` is the source of truth — read the relevant section before writing code.**
This file is the summary; the spec is the canonical detail (12 invariants, shared engines, 8 tabs,
data model, Edge Functions, design system, P0→P8 plan).

## Stack (locked — ask before deviating)

- **Frontend:** React + Vite + TypeScript (strict) + Tailwind. Charts: Recharts. Web only unless
  I say otherwise — ask before assuming mobile/Expo.
- **Backend:** Supabase — Postgres + Row-Level Security (`auth.uid()` on every table) + Edge
  Functions (Deno) + scheduled functions.
- **Data:** Finnhub (equity/ETF quotes) · CoinGecko (crypto) · FMP (ETF holdings) · FRED +
  Cleveland Fed (CPI, EXPINF* expected-inflation curve, breakevens, nowcast). Aggregation
  (Plaid/SnapTrade) is **deferred** — manual-entry-first MVP.

## Invariants (never violate — full text in spec §1)

1. **One source of truth per primitive** — one balance sheet, one consensus-CMA engine, one
   inflation curve, one factor/look-through engine, one Monte Carlo, one alert engine, one
   account-type tag set. Features *consume*; nothing re-implements.
2. Every **real-dollar** figure reads the single **horizon-matched expected-inflation curve**.
   Never hardcode inflation.
3. Every **expected return** reads the **consensus-CMA engine** (full asset universe). Never
   hardcode returns.
4. **Every projected number is a band** with a confidence level + visible sensitivity. No
   false-precision single figures.
5. **Suggestions steer toward a chosen target; never forecast what will outperform.** Allocation =
   contribution-first + tax-aware. 6mo/1yr = projected drift, not signals.
6. **Calm by default.** Net worth present but de-emphasized; prices cached ~15-min but never lead
   with a red/green daily delta; hero = exposure + success probability.
7. **Alerts are low-frequency, pre-committed, threshold/event-driven — never price-triggered.**
8. **Principles overlay explains, never originates or overrides.** Math wins on conflict.
9. **Estate / insurance / advanced tax: model exposure, flag gaps, prompt the professional —
   never draft documents or file returns.**
10. **Security:** all third-party keys live in Supabase secrets; **the browser calls Supabase
    only, never a third-party data API directly.** Read-only connections; data deletion supported.
11. **Primary residence** counts in net worth + estate, **out** of investable-allocation math;
    AVM value is a noisy manual input that never trips an alert.
12. **Fat-tailed sleeves** (crypto) draw class-specific distributions (Student-t) in the Monte
    Carlo — not all-normal.

## Build discipline

- **One phase at a time, in order (P0 → P8 in spec §7).** After each phase: stop, summarize what
  you built, self-check against the invariants, and **wait for my confirmation** before the next.
  Do not scaffold future phases ahead of time.
- Build the spine (**P0–P4**) first — it's the differentiated core.
- **Ask me before:** introducing a new dependency, deviating from the spec, or making a product
  decision the spec doesn't cover.
- **TypeScript strict. No client-side secrets. RLS enforced.** These are pre-ship hard checks.
- Write/update `HANDOFF.md` at the end of each phase (what's built, schema state, env/secrets set,
  what the next phase needs, open questions), then stop for review.

## Design system ("deep instrument" — full tokens in spec §6)

IBM Plex Mono numerals are the hero; Space Grotesk display; Inter body; uppercase micro-labels.
One accent per view (teal/indigo/amber/coral as *meaning*, not decoration). Every figure shows its
band; assumptions always visible + editable; progressive disclosure (glance → detail → engine
internals); responsive (mobile = glance, desktop = depth); sparse dismissible alerts; muted
percentile-band charts, no animation-on-data.

## Repo layout

One flat repo (web app — no docs/code split). `ascent-master-spec.md` + the build prompt live at
root. App code in `src/`; Supabase migrations + Edge Functions under `supabase/`.
