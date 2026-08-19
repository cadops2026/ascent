-- Schedule the evaluate-alerts cron. Run ONCE in the Supabase SQL editor (or via
-- `supabase db query --linked -f <this file>`). Intentionally NOT a migration:
-- it carries no schema, and scheduling + secrets are environment-specific.
--
-- Prerequisites:
--   1. supabase functions deploy evaluate-alerts
--   2. supabase secrets set CRON_SECRET=<a-long-random-string>       # gates the function
--   3. Mirror that same secret into Vault so cron can send it without hardcoding:
--        select vault.create_secret('<the-same-random-string>', 'evaluate_alerts_cron_secret');
--   4. Mirror the project's public anon key into Vault (see the header note below):
--        select vault.create_secret('<anon key>', 'project_anon_key');
--   5. Enable the pg_cron + pg_net extensions (idempotent statements below).

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- TWO headers are required, and missing either one fails differently:
--   * Authorization/apikey — the Supabase PLATFORM rejects a function call with no
--     auth header before the function ever runs (401 UNAUTHORIZED_NO_AUTH_HEADER).
--     The anon key is public by design (it ships in the client bundle; RLS protects
--     the data), and it grants nothing here — the real gate is the next header.
--   * x-cron-secret — the FUNCTION's own gate, constant-time compared against the
--     CRON_SECRET secret. This is what actually restricts invocation.
-- An earlier version of this file sent only x-cron-secret and would have failed
-- silently on every run. Verified end-to-end before committing.
--
-- Monthly: 1st of the month, 13:00 UTC. (Low-frequency by design — invariant #7.)
-- For a weekly digest use '0 13 * * 1' (Mondays).
select cron.schedule(
  'evaluate-alerts-monthly',
  '0 13 1 * *',
  $$
  select net.http_post(
    url := 'https://rhpdjuigivbwfvzoljsa.supabase.co/functions/v1/evaluate-alerts',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'apikey',
        (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_key'),
      'Authorization',
        'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'project_anon_key'),
      'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'evaluate_alerts_cron_secret')
    ),
    body := '{}'::jsonb,
    -- It rebuilds every opted-in user's balance sheet; don't let pg_net hang up early.
    timeout_milliseconds := 120000
  );
  $$
);

-- Manage:
--   select jobid, jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
--   select cron.unschedule('evaluate-alerts-monthly');
