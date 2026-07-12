-- ============================================================================
-- MIGRATIONS_V181 — Vehicle Handover / Condition Reports
-- ============================================================================
-- Backs the Vehicle Handover module (/vehicle-handover): check-in / check-out
-- condition records captured whenever a vehicle changes hands between drivers.
-- Each row is one handover event for one asset at a point in time, recording the
-- outgoing/incoming driver, odometer, fuel level, overall condition, logged
-- damages, cleanliness, and supporting signature/photo evidence.
--
-- Condition history is a core accountability and cost-recovery record (damage
-- attribution, driver behaviour, downtime), so every report is org-isolated,
-- country-scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.handover_reports (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id   uuid DEFAULT public.app_current_org(),
  country           text,
  report_no         text,
  asset_no          text NOT NULL,
  handover_type     text
                      CHECK (handover_type IN ('checkout','checkin')),
  from_driver       text,
  to_driver         text,
  handover_at       timestamptz,
  odometer_km       numeric,
  fuel_level_pct    numeric,
  condition_rating  text
                      CHECK (condition_rating IN ('excellent','good','fair','poor')),
  damages           jsonb,
  damage_count      integer,
  cleanliness       text
                      CHECK (cleanliness IN ('clean','acceptable','dirty')),
  signature_url     text,
  photo_url         text,
  notes             text,
  created_by        uuid DEFAULT auth.uid(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_handover_reports_org      ON public.handover_reports (organisation_id);
CREATE INDEX IF NOT EXISTS idx_handover_reports_asset    ON public.handover_reports (asset_no);
CREATE INDEX IF NOT EXISTS idx_handover_reports_handover ON public.handover_reports (handover_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_handover_reports ON public.handover_reports;
CREATE TRIGGER set_updated_at_handover_reports BEFORE UPDATE ON public.handover_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and record handovers — condition
-- capture at driver change-over is a routine field/ops activity.
ALTER TABLE public.handover_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS handover_reports_org_isolation ON public.handover_reports;
CREATE POLICY handover_reports_org_isolation ON public.handover_reports
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS handover_reports_read ON public.handover_reports;
CREATE POLICY handover_reports_read ON public.handover_reports FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS handover_reports_insert ON public.handover_reports;
CREATE POLICY handover_reports_insert ON public.handover_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS handover_reports_update ON public.handover_reports;
CREATE POLICY handover_reports_update ON public.handover_reports FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS handover_reports_delete ON public.handover_reports;
CREATE POLICY handover_reports_delete ON public.handover_reports FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.handover_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.handover_reports TO authenticated;

-- Reversible:
--   DROP TABLE public.handover_reports;
