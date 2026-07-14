-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATIONS V224 — report_schedules: super-admin manage + dedupe + org-scoped writes
-- Applied live via Supabase MCP on 2026-07-14 (project jhssdmeruxtrlqnwfksc).
--
-- BUG: the write policies on report_schedules only allowed role IN
-- (Admin, Manager, Director) with a TAUTOLOGICAL org check
-- (report_schedules.org_id = report_schedules.org_id), and did NOT recognise
-- super-admin (public.is_super_admin()). A pure super-admin therefore could not
-- create/edit/delete scheduled reports. Two overlapping policy sets existed
-- (report_schedules_* and rs_*).
--
-- FIX: one clean policy set. Super-admin can always manage; otherwise
-- Admin/Manager/Director acting within their own organisation (real org scope).
-- SELECT additionally lets super-admin see every org's schedules.
-- ═══════════════════════════════════════════════════════════════════════════

DROP POLICY IF EXISTS report_schedules_insert ON public.report_schedules;
DROP POLICY IF EXISTS report_schedules_update ON public.report_schedules;
DROP POLICY IF EXISTS report_schedules_delete ON public.report_schedules;
DROP POLICY IF EXISTS report_schedules_select ON public.report_schedules;
DROP POLICY IF EXISTS rs_insert ON public.report_schedules;
DROP POLICY IF EXISTS rs_update ON public.report_schedules;
DROP POLICY IF EXISTS rs_delete ON public.report_schedules;

CREATE POLICY report_schedules_select ON public.report_schedules
  FOR SELECT USING (
    org_id IS NULL
    OR org_id = public.app_current_org()
    OR public.app_is_org_admin()
    OR public.is_super_admin()
  );

CREATE POLICY report_schedules_insert ON public.report_schedules
  FOR INSERT WITH CHECK (
    public.is_super_admin()
    OR (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
        AND (org_id IS NULL OR org_id = public.app_current_org()))
  );

CREATE POLICY report_schedules_update ON public.report_schedules
  FOR UPDATE USING (
    public.is_super_admin()
    OR (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
        AND (org_id IS NULL OR org_id = public.app_current_org()))
  ) WITH CHECK (
    public.is_super_admin()
    OR (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
        AND (org_id IS NULL OR org_id = public.app_current_org()))
  );

CREATE POLICY report_schedules_delete ON public.report_schedules
  FOR DELETE USING (
    public.is_super_admin()
    OR (public.get_my_role() = ANY (ARRAY['Admin','Manager','Director'])
        AND (org_id IS NULL OR org_id = public.app_current_org()))
  );
