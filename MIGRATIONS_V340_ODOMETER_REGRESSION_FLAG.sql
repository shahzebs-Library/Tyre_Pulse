-- MIGRATIONS_V340_ODOMETER_REGRESSION_FLAG.sql
-- =============================================================================
-- Meter regression flagging (accept-but-flag, NEVER block).
--
-- User requirement (verbatim): "KM must be linked and raise an issue in case
-- someone makes it less in the odometer anywhere; in checklist we consider the
-- latest as the current km. If anyone added less km, FLAG it for admin but
-- DON'T block it - accept it. After the flag, admin will check and correct it
-- if required."
--
-- Behaviour delivered here:
--   * A meter reading LOWER than the asset's current stored meter is STILL
--     INSERTED (accepted) but is stamped flagged=true + flag_reason +
--     flagged_prev_reading so an admin can review and correct it later.
--   * "Current stored meter" = vehicle_fleet.current_km for odometer readings,
--     and the latest recorded engine_hours_logs value for hour-meter readings.
--   * The existing AFTER-INSERT monotonic sync trigger (sync_asset_current_km)
--     is UNTOUCHED: it already refuses to LOWER vehicle_fleet.current_km, so a
--     flagged low reading never corrupts the authoritative current_km. This
--     migration only ADDS the flag; it changes no existing trigger.
--   * The flag logic is fail-OPEN: any error while computing the flag is
--     swallowed so the reading is never blocked (the user rule is "don't block").
--
-- Idempotent: re-runnable. Safe columns are nullable / defaulted so existing
-- rows and every insert path (mobile queue, in-app importer, dashboard CSV,
-- service role) keep working.
-- =============================================================================

-- 1) Review/flag columns on odometer_logs -------------------------------------
ALTER TABLE public.odometer_logs
  ADD COLUMN IF NOT EXISTS flagged               boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason           text,
  ADD COLUMN IF NOT EXISTS flagged_prev_reading  numeric,
  ADD COLUMN IF NOT EXISTS reviewed              boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by           uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at           timestamptz;

-- 2) Review/flag columns on engine_hours_logs ---------------------------------
ALTER TABLE public.engine_hours_logs
  ADD COLUMN IF NOT EXISTS flagged               boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason           text,
  ADD COLUMN IF NOT EXISTS flagged_prev_reading  numeric,
  ADD COLUMN IF NOT EXISTS reviewed              boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reviewed_by           uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at           timestamptz;

-- Partial indexes so the admin "open flags" queue (flagged AND NOT reviewed)
-- stays fast as history grows.
CREATE INDEX IF NOT EXISTS odometer_logs_open_flags_idx
  ON public.odometer_logs (organisation_id, created_at DESC)
  WHERE flagged AND NOT reviewed;

CREATE INDEX IF NOT EXISTS engine_hours_logs_open_flags_idx
  ON public.engine_hours_logs (organisation_id, created_at DESC)
  WHERE flagged AND NOT reviewed;

-- 3) BEFORE INSERT flag trigger function --------------------------------------
-- One function serves both tables; it branches on TG_TABLE_NAME so odometer
-- rows compare against vehicle_fleet.current_km and hour rows compare against
-- the latest engine_hours_logs value for the same asset+org.
CREATE OR REPLACE FUNCTION public.flag_meter_regression()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_prev    numeric;
  v_new     numeric;
  v_unit    text;
BEGIN
  -- Never let flagging block an insert (user rule: accept, don't block).
  BEGIN
    IF btrim(coalesce(NEW.asset_no, '')) = '' THEN
      RETURN NEW;
    END IF;

    IF TG_TABLE_NAME = 'odometer_logs' THEN
      v_new  := NEW.odometer_km;
      v_unit := 'km';
      IF v_new IS NULL THEN
        RETURN NEW;
      END IF;
      -- Asset's authoritative current odometer (kept monotonic by
      -- sync_asset_current_km).
      SELECT vf.current_km INTO v_prev
        FROM public.vehicle_fleet vf
       WHERE btrim(vf.asset_no) = btrim(NEW.asset_no)
         AND vf.organisation_id IS NOT DISTINCT FROM NEW.organisation_id
       LIMIT 1;

    ELSIF TG_TABLE_NAME = 'engine_hours_logs' THEN
      v_new  := NEW.engine_hours;
      v_unit := 'hrs';
      IF v_new IS NULL THEN
        RETURN NEW;
      END IF;
      -- Latest recorded hour-meter value for this asset (no current_hours
      -- column exists on vehicle_fleet, so the log itself is the source).
      SELECT e.engine_hours INTO v_prev
        FROM public.engine_hours_logs e
       WHERE btrim(e.asset_no) = btrim(NEW.asset_no)
         AND e.organisation_id IS NOT DISTINCT FROM NEW.organisation_id
         AND e.engine_hours IS NOT NULL
       ORDER BY e.reading_date DESC NULLS LAST, e.created_at DESC
       LIMIT 1;

    ELSE
      RETURN NEW;
    END IF;

    -- Regression: new reading is strictly below the stored current. Accept the
    -- row but stamp the flag for admin review. Equal readings are fine.
    IF v_prev IS NOT NULL AND v_new < v_prev THEN
      NEW.flagged              := true;
      NEW.flagged_prev_reading := v_prev;
      NEW.flag_reason          := format(
        'Meter regression: reading %s %s is below current %s %s for asset %s. Accepted, pending admin review.',
        v_new, v_unit, v_prev, v_unit, btrim(NEW.asset_no)
      );
      -- A freshly flagged row starts un-reviewed.
      NEW.reviewed    := false;
      NEW.reviewed_by := NULL;
      NEW.reviewed_at := NULL;
    END IF;

    RETURN NEW;
  EXCEPTION WHEN OTHERS THEN
    -- Fail open: flagging must never block the reading from being saved.
    RETURN NEW;
  END;
END;
$function$;

-- 4) Attach the BEFORE INSERT triggers (idempotent) ---------------------------
DROP TRIGGER IF EXISTS trg_flag_meter_regression ON public.odometer_logs;
CREATE TRIGGER trg_flag_meter_regression
  BEFORE INSERT ON public.odometer_logs
  FOR EACH ROW EXECUTE FUNCTION public.flag_meter_regression();

DROP TRIGGER IF EXISTS trg_flag_meter_regression ON public.engine_hours_logs;
CREATE TRIGGER trg_flag_meter_regression
  BEFORE INSERT ON public.engine_hours_logs
  FOR EACH ROW EXECUTE FUNCTION public.flag_meter_regression();

-- =============================================================================
-- WEB ADMIN REVIEW SURFACE (follow-up, NOT built here):
--   A "Flagged meter readings" review queue for Admin/Manager/Director should
--   live under the existing meter/fleet area. Recommended home:
--     * New page src/pages/MeterReview.jsx (route /meter-review), OR a tab on an
--       existing odometer/meter surface (e.g. src/pages/OdometerLogs.jsx which
--       already reads odometer_logs), nav group "Fleet"/"Administration & Data".
--     * Service src/lib/api/meterReview.js: list rows WHERE flagged AND NOT
--       reviewed (odometer_logs + engine_hours_logs), show asset, new reading,
--       flagged_prev_reading, flag_reason, who/when.
--     * Actions: "Mark reviewed" (set reviewed=true, reviewed_by=auth.uid(),
--       reviewed_at=now()) and "Correct" (edit odometer_km/engine_hours). Gate
--       writes to Admin/Manager/Director via RLS/role check.
-- =============================================================================
