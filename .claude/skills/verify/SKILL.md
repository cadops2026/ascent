---
name: verify
description: Drive the running ASCENT app end-to-end with a stub Supabase backend and synthetic portfolio — no real account, no live-project seeding.
---

# Verifying ASCENT in the running app

The app is auth-gated (Supabase magic link) and all data is behind RLS, so you can't
log in or seed the live project (see memory: verify-pattern-rls-app). The working
recipe — app code stays 100% untouched:

1. **Stub backend** (Node, zero deps): serve PostgREST-shaped JSON on
   `http://localhost:8543` for every table the app queries
   (`grep -rhoE "from\('[a-z_]+'\)" src/` for the list; ~22 tables, empty `[]` is a
   fine default). Column names MUST match `supabase/migrations/*_init.sql`
   (gotchas: `real_estate.market_value`, `liabilities.orig_balance`). Copy
   `cma_sources` / `asset_class_universe` / `infl_expectations_cache` rows from
   `supabase/migrations/20260625183515_seed_cma_inflation.sql`. Needs CORS
   (`Access-Control-Allow-Origin/Headers/Methods: *`, handle OPTIONS 204). For
   `.maybeSingle()` requests (`Accept` contains `vnd.pgrst.object`) return a bare
   object, or 406 `{code:'PGRST116'}` when empty. Writes: echo the body with 201.
2. **Point the app at it**: back up `.env.local`, set
   `VITE_SUPABASE_URL=http://localhost:8543` (keep the anon key), restart the dev
   server (`preview_start` name `ascent-dev`, port 5173 — env is read at startup).
3. **Fake the session** (auth is client-side): from the page,
   `localStorage.setItem('sb-localhost-auth-token', JSON.stringify(session))` then
   reload. `session` = `{access_token: <any JWT-shaped string with future exp>,
   token_type:'bearer', expires_at:<epoch+86400>, expires_in:86400,
   refresh_token:'x', user:{id:<uuid>, aud:'authenticated', role:'authenticated',
   email:...}}`. The storage key is `sb-<hostname first label>-auth-token` →
   `sb-localhost-auth-token`.
4. **Drive tabs** via the Browser pane. `get_page_text`/`read_page` are reliable;
   the pane's screenshots sometimes go black while the seeded MC hogs the main
   thread — read the DOM instead, and extract chart SVGs via `outerHTML` (replace
   `var(--color-*)` with concrete colors) if you need visual evidence.
5. **Engine math headlessly** (diagnosis only, not the verification):
   `node --experimental-strip-types --no-warnings=ExperimentalWarning --import
   ./scripts/register-ts.mjs <script.ts>` can import `src/lib/finance/*` directly.
6. **Teardown**: restore `.env.local`, kill the stub, restart the dev server,
   `localStorage.removeItem('sb-localhost-auth-token')`, confirm the magic-link
   login renders (not "Connect Supabase").

Gotchas observed:
- Glide-Path (and other tabs with data-initialized inputs) render a first solve
  with `spending=0` before the load effect fires — re-read after ~2s before
  calling a number wrong.
- The seeded MC is deterministic: identical numbers across reloads is the
  expected (and required) behavior — use it as a free regression probe.
