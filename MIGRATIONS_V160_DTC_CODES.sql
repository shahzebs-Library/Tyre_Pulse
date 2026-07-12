-- ============================================================================
-- MIGRATIONS_V160 — Workshop & Downtime: DTC Diagnostics (Trouble Codes)
-- ============================================================================
-- Backs the DTC Diagnostics module (route /dtc). Logs vehicle diagnostic
-- trouble codes (OBD-II / telematics faults) against fleet assets, with a
-- severity + status lifecycle so workshops can triage engine/ABS/emissions
-- faults, plan downtime, and track resolution.
--
-- Org-isolated, country-scoped. Any authenticated member can read/log/edit/
-- clear codes within their organisation (RLS enforces the org boundary).
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.dtc_codes (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  code             text,
  description      text,
  system           text,
  severity         text NOT NULL DEFAULT 'warning'
                     CHECK (severity IN ('info','warning','critical')),
  detected_at      date,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','acknowledged','cleared')),
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dtc_codes_org      ON public.dtc_codes (organisation_id);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_asset    ON public.dtc_codes (asset_no);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_status   ON public.dtc_codes (status);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_severity ON public.dtc_codes (severity);
CREATE INDEX IF NOT EXISTS idx_dtc_codes_detected ON public.dtc_codes (detected_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_dtc_codes ON public.dtc_codes;
CREATE TRIGGER set_updated_at_dtc_codes BEFORE UPDATE ON public.dtc_codes
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain diagnostic codes.
ALTER TABLE public.dtc_codes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dtc_codes_org_isolation ON public.dtc_codes;
CREATE POLICY dtc_codes_org_isolation ON public.dtc_codes
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS dtc_codes_read ON public.dtc_codes;
CREATE POLICY dtc_codes_read ON public.dtc_codes FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dtc_codes_insert ON public.dtc_codes;
CREATE POLICY dtc_codes_insert ON public.dtc_codes FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dtc_codes_update ON public.dtc_codes;
CREATE POLICY dtc_codes_update ON public.dtc_codes FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS dtc_codes_delete ON public.dtc_codes;
CREATE POLICY dtc_codes_delete ON public.dtc_codes FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.dtc_codes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.dtc_codes TO authenticated;

-- Reversible:
--   DROP TABLE public.dtc_codes;
