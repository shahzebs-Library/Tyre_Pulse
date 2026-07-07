-- ============================================================================
-- MIGRATIONS_V103_EXECUTIVE_DISPLAY.sql
-- Roadmap item 21: Executive TV Display mode.
--
-- A secure, read-only, unauthenticated dashboard URL for lobby / control-room
-- / management TVs:
--   https://<app>/display/<token>
--
--  * display_tokens — org-scoped share tokens (high-entropy 'disp_<hex>'),
--    optional bcrypt password, refresh/rotation cadence, template (which
--    widget pages to cycle), expiry. Managed by elevated users; the plaintext
--    token is returned to admins (it lives in the URL by design) but the
--    password hash is never selectable.
--  * get_display_snapshot(token, password) — SECURITY DEFINER, GRANTED TO anon.
--    Validates the token (active / not expired / password), records the view,
--    and returns ONLY org-scoped AGGREGATE KPIs + branding — never raw rows,
--    no PII. This is the sole anon-reachable surface and it reveals nothing
--    without a valid high-entropy token.
--
-- Consistent with V55 anon lockdown: no table grants to anon; the single anon
-- entry point is this function, which chooses exactly what it returns.
--
-- Depends on: V42 (app_current_org, organisations), V22 (is_elevated_user),
--             V68 (organisations.settings->'branding'), pgcrypto (V101).
--
-- Rollback:
--   DROP FUNCTION public.get_display_snapshot(text, text);
--   DROP FUNCTION public.revoke_display_token(uuid);
--   DROP FUNCTION public.create_display_token(text, jsonb, int, int, text, timestamptz);
--   DROP TABLE public.display_tokens;
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TOKENS
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.display_tokens (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
  name            text NOT NULL,
  token           text NOT NULL UNIQUE,
  password_hash   text,                                   -- bcrypt; NULL = no password
  template        jsonb NOT NULL DEFAULT '{"pages":["overview"]}'::jsonb,
  refresh_seconds int NOT NULL DEFAULT 60  CHECK (refresh_seconds BETWEEN 10 AND 3600),
  rotate_seconds  int NOT NULL DEFAULT 15  CHECK (rotate_seconds  BETWEEN 5  AND 600),
  active          boolean NOT NULL DEFAULT true,
  expires_at      timestamptz,
  created_by      uuid DEFAULT auth.uid(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_viewed_at  timestamptz,
  view_count      bigint NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_display_tokens_org ON public.display_tokens (organisation_id, active);

ALTER TABLE public.display_tokens ENABLE ROW LEVEL SECURITY;

-- Elevated users manage their own org's tokens. password_hash stays server-side
-- (the service functions read it; client column lists must exclude it).
DROP POLICY IF EXISTS display_tokens_select ON public.display_tokens;
CREATE POLICY display_tokens_select ON public.display_tokens
  FOR SELECT TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS display_tokens_update ON public.display_tokens;
CREATE POLICY display_tokens_update ON public.display_tokens
  FOR UPDATE TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()))
  WITH CHECK ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));
DROP POLICY IF EXISTS display_tokens_delete ON public.display_tokens;
CREATE POLICY display_tokens_delete ON public.display_tokens
  FOR DELETE TO authenticated
  USING ((SELECT public.is_elevated_user())
         AND organisation_id = (SELECT public.app_current_org()));
-- No INSERT policy: tokens are minted only via create_display_token().

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. MANAGEMENT RPCs (elevated only)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_display_token(
  p_name            text,
  p_template        jsonb DEFAULT '{"pages":["overview"]}'::jsonb,
  p_refresh_seconds int DEFAULT 60,
  p_rotate_seconds  int DEFAULT 15,
  p_password        text DEFAULT NULL,
  p_expires_at      timestamptz DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_token text;
  v_id    uuid;
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  IF COALESCE(trim(p_name), '') = '' THEN
    RAISE EXCEPTION 'name is required';
  END IF;

  v_token := 'disp_' || encode(gen_random_bytes(18), 'hex');

  INSERT INTO public.display_tokens
    (organisation_id, name, token, password_hash, template,
     refresh_seconds, rotate_seconds, expires_at, created_by)
  VALUES
    (public.app_current_org(), trim(p_name), v_token,
     CASE WHEN NULLIF(p_password, '') IS NULL THEN NULL
          ELSE crypt(p_password, gen_salt('bf')) END,
     COALESCE(p_template, '{"pages":["overview"]}'::jsonb),
     GREATEST(LEAST(COALESCE(p_refresh_seconds, 60), 3600), 10),
     GREATEST(LEAST(COALESCE(p_rotate_seconds, 15), 600), 5),
     p_expires_at, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id, 'token', v_token);
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_display_token(text,jsonb,int,int,text,timestamptz) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.create_display_token(text,jsonb,int,int,text,timestamptz) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.revoke_display_token(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_elevated_user() THEN
    RAISE EXCEPTION 'not authorised';
  END IF;
  UPDATE public.display_tokens
     SET active = false
   WHERE id = p_id AND organisation_id = public.app_current_org();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'display token not found';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION public.revoke_display_token(uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.revoke_display_token(uuid) FROM PUBLIC, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. PUBLIC SNAPSHOT (anon) — aggregate KPIs only, token-gated
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_display_snapshot(
  p_token    text,
  p_password text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t            public.display_tokens%ROWTYPE;
  v_org        uuid;
  v_kpis       jsonb;
  v_trend      jsonb;
  v_risk       jsonb;
  v_events     jsonb;
  v_branding   jsonb;
BEGIN
  SELECT * INTO t FROM public.display_tokens WHERE token = p_token;

  IF NOT FOUND OR NOT t.active
     OR (t.expires_at IS NOT NULL AND t.expires_at < now()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  IF t.password_hash IS NOT NULL THEN
    IF p_password IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'password_required');
    ELSIF crypt(p_password, t.password_hash) <> t.password_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_password');
    END IF;
  END IF;

  v_org := t.organisation_id;

  -- Record the view (best-effort, never blocks the snapshot).
  BEGIN
    UPDATE public.display_tokens
       SET last_viewed_at = now(), view_count = view_count + 1
     WHERE id = t.id;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- ── Aggregate KPIs (org-scoped, counts only) ──────────────────────────────
  v_kpis := jsonb_build_object(
    'tyres_total',
      (SELECT count(*) FROM public.tyre_records WHERE organisation_id = v_org),
    'spend_30d',
      (SELECT COALESCE(round(sum(COALESCE(cost_per_tyre,0) * COALESCE(qty,1))::numeric, 2), 0)
         FROM public.tyre_records
        WHERE organisation_id = v_org AND issue_date >= current_date - 30),
    'high_risk',
      (SELECT count(*) FROM public.tyre_records
        WHERE organisation_id = v_org AND lower(COALESCE(risk_level,'')) IN ('high','critical')),
    'inspections_30d',
      (SELECT count(*) FROM public.inspections
        WHERE organisation_id = v_org AND created_at >= now() - interval '30 days'),
    'open_workorders',
      (SELECT count(*) FROM public.work_orders
        WHERE organisation_id = v_org
          AND lower(COALESCE(status,'')) NOT IN ('closed','completed','done','cancelled')),
    'open_accidents',
      (SELECT count(*) FROM public.accidents
        WHERE organisation_id = v_org AND COALESCE(closure_status,'open') <> 'closed'),
    'fleet_size',
      (SELECT count(*) FROM public.vehicle_fleet WHERE organisation_id = v_org)
  );

  -- ── 6-month spend trend ───────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('month', m, 'spend', s) ORDER BY m), '[]'::jsonb)
    INTO v_trend
    FROM (
      SELECT to_char(date_trunc('month', issue_date), 'YYYY-MM') AS m,
             round(sum(COALESCE(cost_per_tyre,0) * COALESCE(qty,1))::numeric, 2) AS s
        FROM public.tyre_records
       WHERE organisation_id = v_org
         AND issue_date >= date_trunc('month', current_date) - interval '5 months'
       GROUP BY 1
    ) q;

  -- ── Risk breakdown ────────────────────────────────────────────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('level', lvl, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_risk
    FROM (
      SELECT COALESCE(NULLIF(trim(risk_level), ''), 'Unclassified') AS lvl, count(*) AS c
        FROM public.tyre_records
       WHERE organisation_id = v_org
       GROUP BY 1
    ) q;

  -- ── Recent activity (event TYPES + counts only, last 24h) ─────────────────
  SELECT COALESCE(jsonb_agg(jsonb_build_object('type', et, 'count', c) ORDER BY c DESC), '[]'::jsonb)
    INTO v_events
    FROM (
      SELECT event_type AS et, count(*) AS c
        FROM public.domain_events
       WHERE organisation_id = v_org AND created_at >= now() - interval '24 hours'
       GROUP BY 1
       LIMIT 12
    ) q;

  -- ── Branding (name + logo + colour) ───────────────────────────────────────
  SELECT jsonb_build_object(
           'name',          o.name,
           'logo_url',      COALESCE(o.settings->'branding'->>'logo_url', o.logo_url),
           'primary_color', o.settings->'branding'->>'primary_color'
         )
    INTO v_branding
    FROM public.organisations o WHERE o.id = v_org;

  RETURN jsonb_build_object(
    'ok',              true,
    'name',            t.name,
    'template',        t.template,
    'refresh_seconds', t.refresh_seconds,
    'rotate_seconds',  t.rotate_seconds,
    'generated_at',    now(),
    'branding',        COALESCE(v_branding, '{}'::jsonb),
    'kpis',            v_kpis,
    'spend_trend',     v_trend,
    'risk_breakdown',  v_risk,
    'recent_activity', v_events
  );
END;
$$;
-- The one intentional anon entry point (token is the credential).
GRANT EXECUTE ON FUNCTION public.get_display_snapshot(text, text) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_display_snapshot(text, text) FROM PUBLIC;

COMMENT ON TABLE public.display_tokens IS
  'Executive TV Display share tokens. get_display_snapshot(token,password) is anon-reachable and returns only org-scoped aggregate KPIs + branding.';
COMMENT ON FUNCTION public.get_display_snapshot(text, text) IS
  'Anon-callable, token-gated. Returns aggregate KPIs only (no raw rows/PII), scoped to the token''s organisation. Optional bcrypt password.';
