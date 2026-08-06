# HANDOFF — state as of 2026-07-11

## Where things live now
- **Repo:** `github.com/yurykhelemsky-source/ascent` (moved off the Jamzli account; `main` has everything).
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
