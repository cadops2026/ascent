-- Schedule the refresh-history cron. Run ONCE in the Supabase SQL editor (or via
-- `supabase db query --linked -f <this file>`). Intentionally NOT a migration:
-- it carries no schema, and scheduling + secrets are environment-specific.
--
-- Prerequisites:
--   1. supabase functions deploy refresh-history
--   2. Enable extensions (idempotent statements below).
--   3. Mirror the project's anon key into Vault so this file holds no key:
--        select vault.create_secret('<anon key>', 'project_anon_key');
--      The anon key is public by design (it ships in the client bundle; RLS is
--      what protects data) — Vault is used here for tidiness, not secrecy.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Daily at 23:00 UTC — after the US close (19:00 EDT / 18:00 EST), so the day's
-- bar has settled. Runs every day, not just weekdays, so assets that trade on
-- weekends stay current too.
--
-- The symbol list is built HERE, from whatever price_history already tracks, so
-- the job keeps existing series current without needing to know anyone's
-- holdings (new tickers get added the first time a user's app requests them).
-- `since` is a rolling 7-day window: every symbol already has coverage starting
-- well before that, so the function takes its incremental path and only fetches
-- forward of the last stored close.
select cron.schedule(
  'refresh-history-daily',
  '0 23 * * *',
  $$
  select net.http_post(
    url := 'https://rhpdjuigivbwfvzoljsa.supabase.co/functions/v1/refresh-history',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'project_anon_key'),
      'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                      where name = 'project_anon_key')
    ),
    body := jsonb_build_object(
      'symbols', (select jsonb_agg(distinct symbol) from public.price_history),
      'since', to_char((now() - interval '7 days')::date, 'YYYY-MM-DD')
    ),
    -- The function fetches each symbol sequentially; don't let pg_net hang up early.
    timeout_milliseconds := 120000
  );
  $$
);

-- Manage:
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select cron.unschedule('refresh-history-daily');
