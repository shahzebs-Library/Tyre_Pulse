-- ============================================================================
-- MIGRATIONS_V143 — Cold-Chain Monitor: Temperature Logs
-- ============================================================================
-- Backs the Cold-Chain Monitor module (/cold-chain). Logs refrigerated-cargo
-- temperature readings for an asset/site against a configured safe range and
-- flags breaches (outside range) and warnings (within 1°C of a bound). Manual
-- entry today; the schema is sensor-ready so an ingest pipeline can insert
-- readings later without change. Org-isolated and country-scoped, mirroring the
-- V127 Support Tickets template.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.cold_chain_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text,
  site             text,
  temperature_c    numeric,
  min_threshold_c  numeric,
  max_threshold_c  numeric,
  status           text NOT NULL DEFAULT 'ok'
                     CHECK (status IN ('ok','breach','warning')),
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cold_chain_logs_org      ON public.cold_chain_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_cold_chain_logs_asset    ON public.cold_chain_logs (asset_no);
CREATE INDEX IF NOT EXISTS idx_cold_chain_logs_recorded ON public.cold_chain_logs (recorded_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_cold_chain_logs ON public.cold_chain_logs;
CREATE TRIGGER set_updated_at_cold_chain_logs BEFORE UPDATE ON public.cold_chain_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log/edit/delete readings.
ALTER TABLE public.cold_chain_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS cold_chain_logs_org_isolation ON public.cold_chain_logs;
CREATE POLICY cold_chain_logs_org_isolation ON public.cold_chain_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS cold_chain_logs_read ON public.cold_chain_logs;
CREATE POLICY cold_chain_logs_read ON public.cold_chain_logs FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cold_chain_logs_insert ON public.cold_chain_logs;
CREATE POLICY cold_chain_logs_insert ON public.cold_chain_logs FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cold_chain_logs_update ON public.cold_chain_logs;
CREATE POLICY cold_chain_logs_update ON public.cold_chain_logs FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS cold_chain_logs_delete ON public.cold_chain_logs;
CREATE POLICY cold_chain_logs_delete ON public.cold_chain_logs FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.cold_chain_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cold_chain_logs TO authenticated;

-- Reversible:
--   DROP TABLE public.cold_chain_logs;
