-- V360 — Daily KM self-service import (Supabase Table Editor CSV -> odometer_logs).
--
-- The customer uploads a simple daily-km sheet (asset code vs kms). This is the
-- same "pure pipe" pattern as expenses_ksa / stg_* : import a raw CSV into
-- public.daily_km in the Table Editor, a BEFORE INSERT trigger maps + routes the
-- row into the real public.odometer_logs table and RETURNS NULL, so daily_km
-- always stays EMPTY and there is no second copy of the data to reconcile.
--
-- HEADER TOLERANCE (deliberate): the exact column names in the customer's file
-- vary, and past imports failed on header mismatch. Several alias columns are
-- provided so the Table Editor auto-maps whatever the sheet calls things:
--     asset  <- asset_code | asset_no | asset | equipment_no
--     km     <- kms | km | odometer | odometer_km | reading
--     date   <- date | reading_date | txn_date          (defaults to today)
-- Only ONE of each group needs to be present in the CSV.
--
-- MERGE, NEVER DUPLICATE: a second upload of the same asset+date UPDATES that
-- reading instead of inserting a duplicate. Existing behaviour preserved: V213
-- sync_asset_current_km still advances vehicle_fleet.current_km (monotonic), and
-- V340 flag_meter_regression still ACCEPTS-but-FLAGS a below-previous reading.
--
-- VERIFIED LIVE (rolled back): lowercase/whitespace asset folded to canonical
-- UPPER; "125,600" parsed; GRAND TOTAL, blank asset and zero km skipped; a second
-- row for the same asset+date updated instead of duplicating; country + site
-- auto-filled from vehicle_fleet; DD-MM-YYYY and DD-Mon-YY dates parsed; staging
-- table left empty.

CREATE TABLE IF NOT EXISTS public.daily_km (
  id            bigserial PRIMARY KEY,
  asset_code    text,
  asset_no      text,
  asset         text,
  equipment_no  text,
  kms           text,
  km            text,
  odometer      text,
  odometer_km   text,
  reading       text,
  date          text,
  reading_date  text,
  txn_date      text,
  country       text,
  site          text,
  notes         text
);

COMMENT ON TABLE public.daily_km IS
  'Import pipe for daily odometer readings. Rows are routed into odometer_logs by trigger and never stored here. Supply an asset column, a km column, and optionally a date and country.';

CREATE OR REPLACE FUNCTION public.daily_km_num(v text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT nullif(regexp_replace(coalesce(v, ''), '[^0-9.\-]', '', 'g'), '')::numeric;
$$;

CREATE OR REPLACE FUNCTION public.process_daily_km()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_asset text; v_km numeric; v_date date; v_country text; v_site text;
  v_org uuid; v_existing uuid;
BEGIN
  v_asset := upper(btrim(coalesce(
    nullif(btrim(NEW.asset_code), ''), nullif(btrim(NEW.asset_no), ''),
    nullif(btrim(NEW.asset), ''), nullif(btrim(NEW.equipment_no), ''))));

  v_km := coalesce(
    public.daily_km_num(NEW.kms), public.daily_km_num(NEW.km),
    public.daily_km_num(NEW.odometer), public.daily_km_num(NEW.odometer_km),
    public.daily_km_num(NEW.reading));

  IF v_asset IS NULL OR v_asset = '' OR v_km IS NULL OR v_km <= 0
     OR public.erp_is_footer(v_asset) THEN
    RETURN NULL;
  END IF;

  v_date := coalesce(
    public.erp_parse_date(nullif(btrim(NEW.date), '')),
    public.erp_parse_date(nullif(btrim(NEW.reading_date), '')),
    public.erp_parse_date(nullif(btrim(NEW.txn_date), '')),
    current_date);

  v_country := nullif(btrim(NEW.country), '');
  v_site    := nullif(btrim(NEW.site), '');

  -- Fill country from the fleet register only when the asset is unambiguous:
  -- a vehicle can legitimately exist in more than one country after a transfer.
  IF v_country IS NULL THEN
    IF (SELECT count(DISTINCT f.country) FROM public.vehicle_fleet f
        WHERE f.asset_no = v_asset) = 1 THEN
      SELECT max(f.country) INTO v_country FROM public.vehicle_fleet f
      WHERE f.asset_no = v_asset;
    END IF;
  END IF;

  IF v_site IS NULL THEN
    SELECT max(f.site) INTO v_site FROM public.vehicle_fleet f
    WHERE f.asset_no = v_asset AND (v_country IS NULL OR f.country = v_country);
  END IF;

  -- The dashboard importer has no profile, so app_current_org() is NULL there and
  -- the row would be invisible under RLS. Same fallback rule as V290.
  v_org := coalesce(public.app_current_org(), '00000000-0000-0000-0000-000000000001'::uuid);

  SELECT o.id INTO v_existing FROM public.odometer_logs o
  WHERE o.organisation_id = v_org AND o.asset_no = v_asset AND o.reading_date = v_date
  ORDER BY o.created_at DESC LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.odometer_logs
       SET odometer_km = v_km, site = coalesce(v_site, site),
           country = coalesce(v_country, country),
           notes = coalesce(nullif(btrim(NEW.notes), ''), notes),
           source = 'Daily KM import', updated_at = now()
     WHERE id = v_existing;
  ELSE
    INSERT INTO public.odometer_logs
      (organisation_id, country, asset_no, odometer_km, reading_date, source, site, notes)
    VALUES (v_org, v_country, v_asset, v_km, v_date, 'Daily KM import', v_site,
            nullif(btrim(NEW.notes), ''));
  END IF;

  RETURN NULL; -- pure pipe: nothing stored in daily_km
END;
$$;

DROP TRIGGER IF EXISTS trg_process_daily_km ON public.daily_km;
CREATE TRIGGER trg_process_daily_km
  BEFORE INSERT ON public.daily_km
  FOR EACH ROW EXECUTE FUNCTION public.process_daily_km();

ALTER TABLE public.daily_km ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_km_select ON public.daily_km;
CREATE POLICY daily_km_select ON public.daily_km
  FOR SELECT TO authenticated USING (public.app_is_active());

DROP POLICY IF EXISTS daily_km_insert ON public.daily_km;
CREATE POLICY daily_km_insert ON public.daily_km
  FOR INSERT TO authenticated WITH CHECK (public.app_is_elevated());

REVOKE ALL ON public.daily_km FROM anon;
GRANT SELECT, INSERT ON public.daily_km TO authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.daily_km_id_seq TO authenticated;

-- ============================================================================
-- REVERSIBLE:
--   DROP TRIGGER IF EXISTS trg_process_daily_km ON public.daily_km;
--   DROP FUNCTION IF EXISTS public.process_daily_km();
--   DROP FUNCTION IF EXISTS public.daily_km_num(text);
--   DROP TABLE IF EXISTS public.daily_km;
-- Imported readings live in odometer_logs (source = 'Daily KM import'):
--   DELETE FROM public.odometer_logs WHERE source = 'Daily KM import';
-- ============================================================================
