-- Run AI inspection worker every five minutes after secure Vault values are configured.
-- Both secrets must exist, otherwise the schedule safely does no network call.
-- tyre_ai_worker_jwt: service-role JWT used only by the server scheduler.
-- tyre_ai_worker_secret: value matching Edge Function AI_WORKER_SECRET.
CREATE OR REPLACE FUNCTION public.ai_tyre_dispatch_worker()
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public
AS $$
DECLARE jwt_secret text; worker_secret text;
BEGIN
 SELECT decrypted_secret INTO jwt_secret FROM vault.decrypted_secrets
 WHERE name='tyre_ai_worker_jwt' LIMIT 1;
 SELECT decrypted_secret INTO worker_secret FROM vault.decrypted_secrets
 WHERE name='tyre_ai_worker_secret' LIMIT 1;
 IF jwt_secret IS NULL OR worker_secret IS NULL THEN RETURN; END IF;
 PERFORM net.http_post(
  url := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/ai-tyre-inspection',
  headers := jsonb_build_object(
   'Content-Type','application/json','Authorization','Bearer ' || jwt_secret,
   'x-worker-secret',worker_secret
  ),
  body := '{"action":"work"}'::jsonb,
  timeout_milliseconds := 30000
 );
END $$;
REVOKE ALL ON FUNCTION public.ai_tyre_dispatch_worker() FROM PUBLIC,anon,authenticated;
-- Repeating migrations should not create duplicate schedules.
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM cron.job WHERE jobname='ai-tyre-inspection-worker') THEN
  PERFORM cron.unschedule('ai-tyre-inspection-worker');
 END IF;
 PERFORM cron.schedule(
  'ai-tyre-inspection-worker','*/5 * * * *',
  'select public.ai_tyre_dispatch_worker()'
 );
END $$;
