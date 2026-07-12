-- ============================================================================
-- MIGRATIONS_V146 — Battery Lifecycle
-- ============================================================================
-- Tracks vehicle/asset batteries across the fleet: install date, warranty term,
-- health %, live voltage, and a lightweight status lifecycle. Backs the Battery
-- Lifecycle module (/batteries) — register a battery, track its health, and
-- predict its replacement window against the warranty. Org-isolated and
-- country-scoped, mirroring V127 (support_tickets) / V136 (certifications).
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.batteries (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  serial_no        text,
  asset_no         text,
  brand            text,
  install_date     date,
  warranty_months  integer,
  health_pct       numeric,
  voltage          numeric,
  status           text NOT NULL DEFAULT 'healthy'
                     CHECK (status IN ('healthy','weak','replace','retired')),
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_batteries_org      ON public.batteries (organisation_id);
CREATE INDEX IF NOT EXISTS idx_batteries_asset    ON public.batteries (asset_no);
CREATE INDEX IF NOT EXISTS idx_batteries_status   ON public.batteries (status);
CREATE INDEX IF NOT EXISTS idx_batteries_created  ON public.batteries (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_batteries ON public.batteries;
CREATE TRIGGER set_updated_at_batteries BEFORE UPDATE ON public.batteries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and maintain battery records.
ALTER TABLE public.batteries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS batteries_org_isolation ON public.batteries;
CREATE POLICY batteries_org_isolation ON public.batteries
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS batteries_read ON public.batteries;
CREATE POLICY batteries_read ON public.batteries FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS batteries_insert ON public.batteries;
CREATE POLICY batteries_insert ON public.batteries FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS batteries_update ON public.batteries;
CREATE POLICY batteries_update ON public.batteries FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS batteries_delete ON public.batteries;
CREATE POLICY batteries_delete ON public.batteries FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.batteries FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.batteries TO authenticated;

-- Reversible:
--   DROP TABLE public.batteries;
