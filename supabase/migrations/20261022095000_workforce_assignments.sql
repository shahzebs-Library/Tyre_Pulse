-- Workforce assignments v1: one accountable employee and an audited source reference.
CREATE TABLE IF NOT EXISTS public.workforce_assignments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 assigned_to uuid NOT NULL REFERENCES public.profiles(id),
 assigned_by uuid NOT NULL DEFAULT auth.uid(),
 title text NOT NULL CHECK(length(trim(title))>0),
 instructions text,
 site text,
 priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','critical')),
 status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','acknowledged','in_progress','blocked','submitted','verified','cancelled')),
 due_at timestamptz,
 estimated_minutes numeric CHECK(estimated_minutes IS NULL OR estimated_minutes>0),
 source_module text, source_record_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_assignments_assignee ON public.workforce_assignments(organisation_id,assigned_to,status,due_at);
ALTER TABLE public.workforce_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_assignments_org ON public.workforce_assignments AS RESTRICTIVE FOR ALL USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_assignments_read ON public.workforce_assignments FOR SELECT TO authenticated USING(assigned_to=auth.uid() OR public.app_is_org_admin());
CREATE POLICY workforce_assignments_create ON public.workforce_assignments FOR INSERT TO authenticated WITH CHECK(public.app_is_org_admin() AND assigned_by=auth.uid() AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=assigned_to AND p.organisation_id=organisation_id));
CREATE POLICY workforce_assignments_update ON public.workforce_assignments FOR UPDATE TO authenticated USING(public.app_is_org_admin()) WITH CHECK(public.app_is_org_admin());
CREATE OR REPLACE FUNCTION public.workforce_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path=public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
   IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by THEN RAISE EXCEPTION 'Assignment ownership is immutable'; END IF;
   NEW.updated_at=now();
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER workforce_assignment_update_guard BEFORE UPDATE ON public.workforce_assignments FOR EACH ROW EXECUTE FUNCTION public.workforce_assignment_guard();
REVOKE ALL ON public.workforce_assignments FROM anon;
GRANT SELECT,INSERT,UPDATE ON public.workforce_assignments TO authenticated;
