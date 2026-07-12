-- ============================================================================
-- MIGRATIONS_V144 — Operations: Vehicle Check In / Out
-- ============================================================================
-- Logs vehicle handovers: a driver checks a vehicle OUT (capturing odometer,
-- fuel level and condition) and later checks it back IN. Backs the Vehicle
-- Check In/Out page. Org-isolated, country-scoped, with a lightweight open/closed
-- status lifecycle.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_checkinout (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  asset_no         text NOT NULL,
  driver_name      text,
  direction        text NOT NULL DEFAULT 'out'
                     CHECK (direction IN ('out','in')),
  odometer_km      numeric,
  fuel_level       text,
  condition_notes  text,
  site             text,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open','closed')),
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vehicle_checkinout_org      ON public.vehicle_checkinout (organisation_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_checkinout_asset    ON public.vehicle_checkinout (asset_no);
CREATE INDEX IF NOT EXISTS idx_vehicle_checkinout_checked  ON public.vehicle_checkinout (checked_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_vehicle_checkinout ON public.vehicle_checkinout;
CREATE TRIGGER set_updated_at_vehicle_checkinout BEFORE UPDATE ON public.vehicle_checkinout
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member of the org may read and log handovers.
ALTER TABLE public.vehicle_checkinout ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_checkinout_org_isolation ON public.vehicle_checkinout;
CREATE POLICY vehicle_checkinout_org_isolation ON public.vehicle_checkinout
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS vehicle_checkinout_read ON public.vehicle_checkinout;
CREATE POLICY vehicle_checkinout_read ON public.vehicle_checkinout FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_checkinout_insert ON public.vehicle_checkinout;
CREATE POLICY vehicle_checkinout_insert ON public.vehicle_checkinout FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_checkinout_update ON public.vehicle_checkinout;
CREATE POLICY vehicle_checkinout_update ON public.vehicle_checkinout FOR UPDATE
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS vehicle_checkinout_delete ON public.vehicle_checkinout;
CREATE POLICY vehicle_checkinout_delete ON public.vehicle_checkinout FOR DELETE
  USING (auth.uid() IS NOT NULL);

REVOKE ALL ON public.vehicle_checkinout FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vehicle_checkinout TO authenticated;

-- Reversible:
--   DROP TABLE public.vehicle_checkinout;
