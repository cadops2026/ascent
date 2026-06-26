-- Schedule the evaluate-alerts cron. Run ONCE in the Supabase SQL editor.
-- This is intentionally NOT a migration (it carries no schema; scheduling +
-- secrets are environment-specific, so it stays out of `supabase db push`).
--
-- Prerequisites:
--   1. supabase functions deploy evaluate-alerts
--   2. supabase secrets set CRON_SECRET=<a-long-random-string>          # gates the function
--   3. In the SQL editor, mirror that secret into Vault so cron can send it
--      without hardcoding it here:
--         select vault.create_secret('<the-same-random-string>', 'evaluate_alerts_cron_secret');
--   4. Enable the pg_cron + pg_net extensions (Dashboard → Database → Extensions),
--      or via the statements below.

create extension if not exists pg_cron;
create extension if not exists pg_net;

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
      'x-cron-secret',
        (select decrypted_secret from vault.decrypted_secrets
         where name = 'evaluate_alerts_cron_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Manage:
--   select * from cron.job;                       -- list schedules
--   select cron.unschedule('evaluate-alerts-monthly');
