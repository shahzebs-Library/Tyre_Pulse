-- ============================================================================
-- MIGRATIONS_V61_SCHEDULED_REPORTS_CRON.sql
-- Backend for scheduled report delivery (the ScheduledReports page previously
-- saved schedules that nothing ever sent).
--
--  * pg_cron + pg_net enabled; a cron job every 15 minutes POSTs to the
--    `send-scheduled-reports` edge function.
--  * cron_config: private one-row secret store (deny-all RLS + no grants —
--    service role only). The cron job reads x-cron-secret from it at run time
--    (the secret never appears in the cron command text); the edge function
--    compares it before doing any work.
--  * report_send_log: append-only delivery tracking (schedule, recipients,
--    sent/failed, provider error) — readable by authenticated users so the
--    ScheduledReports page can show real delivery history.
--
-- Rollback:
--   SELECT cron.unschedule('send-scheduled-reports');
--   DROP TABLE public.report_send_log;
--   DROP TABLE public.cron_config;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Private config (service-role only)
CREATE TABLE IF NOT EXISTS public.cron_config (
  name  text PRIMARY KEY,
  value text NOT NULL
);
ALTER TABLE public.cron_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cron_config FROM anon, authenticated;

INSERT INTO public.cron_config (name, value)
VALUES ('cron_secret', gen_random_uuid()::text)
ON CONFLICT (name) DO NOTHING;

-- Delivery tracking
CREATE TABLE IF NOT EXISTS public.report_send_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES public.report_schedules(id) ON DELETE SET NULL,
  schedule_name text,
  report_type text,
  recipients  text[],
  status      text NOT NULL CHECK (status IN ('sent','failed')),
  error       text,
  sent_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_report_send_log_schedule ON public.report_send_log (schedule_id, sent_at DESC);
ALTER TABLE public.report_send_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY report_send_log_read ON public.report_send_log
  FOR SELECT TO authenticated USING (true);
-- writes are service-role only (bypass RLS) — no write policy on purpose.

-- Cron: every 15 minutes, wake the delivery function. The Authorization bearer
-- is the PUBLIC anon key (the function's real gate is x-cron-secret).
SELECT cron.schedule(
  'send-scheduled-reports',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/send-scheduled-reports',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impoc3NkbWVydXh0cmxxbndma3NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1ODYyMzIsImV4cCI6MjA5NjE2MjIzMn0.W18y4ifFRuEkR2-lseAm1cqcnjq-mL4-OtpsgEyzMoM',
      'x-cron-secret', (SELECT value FROM public.cron_config WHERE name = 'cron_secret')
    ),
    body    := '{}'::jsonb
  );
  $$
);
