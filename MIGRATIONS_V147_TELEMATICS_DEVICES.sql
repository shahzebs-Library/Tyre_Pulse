-- ============================================================================
-- MIGRATIONS_V147 — Telematics Device Registry
-- ============================================================================
-- Backs the Telematics Device Registry (/telematics-devices). Registers GPS /
-- telematics hardware (IMEI/serial, provider, SIM) and maps each device to a
-- fleet asset, tracking install date, operational status and last-seen contact.
-- Org-isolated, country-scoped. Admin/Manager/Director may write; any
-- authenticated member may read within their organisation.
--
-- Depends on V42 helpers: app_current_org(), set_updated_at(), get_my_role().
-- Idempotent and safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.telematics_devices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid DEFAULT public.app_current_org(),
  country          text,
  device_id        text NOT NULL,
  provider         text,
  sim_number       text,
  asset_no         text,
  install_date     date,
  last_seen_at     timestamptz,
  status           text NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active','offline','decommissioned')),
  site             text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT telematics_devices_org_device_key UNIQUE (organisation_id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_telematics_devices_org      ON public.telematics_devices (organisation_id);
CREATE INDEX IF NOT EXISTS idx_telematics_devices_asset    ON public.telematics_devices (asset_no);
CREATE INDEX IF NOT EXISTS idx_telematics_devices_status   ON public.telematics_devices (status);
CREATE INDEX IF NOT EXISTS idx_telematics_devices_created  ON public.telematics_devices (created_at DESC);

DROP TRIGGER IF EXISTS set_updated_at_telematics_devices ON public.telematics_devices;
CREATE TRIGGER set_updated_at_telematics_devices BEFORE UPDATE ON public.telematics_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Org isolation is the hard boundary (RESTRICTIVE). Layered on top: any
-- authenticated member may read devices in their org; only Admin/Manager/
-- Director may register, edit or decommission devices.
ALTER TABLE public.telematics_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS telematics_devices_org_isolation ON public.telematics_devices;
CREATE POLICY telematics_devices_org_isolation ON public.telematics_devices
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS telematics_devices_read ON public.telematics_devices;
CREATE POLICY telematics_devices_read ON public.telematics_devices FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS telematics_devices_insert ON public.telematics_devices;
CREATE POLICY telematics_devices_insert ON public.telematics_devices FOR INSERT
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS telematics_devices_update ON public.telematics_devices;
CREATE POLICY telematics_devices_update ON public.telematics_devices FOR UPDATE
  USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS telematics_devices_delete ON public.telematics_devices;
CREATE POLICY telematics_devices_delete ON public.telematics_devices FOR DELETE
  USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.telematics_devices FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.telematics_devices TO authenticated;

-- Reversible:
--   DROP TABLE public.telematics_devices;
