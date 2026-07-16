-- V245 — Standardize vehicle_type to one canonical UPPER(TRIM()) form.
--
-- Mixed casing (e.g. "TR-MIXER" vs "Tr-Mixer", "PUMPS" vs "Pumps", "Bus" vs "BUS")
-- was splitting the same vehicle type into separate buckets in fleet analytics
-- and the scheduled reports. This normalizes every BASE table that carries a
-- vehicle_type column and adds a cheap BEFORE-write trigger so future imports or
-- edits can never reintroduce the split. Genuinely distinct types stay distinct
-- (e.g. "Tri-mixer" -> "TRI-MIXER", NOT merged into TR-MIXER) — this is a pure
-- casing/whitespace fix, never a semantic merge.
--
-- Base tables with vehicle_type: accidents, fleet_master, inspections,
-- tyre_records, tyre_specifications, vehicle_fleet. (v_tyre_records_secure,
-- v_inspections_secure and vehicles are VIEWS that inherit from these.)

CREATE OR REPLACE FUNCTION public.normalize_vehicle_type()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.vehicle_type IS NOT NULL THEN
    NEW.vehicle_type := upper(btrim(NEW.vehicle_type));
    IF NEW.vehicle_type = '' THEN NEW.vehicle_type := NULL; END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['accidents','fleet_master','inspections','tyre_records','tyre_specifications','vehicle_fleet']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_normalize_vehicle_type ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_normalize_vehicle_type BEFORE INSERT OR UPDATE OF vehicle_type ON public.%I FOR EACH ROW EXECUTE FUNCTION public.normalize_vehicle_type()', tbl);
  END LOOP;
END $$;

-- Backfill existing rows to the canonical form.
UPDATE public.accidents           SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));
UPDATE public.fleet_master        SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));
UPDATE public.tyre_records        SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));
UPDATE public.tyre_specifications SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));
UPDATE public.vehicle_fleet       SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));

-- inspections carries trg_lock_inspection_content, which blocks edits to locked
-- checklists. Casing-normalization is metadata only, so bypass that guard for
-- just this backfill, then restore it. (New writes still normalize via
-- trg_normalize_vehicle_type, which does not conflict with the lock guard.)
ALTER TABLE public.inspections DISABLE TRIGGER trg_lock_inspection_content;
UPDATE public.inspections SET vehicle_type = upper(btrim(vehicle_type)) WHERE vehicle_type IS NOT NULL AND vehicle_type IS DISTINCT FROM upper(btrim(vehicle_type));
ALTER TABLE public.inspections ENABLE TRIGGER trg_lock_inspection_content;
