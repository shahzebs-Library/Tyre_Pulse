-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATIONS V225 — Per-user additive access grants (RBAC per-user overrides)
-- Applied live via Supabase MCP on 2026-07-14 (project jhssdmeruxtrlqnwfksc).
--
-- The "give ONE specific user MORE (or LESS) access than others of the same
-- role" primitive. Additive on top of role-based module_permissions; existing
-- role/table RLS is unchanged. Writes are SUPER-ADMIN ONLY. No new location RLS
-- (that initiative remains on hold).
--
--   user_access_grants        one row per (user, module, capability, effect)
--   user_has_capability(uid,key)  SECURITY DEFINER, reads ONLY this table (no
--                                 profiles reference -> no RLS recursion)
--   get_my_access_grants()    -> jsonb { module_key: 'grant' | 'revoke' } (view)
--   set_user_access_grant(...) / revoke_user_access_grant(id)  super-admin writers
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_access_grants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid,
  user_id     uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  module_key  text NOT NULL,
  capability  text NOT NULL DEFAULT 'view',
  effect      text NOT NULL DEFAULT 'grant' CHECK (effect IN ('grant','revoke')),
  granted_by  uuid REFERENCES public.profiles(id),
  note        text,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module_key, capability, effect)
);
CREATE INDEX IF NOT EXISTS idx_uag_user ON public.user_access_grants(user_id);
CREATE INDEX IF NOT EXISTS idx_uag_org  ON public.user_access_grants(org_id);

ALTER TABLE public.user_access_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS uag_isolation ON public.user_access_grants;
CREATE POLICY uag_isolation ON public.user_access_grants AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (public.is_super_admin() OR org_id IS NULL OR org_id = public.app_current_org() OR user_id = auth.uid())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS uag_select ON public.user_access_grants;
CREATE POLICY uag_select ON public.user_access_grants
  FOR SELECT TO authenticated
  USING (public.is_super_admin() OR user_id = auth.uid());

DROP POLICY IF EXISTS uag_write ON public.user_access_grants;
CREATE POLICY uag_write ON public.user_access_grants
  FOR ALL TO authenticated
  USING (public.is_super_admin()) WITH CHECK (public.is_super_admin());

CREATE OR REPLACE FUNCTION public.user_has_capability(p_uid uuid, p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = p_uid AND g.module_key = p_key
      AND g.capability = 'view' AND g.effect = 'grant'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = p_uid AND g.module_key = p_key
      AND g.capability = 'view' AND g.effect = 'revoke'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

CREATE OR REPLACE FUNCTION public.get_my_access_grants()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(module_key, effect), '{}'::jsonb)
  FROM (
    SELECT DISTINCT ON (module_key) module_key, effect
    FROM public.user_access_grants
    WHERE user_id = auth.uid() AND capability = 'view'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY module_key, (effect = 'revoke') DESC
  ) t;
$$;

CREATE OR REPLACE FUNCTION public.set_user_access_grant(
  p_user_id uuid, p_module_key text, p_capability text DEFAULT 'view',
  p_effect text DEFAULT 'grant', p_note text DEFAULT NULL, p_expires_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_org uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change access grants.' USING errcode = '42501';
  END IF;
  IF p_effect NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'effect must be grant or revoke.'; END IF;
  SELECT org_id INTO v_org FROM public.profiles WHERE id = p_user_id;
  INSERT INTO public.user_access_grants (org_id,user_id,module_key,capability,effect,granted_by,note,expires_at)
  VALUES (v_org,p_user_id,p_module_key,COALESCE(p_capability,'view'),p_effect,auth.uid(),p_note,p_expires_at)
  ON CONFLICT (user_id,module_key,capability,effect)
    DO UPDATE SET note = EXCLUDED.note, expires_at = EXCLUDED.expires_at,
                  granted_by = auth.uid(), created_at = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE OR REPLACE FUNCTION public.revoke_user_access_grant(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change access grants.' USING errcode = '42501';
  END IF;
  DELETE FROM public.user_access_grants WHERE id = p_id;
END $$;

REVOKE ALL ON FUNCTION public.user_has_capability(uuid,text)        FROM anon;
REVOKE ALL ON FUNCTION public.get_my_access_grants()                FROM anon;
REVOKE ALL ON FUNCTION public.set_user_access_grant(uuid,text,text,text,text,timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_user_access_grant(uuid)        FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_access_grants()             TO authenticated;
GRANT EXECUTE ON FUNCTION public.user_has_capability(uuid,text)     TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_access_grant(uuid,text,text,text,text,timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_user_access_grant(uuid)     TO authenticated;
