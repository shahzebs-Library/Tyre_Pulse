-- AI Tyre Inspection: complete additive database foundation
-- Read-only client access; privileged, audited service writes for AI jobs.
-- Inspections and profiles already use organisation_id and app_current_org().
BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_tyre_inspection_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
 tyre_position text NOT NULL CHECK(length(tyre_position) BETWEEN 1 AND 80),
 photo_ref text NOT NULL CHECK(length(photo_ref) BETWEEN 1 AND 2048),
 photo_sha256 text NOT NULL CHECK(photo_sha256 ~ '^[a-f0-9]{64}$'),
 status text NOT NULL DEFAULT 'pending'
   CHECK(status IN ('pending','processing','completed','failed','review_required')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0 AND attempts <= 100),
 analysis jsonb,
 model_version text,
 prompt_version text,
 reviewer_id uuid,
 review_status text NOT NULL DEFAULT 'unreviewed'
   CHECK(review_status IN ('unreviewed','accepted','rejected','corrected')),
 reviewer_note text,
 reviewed_at timestamptz,
 cost_usd numeric(12,6) CHECK(cost_usd IS NULL OR cost_usd >= 0),
 error_message text,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(organisation_id,inspection_id,tyre_position,photo_sha256)
);
CREATE INDEX IF NOT EXISTS ai_tyre_jobs_pending_idx
 ON public.ai_tyre_inspection_jobs(status,created_at)
 WHERE status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS ai_tyre_jobs_inspection_idx
 ON public.ai_tyre_inspection_jobs(organisation_id,inspection_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.ai_tyre_depth_measurements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 organisation_id uuid NOT NULL,
 inspection_id uuid NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
 tyre_position text NOT NULL CHECK(length(tyre_position) BETWEEN 1 AND 80),
 tyre_serial text,
 original_mm numeric(6,2),
 minimum_mm numeric(6,2),
 inner_mm numeric(6,2),
 center_mm numeric(6,2),
 outer_mm numeric(6,2),
 source text NOT NULL CHECK(source IN ('manual_gauge','digital_gauge','calibrated_device')),
 odometer_km numeric(12,1),
 measured_at timestamptz NOT NULL,
 recorded_by uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(original_mm IS NULL OR (original_mm > 0 AND original_mm <= 100)),
 CHECK(minimum_mm IS NULL OR minimum_mm >= 0),
 CHECK(original_mm IS NULL OR minimum_mm IS NULL OR original_mm > minimum_mm),
 CHECK(inner_mm IS NULL OR inner_mm >= 0),
 CHECK(center_mm IS NULL OR center_mm >= 0),
 CHECK(outer_mm IS NULL OR outer_mm >= 0),
 CHECK(inner_mm IS NOT NULL OR center_mm IS NOT NULL OR outer_mm IS NOT NULL),
 CHECK(odometer_km IS NULL OR odometer_km >= 0),
 CHECK(original_mm IS NULL OR (inner_mm IS NULL OR inner_mm <= original_mm)),
 CHECK(original_mm IS NULL OR (center_mm IS NULL OR center_mm <= original_mm)),
 CHECK(original_mm IS NULL OR (outer_mm IS NULL OR outer_mm <= original_mm))
);
CREATE INDEX IF NOT EXISTS ai_tyre_depth_inspection_idx ON
 public.ai_tyre_depth_measurements(organisation_id,inspection_id,tyre_position,measured_at DESC);

-- Ensure the tenant is always the same as the originating inspection.
-- Trigger runs under invoking user privileges, service-role writes only.
CREATE OR REPLACE FUNCTION public.ai_tyre_validate_org()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog,public
AS $$
DECLARE inspection_org uuid;
BEGIN
 SELECT organisation_id INTO inspection_org FROM public.inspections WHERE id=NEW.inspection_id;
 IF inspection_org IS NULL OR inspection_org IS DISTINCT FROM NEW.organisation_id THEN
  RAISE EXCEPTION 'Inspection organisation mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.ai_tyre_validate_org() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS ai_tyre_job_org_guard ON public.ai_tyre_inspection_jobs;
CREATE TRIGGER ai_tyre_job_org_guard BEFORE INSERT OR UPDATE OF inspection_id,organisation_id
 ON public.ai_tyre_inspection_jobs FOR EACH ROW EXECUTE FUNCTION public.ai_tyre_validate_org();
DROP TRIGGER IF EXISTS ai_tyre_depth_org_guard ON public.ai_tyre_depth_measurements;
CREATE TRIGGER ai_tyre_depth_org_guard BEFORE INSERT OR UPDATE OF inspection_id,organisation_id
 ON public.ai_tyre_depth_measurements FOR EACH ROW EXECUTE FUNCTION public.ai_tyre_validate_org();

ALTER TABLE public.ai_tyre_inspection_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_tyre_depth_measurements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ai_tyre_inspection_jobs FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.ai_tyre_depth_measurements FROM PUBLIC,anon,authenticated;
-- Clients may read only authorized organisation data after the migration.
GRANT SELECT ON public.ai_tyre_inspection_jobs TO authenticated;
GRANT SELECT ON public.ai_tyre_depth_measurements TO authenticated;

DROP POLICY IF EXISTS ai_tyre_jobs_org_read ON public.ai_tyre_inspection_jobs;
CREATE POLICY ai_tyre_jobs_org_read ON public.ai_tyre_inspection_jobs
 FOR SELECT TO authenticated
 USING (
  ((organisation_id=(SELECT app_current_org())) OR (SELECT is_super_admin()))
  AND (SELECT app_user_can('inspections','view'))
  AND EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id=inspection_id
      AND i.organisation_id=ai_tyre_inspection_jobs.organisation_id
  )
 );

DROP POLICY IF EXISTS ai_tyre_depth_org_read ON public.ai_tyre_depth_measurements;
CREATE POLICY ai_tyre_depth_org_read ON public.ai_tyre_depth_measurements
 FOR SELECT TO authenticated
 USING (
  ((organisation_id=(SELECT app_current_org())) OR (SELECT is_super_admin()))
  AND (SELECT app_user_can('inspections','view'))
  AND EXISTS (
    SELECT 1 FROM public.inspections i
    WHERE i.id=inspection_id
      AND i.organisation_id=ai_tyre_depth_measurements.organisation_id
  )
 );
-- Never create public INSERT/UPDATE/DELETE policies. Privileged server must
-- validate role and tenant before writing; no browser may approve AI findings.
COMMIT;
