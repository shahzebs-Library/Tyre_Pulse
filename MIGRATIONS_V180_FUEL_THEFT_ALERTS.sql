-- ============================================================================
-- MIGRATIONS_V180 — Fuel Theft / Fuel Anomaly Alerts
-- ============================================================================
-- Backs the Fuel Theft Alerts module (/fuel-theft-alerts). Stores detected
-- fuel-level drops and refuel discrepancies so a fleet operator can triage,
-- investigate, and quantify fuel loss. Each row is one anomaly event for one
-- asset at a point in time — a sudden tank drop, an unexplained level change,
-- or a refuel that does not reconcile with the pump/ERP record.
--
-- Fuel is one of the largest fleet operating costs after tyres; unaddressed
-- theft and metering errors erode margin directly. This module turns raw
-- anomaly detections into an actionable, auditable investigation queue with an
-- estimated financial loss per event.
--
-- Org-scoped, country-scoped. Depends on V42 helpers: app_current_org(),
-- set_updated_at(). Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fuel_theft_alerts (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id      uuid DEFAULT public.app_current_org(),
  country              text,
  alert_no             text,
  asset_no             text NOT NULL,
  driver_name          text,
  location             text,
  detected_at          timestamptz NOT NULL DEFAULT now(),
  drop_litres          numeric,
  expected_litres      numeric,
  fuel_price_per_litre numeric,
  estimated_loss       numeric,
  currency             text,
  severity             text
                         CHECK (severity IN ('low','medium','high','critical')),
  status               text NOT NULL DEFAULT 'open'
                         CHECK (status IN ('open','investigating','confirmed','dismissed','resolved')),
  resolution           text,
  notes                text,
  created_by           uuid DEFAULT auth.uid(),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_fuel_theft_alerts_org      ON public.fuel_theft_alerts (organisation_id);
CREATE INDEX IF NOT EXISTS idx_fuel_theft_alerts_asset    ON public.fuel_theft_alerts (asset_no);
CREATE INDEX IF NOT EXISTS idx_fuel_theft_alerts_detected ON public.fuel_theft_alerts (detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_fuel_theft_alerts_status   ON public.fuel_theft_alerts (status);

DROP TRIGGER IF EXISTS set_updated_at_fuel_theft_alerts ON public.fuel_theft_alerts;
CREATE TRIGGER set_updated_at_fuel_theft_alerts BEFORE UPDATE ON public.fuel_theft_alerts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Any authenticated member of
-- the org may read alerts; authenticated members may raise (insert), triage
-- (update), and remove (delete) alerts for their own org.
ALTER TABLE public.fuel_theft_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fuel_theft_alerts_org_isolation ON public.fuel_theft_alerts;
CREATE POLICY fuel_theft_alerts_org_isolation ON public.fuel_theft_alerts
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS fuel_theft_alerts_read ON public.fuel_theft_alerts;
CREATE POLICY fuel_theft_alerts_read ON public.fuel_theft_alerts FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_theft_alerts_insert ON public.fuel_theft_alerts;
CREATE POLICY fuel_theft_alerts_insert ON public.fuel_theft_alerts FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_theft_alerts_update ON public.fuel_theft_alerts;
CREATE POLICY fuel_theft_alerts_update ON public.fuel_theft_alerts FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS fuel_theft_alerts_delete ON public.fuel_theft_alerts;
CREATE POLICY fuel_theft_alerts_delete ON public.fuel_theft_alerts FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.fuel_theft_alerts FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fuel_theft_alerts TO authenticated;

-- Reversible:
--   DROP TABLE public.fuel_theft_alerts;
