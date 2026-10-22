-- Workforce planning: dependency graph and standards, additive on existing assignments.
CREATE TABLE IF NOT EXISTS public.workforce_dependencies(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 predecessor_id uuid NOT NULL REFERENCES public.workforce_assignments(id) ON DELETE CASCADE,
 successor_id uuid NOT NULL REFERENCES public.workforce_assignments(id) ON DELETE CASCADE,
 created_by uuid NOT NULL DEFAULT auth.uid(), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(predecessor_id,successor_id), CHECK(predecessor_id<>successor_id)
);
ALTER TABLE public.workforce_dependencies ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_dependencies_org ON public.workforce_dependencies AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_dependencies_read ON public.workforce_dependencies FOR SELECT TO authenticated
 USING(public.workforce_is_manager() OR EXISTS(SELECT 1 FROM public.workforce_assignments a WHERE a.id=successor_id AND a.assigned_to=auth.uid()));
CREATE POLICY workforce_dependencies_create ON public.workforce_dependencies FOR INSERT TO authenticated
 WITH CHECK(public.workforce_is_manager() AND EXISTS(
  SELECT 1 FROM public.workforce_assignments a JOIN public.workforce_assignments b ON b.id=successor_id
  WHERE a.id=predecessor_id AND a.organisation_id=public.app_current_org() AND b.organisation_id=public.app_current_org()));
CREATE POLICY workforce_dependencies_delete ON public.workforce_dependencies FOR DELETE TO authenticated USING(public.workforce_is_manager());
GRANT SELECT,INSERT,DELETE ON public.workforce_dependencies TO authenticated;
CREATE TABLE IF NOT EXISTS public.workforce_work_standards(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 work_type text NOT NULL,role_name text,unit_name text NOT NULL DEFAULT 'unit',
 minutes_per_unit numeric NOT NULL CHECK(minutes_per_unit>0),
 sample_count integer NOT NULL DEFAULT 0 CHECK(sample_count>=0),
 confidence text NOT NULL DEFAULT 'provisional' CHECK(confidence IN ('provisional','reviewed','validated')),
 approved_by uuid,approved_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,work_type,role_name)
);
ALTER TABLE public.workforce_work_standards ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_standards_org ON public.workforce_work_standards AS RESTRICTIVE FOR ALL
 USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_standards_read ON public.workforce_work_standards FOR SELECT TO authenticated USING(auth.uid() IS NOT NULL);
CREATE POLICY workforce_standards_write ON public.workforce_work_standards FOR INSERT TO authenticated WITH CHECK(public.workforce_is_manager());
CREATE POLICY workforce_standards_update ON public.workforce_work_standards FOR UPDATE TO authenticated USING(public.workforce_is_manager()) WITH CHECK(public.workforce_is_manager());
GRANT SELECT,INSERT,UPDATE ON public.workforce_work_standards TO authenticated;
