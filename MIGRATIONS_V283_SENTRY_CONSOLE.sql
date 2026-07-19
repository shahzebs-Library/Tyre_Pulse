-- V283: Secure storage + super-admin RPCs for the in-console Sentry integration
-- (Console -> Crash Reports).
--
-- The Sentry auth token is a secret, so it is stored in cron_config (deny-all RLS,
-- never granted to anon/authenticated) and read only by the `sentry-issues` edge
-- function via the service role. The console UI writes it through set_sentry_config
-- and can only ever read back a "configured / not configured" status via
-- get_sentry_config_status -- never the token itself. Both RPCs self-gate on
-- profiles.is_super_admin and pin search_path.

CREATE OR REPLACE FUNCTION public.set_sentry_config(
  p_token text DEFAULT NULL,
  p_org text DEFAULT NULL,
  p_region_url text DEFAULT NULL,
  p_project text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_super boolean;
BEGIN
  SELECT COALESCE(is_super_admin,false) INTO v_super FROM public.profiles WHERE id = auth.uid();
  IF v_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a super admin can configure Sentry.' USING errcode='42501';
  END IF;

  -- A NULL/blank token keeps the existing one (change org/project without re-pasting).
  IF p_token IS NOT NULL AND length(btrim(p_token)) > 0 THEN
    INSERT INTO public.cron_config(name, value) VALUES ('sentry_auth_token', btrim(p_token))
      ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  END IF;
  INSERT INTO public.cron_config(name, value) VALUES ('sentry_org', COALESCE(NULLIF(btrim(p_org),''),'shah-profile'))
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.cron_config(name, value) VALUES ('sentry_region_url', COALESCE(NULLIF(btrim(p_region_url),''),'https://de.sentry.io'))
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;
  INSERT INTO public.cron_config(name, value) VALUES ('sentry_project', COALESCE(btrim(p_project),''))
    ON CONFLICT (name) DO UPDATE SET value = EXCLUDED.value;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_sentry_config_status()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_super boolean; v_tok text; v_org text; v_region text; v_proj text;
BEGIN
  SELECT COALESCE(is_super_admin,false) INTO v_super FROM public.profiles WHERE id = auth.uid();
  IF v_super IS NOT TRUE THEN
    RAISE EXCEPTION 'Only a super admin can view Sentry settings.' USING errcode='42501';
  END IF;
  SELECT value INTO v_tok    FROM public.cron_config WHERE name='sentry_auth_token';
  SELECT value INTO v_org    FROM public.cron_config WHERE name='sentry_org';
  SELECT value INTO v_region FROM public.cron_config WHERE name='sentry_region_url';
  SELECT value INTO v_proj   FROM public.cron_config WHERE name='sentry_project';
  RETURN jsonb_build_object(
    'configured', (v_tok IS NOT NULL AND length(v_tok) > 0),
    'org', COALESCE(v_org,'shah-profile'),
    'region_url', COALESCE(v_region,'https://de.sentry.io'),
    'project', COALESCE(v_proj,'')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_sentry_config(text,text,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_sentry_config_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_sentry_config(text,text,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_sentry_config_status() TO authenticated;
