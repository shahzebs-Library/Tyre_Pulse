-- Workforce evidence: scoped attachment metadata, immutable after submission.
CREATE TABLE IF NOT EXISTS public.workforce_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL DEFAULT public.app_current_org(),
 report_id uuid NOT NULL REFERENCES public.workforce_daily_reports(id) ON DELETE RESTRICT,
 entry_id uuid REFERENCES public.workforce_daily_entries(id) ON DELETE RESTRICT,
 employee_id uuid NOT NULL DEFAULT auth.uid(),
 object_path text NOT NULL UNIQUE,
 file_name text NOT NULL CHECK (char_length(file_name) BETWEEN 1 AND 240),
 mime_type text NOT NULL,
 byte_size bigint NOT NULL CHECK(byte_size BETWEEN 1 AND 10485760),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workforce_evidence_report_idx ON public.workforce_evidence(report_id,created_at);
ALTER TABLE public.workforce_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY workforce_evidence_org ON public.workforce_evidence AS RESTRICTIVE FOR ALL USING(organisation_id=public.app_current_org()) WITH CHECK(organisation_id=public.app_current_org());
CREATE POLICY workforce_evidence_read ON public.workforce_evidence FOR SELECT TO authenticated USING(employee_id=auth.uid() OR public.app_is_org_admin());
CREATE POLICY workforce_evidence_insert ON public.workforce_evidence FOR INSERT TO authenticated WITH CHECK(
 employee_id=auth.uid() AND object_path LIKE organisation_id::text||'/'||employee_id::text||'/%'
 AND EXISTS(SELECT 1 FROM public.workforce_daily_reports r WHERE r.id=report_id AND r.organisation_id=organisation_id AND r.employee_id=auth.uid() AND r.status IN ('draft','returned'))
 AND (entry_id IS NULL OR EXISTS(SELECT 1 FROM public.workforce_daily_entries e WHERE e.id=entry_id AND e.report_id=report_id AND e.employee_id=auth.uid()))
);
CREATE POLICY workforce_evidence_delete ON public.workforce_evidence FOR DELETE TO authenticated USING(
 employee_id=auth.uid() AND EXISTS(SELECT 1 FROM public.workforce_daily_reports r WHERE r.id=report_id AND r.status IN ('draft','returned'))
);
REVOKE ALL ON public.workforce_evidence FROM anon;
GRANT SELECT,INSERT,DELETE ON public.workforce_evidence TO authenticated;
INSERT INTO storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 VALUES ('workforce-evidence','workforce-evidence',false,10485760,ARRAY['image/jpeg','image/png','application/pdf'])
 ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=10485760,allowed_mime_types=EXCLUDED.allowed_mime_types;
CREATE POLICY workforce_files_select ON storage.objects FOR SELECT TO authenticated
 USING(bucket_id='workforce-evidence' AND EXISTS(
 SELECT 1 FROM public.workforce_evidence e
 WHERE e.object_path=name AND e.organisation_id=public.app_current_org() AND
 (e.employee_id=auth.uid() OR public.app_is_org_admin())));
CREATE POLICY workforce_files_insert ON storage.objects FOR INSERT TO authenticated
 WITH CHECK(bucket_id='workforce-evidence' AND (storage.foldername(name))[1]=public.app_current_org()::text AND (storage.foldername(name))[2]=auth.uid()::text);
CREATE POLICY workforce_files_delete ON storage.objects FOR DELETE TO authenticated
 USING(bucket_id='workforce-evidence' AND EXISTS(
 SELECT 1 FROM public.workforce_evidence e JOIN public.workforce_daily_reports r ON r.id=e.report_id
 WHERE e.object_path=name AND e.employee_id=auth.uid() AND r.status IN ('draft','returned')));
