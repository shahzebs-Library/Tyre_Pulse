-- V246 — Standardize `site` to one canonical UPPER + single-spaced + trimmed form
-- across the operational tables where site is a grouping dimension for analytics
-- and reports. Mixed casing ("Metro" vs "METRO", "Dhahban" vs "DHAHBAN", "Redsea"
-- vs "REDSEA") split the same site into separate report buckets. A cheap
-- BEFORE-write trigger prevents future imports/edits from reintroducing the split.
--
-- Scope notes:
--  * PURE casing/whitespace fix. It does NOT merge semantically-distinct codes:
--    "REDSEA-ST" stays separate from "REDSEA"/"RED SEA", "DHABAN-ST" from "DHAHBAN",
--    "NHC-ST" from "NHC". Reconciling the tyre_records "-ST" convention against the
--    vehicle_fleet plain-name convention is a SEPARATE, business-confirmed mapping
--    (see PROJECT_MEMORY "Site vocabulary reconciliation" — deferred to user sign-off).
--  * profiles.site is deliberately EXCLUDED: it is a guarded privileged column
--    (trg_guard_profile_privileged) used for user scoping, already 0 rows off-canonical,
--    and a normalize trigger there could race the guard's "site changed?" self-edit check.
--  * Pure log/telemetry/audit tables are excluded (site there is not a report grouper).

CREATE OR REPLACE FUNCTION public.normalize_site()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.site IS NOT NULL THEN
    NEW.site := upper(regexp_replace(btrim(NEW.site), '\s+', ' ', 'g'));
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
  tables text[] := ARRAY[
    'accidents','alerts','budgets','corrective_actions','customers','drivers',
    'fleet_master','gate_passes','goods_receipts','incident_reports','inspections',
    'purchase_orders','rca_records','requisitions','stock','stock_movements',
    'stock_records','suppliers','tyre_records','tyre_rotations','tyre_service_events',
    'vehicle_fleet','warranty_claims','work_orders'
  ];
BEGIN
  -- inspections carries a content-lock trigger that blocks edits to locked
  -- checklists; casing normalization is metadata only, so bypass it for the
  -- backfill and restore below. A transaction abort would revert this DISABLE.
  ALTER TABLE public.inspections DISABLE TRIGGER trg_lock_inspection_content;

  FOREACH tbl IN ARRAY tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_normalize_site ON public.%I', tbl);
    EXECUTE format('CREATE TRIGGER trg_normalize_site BEFORE INSERT OR UPDATE OF site ON public.%I FOR EACH ROW EXECUTE FUNCTION public.normalize_site()', tbl);
    EXECUTE format(
      'UPDATE public.%I SET site = upper(regexp_replace(btrim(site),''\s+'','' '',''g''))
         WHERE site IS NOT NULL AND btrim(site) <> ''''
           AND site IS DISTINCT FROM upper(regexp_replace(btrim(site),''\s+'','' '',''g''))',
      tbl);
  END LOOP;

  ALTER TABLE public.inspections ENABLE TRIGGER trg_lock_inspection_content;
END $$;
