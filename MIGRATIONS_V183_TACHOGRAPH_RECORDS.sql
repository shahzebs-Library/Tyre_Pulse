-- ============================================================================
-- MIGRATIONS_V183 — Tachograph Records
-- ============================================================================
-- Backs the Tachograph Records module (/tachograph): EU driver tachograph
-- download records. Each row captures one download (driver card or vehicle
-- unit) with aggregated driving / rest / work / availability minutes, distance,
-- and any recorded infringements. This is the compliance backbone for driver
-- hours (EC 561/2006) analytics, so every record is org-isolated, country
-- scoped, and auditable.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.tachograph_records (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id     uuid DEFAULT public.app_current_org(),
  country             text,
  driver_name         text NOT NULL,
  asset_no            text,
  card_number         text,
  record_date         date,
  download_type       text
                        CHECK (download_type IN ('driver_card','vehicle_unit')),
  driving_min         numeric,
  rest_min            numeric,
  work_min            numeric,
  available_min       numeric,
  distance_km         numeric,
  infringement_count  integer,
  infringement_types  jsonb,
  status              text
                        CHECK (status IN ('downloaded','reviewed','flagged','archived')),
  notes               text,
  created_by          uuid DEFAULT auth.uid(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tachograph_records_org    ON public.tachograph_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_tachograph_records_driver ON public.tachograph_records (driver_name);
CREATE INDEX IF NOT EXISTS idx_tachograph_records_asset  ON public.tachograph_records (asset_no);
CREATE INDEX IF NOT EXISTS idx_tachograph_records_date   ON public.tachograph_records (record_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_tachograph_records ON public.tachograph_records;
CREATE TRIGGER set_updated_at_tachograph_records BEFORE UPDATE ON public.tachograph_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and record tachograph downloads —
-- driver-hours capture is a routine compliance/ops activity, not a privileged
-- one.
ALTER TABLE public.tachograph_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tachograph_records_org_isolation ON public.tachograph_records;
CREATE POLICY tachograph_records_org_isolation ON public.tachograph_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS tachograph_records_read ON public.tachograph_records;
CREATE POLICY tachograph_records_read ON public.tachograph_records FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tachograph_records_insert ON public.tachograph_records;
CREATE POLICY tachograph_records_insert ON public.tachograph_records FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tachograph_records_update ON public.tachograph_records;
CREATE POLICY tachograph_records_update ON public.tachograph_records FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS tachograph_records_delete ON public.tachograph_records;
CREATE POLICY tachograph_records_delete ON public.tachograph_records FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.tachograph_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tachograph_records TO authenticated;

-- Reversible:
--   DROP TABLE public.tachograph_records;
