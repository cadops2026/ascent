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
- **Data cleanup: PENDING USER AUTHORIZATION** (auto-mode classifier correctly blocks live-DB
  deletes). Plan: delete accounts `7578eca4-7083-434f-8dc3-b24c55c5393e` +
  `2da855e4-a63a-4220-825b-387be942d842` (holdings cascade, 41 rows; copy1 `e3acee9a` is a
  strict superset of both) + holding `4f1b89f0-f256-4ac4-b9b1-9077e6a67521` (POL amount row).
  **Full-table backups first:** `Ascent DOCS/db-backups/{holdings,accounts}-2026-08-07.json`
  (gitignored). Expect 122→80 holdings, 13→11 accounts; net worth −$468k (was overstated).
- **Open question for the user:** two "Vanguard Cash Plus (Bank Sweep)" amount rows —
  $421,916.22 (batch 1, acct `d0dbf47a`) vs $607,614.86 (batch 2, acct `6138797a`). Same sweep
  account on two statement dates (⇒ delete the older, −$421,916) or two real accounts (keep both)?
  Not decidable from data; left untouched.
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
