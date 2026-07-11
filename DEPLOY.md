# Deploying ASCENT — the free, durable setup

Goal: turn the localhost dev server into a real app you can bookmark and open from
any device, running **$0/month**. The backend (Supabase: Postgres + Auth + Edge
Functions) is already hosted in the cloud — only the **frontend** needs a home, plus
a tiny keepalive so the free Supabase project never goes idle.

You'll need your two public values (already in `.env.local`):

- `VITE_SUPABASE_URL`  (e.g. `https://rhpdjuigivbwfvzoljsa.supabase.co`)
- `VITE_SUPABASE_ANON_KEY`  (the anon/public key — gated by Row-Level Security, safe to expose)

---

## 1. Host the frontend on Vercel (free, ~5 min)

1. Go to **vercel.com**, sign in **with GitHub**, and click **Add New → Project**.
2. Import the **`yurykhelemsky-source/ascent`** repo.
3. Vercel auto-detects Vite (this repo also ships `vercel.json`). Leave the defaults:
   - Build command: `npm run build`
   - Output directory: `dist`
4. Under **Environment Variables**, add the two values above
   (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).
5. Set the **Production Branch** to `main` (recommended — merge the feature branch
   first) or to `balance-sheet-pricing-and-real-cma` if you want to deploy as-is.
6. Click **Deploy**. You'll get a URL like `https://ascent-xxxx.vercel.app`.

Every future `git push` to that branch redeploys automatically.

> Prefer **Cloudflare Pages**? Same idea: Create project → connect `yurykhelemsky-source/ascent` →
> framework preset **Vite**, build `npm run build`, output `dist`, add the same two
> env vars.

## 2. Point Supabase auth at the new URL

The magic-link login must be allowed to redirect back to your hosted URL:

1. Supabase dashboard → **Authentication → URL Configuration**.
2. Add your Vercel URL (e.g. `https://ascent-xxxx.vercel.app`) to **Site URL** and to
   **Redirect URLs**. (Keep `http://localhost:5173` there too for local dev.)

Now open the Vercel URL, enter your email, click the magic link → you're in, from
anywhere.

## 3. Keep the free Supabase project awake (free)

Free projects pause after ~7 days of inactivity. The included GitHub Action
(`.github/workflows/keepalive.yml`) pings the project every 6 hours so it never does.

1. In GitHub → repo **Settings → Secrets and variables → Actions → New repository
   secret**, add:
   - `SUPABASE_URL` = your `VITE_SUPABASE_URL` value
   - `SUPABASE_ANON_KEY` = your `VITE_SUPABASE_ANON_KEY` value
2. Open the **Actions** tab; if Actions are disabled, enable them. The `keepalive`
   workflow runs on its schedule (you can also trigger it once via **Run workflow**
   to confirm it's green).

That's the whole durable setup. Bookmark the Vercel URL and use it.

---

## Notes

- **Backups (free tier has none automatic):** every so often, click **Settings →
  Export my data (JSON)** in the app. The code itself is backed up on GitHub.
- **If it ever sleeps anyway:** Supabase dashboard → **Resume project** (one click,
  data intact). Then re-run the keepalive workflow.
- **Custom domain (optional):** add one in Vercel → Domains, then add it to the
  Supabase Auth redirect URLs too.
- **Data freshness:** prices refresh when you open the app; the look-through needs a
  one-time **Refresh ETF holdings** click after new ETFs are added.
- **Keys:** market/econ keys (Finnhub, FRED, optional FMP) live in **Supabase
  secrets**, never in the frontend. ETF look-through works keyless via Yahoo.
- **GitHub Actions caveat:** scheduled workflows get disabled after 60 days with no
  repo commits — any push re-arms them.
