-- Workforce assignment creation: close a cross-tenant gap in the INSERT policy.
-- The earlier policy compared "p.organisation_id=organisation_id" inside an EXISTS
-- subquery. The unqualified name resolved to the PROFILE row (p), so the test was
-- p.organisation_id=p.organisation_id (always true) and a manager could assign work
-- to an employee of another organisation. Qualify the assignment column explicitly,
-- and require the assignee to be an approved, unlocked account.
-- Rollback: re-create the policy from 20261022112500_workforce_manager_permissions.sql.
DROP POLICY IF EXISTS workforce_assignments_create ON public.workforce_assignments;
CREATE POLICY workforce_assignments_create ON public.workforce_assignments FOR INSERT TO authenticated
WITH CHECK(
 public.workforce_is_manager()
 AND assigned_by=auth.uid()
 AND EXISTS(
  SELECT 1 FROM public.profiles p
  WHERE p.id=workforce_assignments.assigned_to
    AND p.organisation_id=workforce_assignments.organisation_id
    AND p.organisation_id=public.app_current_org()
    AND coalesce(p.approved,false) AND NOT coalesce(p.locked,false)
 )
);
