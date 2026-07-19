-- V284: Fatal-crash alerting for the Sentry console.
-- A pg_cron job (every 15 min) calls the sentry-crash-alert edge function, which
-- polls unresolved level:fatal Sentry issues and, for each NEW one, records it in
-- sentry_alert_log (dedupe), writes a critical system_logs row (Console -> System
-- Health), and emails the configured alert address(es) via Resend. Alerts run only
-- when the operator enables them (sentry_alerts_enabled='true') and a token exists.
-- Verified live: first fire {new:1} (logged the standing fatal crash), second fire
-- {new:0} (dedupe holds).

-- 1. Dedupe / audit table (global, not per-tenant). Super-admin read; service-role writes.
CREATE TABLE IF NOT EXISTS public.sentry_alert_log (
  issue_id   text PRIMARY KEY,
  short_id   text, title text, permalink text, level text,
  first_seen timestamptz,
  alerted_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sentry_alert_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS sentry_alert_log_super_read ON public.sentry_alert_log;
CREATE POLICY sentry_alert_log_super_read ON public.sentry_alert_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.is_super_admin = true));
REVOKE ALL ON public.sentry_alert_log FROM anon;
GRANT SELECT ON public.sentry_alert_log TO authenticated;  -- RLS restricts to super-admin

-- 2. Extend the Sentry config RPCs with alert email + on/off (drop+recreate for the new signature).
DROP FUNCTION IF EXISTS public.set_sentry_config(text,text,text,text);
CREATE OR REPLACE FUNCTION public.set_sentry_config(
  p_token text DEFAULT NULL, p_org text DEFAULT NULL, p_region_url text DEFAULT NULL,
  p_project text DEFAULT NULL, p_alert_email text DEFAULT NULL, p_alerts_enabled boolean DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_super boolean;
BEGIN
  SELECT COALESCE(is_super_admin,false) INTO v_super FROM public.profiles WHERE id = auth.uid();
  IF v_super IS NOT TRUE THEN RAISE EXCEPTION 'Only a super admin can configure Sentry.' USING errcode='42501'; END IF;
  IF p_token IS NOT NULL AND length(btrim(p_token)) > 0 THEN
    INSERT INTO public.cron_config(name,value) VALUES ('sentry_auth_token', btrim(p_token)) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value; END IF;
  INSERT INTO public.cron_config(name,value) VALUES ('sentry_org', COALESCE(NULLIF(btrim(p_org),''),'shah-profile')) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.cron_config(name,value) VALUES ('sentry_region_url', COALESCE(NULLIF(btrim(p_region_url),''),'https://de.sentry.io')) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.cron_config(name,value) VALUES ('sentry_project', COALESCE(btrim(p_project),'')) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  IF p_alert_email IS NOT NULL THEN
    INSERT INTO public.cron_config(name,value) VALUES ('sentry_alert_email', btrim(p_alert_email)) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value; END IF;
  IF p_alerts_enabled IS NOT NULL THEN
    INSERT INTO public.cron_config(name,value) VALUES ('sentry_alerts_enabled', CASE WHEN p_alerts_enabled THEN 'true' ELSE 'false' END) ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value; END IF;
  RETURN jsonb_build_object('ok', true);
END; $$;

CREATE OR REPLACE FUNCTION public.get_sentry_config_status()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_super boolean; v_tok text; v_org text; v_region text; v_proj text; v_mail text; v_en text;
BEGIN
  SELECT COALESCE(is_super_admin,false) INTO v_super FROM public.profiles WHERE id = auth.uid();
  IF v_super IS NOT TRUE THEN RAISE EXCEPTION 'Only a super admin can view Sentry settings.' USING errcode='42501'; END IF;
  SELECT value INTO v_tok FROM public.cron_config WHERE name='sentry_auth_token';
  SELECT value INTO v_org FROM public.cron_config WHERE name='sentry_org';
  SELECT value INTO v_region FROM public.cron_config WHERE name='sentry_region_url';
  SELECT value INTO v_proj FROM public.cron_config WHERE name='sentry_project';
  SELECT value INTO v_mail FROM public.cron_config WHERE name='sentry_alert_email';
  SELECT value INTO v_en FROM public.cron_config WHERE name='sentry_alerts_enabled';
  RETURN jsonb_build_object('configured', (v_tok IS NOT NULL AND length(v_tok) > 0),
    'org', COALESCE(v_org,'shah-profile'), 'region_url', COALESCE(v_region,'https://de.sentry.io'),
    'project', COALESCE(v_proj,''), 'alert_email', COALESCE(v_mail,''), 'alerts_enabled', (v_en = 'true'));
END; $$;

REVOKE ALL ON FUNCTION public.set_sentry_config(text,text,text,text,text,boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sentry_config_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sentry_config(text,text,text,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sentry_config_status() TO authenticated;

-- 3. Schedule the poller every 15 minutes (idempotent).
DO $$ BEGIN PERFORM cron.unschedule('sentry-crash-alert'); EXCEPTION WHEN OTHERS THEN NULL; END $$;
SELECT cron.schedule('sentry-crash-alert', '*/15 * * * *', $cron$
  SELECT net.http_post(
    url := 'https://jhssdmeruxtrlqnwfksc.supabase.co/functions/v1/sentry-crash-alert',
    headers := jsonb_build_object('Content-Type','application/json',
      'x-cron-secret', (SELECT value FROM public.cron_config WHERE name='cron_secret')),
    body := '{}'::jsonb);
$cron$);
