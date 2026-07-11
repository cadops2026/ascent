# ASCENT — Adversarial Review (2026-06-29)

Scope: formula/engine correctness, internal consistency, and alignment with current
leading financial practice for the owner's profile (high-income **W2 physician**, NJ;
"Jamzli" is an unmonetized side project, not a wealth position). Grounded in the actual
code on branch `balance-sheet-pricing-and-real-cma`. File:line references throughout.

**Bottom line.** The engineering is genuinely strong — careful tax math, correct
amortization and bond duration, disciplined invariants, a *seeded* Monte Carlo for the
right reasons. But there are **three structural modeling issues that bias the core
projection**, two of which are material at the dollar amounts involved, plus several
profile-specific strategy gaps for a high-income physician (most importantly **no way to
represent municipal bonds / fixed income**, **no tax-advantaged-space maximization read**
— backdoor/mega-backdoor Roth, 457(b), HSA — and **asset-protection / own-occupation
disability** are only lightly covered). Fix the P0 items before trusting the projection
for real decisions.

---

## Part 1 — Formula & engine correctness (severity-ranked)

### P0-A. Monte Carlo uses additive-normal returns with the published *geometric* CMA as the *arithmetic* drift
`src/lib/finance/montecarlo.ts:118-129`

Two coupled problems:

1. **Arithmetic vs geometric.** The houses (Vanguard/JPM/BlackRock/Invesco/MS) publish
   **geometric** (compound) long-run returns; these are seeded verbatim as the per-class
   `expectedReturn` (`reseed_real_cma.sql`). The sim then uses that number as the
   **arithmetic** one-year drift: `ret = mean + vol*shock`, `wealth *= (1+ret)`. In any
   multiplicative process the *median* compound growth ≈ arithmetic − σ²/2, so the median
   path lands **below** the very CMA the UI shows as the assumption.
2. **Additive normal allows impossible returns.** A normal one-year draw can produce
   `ret < −100%`, which is then clamped to ruin. This is a model artifact, not realism,
   and it dominates high-vol sleeves.

Quantified with the actual seeded numbers (40k sims, 30y, real terms):

| Portfolio | CMA-implied real | Simulated **median** | Drag/yr | Ruin |
|---|---|---|---|---|
| All US equity | 4.10% | **2.88%** | 1.22 pts | 0% |
| True 60/40 | 3.42% | 2.92% | 0.50 pts | 0% |
| HNW mix (eq/RE/PE/crypto/bonds/cash) | 4.45% | 3.49% | 0.97 pts | 0% |
| 50/50 equity/crypto | 6.85% | **−1.52%** | 8.37 pts | **18%** |
| All crypto | — | — | — | **76%** (4.7% of crypto-years draw < −100%) |

The equity median is understated ~30% over 30 years; the crypto/high-vol cases are
**broken**, not just conservative — the ruin is manufactured by the <−100% artifact.

**Fix (industry standard):** switch to **log-returns / geometric Brownian motion**:
`wealth *= exp(mu_log + sigma_log * shock)` with `mu_log = ln(1 + geoCMA)` (and
`sigma_log = ln(1+vol)` or the lognormal-matched moment). This simultaneously (a) makes
the median compound *exactly* at the published CMA, (b) eliminates the <−100% artifact,
(c) gives the correct right-skewed lognormal band. If you instead keep additive normal,
you must add σ²/2 back to the drift **and** truncate, and document the convention — but
log-returns is cleaner and is what Boldin/ProjectionLab/MoneyGuidePro do. This is the
single most important fix.

### P0-B. The asset taxonomy has no fixed income — a 60/40 investor is modeled as 100% equity
`src/lib/finance/networth.ts:10-17` (KIND_TO_CLASS) → `CLASS_MAP` in
`ProjectionTab.tsx:19`, `WorkGlidePathTab.tsx:17`, `TaxWithdrawalTab.tsx:25`,
`Dashboard.tsx:29`.

The balance-sheet classifier buckets **both `stock` and `etf` → `Equities`**, and every
`CLASS_MAP` collapses **`Equities` → `us_equity`**. Consequences:

- A Treasury/agg-bond/TIPS/muni **ETF is modeled as US equity** — 16% vol and 4.1% real
  instead of 5% vol and 2.4% real. There is **no way to represent a bond allocation** in
  the investable pie.
- The CMA rows `bonds`, `tips`, `intl_equity`, `commodities` are **dead** — seeded, but
  unreachable from real holdings. The "full-universe consensus CMA" is real in the data
  and unused by the engine.

Quantified — the *same* 60/40 portfolio, modeled correctly vs. as the app sees it:

| | p10 (30y) | p50 | p90 |
|---|---|---|---|
| True 60/40 (us_equity .6 / bonds .4) | 1.19x | 2.37x | 4.72x |
| **App models it as 100% us_equity** | 0.76x | 2.34x | 6.96x |

The app shows a conservative investor a **36%-worse downside and an inflated upside** —
it manufactures risk, which directly undercuts the "calm by default" thesis (invariant
#6) and makes the years-of-work / success-probability solvers wrong for anyone holding
bonds.

**Fix:** (1) add a fixed-income classification path — either a per-holding `asset_class`
tag or a symbol/kind heuristic that routes bond/TIPS/muni funds to `bonds`/`tips`, and
split US vs intl equity; (2) **extract the duplicated `CLASS_MAP` into one shared util**
(invariant #1 — "one source of truth per primitive" is currently violated by 4 copies).

### P1-C. NIIT is defined but never applied in the withdrawal/LTCG tax
`src/lib/finance/taxparams.ts:82-83` defines `niitRate 3.8%` + thresholds, but
`withdrawal.ts:taxAwareSourcing` (`:171-178`) taxes the taxable sleeve with `ltcgTax`
only — no NIIT. For this owner's MAGI, the 3.8% surtax almost always applies, so the
effective LTCG rate is **23.8%, not 20%**, and `effectiveRate`/`totalTax` are understated
on the gain portion. Meanwhile `coordinatePrompts` (`tax.ts:347`) *flags* NIIT — so the
app both flags it and silently omits it from its own computed tax. Either wire NIIT into
the taxable-sleeve tax (params already carry it) or label the computed figure "pre-NIIT."

### P1-D. AMT is not modeled — and ISO exercise is a founder's classic AMT event
No AMT exemption/threshold in `TaxParams`. For a founder exercising **ISOs**, the
bargain element is an AMT preference item — the most common way a founder gets a surprise
six/seven-figure tax bill. Spec promises "NIIT/AMT flags"; only a generic prompt exists
(`tax.ts:347`). At minimum model the AMT crossover on ISO exercise in the tax tab.

### P1-E. Guyton-Klinger guardrails are displayed but not simulated
`withdrawal.ts:guytonKlingerGuardrails` (`:95`) computes the trigger levels correctly,
but the Monte Carlo runs a **constant real withdrawal** — it never applies the 10%
spending cuts/raises inside the sim. So the success probability reflects a *more rigid*
spender than GK, understating sustainable spending (partially offsetting P0-A/B in the
opposite direction — two wrongs, not a cancel). To claim "dynamic guardrails" honestly,
apply the rule inside the simulated path and report the spending-cut distribution.

### P1-F. Single-factor correlation understates co-movement among safe assets
`montecarlo.ts:122-124`. The one-factor model forces corr(i,j) = corrᵢ·corrⱼ. Bonds
(0.15) × TIPS (0.10) ⇒ implied 0.015, when real bond/TIPS correlation is ~0.8. This
understates safe-sleeve covariance ⇒ understates portfolio vol ⇒ overstates success
probability. Defensible as an MVP, but it should be a documented limitation, and a full
Cholesky covariance matrix is the correct fix once fixed income exists (P0-B).

### P2 — smaller correctness items
- **No automated tests.** Zero `*.test.ts` for engines moving millions. Every fix above
  is unguarded against regression. Add unit tests with hand-checked fixtures (tax
  brackets, LTCG stacking, amortization, duration, MC median vs analytic) — this is the
  cheapest way to make "the base solid."
- **PE volatility (0.22) is the *smoothed* number.** Reported private-equity vol is
  appraisal-smoothed; true economic vol is ~30%+. Minor for this owner (no real private
  holding — Jamzli is unmonetized), but worth de-smoothing if any private stake is added.
- **`real_estate` holding-kind misclassifies as Equities.** `KIND_TO_CLASS`
  (`networth.ts:10`) has no `real_estate` key, so a REIT/real-estate *holding* (vs. the
  `real_estate` table) falls to `'Equities'` via the `?? 'Equities'` default.
- **Non-mortgage debt never amortizes** (`networth.ts:53`) — a HELOC/term loan stays at
  origination balance forever.
- **Estate uses the full $30M** (`estate.ts`) — assumes portability/credit-shelter is in
  place; correctly disclosed, but optimistic for a "quick number."
- **Crypto wash-sale over-restriction.** `tax.ts:113` applies a 30-day wash window to all
  taxable holdings including crypto; crypto is **not** currently subject to §1091 wash-
  sale, so the app may wrongly block harvestable crypto losses (a real, legal lever today).
- **Withdrawal sequencing is the textbook order** (taxable→deferred→Roth, `tax.ts:70`).
  Fine as a default, but modern practice *bracket-fills* tax-deferred in low-income years
  even when taxable exists. Worth surfacing as an option.

### What's correct (credit where due)
Seeded MC with the right rationale (calm hero, solver monotonicity); correct progressive
`ordinaryTax` and properly **stacked** `ltcgTax`; correct fixed-rate `amortize`; correct
**Macaulay duration** for mortgage-as-short-bond; correct forward-rate construction on the
inflation curve (cumulative-factor ratio); OBBBA estate $15M/$30M + 40%; SECURE 2.0 RMD
start ages (73/75) and Uniform Lifetime divisors; careful lot-level TLH with wash-sale
*risk* flagging; clean separation of pure engines from UI; real-vs-nominal handled
consistently (CMA real ⇒ no double-deflation). The Student-t standardization
(`randt`, `:76-84`) is mathematically correct (unit variance, df=4).

---

## Part 2 — Strategy fit for the owner's profile (high-income W2 physician)

**Profile:** W2 physician on a high salary (top federal bracket + NJ ~10.75% ⇒ ~46–48%
marginal, plus 3.8% NIIT and 0.9% additional-Medicare on the relevant income), a growing
liquid portfolio, a crypto sleeve, primary residence + mortgage, 529s, NJ resident,
planning to ~85. "Jamzli" is an unmonetized side project — model it as a small, illiquid,
speculative asset (~$0), **not** a wealth concentration. The physician playbook centers on
four things: **fill every tax-advantaged dollar, protect the assets and the income, invest
the taxable account tax-efficiently, and defuse the future RMD tax bomb.**

| # | Leading strategy for a high-income W2 physician | Why it matters here | ASCENT today |
|---|---|---|---|
| 1 | **Max all tax-advantaged space**: 401(k)/403(b) employee+employer, **mega-backdoor Roth** (after-tax + in-plan conversion) if the plan allows, **457(b)** (governmental = strong; non-governmental = employer-credit risk — the distinction matters), **HSA** invested as a "stealth IRA" | At a ~47% marginal rate, every sheltered dollar is the highest-certainty return you can get | **Gap** — accounts can be *tagged* (hsa/roth/etc.) but there's no "are you maxing / what's your remaining capacity" read, no mega-backdoor capacity, no 457(b) governmental-vs-non flag |
| 2 | **Backdoor Roth IRA** (income too high for direct), watching the **pro-rata rule** (keep $0 pre-tax IRA, or roll it into the 401(k) to clean it) | Standard high-earner Roth access; pro-rata is the classic trap | **Gap** — no backdoor-Roth / pro-rata read; Roth *conversion* explorer exists (`tax.ts:294`) but not the backdoor mechanics |
| 3 | **Asset protection** (the physician's #1 non-investment concern): high-limit **umbrella**, retirement-account creditor protection (ERISA plans = unlimited federal; IRAs protected under NJ/BAPCPA), **NJ tenancy-by-the-entirety** home titling, LLCs for any rental | Malpractice liability is the real tail risk; this is structural, not optional | **Partial** — insurance-gap + titling/beneficiary audit spec'd P7; no physician-specific liability/creditor-exposure framing — **verify built** |
| 4 | **Own-occupation, specialty-specific disability insurance** + adequate term life | Your future earnings are your largest asset; own-occ is the single most important policy a physician buys | **Partial** — disability/term in the insurance-gap readout (P7) — **verify built & sized to income** |
| 5 | **Tax-efficient taxable investing**: **NJ municipal bonds in taxable**, bonds/REITs in tax-deferred, growth in Roth, low-turnover total-market index funds, avoid high-distribution active funds | At ~47% + 3.8% NIIT, location and muni-vs-taxable-yield is a large, certain after-tax gain | **Gap** — **P0-B blocks this entirely: the app cannot represent a bond, let alone a muni.** Light location read only (`tax.ts:86`) |
| 6 | **Tax-loss harvesting + direct indexing** on the taxable account | Banks losses against future gains/income at a high bracket | **Covered** — lot-level TLH + wash-sale (`tax.ts:151`) |
| 7 | **Defuse the RMD tax bomb**: Roth conversions in the early-retirement low-income "valley" before RMDs/Social Security | High earners accumulate large 401(k)/403(b) → large RMDs at 73/75 → bracket spike; the conversion window is worth a lot | **Covered** — `rothConversion` with IRMAA (`tax.ts:294`); RMD projection (`tax.ts:262`). *But* P1-E: guardrails not simulated |
| 8 | **Don't reflexively kill a sub-4% mortgage** (cheap leverage / short bond) | Keep the spread and the liquidity | **Covered** — mortgage-as-short-bond (`mortgagebond.ts`) |
| 9 | **529 superfunding** (5-yr gift averaging) + **529→Roth** rollover (SECURE 2.0, $35k) | Education funding + leftover-to-Roth | **Covered** — 529s modeled |
| 10 | **Charitable**: DAF funded with appreciated taxable lots, **QCD** at 70½+ | Avoids cap-gains; QCD trims RMD/MAGI/IRMAA | **Partial** — flagged (`tax.ts:341-344`), not modeled |
| 11 | **Estate basics**: revocable trust, POA, healthcare directive, **guardianship for kids**, beneficiary/titling audit; net worth "likely to grow" → watch the $15M/$30M exemption over decades | Approaching the exemption over a career is realistic; the docs matter now | **Partial/Covered** — net-to-heirs + estate-doc vault spec'd; NJ $0 estate handled (`estate.ts`) |
| 12 | **Crypto**: specific-ID lots, harvest losses (no wash-sale rule applies to crypto today), custody/staking-income hygiene | A real, legal tax lever right now | **Partial** — fat-tailed in MC, but the TLH engine wrongly applies a wash window to crypto (P2) |
| 13 | **If Jamzli ever monetizes** (1099 side income): opens Solo-401(k)/SEP, cash-balance/DB plan, QBI | Contingent — not applicable while unmonetized | **Flagged** (`tax.ts:345`) — correctly contingent |

**Highest-value profile gaps for you:** (a) **#5 — the no-fixed-income/no-muni problem**
(this is P0-B wearing a tax hat: a high-bracket physician's bond allocation should largely
be NJ munis in taxable, and the app can't model a bond at all); (b) **#1/#2 — a
tax-advantaged-space maximizer** (backdoor + mega-backdoor Roth capacity, 457(b)
governmental-vs-non, HSA-as-investment) — the highest-certainty wins a physician has and
the app doesn't yet quantify them; (c) **#3/#4 — asset protection + own-occupation
disability**, which for a physician are first-order, not P7 afterthoughts. The
codebase's "private/founder equity" emphasis (spec §2, CLAUDE.md) is harmless but
mis-weighted for you — it's a $0 side bucket, not a thesis.

---

## Part 3 — Recommended remediation order

1. **P0-A** log-return Monte Carlo (median matches CMA, no <−100% artifact). *Engine.*
2. **P0-B** fixed-income taxonomy + single shared `CLASS_MAP`. *Engine + data model.*
3. **Tests** for both, with hand-checked fixtures, before touching anything else.
4. **P1-C/D** NIIT in the withdrawal tax; AMT/ISO crossover in the tax tab.
5. **P1-E** simulate guardrails (or stop calling them "dynamic").
6. **Profile features (physician)**: tax-advantaged-space maximizer (backdoor +
   mega-backdoor Roth capacity, 457(b) governmental flag, HSA-as-investment); NJ-muni
   asset-location once fixed income exists (rides on P0-B); asset-protection /
   own-occupation-disability readout promoted out of P7 — scoped as their own phase.
7. **P1-F / P2** Cholesky correlation, crypto-TLH fix, misc.

None of this is a rewrite — the architecture is sound and the pure-engine separation makes
each fix local and testable.
