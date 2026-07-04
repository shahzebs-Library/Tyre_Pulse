-- V70: Close cross-tenant PII exposure on public.profiles.
--
-- Before this migration the only SELECT policy on profiles was:
--     profiles_select  USING (auth.role() = 'authenticated')
-- i.e. ANY authenticated user could read EVERY profile row across ALL
-- organisations — usernames, roles, org membership, employee codes, etc.
-- The 23 business tables already enforce org isolation via RESTRICTIVE
-- *_org_isolation policies; profiles was the gap.
--
-- Fix: add a RESTRICTIVE org-isolation gate. RESTRICTIVE policies AND with the
-- existing permissive read, so a row is returned only when BOTH pass. A user may
-- read:
--   * their own profile      (id = auth.uid())            -> login/bootstrap safe
--   * any profile            (app_is_org_admin())         -> Admin / super admin
--   * same-org profiles      (org_id = app_current_org()) -> normal users
--
-- Notes / safety:
--   * app_current_org(), app_is_org_admin(), is_super_admin(), app_role() are all
--     SECURITY DEFINER with a pinned search_path -> no RLS recursion when a
--     profiles policy calls them.
--   * app_current_org() reads profiles.org_id (verified live), so the column used
--     here matches the org source of truth exactly.
--   * Verified in a rolled-back two-tenant probe: a non-admin user in org A sees
--     only their own row (1), never org B's profile, never the real admin.
--   * get_advisors(security): 0 ERROR-level findings after apply.

CREATE POLICY profiles_org_isolation ON public.profiles
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.app_is_org_admin()
    OR (org_id IS NOT NULL AND org_id = public.app_current_org())
  );
