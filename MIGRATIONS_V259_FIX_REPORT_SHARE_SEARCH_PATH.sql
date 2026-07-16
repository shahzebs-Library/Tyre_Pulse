-- MIGRATIONS_V259 (applied live) - Fix: "cannot create a shared link for TV" (Report Shares).
--
-- ROOT CAUSE: create_report_share (V251) ran with SET search_path TO 'public',
-- but pgcrypto (gen_random_bytes / gen_salt / crypt) lives in the 'extensions'
-- schema on this project. The very first statement that builds the token,
--   'rpt_' || encode(gen_random_bytes(18), 'hex')
-- therefore threw "function gen_random_bytes(integer) does not exist" on EVERY
-- create call, so no share could ever be minted (client saw a create failure).
-- The RPC gate (is_elevated_user), EXECUTE grant and RLS were all healthy; only
-- the search_path was wrong. The sibling minters create_api_key and
-- create_display_token already use 'public, extensions' and work.
--
-- FIX: recreate create_report_share with SET search_path TO 'public','extensions'
-- (body unchanged). Applied live via Supabase MCP; verified by an impersonated
-- elevated call returning {id, token} (with and without a password), rolled back.
CREATE OR REPLACE FUNCTION public.create_report_share(
  p_name text,
  p_pages jsonb DEFAULT NULL::jsonb,
  p_rotate integer DEFAULT 30,
  p_refresh integer DEFAULT 300,
  p_password text DEFAULT NULL::text,
  p_expires timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_token text; v_id uuid; v_org uuid;
BEGIN
  IF NOT public.is_elevated_user() THEN RAISE EXCEPTION 'Not authorized'; END IF;
  v_org := public.app_current_org();
  v_token := 'rpt_' || encode(gen_random_bytes(18), 'hex');
  INSERT INTO public.report_shares (organisation_id, name, token, password_hash, pages, rotate_seconds, refresh_seconds, expires_at)
  VALUES (
    v_org, coalesce(nullif(btrim(p_name), ''), 'Shared report'), v_token,
    CASE WHEN p_password IS NOT NULL AND btrim(p_password) <> '' THEN crypt(p_password, gen_salt('bf')) ELSE NULL END,
    coalesce(p_pages, '["board_kpis","board_trends","board_charts"]'::jsonb),
    greatest(5, least(600, coalesce(p_rotate, 30))),
    greatest(30, least(3600, coalesce(p_refresh, 300))),
    p_expires
  ) RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'token', v_token);
END; $function$;
