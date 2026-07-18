-- =============================================================================
-- MIGRATIONS_V278_MAINTENANCE_WEBGATE.sql
-- Two access features (WEB app only):
--   1. Module maintenance WINDOW - modules can carry an optional
--      maintenance_until (ETA) + maintenance_note surfaced on the
--      "Under maintenance" screen.
--   2. Per-account WEB-app access gate - profiles.web_access decides whether an
--      account may use the WEB app (mobile is unaffected). Mobile-only accounts
--      are shown a calm informational screen on web. Admins / super-admins are
--      never blocked.
--
-- Blast radius: purely additive (two nullable columns + one boolean column with
-- a safe default true + one SECURITY DEFINER RPC). No behaviour changes until an
-- admin sets a maintenance window or blocks web access on an account.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE FUNCTION.
-- Reversible: see the footer.
--
-- Depends on existing helpers public.is_super_admin(), public.get_my_role().
-- NOTE: profiles has a BEFORE UPDATE guard trigger trg_guard_profile_privileged
-- (guard_profile_privileged_cols) that RAISES for non-Admin callers ONLY when
-- role / approved / locked / is_super_admin / country / site change. web_access
-- is a NEW column and is NOT in that blocked set, so a plain UPDATE of it inside
-- the DEFINER RPC never trips the guard (and the RPC already self-gates to
-- Admin / super-admin anyway). No trigger disable/enable dance is required.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Module maintenance window columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS maintenance_until timestamptz,
  ADD COLUMN IF NOT EXISTS maintenance_note  text;

-- ---------------------------------------------------------------------------
-- 2. Per-account WEB app access flag (mobile is unaffected by this column)
-- ---------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS web_access boolean NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 3. Admin RPC to set an account's web access.
--    Self-gates to Admin / super-admin, pins search_path, revokes anon/PUBLIC.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_set_web_access(p_user_id uuid, p_web boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Caller gate: only an Admin or a super-admin may change web access.
  IF NOT (public.is_super_admin() OR public.get_my_role() = 'Admin') THEN
    RAISE EXCEPTION 'Not authorized to change web access.'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'A target user is required.';
  END IF;

  -- web_access is not in the profiles privileged-guard blocked set, so this
  -- plain UPDATE is safe even though the DEFINER runs with the caller's role.
  UPDATE public.profiles
     SET web_access = COALESCE(p_web, true)
   WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_set_web_access(uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_set_web_access(uuid, boolean) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_set_web_access(uuid, boolean) TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.admin_set_web_access(uuid, boolean);
--   ALTER TABLE public.profiles DROP COLUMN IF EXISTS web_access;
--   ALTER TABLE public.modules
--     DROP COLUMN IF EXISTS maintenance_until,
--     DROP COLUMN IF EXISTS maintenance_note;
-- =============================================================================
