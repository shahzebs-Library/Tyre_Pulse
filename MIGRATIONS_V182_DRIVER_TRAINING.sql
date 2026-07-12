-- ============================================================================
-- MIGRATIONS_V182 — Driver Training Records
-- ============================================================================
-- Backs the Driver Training module (/driver-training): training courses
-- completed by drivers, with certification expiry tracking. Each row is one
-- course/certification for one driver — completion, score, result, and the
-- expiry date that drives compliance and renewal planning.
--
-- Certification currency is a compliance backbone (defensive driving, hazmat,
-- first aid, vehicle-specific, induction), so every record is org-isolated,
-- country-scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.driver_training (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  driver_name      text NOT NULL,
  course_name      text,
  category         text
                     CHECK (category IN ('defensive','hazmat','first_aid',
                       'vehicle_specific','compliance','induction','other')),
  provider         text,
  completed_date   date,
  expiry_date      date,
  score            numeric,
  pass_mark        numeric,
  result           text
                     CHECK (result IN ('pass','fail','pending')),
  certificate_no   text,
  certificate_url  text,
  cost             numeric,
  currency         text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_training_org       ON public.driver_training (organisation_id);
CREATE INDEX IF NOT EXISTS idx_driver_training_driver    ON public.driver_training (driver_name);
CREATE INDEX IF NOT EXISTS idx_driver_training_completed ON public.driver_training (completed_date DESC);
CREATE INDEX IF NOT EXISTS idx_driver_training_expiry    ON public.driver_training (expiry_date);

DROP TRIGGER IF EXISTS set_updated_at_driver_training ON public.driver_training;
CREATE TRIGGER set_updated_at_driver_training BEFORE UPDATE ON public.driver_training
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain training records —
-- capturing course completions and certifications is a routine ops activity.
ALTER TABLE public.driver_training ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_training_org_isolation ON public.driver_training;
CREATE POLICY driver_training_org_isolation ON public.driver_training
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS driver_training_read ON public.driver_training;
CREATE POLICY driver_training_read ON public.driver_training FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_training_insert ON public.driver_training;
CREATE POLICY driver_training_insert ON public.driver_training FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_training_update ON public.driver_training;
CREATE POLICY driver_training_update ON public.driver_training FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS driver_training_delete ON public.driver_training;
CREATE POLICY driver_training_delete ON public.driver_training FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.driver_training FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_training TO authenticated;

-- Reversible:
--   DROP TABLE public.driver_training;
