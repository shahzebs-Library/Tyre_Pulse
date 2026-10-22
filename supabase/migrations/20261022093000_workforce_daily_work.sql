-- Workforce My Day v1: additive tables, org isolation, immutable submission revisions.
-- Apply through reviewed Supabase migration. Do not alter existing operational records.
CREATE TABLE IF NOT EXISTS public.workforce_daily_reports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 employee_id uuid NOT NULL DEFAULT auth.uid(),
 work_date date NOT NULL,
 site text,
 summary text NOT NULL DEFAULT '',
 next_actions text,
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','returned','verified')),
 submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid, review_note text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,employee_id,work_date)
);
CREATE TABLE IF NOT EXISTS public.workforce_daily_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 report_id uuid NOT NULL REFERENCES public.workforce_daily_reports(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL DEFAULT auth.uid(),
 title text NOT NULL CHECK (length(trim(title))>0),
 details text NOT NULL DEFAULT '', deliverable text, source_type text, source_id text,
 category text NOT NULL DEFAULT 'productive' CHECK (category IN ('productive','coordination','reporting','training','break','blocked','unassigned')),
 started_at timestamptz NOT NULL, ended_at timestamptz NOT NULL,
 blocked_reason text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (ended_at>started_at),
 CHECK (category<>'blocked' OR nullif(trim(blocked_reason),'') IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS workforce_reports_work_date ON public.workforce_daily_reports(organisation_id,work_date DESC);
CREATE INDEX IF NOT EXISTS workforce_entries_report ON public.workforce_daily_entries(report_id,started_at);
CREATE OR REPLACE FUNCTION public.workforce_guard_daily_entry() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
DECLARE r public.workforce_daily_reports;
BEGIN
 SELECT * INTO r FROM public.workforce_daily_reports WHERE id=NEW.report_id;
 IF NOT FOUND OR r.organisation_id IS DISTINCT FROM NEW.organisation_id OR r.employee_id IS DISTINCT FROM NEW.employee_id
 THEN RAISE EXCEPTION 'Entry/report identity mismatch'; END IF;
 IF r.status NOT IN ('draft','returned') THEN RAISE EXCEPTION 'Submitted or verified reports cannot be edited'; END IF;
 IF (NEW.started_at AT TIME ZONE 'UTC')::date < r.work_date - 1
    OR (NEW.ended_at AT TIME ZONE 'UTC')::date > r.work_date + 2 THEN
   RAISE EXCEPTION 'Activity does not belong to workday'; END IF;
 IF EXISTS(SELECT 1 FROM public.workforce_daily_entries e
           WHERE e.report_id=NEW.report_id AND e.id IS DISTINCT FROM NEW.id
           AND tstzrange(e.started_at,e.ended_at,'[)') && tstzrange(NEW.started_at,NEW.ended_at,'[)'))
 THEN RAISE EXCEPTION 'Overlapping activity'; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_entry_guard ON public.workforce_daily_entries;
CREATE TRIGGER workforce_entry_guard BEFORE INSERT OR UPDATE ON public.workforce_daily_entries
FOR EACH ROW EXECUTE FUNCTION public.workforce_guard_daily_entry();
CREATE OR REPLACE FUNCTION public.workforce_guard_report_update() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
 IF OLD.status='verified' THEN RAISE EXCEPTION 'Verified report is immutable'; END IF;
 IF NEW.organisation_id IS DISTINCT FROM OLD.organisation_id OR NEW.employee_id IS DISTINCT FROM OLD.employee_id OR NEW.work_date IS DISTINCT FROM OLD.work_date
 THEN RAISE EXCEPTION 'Report identity cannot be changed'; END IF;
 IF OLD.status IN ('draft','returned') AND NEW.status IN ('draft','submitted') THEN
   IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at OR NEW.review_note IS DISTINCT FROM OLD.review_note
   THEN RAISE EXCEPTION 'Employee cannot write review fields'; END IF;
 END IF;
 IF OLD.status='submitted' THEN
   IF ROW(NEW.organisation_id,NEW.employee_id,NEW.work_date,NEW.site,NEW.summary,NEW.next_actions,NEW.submitted_at,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.organisation_id,OLD.employee_id,OLD.work_date,OLD.site,OLD.summary,OLD.next_actions,OLD.submitted_at,OLD.created_at)
   THEN RAISE EXCEPTION 'Submitted report content cannot be changed during review'; END IF;
 END IF;
 IF OLD.status IN ('draft','returned') AND NEW.status='submitted' THEN
   NEW.reviewed_by=NULL; NEW.reviewed_at=NULL; NEW.review_note=NULL;
 END IF;
 IF OLD.status='submitted' AND NEW.status<>'returned' AND NEW.status<>'verified'
 THEN RAISE EXCEPTION 'Submitted report must be reviewed'; END IF;
 IF NEW.status='submitted' AND (nullif(trim(NEW.summary),'') IS NULL OR NOT EXISTS(SELECT 1 FROM public.workforce_daily_entries WHERE report_id=OLD.id))
 THEN RAISE EXCEPTION 'Report requires a summary and activity entries'; END IF;
 IF NEW.status IN ('returned','verified') AND (NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL)
 THEN RAISE EXCEPTION 'Review metadata required'; END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS workforce_report_guard ON public.workforce_daily_reports;
CREATE TRIGGER workforce_report_guard BEFORE UPDATE ON public.workforce_daily_reports
FOR EACH ROW EXECUTE FUNCTION public.workforce_guard_report_update();
ALTER TABLE public.workforce_daily_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workforce_daily_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workforce_reports_org ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_org ON public.workforce_daily_reports AS RESTRICTIVE FOR ALL
USING (organisation_id=public.app_current_org()) WITH CHECK (organisation_id=public.app_current_org());
DROP POLICY IF EXISTS workforce_entries_org ON public.workforce_daily_entries;
CREATE POLICY workforce_entries_org ON public.workforce_daily_entries AS RESTRICTIVE FOR ALL
USING (organisation_id=public.app_current_org()) WITH CHECK (organisation_id=public.app_current_org());
DROP POLICY IF EXISTS workforce_reports_read ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_read ON public.workforce_daily_reports FOR SELECT TO authenticated
USING (employee_id=auth.uid() OR public.app_is_org_admin());
DROP POLICY IF EXISTS workforce_reports_create ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_create ON public.workforce_daily_reports FOR INSERT TO authenticated
WITH CHECK (employee_id=auth.uid() AND status='draft');
DROP POLICY IF EXISTS workforce_reports_update ON public.workforce_daily_reports;
CREATE POLICY workforce_reports_update ON public.workforce_daily_reports FOR UPDATE TO authenticated
USING ((employee_id=auth.uid() AND status IN ('draft','returned')) OR (public.app_is_org_admin() AND status='submitted'))
WITH CHECK ((employee_id=auth.uid() AND status IN ('draft','submitted')) OR (public.app_is_org_admin() AND status IN ('returned','verified')));
DROP POLICY IF EXISTS workforce_entries_read ON public.workforce_daily_entries;
CREATE POLICY workforce_entries_read ON public.workforce_daily_entries FOR SELECT TO authenticated
USING (employee_id=auth.uid() OR public.app_is_org_admin());
DROP POLICY IF EXISTS workforce_entries_insert ON public.workforce_daily_entries;
CREATE POLICY workforce_entries_insert ON public.workforce_daily_entries FOR INSERT TO authenticated
WITH CHECK (employee_id=auth.uid());
DROP POLICY IF EXISTS workforce_entries_update ON public.workforce_daily_entries;
CREATE POLICY workforce_entries_update ON public.workforce_daily_entries FOR UPDATE TO authenticated
USING (employee_id=auth.uid()) WITH CHECK(employee_id=auth.uid());
REVOKE ALL ON public.workforce_daily_reports, public.workforce_daily_entries FROM anon;
GRANT SELECT,INSERT,UPDATE ON public.workforce_daily_reports TO authenticated;
GRANT SELECT,INSERT,UPDATE ON public.workforce_daily_entries TO authenticated;
