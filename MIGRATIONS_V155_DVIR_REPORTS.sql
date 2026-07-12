-- ============================================================================
-- MIGRATIONS_V155 — DVIR: Driver Vehicle Inspection Reports
-- ============================================================================
-- Backs the DVIR module (/dvir). Drivers log daily pre/post-trip vehicle
-- inspection reports: which asset, who inspected it, the date, whether defects
-- were found, whether the vehicle is safe to operate, and a status lifecycle
-- (open -> resolved -> closed). Org-isolated and country-scoped; any authenticated
-- member may read and maintain records.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dvir_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  inspection_type  text NOT NULL DEFAULT 'pre_trip'
                     CHECK (inspection_type IN ('pre_trip','post_trip')),
  inspection_date  date,
  defects_found    boolean NOT NULL DEFAULT false,
  defect_notes     text,
  safe_to_operate  boolean NOT NULL DEFAULT true,
  site             text,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','resolved','closed')),
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dvir_reports_org       ON public.dvir_reports (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dvir_reports_asset     ON public.dvir_reports (asset_no);
CREATE INDEX IF NOT EXISTS idx_dvir_reports_date      ON public.dvir_reports (inspection_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_dvir_reports ON public.dvir_reports;
CREATE TRIGGER set_updated_at_dvir_reports BEFORE UPDATE ON public.dvir_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read and maintain DVIR reports within their org.
ALTER TABLE public.dvir_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dvir_reports_org_isolation ON public.dvir_reports;
CREATE POLICY dvir_reports_org_isolation ON public.dvir_reports
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS dvir_reports_read ON public.dvir_reports;
CREATE POLICY dvir_reports_read ON public.dvir_reports FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dvir_reports_insert ON public.dvir_reports;
CREATE POLICY dvir_reports_insert ON public.dvir_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dvir_reports_update ON public.dvir_reports;
CREATE POLICY dvir_reports_update ON public.dvir_reports FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dvir_reports_delete ON public.dvir_reports;
CREATE POLICY dvir_reports_delete ON public.dvir_reports FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.dvir_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dvir_reports TO authenticated;

-- Reversible:
--   DROP TABLE public.dvir_reports;
