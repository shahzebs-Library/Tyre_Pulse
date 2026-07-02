-- V65: multi-org foundation. A SUPER ADMIN sees/works across ALL organisations
-- while each org's users stay isolated. Adds `OR public.is_super_admin()` to the
-- 38 uniform RESTRICTIVE *_org_isolation policies. Normal users unchanged
-- (is_super_admin() = false for them). Verified live: super-admin sees another
-- org's row (1), a normal user does not (0).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT tablename, policyname FROM pg_policies
    WHERE schemaname='public' AND permissive='RESTRICTIVE' AND policyname LIKE '%org_isolation%'
      AND qual = '((organisation_id IS NULL) OR (organisation_id = app_current_org()))'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', r.policyname, r.tablename);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
      || 'USING ((organisation_id IS NULL) OR (organisation_id = public.app_current_org()) OR public.is_super_admin()) '
      || 'WITH CHECK ((organisation_id IS NULL) OR (organisation_id = public.app_current_org()) OR public.is_super_admin())',
      r.policyname, r.tablename);
  END LOOP;
END $$;
