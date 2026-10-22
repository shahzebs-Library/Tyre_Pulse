-- Managers and Directors may review organisation-scoped work; employees keep owner-only write access.
-- All access remains restricted by workforce_*_org restrictive policies.
CREATE OR REPLACE FUNCTION public.workforce_is_manager()
RETURNS boolean LANGUAGE sql STABLE SECURITY INVOKER SET search_path=public
AS $$ SELECT auth.uid() IS NOT NULL AND (
 public.app_is_org_admin() OR public.get_my_role() IN ('Manager','Director')
) $$;
REVOKE ALL ON FUNCTION public.workforce_is_manager() FROM anon;
GRANT EXECUTE ON FUNCTION public.workforce_is_manager() TO authenticated;
DROP POLICY IF EXISTS workforce_reports_read ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_read ON public.workforce_daily_reports FOR SELECT TO authenticated
USING(employee_id=auth.uid() OR public.workforce_is_manager());
DROP POLICY IF EXISTS workforce_reports_update ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_update ON public.workforce_daily_reports FOR UPDATE TO authenticated
USING((employee_id=auth.uid() AND status IN ('draft','returned')) OR (public.workforce_is_manager() AND status='submitted'))
WITH CHECK((employee_id=auth.uid() AND status IN ('draft','submitted')) OR (public.workforce_is_manager() AND status IN ('returned','verified')));
DROP POLICY IF EXISTS workforce_entries_read ON public.workforce_daily_entries;
CREATE POLICY workforce_entries_read ON public.workforce_daily_entries FOR SELECT TO authenticated
USING(employee_id=auth.uid() OR public.workforce_is_manager());
DROP POLICY IF EXISTS workforce_evidence_read ON public.workforce_evidence;
CREATE POLICY workforce_evidence_read ON public.workforce_evidence FOR SELECT TO authenticated
USING(employee_id=auth.uid() OR public.workforce_is_manager());
DROP POLICY IF EXISTS workforce_assignments_read ON public.workforce_assignments;
CREATE POLICY workforce_assignments_read ON public.workforce_assignments FOR SELECT TO authenticated
USING(assigned_to=auth.uid() OR public.workforce_is_manager());
DROP POLICY IF EXISTS workforce_assignments_create ON public.workforce_assignments;
CREATE POLICY workforce_assignments_create ON public.workforce_assignments FOR INSERT TO authenticated
WITH CHECK(public.workforce_is_manager() AND assigned_by=auth.uid() AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=assigned_to AND p.organisation_id=organisation_id));
DROP POLICY IF EXISTS workforce_assignments_update ON public.workforce_assignments;
CREATE POLICY workforce_assignments_update ON public.workforce_assignments FOR UPDATE TO authenticated
USING(public.workforce_is_manager()) WITH CHECK(public.workforce_is_manager());
