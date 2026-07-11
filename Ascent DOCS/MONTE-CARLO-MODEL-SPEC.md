# ASCENT — Monte Carlo: the "best-practice" model, multi-source verified (2026-06-29)

Goal: replace the current additive-normal sim with the model the leading planning engines
and retirement researchers actually use, verified across **independent practitioner,
commercial-tool, and academic sources** — not asserted from memory. This supersedes the
P0-A fix in the adversarial review: do it *as this model*, not a one-line patch.

---

## 1. What "the way" is (the consensus)

There are **two families** the top pros use; the most rigorous engines offer both and
cross-check them:

**A. Parametric Monte Carlo (the industry standard).** Simulate **log returns as normally
distributed** (⇒ simple returns lognormal / geometric Brownian motion), using the
**arithmetic** mean as drift, with a **full covariance matrix** across asset classes drawn
via **Cholesky decomposition**. Used by MoneyGuidePro, eMoney, RightCapital, Boldin,
ProjectionLab, MSCI. Enhancements the research says materially improve accuracy:
**fat tails (Student-t, df 4–6)**, **regime-switching / tail-dependent correlations**.

**B. Historical block-bootstrap (the researcher's cross-check).** Resample *actual*
historical returns in **3–5 year blocks** to preserve serial correlation, mean reversion,
real fat tails, and real cross-asset correlation — without assuming any distribution. Used
by Pfau/Retirement Researcher, cFIREsim, and offered alongside parametric in ProjectionLab.

Both are legitimate; they answer slightly different questions. The strongest tools run
parametric *and* offer historical, and reconcile the two.

---

## 2. Multi-source verification (claim → independent sources)

| Claim (what the model must do) | Independent sources confirming it |
|---|---|
| **Use the ARITHMETIC mean as the drift, not geometric** — geometric already embeds volatility drag, so feeding geometric in double-counts it and *understates* outcomes | Kitces *Volatility Drag* [1]; Kitces via *Financial Planning* [2] (50/50 example: 7.5%→6.65%, success 87%→76%); **Boldin** literally switched **CAGR→AAGR** "to avoid double-counting volatility" [5][6] |
| geometric ≈ arithmetic − ½·variance; convert by **adding ½·variance back** to the CMA | Kitces [1][2]; eMoney/industry [14] |
| **Lognormal / geometric Brownian motion on log returns** (no impossible <−100% returns; correct right-skew) | Academic GWN model, Zivot [10]; eMoney/MSCI "GBM with lognormal returns, convert arithmetic CMAs to log returns" [3][14][15]; ProjectionLab "lognormally distributed with a mean arithmetic return" [13] |
| **Full covariance matrix + Cholesky** for correlated assets (a single-factor "correlation-to-one-index" model is inadequate) | Zivot multivariate-normal w/ Σ [10]; Kitces *Correlation Matrix* [3]; MSCI/NumberAnalytics "Cholesky decomposition to generate correlated normals" [3][15] |
| **Correlations spike in crises** — static matrices overstate diversification; model tail dependence / regime-dependent correlation | Kitces [3]; Morningstar/Blanchett [8]; quantdecoded (regime-switching) [7] |
| **Fat tails matter** — normal MC understates failure by 10–17 pts; Student-t (df 4–6) roughly **doubles** failure (4% WR: 11%→22%); combined fat-tails+regime+autocorrelation → **28% vs 11%** | quantdecoded [7]; Morningstar/Blanchett "some MC allow fat-tailed distributions" [8]; Kitces *Fat Tails* [4]; Advisor Perspectives [9] |
| **Sequence-of-returns risk dominates** — ~77% of the outcome is set by the first 10 years; capture it via block bootstrap (serial correlation / mean reversion) | Pfau, *Lifetime Sequence of Returns* [11][12]; Retirement Researcher [11]; ProjectionLab historical mode [13] |
| **≥1,000 trials**, report percentile bands | Boldin 1,000 paths [5]; industry norm [3][9] |

Every load-bearing claim has **≥2 independent sources**, and the single most important one
(arithmetic vs geometric) is corroborated by a leading consumer tool (Boldin) making
*exactly this change* in production.

---

## 3. The recommended ASCENT model (concrete, implementable)

Layered so each piece is independently shippable and testable. Keep the **seeded PRNG**
(deterministic — the owner's standing rule; required for calm hero + solver monotonicity).

### Layer 1 — Lognormal core with arithmetic drift (fixes P0-A; the must-do)
For each class with geometric real CMA `g` and simple-return vol `σ`:
```
σ_log = sqrt( ln(1 + (σ/(1+g))^2) )      // exact lognormal vol
μ_log = ln(1 + g)                         // median annual gross = 1+g
// per year, per class:  logret = μ_log + σ_log * shock ;  gross = exp(logret)
```
Consequences: the **median path compounds at exactly the published CMA `g`** (no more
σ²/2 understatement); the **arithmetic mean is `(1+g)·sqrt(1+(σ/(1+g))²) − 1 > g`**, as it
must be (Kitces); and `exp(·) > 0` always, so the **<−100% / artifact-ruin problem
disappears**. This is the mathematically clean equivalent of Boldin's CAGR→AAGR switch.

### Layer 2 — Full covariance matrix via Cholesky (fixes P1-F)
Replace the single-factor `corr = cᵢ·cⱼ` with a real **N×N correlation matrix** `C` (seed
sensible cross-class correlations; the safe-asset block bonds↔TIPS↔cash is where the
single-factor model is worst). Build `Σ` from `σ_log` + `C`, factor `Σ = L·Lᵀ`, draw
`z ~ N(0,I)`, correlated shocks `= L·z`. This requires the **fixed-income taxonomy from
P0-B to exist first** (today bonds collapse into `us_equity`, so there's nothing to
correlate).

### Layer 3 — Fat tails with tail dependence (generalizes the current crypto-only t)
Use a **multivariate Student-t** (df ≈ 5): one shared chi-square mixing variable across all
classes, so the *whole portfolio* fattens together — this simultaneously gives fat tails
**and** the crisis correlation-spike (tail dependence) the research demands, in one move.
The current code already standardizes a df=4 t correctly for crypto (`montecarlo.ts:76`);
this promotes that idea to the whole vector. Keep crypto's df lower (≈4) than broad markets
(≈5–6).

### Layer 4 — Historical block-bootstrap mode (the researcher's cross-check)
Add an alternative engine: resample historical real annual returns in **3–5yr blocks**
(stationary block bootstrap) to capture sequence risk / mean reversion natively. Requires a
historical real-return dataset per class (a new data dependency). Show parametric and
historical side-by-side; large divergence is itself a signal.

### Build order
L1 (with tests) → P0-B taxonomy → L2 → L3 → L4. L1 alone closes the headline bias; L2–L3
make tail/diversification realistic; L4 is the gold-standard cross-check.

---

## 4. "Do they work?" — how to verify the implementation (not just trust it)

The sources don't just specify the model; they imply concrete acceptance tests:

1. **Median = analytic CAGR.** With vol but zero flows, the simulated **median** terminal
   multiple must equal `(1+g)^T` within Monte Carlo error. This is the unit test that
   *proves* L1 fixed the drag. (Today it fails by σ²/2 — demonstrated: all-equity median
   2.88% vs CMA 4.10%.)
2. **Arithmetic vs geometric sanity.** Mean terminal > median terminal, and the gap tracks
   σ²/2 (Kitces).
3. **No impossible returns.** Zero single-period returns ≤ −100% across all sims (L1
   guarantees this; assert it).
4. **Failure-rate calibration.** A 4%/30yr 60/40 plan should fail ≈5–10% under normal and
   roughly **double** under Student-t — matches quantdecoded's 11%→22% [7]. If your numbers
   are wildly off, the calibration is wrong.
5. **Covariance recovers inputs.** Empirically estimate vol/correlation from simulated
   draws; they must match the seeded `Σ` (validates the Cholesky step).
6. **Historical cross-check.** L4's bands should bracket the parametric bands; a backtest
   over 1929/1966/2000 start-years should land in the lower percentiles, not outside them.
7. **"Does simulated data look like real data?"** (Zivot's test [10]) — eyeball simulated
   return paths against history for obvious distributional mismatch.

Wire these as committed unit tests (the repo currently has **none**) so the math can't
silently regress.

---

## Sources
[1] Kitces, *Volatility Drag* — https://www.kitces.com/blog/volatility-drag-variance-drain-mean-arithmetic-vs-geometric-average-investment-returns/
[2] Kitces via Financial Planning — https://www.financial-planning.com/news/kitces-monte-carlo-arithmetic-average-geometric-average
[3] Kitces, *Correlation Matrix Assumptions in Monte Carlo* — https://www.kitces.com/blog/monte-carlo-correlation-matrix-investment-assumptions-retirement-planning-projection/
[4] Kitces, *Fat Tails vs Safe Withdrawal Rates* — https://www.kitces.com/blog/monte-carlo-analysis-risk-fat-tails-vs-safe-withdrawal-rates-rolling-historical-returns/
[5] Boldin, *Understanding Boldin's Monte Carlo* — https://www.boldin.com/retirement/understanding-boldins-monte-carlo-simulation-what-it-is-why-it-matters-and-whats-new/
[6] Boldin Help, *FAQ on Monte Carlo Updates* — https://help.boldin.com/en/articles/11708904-faq-on-monte-carlo-updates
[7] Quant Decoded, *When Monte Carlo Fails* — https://quantdecoded.com/en/when-monte-carlo-fails-retirement-planning-pitfalls
[8] Morningstar (Blanchett), *Monte Carlo's role in retirement planning* — https://www.morningstar.ca/ca/news/185443/monte-carlos-role-in-retirement-planning.aspx
[9] Advisor Perspectives, *The Power and Limitations of Monte Carlo Simulations* — https://www.advisorperspectives.com/articles/2014/08/26/the-power-and-limitations-of-monte-carlo-simulations
[10] Zivot, *Intro to Computational Finance* — GWN Monte Carlo — https://bookdown.org/compfinezbook/introcompfinr/GWN-Monte-Carlo-Simulation.html
[11] Retirement Researcher (Pfau), *Advantages of Monte Carlo* — https://retirementresearcher.com/advantages-monte-carlo-simulations/
[12] Pfau, *The Lifetime Sequence of Returns* (SSRN) — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2544637
[13] ProjectionLab, *Monte Carlo* — https://projectionlab.com/monte-carlo · https://projectionlab.com/financial-terms/monte-carlo-simulation
[14] eMoney Advisor, *Monte Carlo in Financial Planning* — https://emoneyadvisor.com/blog/securing-client-confidence-with-monte-carlo-simulation-in-financial-planning/
[15] MSCI, *A New Monte Carlo Simulation Methodology* — https://www.msci.com/documents/10199/0d253c46-ea73-4cec-b423-bd60633e2d66
