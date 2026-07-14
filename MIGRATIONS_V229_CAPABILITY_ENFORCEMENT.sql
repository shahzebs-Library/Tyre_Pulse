-- ============================================================================
-- MIGRATIONS V229 - Capability enforcement helpers (grant/revoke aware)
-- ============================================================================
-- Extends the per user grant primitive (V225) from a single "view" reach flag
-- to full per capability resolution (view/create/edit/delete/export/approve),
-- and adds the current user "can I?" resolver that merges role defaults with
-- the grant/revoke overlay.
--
--   user_has_capability(uuid, text, text)  3-arg, capability aware. The 2-arg
--                                           V225 form (defaults cap='view') is
--                                           left untouched and keeps working.
--   get_my_capabilities()                  -> jsonb { module: { cap: effect } }
--   app_user_can(text, text)               -> boolean for the CURRENT user:
--                                             Admin/super => true; else
--                                             revoke > roleAllows > grant > deny
--
-- All SECURITY DEFINER + SET search_path=public. Read only against
-- profiles(role,is_super_admin), module_permissions, user_access_grants and
-- app_settings. NEVER call app_user_can from profiles' own RLS policies (it
-- reads profiles and would recurse).
-- ============================================================================

-- ── 3-arg capability aware grant check (grant unless a revoke wins) ──────────
-- The 2-arg public.user_has_capability(uuid,text) from V225 is a DISTINCT
-- overload and is intentionally left in place (it hard codes capability='view').
CREATE OR REPLACE FUNCTION public.user_has_capability(p_uid uuid, p_key text, p_cap text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = p_uid AND g.module_key = p_key
      AND g.capability = COALESCE(p_cap, 'view') AND g.effect = 'grant'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  ) AND NOT EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = p_uid AND g.module_key = p_key
      AND g.capability = COALESCE(p_cap, 'view') AND g.effect = 'revoke'
      AND (g.expires_at IS NULL OR g.expires_at > now())
  );
$$;

-- ── Full capability overlay for the current user (revoke wins per cap) ──────
CREATE OR REPLACE FUNCTION public.get_my_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_object_agg(module_key, caps), '{}'::jsonb)
  FROM (
    SELECT module_key, jsonb_object_agg(capability, effect) AS caps
    FROM (
      SELECT DISTINCT ON (module_key, capability) module_key, capability, effect
      FROM public.user_access_grants
      WHERE user_id = auth.uid()
        AND (expires_at IS NULL OR expires_at > now())
      ORDER BY module_key, capability, (effect = 'revoke') DESC
    ) picked
    GROUP BY module_key
  ) grouped;
$$;

-- ── Current-user capability resolver ────────────────────────────────────────
-- Precedence: Admin/super => true; revoke > roleAllows > grant > deny.
-- Role default for 'view' = the module_permissions.enabled flag (global rows,
-- org_id IS NULL). For any other capability the default comes from the
-- app_settings `permission_overrides` envelope (JSON) if present, else false.
CREATE OR REPLACE FUNCTION public.app_user_can(p_key text, p_cap text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid     uuid    := auth.uid();
  v_role    text;
  v_super   boolean;
  v_cap     text    := COALESCE(NULLIF(p_cap, ''), 'view');
  v_default boolean := false;
  v_revoked boolean;
  v_granted boolean;
  v_json    jsonb;
  v_ov      jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN false;
  END IF;

  SELECT role, COALESCE(is_super_admin, false)
    INTO v_role, v_super
    FROM public.profiles
   WHERE id = v_uid;

  -- Admin / super admin: full access, no overlay needed.
  IF v_super IS TRUE OR v_role = 'Admin' THEN
    RETURN true;
  END IF;

  -- Role default.
  IF v_cap = 'view' THEN
    v_default := COALESCE((
      SELECT enabled FROM public.module_permissions
       WHERE org_id IS NULL AND role = v_role AND module_key = p_key
       LIMIT 1
    ), false);
  ELSE
    BEGIN
      SELECT value::jsonb INTO v_json
        FROM public.app_settings WHERE key = 'permission_overrides' LIMIT 1;
      v_ov := COALESCE(v_json -> 'overrides', v_json);
      v_default := COALESCE((v_ov -> v_role -> p_key ->> v_cap)::boolean, false);
    EXCEPTION WHEN others THEN
      v_default := false;
    END;
  END IF;

  -- Grant / revoke overlay (revoke wins, expiry aware).
  v_revoked := EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = v_uid AND g.module_key = p_key AND g.capability = v_cap
      AND g.effect = 'revoke' AND (g.expires_at IS NULL OR g.expires_at > now())
  );
  IF v_revoked THEN
    RETURN false;
  END IF;

  IF v_default THEN
    RETURN true;
  END IF;

  v_granted := EXISTS (
    SELECT 1 FROM public.user_access_grants g
    WHERE g.user_id = v_uid AND g.module_key = p_key AND g.capability = v_cap
      AND g.effect = 'grant' AND (g.expires_at IS NULL OR g.expires_at > now())
  );

  RETURN v_granted;
END $$;

REVOKE ALL ON FUNCTION public.user_has_capability(uuid, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.get_my_capabilities()                 FROM anon;
REVOKE ALL ON FUNCTION public.app_user_can(text, text)              FROM anon;
GRANT EXECUTE ON FUNCTION public.user_has_capability(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_my_capabilities()                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_user_can(text, text)              TO authenticated;

-- Reversible:
--   DROP FUNCTION IF EXISTS public.app_user_can(text, text);
--   DROP FUNCTION IF EXISTS public.get_my_capabilities();
--   DROP FUNCTION IF EXISTS public.user_has_capability(uuid, text, text);
--   (the 2-arg user_has_capability(uuid,text) from V225 is unaffected)
