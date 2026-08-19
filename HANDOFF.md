# HANDOFF — state as of 2026-08-19 (both crons live)

## Scheduled jobs — BOTH now active on the live project
`pg_cron` + `pg_net` were NOT enabled before today; enabling them was the missing
prerequisite for every scheduled job. Check with:
`select extname from pg_extension where extname in ('pg_cron','pg_net');`

| job | schedule | what it does |
|---|---|---|
| `refresh-history-daily` | `0 23 * * *` | tops up `price_history` for every tracked symbol |
| `evaluate-alerts-monthly` | `0 13 1 * *` | evaluates opted-in users, writes to `alerts` |

Inspect: `select jobid, jobname, schedule, active from cron.job;`
Runs: `select * from cron.job_run_details order by start_time desc limit 5;`

### ⚠️ Edge-function crons need TWO headers, not one
The original `evaluate-alerts/schedule.sql` sent only `x-cron-secret` and **would have
failed silently on every run**. The Supabase PLATFORM rejects a function call with no
auth header before the function ever executes:
`401 {"code":"UNAUTHORIZED_NO_AUTH_HEADER"}`. Verified all three cases:

- `x-cron-secret` only → 401 UNAUTHORIZED_NO_AUTH_HEADER (platform)
- anon key + wrong secret → 401 `{"error":"unauthorized"}` (function gate works)
- anon key + correct secret → 200 `{"evaluated":0,...}`

Both schedule files now send `apikey` + `Authorization: Bearer <anon>` **and**, where
the function gates on it, `x-cron-secret`. Vault holds `project_anon_key` (shared, the
public anon key — it only satisfies the platform header; the cron secret is the real
gate) and `evaluate_alerts_cron_secret`. `CRON_SECRET` is set in Supabase secrets.

**Always fire the job body manually after scheduling** rather than waiting for the
cron — a broken body is invisible until the schedule fires:
`select net.http_post(...)` then `select status_code, content from net._http_response`.

### evaluate-alerts is deployed but will do nothing yet
Live counts: `alert_rules = 0`, `alerts = 0`, `target_allocation = 0`, `holdings = 84`.
Nobody has opted in (an `alert_rules` row is created by setting thresholds in the Risk
tab), so the monthly job evaluates zero users by design. That is correct behavior, not
a failure — but do not read a `{"evaluated":0}` response as proof the pipeline works
end-to-end on real data. It has never yet run against a user with rules.

The function writes ONLY to the `alerts` table — no email, webhook, or external send.

---

# HANDOFF — state as of 2026-08-19 (You Index; production URL corrected)

## ⚠️ CORRECTION — the "Vercel isn't shipping" issue below is WRONG and cost hours
Vercel has been building and deploying **every** commit fine. Verified via
`gh api repos/cadops2026/ascent/deployments`: production deployments exist for
2026-08-14 and 2026-08-19 commits, all `state=success`.

**The real problem is the URL.** `https://ascent-umber.vercel.app` is a STALE ALIAS
permanently stuck on the first build (`index-mOJmIHc9.js`). It is not attached to this
project's deployments and will never update.

- **Live production is `https://ascent-cadops1.vercel.app`** — confirmed serving the
  current bundle, with the You Index strings present in the `AllocationPie-*` chunk.
- To reclaim the old URL: Vercel dashboard → ascent → Settings → Domains → remove or
  reassign `ascent-umber`. Needs dashboard access; not doable from the CLI here (the
  `vercel` CLI is not installed and `VERCEL_OIDC_TOKEN` in `.env.local` is expired and
  wrong-scoped).
- Do **not** re-diagnose this as "Vercel is stuck." Check `gh api .../deployments` first.

## ⚠️ Local dev: vite was binding IPv6-only
`vite.config.ts` now sets `server.host: '0.0.0.0'`. Default binds "localhost", which
resolved to `::1` ONLY — `lsof` showed `TCP [::1]:5173 (LISTEN)` and
`http://127.0.0.1:5173` returned connection refused while `[::1]` returned 200. Any
browser resolving localhost to IPv4 saw a dead port. Symptom looks exactly like "the
app never updated." Check the bind with `lsof -nP -iTCP:5173 -sTCP:LISTEN` before
assuming a code problem.

## You Index replaced the per-holding alpha meter (owner decision 2026-08-19)
The statistical version (per-lot alpha, tracking-error noise bands, ahead/behind
verdicts, exclusion lists) was more machinery than the question needed. Now: your
holdings as one index line vs SPY, two numbers, one chart, 1M/3M/YTD/1Y.

- `src/lib/finance/youindex.ts` — basket from CURRENT share counts × daily closes,
  normalized to zero at period start, walked as a linear merge over the benchmark's
  calendar with forward-fill (so weekend-trading assets and ETFs share one calendar).
  Holdings without history covering the whole window are excluded, not joined
  mid-chart (which would draw a jump that isn't a return).
- Needs no tax lots — that's why it works where the alpha meter would have shown 0%
  coverage on statement-imported holdings.
- **Live tail:** the last point comes from `quote_cache` (15-min), not the last daily
  close, so it doesn't disagree with the rest of the app. All-or-nothing: it needs a
  live price for every leg, or a partial basket would draw a fake drop. SPY gets its
  own live quote. `index.live` says which mode the caption is in.

### ⚠️ Vendor tickers ≠ holding tickers (silent-corruption trap)
`historySymbol()` maps crypto to Yahoo's `-USD` pair. Yahoo's bare **`BTC` is the
Grayscale Bitcoin Mini Trust ETF (~$28), not bitcoin (~$64k)** — and it returns data
with `missing:[]` rather than erroring, so an unmapped crypto symbol silently prices a
completely different instrument. `price_history` is keyed by the VENDOR ticker;
`quote_cache` by the holding's. Do not conflate them. (Stale bogus `symbol='BTC'` rows
from testing exist in `price_history`; harmless since nothing reads that key now, but
delete them if you ever get service-role access.)

### Refresh cadence (asked 2026-08-19)
- Daily history: fetched **once per page load** (module flag in `useYouIndex`), and the
  Edge Function no-ops per symbol if it already holds a close from the last 24h.
- Live prices: 15-min TTL, staleness-triggered, app-wide via `useBalanceSheet`.
- There is **no cron** for `price_history` — nothing updates while the app sits open.

---

# HANDOFF — state as of 2026-08-17 (live pricing + alpha meter)

## 1. Prices now refresh app-wide, not just on the Balance Sheet
- **Was:** the only auto-refresh lived in `BalanceSheet.tsx` and fired only when a holding had
  **no price at all**. Once everything had been priced once, it never fired again — prices only
  moved if you clicked "Refresh quotes". The other 7 tabs read `quote_cache` but never triggered a
  fetch, so landing on the Dashboard showed whatever was last cached, however old.
- **Now:** `src/lib/finance/quotes.ts` is the single price-refresh path (invariant #1) — symbol
  collection (equities / crypto / money-market NAV tickers / 529 basket legs), the vendor calls, the
  staleness test, and the once-per-TTL guard. `useBalanceSheet` drives it, so **any** tab that loads
  the balance sheet re-prices stale holdings. Trigger is **staleness** (`quote_cache.updated_at`
  older than the 15-min TTL), not "unpriced". Server-side TTL makes repeat calls cheap no-ops;
  failures are silent and leave cached prices in place (#6).
- `BalanceSheet.tsx` lost its duplicated symbol-collection logic; its remaining mount effect only
  repairs name-only imported funds (sets a ticker from the alias map) — a data fix, not pricing.
- New `PricesAsOf` component on Dashboard + Balance Sheet shows the **oldest** quote backing the
  current holdings (an honest floor: "everything here is at least this current"), amber past 4× TTL.
  A timestamp, never a red/green delta (#6).

## 2. Alpha meter — realized, class-relative, since purchase
Owner decisions (2026-08-17): benchmark **each holding against its own asset class**; measure
**since purchase**.

- `src/lib/finance/alpha.ts` (pure, 8 tests): per-**tax-lot** annualized return (cost basis vs
  today's price) minus what that holding's own class returned over the same window, dollar-weighted
  into a portfolio figure. Per-lot rather than an average purchase date, so multi-lot positions are
  exact. Benchmarks: us_equity→VTI, intl→VXUS, bonds→BND, tips→SCHP, cash→BIL, real_estate→VNQ,
  commodities→DJP, crypto→BTC-USD. **private_equity + collectibles map to null** — excluded with a
  visible reason rather than measured against something wrong.
- **Every alpha carries a noise band (#4).** SE = assumed tracking error ÷ √years, where TE is a
  multiple of the class's own vol (0.35× funds, 1.0× single names — `TE_MULTIPLE`, documented and in
  one place). A holding is only called ahead/behind once it clears 1.65 SE (~90%). Most land in
  `noise`, which is the truthful answer and is deliberately rendered in **ink, not coral** — an
  alpha inside its own error bars is not bad news.
- Positions held under `MIN_YEARS` (3mo) are excluded: annualizing a few weeks produces a headline
  number that means nothing. Same for missing basis/purchase date. Excluded value + reasons are
  shown, and `coverage` reports what fraction of holdings the number actually covers.
- **This measures, it never forecasts (#5).** The underperformer list ships with the context that
  trailing returns don't predict the next stretch and a sale has a tax bill attached.
- **Known limit, stated in the UI:** returns are price-only (neither side counts dividends), so a
  holding yielding much more than its benchmark reads low. And because each holding is judged
  against its own class, this measures *selection* only — it says nothing about the allocation.

### Schema + Edge Function — NOT YET DEPLOYED
- `supabase/migrations/20260817000000_price_history.sql` — new `price_history(symbol, on_date,
  close)`, shared-reference RLS (authenticated read; service_role writes), idempotent.
- `supabase/functions/refresh-history/` — daily benchmark closes from the keyless Yahoo chart
  endpoint, incremental (only fetches forward of stored coverage, backfills when an older lot
  appears). Uses `quote[0].close` (split-adjusted, **not** `adjclose`) so both sides of the alpha
  subtraction are price-only. Endpoint shape verified live: 752 daily rows, no nulls.
- **ACTIVATED (2026-08-18):** `supabase db push` applied `20260817000000` (`supabase migration list`
  now shows Local == Remote through it) and `supabase functions deploy refresh-history` shipped the
  function (ACTIVE, v1; no other function touched). Live checks: anon SELECT on `price_history`
  returns `200 []` and anon INSERT is rejected `42501` "violates row-level security" — read policy is
  authenticated-only, writes are service_role-only, exactly as intended. Function verified end-to-end
  against the real Yahoo endpoint: backfill works, an unknown ticker returns `{updated:0,
  missing:[...]}` rather than crashing, and a repeat call re-checks only the 7-day pad.
- **Benchmark cache warmed (2026-08-18):** 10 years of daily closes for all eight benchmarks —
  VTI/VXUS/BND/SCHP/BIL/VNQ/DJP at 2,674 rows each (trading days) and BTC-USD at 3,889 (calendar
  days; crypto trades weekends). So the meter has history on first load rather than backfilling live.
- **What still gates the meter lighting up:** alpha needs a **tax lot with `acquired_on`** per
  position. Imported statement holdings carry `cost_basis` but no purchase date, so any holding
  without a lot shows under "Not measured · no purchase date". Add lots via the Tax Lots editor on
  the Balance Sheet to bring positions into coverage.
- `src/lib/database.types.ts` had `price_history` added by hand (no gen script in this repo).

### Verification
63 tests pass (8 new, hand-checked: ARKK −26.0% = 0.5^0.25−1 minus VTI's 10.10% CAGR; bands
±4.6% / ±57.7% / ±13.2% = 1.65 × TE ÷ √4 exactly), tsc + build green. Rendered end-to-end against a
throwaway stub backend with a synthetic 8-holding portfolio covering every path — ahead, behind,
noise, and all three exclusion reasons. Crypto's ±57.7% band correctly swallowed BTC's −11.4% gap
(the calm design working as intended). Live project never touched.

---

# HANDOFF — state as of 2026-08-07 (later session: TLH duplicates)

## TLH panel showed every losing position 3× — root cause + fix
- **Data:** the live DB holds the same E*TRADE statement **three times** — accounts
  `e3acee9a` / `7578eca4` / `2da855e4`, identical holdings to the fractional share, created
  ~1s apart on 2026-06-28 16:01:50–52Z. That's **$468,370 of phantom taxable value**; the TLH
  panel ranked NIO/PLTR/BABA/CEG/CRSP/NCLH/DOGP 3× each (COIN 2× — one copy skipped it) and
  claimed $125,694 harvestable vs the true $46,102. Also a stale POL row (amount-mode $1,874.97
  snapshot of the same 26,501 POL the shares-mode row prices live).
- **Why:** rows were committed 11:57–12:01 EDT with the PRE-dedup importer — the seen-set dedup
  commit `97e4867` landed 12:40, ~40min later, during the same stuck-parsing incident.
- **Fix shipped (code):** `ImportSection.commit` now takes a **synchronous ref lock** (+
  "Importing…" disabled button). Concurrent commits each read pre-insert state, so the seen-set
  alone can't stop a double-click; the ref closes the same-tick stale-closure case React state
  can't. Verified against a stub backend: same-tick double-fire → exactly 1 account POST,
  2 holding POSTs, 1 PATCH (was 2/4/2-shaped before).
- **Data cleanup: DONE (2026-08-07, user-authorized in-session).** Deleted accounts
  `7578eca4` + `2da855e4` (holdings cascaded, 41 rows; kept copy `e3acee9a` was a strict
  superset of both) + holding `4f1b89f0` (POL amount row). Verified live: 122→80 holdings,
  13→11 accounts, 1 E*TRADE account; TLH engine on live data returns exactly 9 positions /
  $46,102. Net worth correctly dropped ~$470k (was phantom). **Full-table pre-delete backups:**
  `Ascent DOCS/db-backups/{holdings,accounts}-2026-08-07.json` (gitignored) — restorable by
  re-inserting those rows.
- **Vanguard Cash Plus ×2 resolved:** user confirmed these are **two real accounts**
  ($421,916.22 in `d0dbf47a`, $607,614.86 in `6138797a`) — both kept, not duplicates.
- 529s ×3 (different share counts), Vanguard roth vs taxable, TIAA multi-source rows: **legit,
  untouched.** No other exact duplicates anywhere (scanned all 122 rows).

# HANDOFF — state as of 2026-08-07

## Live and working
- **App:** https://ascent-cadops1.vercel.app — password sign-in, serving current code.
- **Repo:** `github.com/cadops2026/ascent` (PUBLIC — required to deploy on Vercel's free tier
  without Pro; verified no secrets or personal documents in any of the 58 commits).
- **Vercel:** project `ascent` on team `cadops1`. Deploy with `npx vercel deploy --prod --yes`.
- **Supabase:** `rhpdjuigivbwfvzoljsa` ("Ascent Financial", org `Ascent`). Kept deliberately — it
  holds all data. Separate ORG from Jamzli's, so quota/billing are independent (Supabase bills per
  organization, confirmed in their billing docs). Not commingled.
- **Keepalive ×2:** GitHub Action (6-hourly) + a local cron `15 9 */3 * *` →
  `~/.ascent-keepalive.sh`, logging to `~/.ascent-keepalive.log`. Both verified HTTP 200.
  NOTE: on a PUBLIC repo GitHub disables scheduled workflows after 60 days of repo inactivity.

## ⚠️ Read this before debugging deploys again
Three wrong diagnoses cost most of 2026-08-06. The truth, in order:
1. Vercel was **never** failing to build and the Git connection was **never** broken. It was
   receiving pushes, creating deployments, and **blocking** them: *"the commit email
   yhr9txwf7d@privaterelay.appleid.com could not be matched to a GitHub account."* An Apple
   private-relay address resolves to no GitHub user. Commit identity is now
   `cadops2026 <313970716+cadops2026@users.noreply.github.com>` — a noreply address always resolves.
   **If the repo ever moves accounts, regenerate that noreply for the new account.**
2. A "Blocked" deployment states its reason on the deployment page. Read it before theorising.
3. `git push` can fail with *"denied to Jamzli"* even when `gh` shows cadops2026 active — the macOS
   keychain hands git a stale token. Fix: `gh auth switch --user cadops2026 && gh auth setup-git`.

## Gotchas that cost real time
- **Two Supabase accounts exist.** The browser was signed into one owning `ysbviyagzmdiertnrvzy`
  (empty); the CLI owns Ascent Financial. A `service_role` key from the wrong project returns 401
  forever. `supabase projects api-keys --project-ref rhpdjuigivbwfvzoljsa` avoids the browser entirely.
- **Built-in auth email is capped at 2/hour project-wide** and cannot be raised without custom SMTP.
  That is why password login now exists — it needs no email.
- **`supabase config push` prompts `[Y/n]` and a non-interactive shell's EOF takes the default YES**,
  pushing the WHOLE config.toml. It once overwrote live `max_frequency`/`otp_length` with stock
  defaults. Always diff first; `config.toml` is local-dev boilerplate, not a mirror of live.
- **Old dead URLs:** `ascent-umber.vercel.app` / `ascent-ascentfin.vercel.app` still serve the July
  build with magic-link-only sign-in. Delete that old `ascentfin` Vercel project.

## Built 2026-08-06
- **Physician protection readout (P7)** — `disability.ts` (banded human capital; reads own-occ tier,
  benefit tax character, benefit period, riders) + `assetprotection.ts` (creditor tiers; solo-401(k)
  is 'depends', not ERISA; umbrella sized vs *reachable* assets; claims-made-without-tail = high flag).
  `insuranceGaps` consumes `reachableAssets` + `disabilityStatus` so summary and detail cannot
  contradict (invariant #1). Migration `20260806000000` APPLIED.
- **Auth** — email+password primary, magic link kept as fallback; in-app change password in Settings.
- **Look-through fix** — a fund's tail beyond its cached top-10 (VTSAX 34.6% covered, so ~65% tail)
  was ranked as one synthetic single name, and fully-opaque funds were added whole. Both overstated
  concentration and polluted the Dashboard hero + alert engine. Now `LookThrough.unexplained` /
  `unexplainedPct`: counted, reported, never ranked. Real portfolio: largest single name went from a
  fund artifact to Apple 6.3%; 38.4% correctly shown as diversified fund tail. Mirrored into the
  vendored Deno copy.
- **55 tests pass**, tsc/lint/build green.

## Open
- Delete the old `ascentfin` Vercel project once the new one is trusted.
- Data-less funds (USO, VNJUX, JP Morgan Mid Cap, Invesco Main St Sm Cap, Vanguard Target 2050) have
  no equity constituents to resolve; they sit in the tail. Fuller constituent data needs a paid source
  and would not change any decision.
- Optional: separate the Supabase *login* (cosmetic — orgs are already independent).

---

# HANDOFF — state as of 2026-08-06

## This session — physician protection readout (P7), built & verified
Two new pure engines + panels on the **Estate & Protection** tab, filling the one gap the adversarial
review left explicitly under-built:
- `src/lib/finance/disability.ts` — own-occupation income protection. Human capital (PV of remaining
  after-tax earnings, **banded**, #4) + per-policy *terms* reading: own-occ definition tier, benefit tax
  character (group ⇒ taxable ⇒ discounted at the marginal rate), benefit period vs working horizon, riders.
  Gap measured against the spending floor **and** full after-tax income; shortfall severity scales with the
  hole's size, so a near-miss stays calm (#6).
- `src/lib/finance/assetprotection.ts` — creditor exposure by bucket (ERISA strong · IRA capped · HSA/529/
  residence state-law · **solo-401(k) depends**, not ERISA · taxable/rental reachable), umbrella sized
  against *reachable* assets, professional-liability form read (**claims-made + no tail = high flag**).
- `src/app/estate/PhysicianProtectionPanels.tsx` — presentational; policy-terms editor + earned-income
  input wired into `EstateProtectionTab`.
- **Invariant #1:** `insuranceGaps` now consumes `reachableAssets` + `disabilityStatus`, so the summary
  cannot contradict the detail panel. Tested both directions.
- **51 tests pass** (24 new), tsc/lint/build green. Both panels render-verified end-to-end against a
  throwaway stub backend (real engine output; numbers hand-checked).

**ACTIVATED (2026-08-06):** `supabase db push` applied `20260806000000_protection_details.sql` — adds
`insurance_policies.details` (jsonb, default `{}`) + `profiles.earned_income` (nullable). Both additive and
idempotent (`add column if not exists`); RLS already owner-only, so no policy change was needed.
`supabase migration list` shows Local == Remote through `20260806000000`, and an anon-key REST probe on
both columns returns `200 []` (column present, RLS correctly yielding no rows). **Nothing is dormant —
policy terms and earned income save for real.**

---

# HANDOFF — state as of 2026-07-11

## Where things live now
- **Repo:** `github.com/cadops2026/ascent` (private; `main` has everything). Superseded `yurykhelemsky-source/ascent`, kept as the `old-origin` remote.
- **Backend (Supabase, project `rhpdjuigivbwfvzoljsa`):** all live — migrations applied, edge functions deployed (`refresh-etf-holdings` keyless-Yahoo, `refresh-crypto`, `refresh-quotes`, `parse-statements`).
- **Frontend:** deployed on Vercel at **https://ascent-umber.vercel.app** (also runs locally via `npm run dev`).
- **Keepalive:** GitHub Action `keepalive.yml` is **active**; repo secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set, so free-tier Supabase won't pause.

## ⚠️ OPEN ISSUE — Vercel isn't shipping new commits to production
The env-var problem is now **bypassed in code**: `src/lib/env.ts` bakes in the project's public
Supabase URL + anon key as defaults (commit `3078a54` on `main`), so NO Vercel env-var config is
needed. The anon key is public by design (RLS protects data), so this is safe.

**BUT** the production URL **https://ascent-umber.vercel.app** is stuck on the FIRST build
(`index-mOJmIHc9.js`, `main`@`85d4e35`) and still shows **"Connect Supabase."** Vercel has not
deployed ANY `main` commit since the first one, despite several pushes. Verified: the baked config is
on `main` but absent from the live bundle.

**Fix (Vercel dashboard — account owner):**
1. Vercel → **ascent** project → **Settings → Git**: confirm **Production Branch = `main`** and Git
   auto-deploy is on.
2. **Deployments** tab → ship the latest `main`: it should auto-build once #1 is right; otherwise
   **⋯ → Redeploy** the newest and **UNCHECK "use existing build cache."**
3. If a deploy is **failing**, open its **Build Logs** and paste the error (main includes a parallel
   session's Monte Carlo/correlation rewrite — a build error there would keep the old build live).
4. Success check: `curl -s https://ascent-umber.vercel.app/assets/index-*.js | grep rhpdjuigivbwfvzoljsa`
   matches, and the site shows the **login screen**, not "Connect Supabase."

## Works locally right now
`npm run dev` → http://localhost:5173 fully works (`.env.local` has the keys). Use that until Vercel ships.

## Then — last step for login to work
Supabase → **Authentication → URL Configuration**: set **Site URL** and add a **Redirect URL**
of `https://ascent-umber.vercel.app`. Then magic-link login works on the live site.

## Housekeeping — WIP committed (2026-07-11)
The working-tree WIP (Monte Carlo lognormal rewrite, correlation matrix, asset-class taxonomy,
tax engine upgrades, 27-test suite) is now **committed as `e392c34`** and pushed to both
`balance-sheet-pricing-and-real-cma` and `main`. Verified before commit: `tsc` clean, oxlint
clean, all 27 tests pass, production build succeeds. The adversarial-review P0-A and P0-B
findings are fixed.

**Never commit the personal documents in `Ascent DOCS/`** (brokerage statements, confirms,
photos) — `.gitignore` now excludes everything there except `*.md`.

- A non-dev, click-by-click deploy guide was produced as a Claude artifact; `DEPLOY.md` has the written version.

## Optional follow-ups discussed
- Remove `Jamzli` as a collaborator on the repo for full separation; switch this Mac's git auth to the personal account.
- Persist the Projection contribution schedule + DOB-driven age to the Dashboard.
- Wire the Settings global real-growth override into the drawdown recovery rate.

## Why Vercel stopped deploying (RESOLVED 2026-08-06)
Not a build failure, not the production-branch setting, and not a broken Git connection — all three
were red herrings in the earlier runbook. Vercel *was* receiving pushes and creating deployments;
it **blocked** them with: *"the commit email yhr9txwf7d@privaterelay.appleid.com could not be matched
to a GitHub account."* The commit author was an Apple private-relay address registered on no GitHub
account, so Vercel refused to attribute the commit. Fix: commit identity is now
`cadops2026 <313970716+cadops2026@users.noreply.github.com>` (a GitHub noreply address, which always
resolves). Verified via the API: `commit.author.email` → `author.login: cadops2026`.
**If the repo ever moves accounts again, the noreply address must be regenerated for that account.**
