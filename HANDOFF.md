# HANDOFF — state as of 2026-07-11

## Where things live now
- **Repo:** `github.com/yurykhelemsky-source/ascent` (moved off the Jamzli account; `main` has everything).
- **Backend (Supabase, project `rhpdjuigivbwfvzoljsa`):** all live — migrations applied, edge functions deployed (`refresh-etf-holdings` keyless-Yahoo, `refresh-crypto`, `refresh-quotes`, `parse-statements`).
- **Frontend:** deployed on Vercel at **https://ascent-umber.vercel.app** (also runs locally via `npm run dev`).
- **Keepalive:** GitHub Action `keepalive.yml` is **active**; repo secrets `SUPABASE_URL` + `SUPABASE_ANON_KEY` are set, so free-tier Supabase won't pause.

## ⚠️ OPEN ISSUE — finish this first
The Vercel build does **not** contain the Supabase env vars, so the live site shows the
**"Connect Supabase"** screen instead of the login. Verified by inspecting the deployed
bundle: the project ref `rhpdjuigivbwfvzoljsa` is absent, even after a forced fresh build.

**Fix:**
1. Vercel → **ascent** project → **Settings → Environment Variables**. Ensure BOTH exist **and are enabled for Production**:
   - `VITE_SUPABASE_URL` = `https://rhpdjuigivbwfvzoljsa.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = (the anon key, in `.env.local`)
   - Common cause: they were added only to Preview/Development, or never saved (didn't click **Add** on the import screen).
2. Redeploy (Deployments → ⋯ → Redeploy) OR push any commit — a fresh build inlines them.
3. Verify: `curl -s https://ascent-umber.vercel.app/assets/index-*.js | grep rhpdjuigivbwfvzoljsa` should match.

## Then — last step for login to work
Supabase → **Authentication → URL Configuration**: set **Site URL** and add a **Redirect URL**
of `https://ascent-umber.vercel.app`. Then magic-link login works on the live site.

## Housekeeping — pre-existing WIP in the working tree (NOT from this session)
This session's work is all committed on `main`. Separately, the working tree carries ~18 files of
**uncommitted changes that predate this session** and were left untouched — notably a large
`montecarlo.ts` rewrite (+164) and tax work (`taxparams.ts`, `taxtables.ts`, `TaxPanels.tsx`,
`WithdrawalPlanner.tsx`, `TaxWithdrawalTab.tsx`), plus untracked files `src/lib/finance/assetclass.ts`,
`correlation.ts`, `taxadvantaged.ts`, `scripts/`, `src/lib/finance/__tests__/`, `tsconfig.test.json`.

⚠️ **Several overlap files this session also edited** (montecarlo, networth, drawdownstress,
ProjectionTab, RiskExposureTab, Dashboard, TaxWithdrawalTab, WorkGlidePathTab). This session's versions
are the committed ones on `main`; the working-tree WIP diverges from them. Reconcile before committing the
WIP so this session's changes aren't clobbered. Review / commit / discard as you decide.

- A non-dev, click-by-click deploy guide was produced as a Claude artifact; `DEPLOY.md` has the written version.

## Optional follow-ups discussed
- Remove `Jamzli` as a collaborator on the repo for full separation; switch this Mac's git auth to the personal account.
- Persist the Projection contribution schedule + DOB-driven age to the Dashboard.
- Wire the Settings global real-growth override into the drawdown recovery rate.
