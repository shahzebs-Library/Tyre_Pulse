-- ============================================================================
-- MIGRATIONS_V138 — Incident Reports
-- ============================================================================
-- Logs operational incidents (near-miss, damage, breakdown, safety, theft…)
-- raised against an asset/site — distinct from the formal Accidents module.
-- Any authenticated member can raise, view, update and resolve incidents within
-- their organisation. Org-isolated (RESTRICTIVE), country-scoped, with a light
-- status lifecycle.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.incident_reports (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  incident_no      text,
  incident_type    text NOT NULL DEFAULT 'other'
                     CHECK (incident_type IN ('near_miss','damage','breakdown','safety','theft','other')),
  asset_no         text,
  site             text,
  incident_date    date,
  severity         text NOT NULL DEFAULT 'medium'
                     CHECK (severity IN ('low','medium','high','critical')),
  reported_by      text,
  description      text,
  action_taken     text,
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','investigating','resolved','closed')),
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_incident_reports_org      ON public.incident_reports (organisation_id);
CREATE INDEX IF NOT EXISTS idx_incident_reports_status   ON public.incident_reports (status);
CREATE INDEX IF NOT EXISTS idx_incident_reports_severity ON public.incident_reports (severity);
CREATE INDEX IF NOT EXISTS idx_incident_reports_asset    ON public.incident_reports (asset_no);
CREATE INDEX IF NOT EXISTS idx_incident_reports_created  ON public.incident_reports (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_incident_reports ON public.incident_reports;
CREATE TRIGGER set_updated_at_incident_reports BEFORE UPDATE ON public.incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read, raise, update and delete incidents.
ALTER TABLE public.incident_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS incident_reports_org_isolation ON public.incident_reports;
CREATE POLICY incident_reports_org_isolation ON public.incident_reports
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS incident_reports_read ON public.incident_reports;
CREATE POLICY incident_reports_read ON public.incident_reports FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS incident_reports_insert ON public.incident_reports;
CREATE POLICY incident_reports_insert ON public.incident_reports FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS incident_reports_update ON public.incident_reports;
CREATE POLICY incident_reports_update ON public.incident_reports FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS incident_reports_delete ON public.incident_reports;
CREATE POLICY incident_reports_delete ON public.incident_reports FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.incident_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.incident_reports TO authenticated;

-- Reversible:
--   DROP TABLE public.incident_reports;
