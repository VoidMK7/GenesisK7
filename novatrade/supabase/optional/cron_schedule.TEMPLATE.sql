-- OPTIONAL and NOT a migration: run by hand in the SQL editor after the function is deployed.
-- Replace the two placeholders. The copy-trading job only runs if you schedule it.
-- Enable the extensions first: Dashboard > Database > Extensions > pg_cron, pg_net.
--
-- Note: the secret is stored in the job text, which anyone with database admin access can read. If that matters,
-- keep it in Supabase Vault and read it inside the job instead.

select cron.schedule('nova-copy-trading', '*/5 * * * *', $$
  select net.http_get(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/copy',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);

select cron.schedule('nova-maintenance', '0 3 * * *', $$
  select net.http_get(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/maintenance',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);

-- Memecoin agents + trader watching. Each call is TIME-BOXED (budget in ms) and keeps its state in the database, so a short
-- invocation never overruns and the next one resumes. Every minute is the useful cadence for "tell me about every trade".
select cron.schedule('nova-trader-watch', '* * * * *', $$
  select net.http_get(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/watch?budget=20000',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);
select cron.schedule('nova-memecoin-agents', '*/2 * * * *', $$
  select net.http_get(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/memecoin?budget=20000',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);
-- Only if you have a trader data feed (see .env.example TRADER_FEED_URL):
select cron.schedule('nova-traders-sync', '*/30 * * * *', $$
  select net.http_get(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/api/cron/traders-sync',
    headers := jsonb_build_object('Authorization', 'Bearer <CRON_SECRET>')
  );
$$);

-- To stop (add: nova-trader-watch, nova-memecoin-agents, nova-traders-sync): select cron.unschedule('nova-copy-trading'); select cron.unschedule('nova-maintenance');
