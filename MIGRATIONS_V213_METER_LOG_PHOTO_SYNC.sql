-- ============================================================================
-- MIGRATIONS_V213 — Driver meter logs: gauge photo, offline idempotency,
--                   and authoritative current_km sync
-- ============================================================================
-- PURELY ADDITIVE. Extends the EXISTING odometer_logs (V162) and
-- engine_hours_logs (V161) — no new tables, no duplication — so drivers can
-- capture daily meter readings from the mobile app in markets without
-- telematics (e.g. Egypt): a photo of the odometer / hour-meter gauge plus the
-- reading, offline-safe.
--
--   1. `photos text[]`   — storage refs of the gauge photo(s) (proof of reading).
--   2. `client_uuid text` + partial UNIQUE index — matches the mobile record
--      queue's upsert(onConflict=client_uuid, ignoreDuplicates) so a replayed
--      offline insert is a no-op (same pattern as V81 / V125).
--   3. Trigger on odometer_logs → keeps public.vehicle_fleet.current_km the
--      authoritative "actual current km", bumped forward from ANY odometer
--      source (mobile, ERP, telematics). SECURITY DEFINER so it updates the
--      fleet row regardless of the writer's RLS; strictly org-scoped and
--      monotonic (never rolls a meter backwards).
--
-- Depends on V42 helpers. Idempotent and reversible (see footer).
-- ============================================================================

-- 1 + 2 · columns -------------------------------------------------------------
ALTER TABLE public.odometer_logs
  ADD COLUMN IF NOT EXISTS photos      text[],
  ADD COLUMN IF NOT EXISTS client_uuid text;

ALTER TABLE public.engine_hours_logs
  ADD COLUMN IF NOT EXISTS photos      text[],
  ADD COLUMN IF NOT EXISTS client_uuid text;

CREATE UNIQUE INDEX IF NOT EXISTS ux_odometer_logs_client_uuid
  ON public.odometer_logs (client_uuid) WHERE client_uuid IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_engine_hours_logs_client_uuid
  ON public.engine_hours_logs (client_uuid) WHERE client_uuid IS NOT NULL;

-- 3 · authoritative current_km sync ------------------------------------------
-- On every odometer reading, advance the matching asset's current_km when the
-- new reading is higher (monotonic). Org-scoped match; runs as definer so the
-- driver's limited write scope is enough to log a reading without being granted
-- direct UPDATE on vehicle_fleet.
CREATE OR REPLACE FUNCTION public.sync_asset_current_km()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.odometer_km IS NULL OR btrim(coalesce(NEW.asset_no, '')) = '' THEN
    RETURN NEW;
  END IF;
  UPDATE public.vehicle_fleet vf
     SET current_km = NEW.odometer_km,
         updated_at = now()
   WHERE btrim(vf.asset_no) = btrim(NEW.asset_no)
     AND vf.organisation_id IS NOT DISTINCT FROM NEW.organisation_id
     AND (vf.current_km IS NULL OR NEW.odometer_km >= vf.current_km);
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_asset_current_km() FROM public, anon;

DROP TRIGGER IF EXISTS trg_sync_asset_current_km ON public.odometer_logs;
CREATE TRIGGER trg_sync_asset_current_km
  AFTER INSERT OR UPDATE OF odometer_km ON public.odometer_logs
  FOR EACH ROW EXECUTE FUNCTION public.sync_asset_current_km();

-- Reversible:
--   DROP TRIGGER IF EXISTS trg_sync_asset_current_km ON public.odometer_logs;
--   DROP FUNCTION IF EXISTS public.sync_asset_current_km();
--   DROP INDEX IF EXISTS public.ux_odometer_logs_client_uuid;
--   DROP INDEX IF EXISTS public.ux_engine_hours_logs_client_uuid;
--   ALTER TABLE public.odometer_logs     DROP COLUMN IF EXISTS photos, DROP COLUMN IF EXISTS client_uuid;
--   ALTER TABLE public.engine_hours_logs DROP COLUMN IF EXISTS photos, DROP COLUMN IF EXISTS client_uuid;
