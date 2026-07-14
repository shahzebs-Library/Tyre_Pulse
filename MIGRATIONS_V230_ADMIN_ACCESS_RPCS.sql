-- ============================================================================
-- MIGRATIONS V230 - Admin access RPCs (super-admin control surface)
-- ============================================================================
-- The write/inspect API the Access Control console drives. EVERY function is
-- SECURITY DEFINER and self-gates on is_super_admin(), raising 42501 otherwise,
-- so GRANT EXECUTE to authenticated is safe (the gate is the boundary, not the
-- grant). Reads/writes only profiles, module_permissions, custom_roles,
-- user_access_grants, access_audit.
--
--   admin_get_effective_access(uuid)        -> jsonb  (resolved access matrix)
--   admin_set_user_country(uuid, text[])    -> void
--   admin_bulk_set_grant(uuid[],text,...)   -> integer (rows touched)
--   admin_bulk_set_role(uuid[], text)       -> integer (rows changed)
--   admin_clone_role(text, text)            -> void
--   admin_list_access_audit(int, uuid)      -> setof access_audit
--
-- Lockout guard: admin_bulk_set_role refuses to change the role of the LAST
-- remaining (active) super admin and never demotes a super admin. is_super_admin
-- itself is out of scope for these RPCs (role change only).
-- Depends on V225 (user_access_grants + set_user_access_grant), V228
-- (access_audit), existing helpers is_super_admin()/app_current_org().
-- ============================================================================

-- ── Effective access for one user ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_get_effective_access(p_user_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role    text;
  v_super   boolean;
  v_country text[];
  v_modules jsonb;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can inspect effective access.' USING errcode = '42501';
  END IF;

  SELECT role, COALESCE(is_super_admin, false), country
    INTO v_role, v_super, v_country
    FROM public.profiles WHERE id = p_user_id;

  WITH keys AS (
    SELECT DISTINCT module_key FROM public.module_permissions
      WHERE role = v_role AND org_id IS NULL
    UNION
    SELECT DISTINCT module_key FROM public.user_access_grants
      WHERE user_id = p_user_id
  ),
  ra AS (
    SELECT module_key, bool_or(enabled) AS role_allows
      FROM public.module_permissions
     WHERE role = v_role AND org_id IS NULL
     GROUP BY module_key
  ),
  vov AS ( -- view-capability override (revoke wins, expiry aware)
    SELECT module_key, effect FROM (
      SELECT DISTINCT ON (module_key) module_key, effect
        FROM public.user_access_grants
       WHERE user_id = p_user_id AND capability = 'view'
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY module_key, (effect = 'revoke') DESC
    ) z
  ),
  capov AS ( -- every capability effect per module (revoke wins, expiry aware)
    SELECT module_key, jsonb_object_agg(capability, effect) AS caps FROM (
      SELECT DISTINCT ON (module_key, capability) module_key, capability, effect
        FROM public.user_access_grants
       WHERE user_id = p_user_id
         AND (expires_at IS NULL OR expires_at > now())
       ORDER BY module_key, capability, (effect = 'revoke') DESC
    ) z GROUP BY module_key
  )
  SELECT jsonb_agg(row_obj ORDER BY module_key) INTO v_modules
  FROM (
    SELECT k.module_key,
      jsonb_build_object(
        'key',         k.module_key,
        'role_allows', COALESCE(ra.role_allows, false),
        'override',    vov.effect,
        'caps',        COALESCE(capov.caps, '{}'::jsonb),
        'final', CASE
          WHEN v_super OR v_role = 'Admin'          THEN true
          WHEN vov.effect = 'revoke'                THEN false
          WHEN COALESCE(ra.role_allows, false)      THEN true
          WHEN vov.effect = 'grant'                 THEN true
          ELSE false END,
        'reason', CASE
          WHEN v_super OR v_role = 'Admin'          THEN 'admin override'
          WHEN vov.effect = 'revoke'                THEN 'per-user revoke'
          WHEN COALESCE(ra.role_allows, false)      THEN 'role allows'
          WHEN vov.effect = 'grant'                 THEN 'per-user grant'
          ELSE 'denied by default' END
      ) AS row_obj
    FROM keys k
    LEFT JOIN ra    ON ra.module_key    = k.module_key
    LEFT JOIN vov   ON vov.module_key   = k.module_key
    LEFT JOIN capov ON capov.module_key = k.module_key
  ) assembled;

  RETURN jsonb_build_object(
    'role',     v_role,
    'is_super', COALESCE(v_super, false),
    'country',  COALESCE(to_jsonb(v_country), '[]'::jsonb),
    'modules',  COALESCE(v_modules, '[]'::jsonb)
  );
END $$;

-- ── Set a user's country scope ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_user_country(p_user_id uuid, p_countries text[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change a user country.' USING errcode = '42501';
  END IF;
  UPDATE public.profiles SET country = p_countries WHERE id = p_user_id;
END $$;

-- ── Bulk grant/revoke a capability across many users ────────────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_set_grant(
  p_user_ids uuid[], p_module_key text, p_capability text,
  p_effect text, p_expires_at timestamptz)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid; v_n integer := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change access grants.' USING errcode = '42501';
  END IF;
  IF COALESCE(p_effect, 'grant') NOT IN ('grant','revoke') THEN
    RAISE EXCEPTION 'effect must be grant or revoke.';
  END IF;
  IF p_user_ids IS NULL THEN RETURN 0; END IF;

  FOREACH v_uid IN ARRAY p_user_ids LOOP
    PERFORM public.set_user_access_grant(
      v_uid, p_module_key, COALESCE(NULLIF(p_capability, ''), 'view'),
      COALESCE(p_effect, 'grant'), NULL, p_expires_at);
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- ── Bulk role change (with last-super-admin lockout guard) ──────────────────
CREATE OR REPLACE FUNCTION public.admin_bulk_set_role(p_user_ids uuid[], p_role text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid       uuid;
  v_n         integer := 0;
  v_is_super  boolean;
  v_super_cnt integer;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can change roles.' USING errcode = '42501';
  END IF;
  IF p_role IS NULL OR btrim(p_role) = '' THEN
    RAISE EXCEPTION 'role is required.';
  END IF;
  IF p_user_ids IS NULL THEN RETURN 0; END IF;

  -- Count of active (non-locked) super admins, for the lockout guard.
  SELECT count(*) INTO v_super_cnt
    FROM public.profiles
   WHERE COALESCE(is_super_admin, false) = true AND COALESCE(locked, false) = false;

  FOREACH v_uid IN ARRAY p_user_ids LOOP
    SELECT COALESCE(is_super_admin, false) INTO v_is_super
      FROM public.profiles WHERE id = v_uid;

    -- Never demote a super admin via a role change, and never touch the last
    -- remaining super admin. is_super_admin flag is left untouched regardless.
    IF v_is_super IS TRUE AND (v_super_cnt <= 1 OR p_role <> 'Admin') THEN
      CONTINUE;
    END IF;

    UPDATE public.profiles SET role = p_role WHERE id = v_uid;
    IF FOUND THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END $$;

-- ── Clone a role's module matrix into a new custom role ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_clone_role(p_source text, p_new_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can clone a role.' USING errcode = '42501';
  END IF;
  IF p_source IS NULL OR btrim(p_source) = '' OR p_new_name IS NULL OR btrim(p_new_name) = '' THEN
    RAISE EXCEPTION 'source and new name are required.';
  END IF;

  -- Roster the new custom role (org scoped). No-op if it already exists.
  INSERT INTO public.custom_roles (organisation_id, name, description, created_by)
  VALUES (public.app_current_org(), p_new_name,
          'Cloned from ' || p_source, v_uid)
  ON CONFLICT (organisation_id, name) DO NOTHING;

  -- Copy the source role's global module rows (org_id IS NULL) to the new name,
  -- skipping any that already exist so re-runs stay idempotent.
  INSERT INTO public.module_permissions (module_key, role, org_id, enabled, updated_by, updated_at)
  SELECT src.module_key, p_new_name, NULL, src.enabled, v_uid, now()
    FROM public.module_permissions src
   WHERE src.role = p_source AND src.org_id IS NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.module_permissions dst
        WHERE dst.role = p_new_name AND dst.org_id IS NULL
          AND dst.module_key = src.module_key
     );
END $$;

-- ── Read the access audit trail (newest first, optional target filter) ──────
CREATE OR REPLACE FUNCTION public.admin_list_access_audit(
  p_limit int DEFAULT 100, p_target uuid DEFAULT NULL)
RETURNS SETOF public.access_audit LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only a Super Admin can read the access audit.' USING errcode = '42501';
  END IF;
  RETURN QUERY
    SELECT * FROM public.access_audit
     WHERE (p_target IS NULL OR target_user = p_target)
     ORDER BY at DESC
     LIMIT GREATEST(COALESCE(p_limit, 100), 1);
END $$;

-- ── Grants (each RPC self-gates on is_super_admin) ──────────────────────────
REVOKE ALL ON FUNCTION public.admin_get_effective_access(uuid)                       FROM anon;
REVOKE ALL ON FUNCTION public.admin_set_user_country(uuid, text[])                   FROM anon;
REVOKE ALL ON FUNCTION public.admin_bulk_set_grant(uuid[], text, text, text, timestamptz) FROM anon;
REVOKE ALL ON FUNCTION public.admin_bulk_set_role(uuid[], text)                      FROM anon;
REVOKE ALL ON FUNCTION public.admin_clone_role(text, text)                           FROM anon;
REVOKE ALL ON FUNCTION public.admin_list_access_audit(int, uuid)                     FROM anon;
GRANT EXECUTE ON FUNCTION public.admin_get_effective_access(uuid)                       TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_user_country(uuid, text[])                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_grant(uuid[], text, text, text, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_bulk_set_role(uuid[], text)                      TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_clone_role(text, text)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_list_access_audit(int, uuid)                     TO authenticated;

-- Reversible:
--   DROP FUNCTION IF EXISTS public.admin_get_effective_access(uuid);
--   DROP FUNCTION IF EXISTS public.admin_set_user_country(uuid, text[]);
--   DROP FUNCTION IF EXISTS public.admin_bulk_set_grant(uuid[], text, text, text, timestamptz);
--   DROP FUNCTION IF EXISTS public.admin_bulk_set_role(uuid[], text);
--   DROP FUNCTION IF EXISTS public.admin_clone_role(text, text);
--   DROP FUNCTION IF EXISTS public.admin_list_access_audit(int, uuid);
