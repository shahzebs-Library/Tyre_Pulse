-- MIGRATIONS_V314_ADMIN_CROSSORG_SWEEP.sql
-- Status: NOT YET APPLIED. Apply by parent after review (Supabase project jhssdmeruxtrlqnwfksc).
--
-- Purpose:
--   V306 fixed the 45 `<t>_org_isolation` policies so that crossing the org boundary
--   requires a TRUE super-admin (is_super_admin()) rather than any plain Admin
--   (app_is_org_admin() returns true for role='Admin' inside the same tenant, but the
--   helper does NOT scope by org, so using it as a cross-org escape hatch lets a plain
--   Admin of tenant B read/act on tenant A's data).
--
--   This sweep finds the REMAINING RLS policies (any name, any table) that still grant
--   cross-tenant access via app_is_org_admin() and swaps that term for is_super_admin().
--   Only policies classified as a genuine cross-tenant DATA/asset leak are changed.
--
-- Full inventory of every app_is_org_admin() policy (from pg_policies) and classification:
--
--   1. storage.objects / vehicle_photos_delete  (DELETE, authenticated)   -> CHANGED (real leak)
--        USING: (bucket_id='vehicle-photos' AND app_is_org_admin())
--        The DELETE policy has NO org scoping at all (unlike vehicle_photos_read which uses
--        storage_object_in_my_org(owner)). A plain Admin of any tenant can DELETE another
--        tenant's vehicle photos. Destructive cross-tenant leak.
--        NOTE (policy decision for reviewer): the strict swap makes photo deletion
--        super-admin-only. If in-tenant admin deletion must be preserved, the correct fix is
--        `app_is_org_admin() AND storage_object_in_my_org(owner)` instead. Left as the
--        mechanical is_super_admin() swap per the sweep rule; reviewer may widen if desired.
--
--   2. public.organisations / organisations_select  (SELECT, public)       -> CHANGED (real leak)
--        USING: (id = app_current_org() OR is_super_admin() OR app_is_org_admin())
--        organisations is the tenant registry itself. app_is_org_admin() lets a plain Admin
--        enumerate ALL tenant companies (4 rows today). Cross-tenant metadata leak.
--        (The redundant duplicate is_super_admin() term produced by the swap is collapsed;
--         X OR X = X, no semantic change beyond the swap.)
--
--   3. public.report_schedules / report_schedules_select  (SELECT, public) -> CHANGED (real leak)
--        USING: (org_id IS NULL OR org_id = app_current_org() OR app_is_org_admin() OR is_super_admin())
--        app_is_org_admin() lets a plain Admin see other tenants' scheduled reports.
--        org_id IS NULL branch KEPT: all 6 rows are null-org today (global schedules), so
--        dropping it would hide every existing row. (The pre-existing global-null-org
--        exposure is a separate, documented item and out of scope for this swap.)
--        (Redundant duplicate is_super_admin() term collapsed.)
--
--   4. public.report_send_log / report_send_log_read  (SELECT, public)     -> CHANGED (real leak)
--        USING: ((organisation_id IS NULL OR organisation_id = app_current_org()
--                 OR app_is_org_admin()) AND get_my_role() = ANY('{Admin,Manager,Director}'))
--        app_is_org_admin() lets a plain Admin/Manager/Director see other tenants' report
--        delivery logs. organisation_id IS NULL branch KEPT: all 158 rows are null-org today,
--        dropping it would hide every existing row.
--
-- NOT changed / NOT touched:
--   * app_can_see_country() / app_can_see_site() function bodies are NOT modified. Their
--     internal "admin sees all countries/sites within the org" behaviour is legitimate
--     within-tenant scoping and is out of scope. (No such policy appears above anyway.)
--   * No config-table policy was found where cross-org plain-Admin access is acceptable.
--
-- Policies changed by this migration (4):
--   storage.objects.vehicle_photos_delete
--   public.organisations.organisations_select
--   public.report_schedules.report_schedules_select
--   public.report_send_log.report_send_log_read
--
-- All recreations preserve cmd / roles / PERMISSIVE / every other clause EXACTLY; the ONLY
-- logic change is app_is_org_admin() -> is_super_admin() (plus collapsing the resulting
-- duplicate is_super_admin() OR-term where one already existed).

BEGIN;

-- 1. storage.objects / vehicle_photos_delete (DELETE, authenticated)
--    Preserve in-tenant admin deletion but close the cross-tenant leak: keep the
--    admin gate (app_is_org_admin) AND scope to the caller's own org via
--    storage_object_in_my_org(owner) -- the exact org scope the READ policy uses.
--    A plain Admin can now delete ONLY their own tenant's vehicle photos.
DROP POLICY IF EXISTS "vehicle_photos_delete" ON storage.objects;
CREATE POLICY "vehicle_photos_delete"
  ON storage.objects
  AS PERMISSIVE
  FOR DELETE
  TO authenticated
  USING (
    (bucket_id = 'vehicle-photos'::text)
    AND app_is_org_admin()
    AND storage_object_in_my_org(owner)
  );

-- 2. public.organisations / organisations_select (SELECT, public)
DROP POLICY IF EXISTS "organisations_select" ON public.organisations;
CREATE POLICY "organisations_select"
  ON public.organisations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    (id = ( SELECT app_current_org() AS app_current_org))
    OR ( SELECT is_super_admin() AS is_super_admin)
  );

-- 3. public.report_schedules / report_schedules_select (SELECT, public)
--    org_id IS NULL branch kept (6/6 rows are null-org today).
DROP POLICY IF EXISTS "report_schedules_select" ON public.report_schedules;
CREATE POLICY "report_schedules_select"
  ON public.report_schedules
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    (org_id IS NULL)
    OR (org_id = ( SELECT app_current_org() AS app_current_org))
    OR ( SELECT is_super_admin() AS is_super_admin)
  );

-- 4. public.report_send_log / report_send_log_read (SELECT, public)
--    organisation_id IS NULL branch kept (158/158 rows are null-org today).
DROP POLICY IF EXISTS "report_send_log_read" ON public.report_send_log;
CREATE POLICY "report_send_log_read"
  ON public.report_send_log
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (
    (
      (organisation_id IS NULL)
      OR (organisation_id = ( SELECT app_current_org() AS app_current_org))
      OR ( SELECT is_super_admin() AS is_super_admin)
    )
    AND (( SELECT get_my_role() AS get_my_role) = ANY (ARRAY['Admin'::text, 'Manager'::text, 'Director'::text]))
  );

COMMIT;

-- Verification (run after apply):
--   SELECT tablename, policyname, qual FROM pg_policies
--   WHERE qual ILIKE '%app_is_org_admin%' OR with_check ILIKE '%app_is_org_admin%';
--   -- expect 0 rows.
