-- ============================================================================
-- V273 - admin_clear_push_token
-- ----------------------------------------------------------------------------
-- Super-admin action for the "Sessions & Devices" console page: clear a user's
-- push notification token so their device stops receiving server-sent pushes
-- (e.g. a lost/retired phone). This does NOT revoke the user's auth session -
-- true session revocation needs a service-role edge function (see the console
-- page note); this only removes the push channel.
--
-- SECURITY DEFINER + self-gate on public.is_super_admin(): anyone who is not a
-- super-admin gets a hard "not authorized" error. search_path is pinned; the
-- default PUBLIC/anon EXECUTE grant is revoked, only authenticated may call it
-- (the in-body gate is the real boundary).
--
-- Idempotent: CREATE OR REPLACE. Reversible: see the DOWN footer.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_clear_push_token(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  UPDATE public.profiles
     SET push_token = NULL,
         push_token_updated_at = now()
   WHERE id = p_user_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_clear_push_token(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_clear_push_token(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.admin_clear_push_token(uuid) TO authenticated;

-- ============================================================================
-- DOWN (manual rollback)
-- ----------------------------------------------------------------------------
-- DROP FUNCTION IF EXISTS public.admin_clear_push_token(uuid);
-- ============================================================================
