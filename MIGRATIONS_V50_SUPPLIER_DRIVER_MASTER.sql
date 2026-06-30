-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V50 — Supplier & Driver master tables + Data Intake adapters
--
-- Adds the two master tables the Data Intake Center needs to promote the
-- 'supplier' and 'driver' modules from staging-only to live adapters:
--   supplier → suppliers, driver → drivers
-- Both are org/country-scoped, RLS-protected (mirroring vehicle_fleet), and
-- carry the scope/audit columns the generic commit RPC (V46) stamps. The
-- import_target_table() + import_existing_keys() functions are extended so the
-- existing commit/dedup pipeline works unchanged.
--
-- Natural keys mirror client validate.js keyParts() (norm=lower(btrim), chr(1)):
--   supplier : country | (supplier_code preferred, else supplier_name)
--   driver   : country | driver_id
--
-- Depends on V42 helpers (app_current_org, set_updated_at) + V46 (import_target_table).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── suppliers ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.suppliers (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  supplier_name   text NOT NULL,
  supplier_code   text,
  supplier_type   text,                          -- tyre | parts | service | other
  contact_person  text,
  phone           text,
  email           text,
  site            text,
  region          text,
  country         text,
  rating          numeric(3,1),
  status          text NOT NULL DEFAULT 'active',
  notes           text,
  organisation_id uuid,
  created_by      uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES auth.users ON DELETE SET NULL,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_suppliers_org      ON public.suppliers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_suppliers_country  ON public.suppliers (country);
CREATE INDEX IF NOT EXISTS idx_suppliers_name     ON public.suppliers (lower(btrim(supplier_name)));

-- ── drivers ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.drivers (
  id                 uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  driver_id          text NOT NULL,              -- employee / badge / iqama id (identity)
  driver_name        text NOT NULL,
  license_no         text,
  license_expiry     date,
  phone              text,
  nationality        text,
  assigned_asset_no  text,
  site               text,
  region             text,
  country            text,
  status             text NOT NULL DEFAULT 'active',
  notes              text,
  organisation_id    uuid,
  created_by         uuid REFERENCES auth.users ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_by         uuid REFERENCES auth.users ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drivers_org        ON public.drivers (organisation_id);
CREATE INDEX IF NOT EXISTS idx_drivers_country    ON public.drivers (country);
CREATE INDEX IF NOT EXISTS idx_drivers_driver_id  ON public.drivers (lower(btrim(driver_id)));

-- ── updated_at triggers ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_updated_at_suppliers ON public.suppliers;
CREATE TRIGGER set_updated_at_suppliers BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
DROP TRIGGER IF EXISTS set_updated_at_drivers ON public.drivers;
CREATE TRIGGER set_updated_at_drivers BEFORE UPDATE ON public.drivers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── RLS (mirrors vehicle_fleet: org isolation + authenticated CRUD) ──────────────
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS suppliers_org_isolation ON public.suppliers;
CREATE POLICY suppliers_org_isolation ON public.suppliers FOR ALL
  USING (organisation_id IS NULL OR organisation_id = app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = app_current_org());
DROP POLICY IF EXISTS suppliers_select ON public.suppliers;
CREATE POLICY suppliers_select ON public.suppliers FOR SELECT USING (true);
DROP POLICY IF EXISTS suppliers_insert ON public.suppliers;
CREATE POLICY suppliers_insert ON public.suppliers FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS suppliers_update ON public.suppliers;
CREATE POLICY suppliers_update ON public.suppliers FOR UPDATE
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated')
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS suppliers_delete ON public.suppliers;
CREATE POLICY suppliers_delete ON public.suppliers FOR DELETE
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS drivers_org_isolation ON public.drivers;
CREATE POLICY drivers_org_isolation ON public.drivers FOR ALL
  USING (organisation_id IS NULL OR organisation_id = app_current_org())
  WITH CHECK (organisation_id IS NULL OR organisation_id = app_current_org());
DROP POLICY IF EXISTS drivers_select ON public.drivers;
CREATE POLICY drivers_select ON public.drivers FOR SELECT USING (true);
DROP POLICY IF EXISTS drivers_insert ON public.drivers;
CREATE POLICY drivers_insert ON public.drivers FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS drivers_update ON public.drivers;
CREATE POLICY drivers_update ON public.drivers FOR UPDATE
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated')
  WITH CHECK (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS drivers_delete ON public.drivers;
CREATE POLICY drivers_delete ON public.drivers FOR DELETE
  USING (auth.uid() IS NOT NULL AND auth.role() = 'authenticated');

-- ── Map the two modules to their live tables ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.import_target_table(p_module text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT (jsonb_build_object(
    'fleet','vehicle_fleet', 'tyre','tyre_records', 'stock','stock_records',
    'accident','accidents', 'inspection','inspections', 'workorder','work_orders',
    'warranty','warranty_claims', 'gatepass','gate_passes',
    'supplier','suppliers', 'driver','drivers'
  )) ->> p_module;
$$;

-- ── Extend live-dedup with supplier + driver branches ───────────────────────────
CREATE OR REPLACE FUNCTION public.import_existing_keys(p_module text, p_country text)
RETURNS SETOF text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org    uuid := public.app_current_org();
  v_target text := public.import_target_table(p_module);
  v_key    text;
  v_guard  text;
BEGIN
  IF v_target IS NULL THEN RETURN; END IF;

  IF p_module = 'fleet' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,'''')))';
  ELSIF p_module = 'tyre' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(serial_no,'''')))';
  ELSIF p_module = 'stock' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(site,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(description,'''')))';
  ELSIF p_module = 'accident' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || '
          || 'lower(btrim(coalesce(nullif(btrim(coalesce(insurance_claim_no,'''')),''''), police_report_no, '''')))';
  ELSIF p_module = 'inspection' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspection_type,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspection_date::text,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(inspector,'''')))';
  ELSIF p_module = 'workorder' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(work_order_no,'''')))';
  ELSIF p_module = 'warranty' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(serial_number,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(claim_no,'''')))';
  ELSIF p_module = 'gatepass' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(pass_date::text,'''')))';
  ELSIF p_module = 'supplier' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || '
          || 'lower(btrim(coalesce(nullif(btrim(coalesce(supplier_code,'''')),''''), supplier_name, '''')))';
  ELSIF p_module = 'driver' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(driver_id,'''')))';
  ELSE
    RETURN;
  END IF;

  IF p_module = 'stock' THEN
    v_guard := '(btrim(coalesce(site,'''')) <> '''' OR btrim(coalesce(description,'''')) <> '''')';
  ELSIF p_module = 'tyre' THEN
    v_guard := 'btrim(coalesce(serial_no,'''')) <> ''''';
  ELSIF p_module = 'accident' THEN
    v_guard := '(btrim(coalesce(insurance_claim_no,'''')) <> '''' OR btrim(coalesce(police_report_no,'''')) <> '''')';
  ELSIF p_module = 'workorder' THEN
    v_guard := 'btrim(coalesce(work_order_no,'''')) <> ''''';
  ELSIF p_module = 'warranty' THEN
    v_guard := 'btrim(coalesce(serial_number,'''')) <> ''''';
  ELSIF p_module = 'supplier' THEN
    v_guard := '(btrim(coalesce(supplier_code,'''')) <> '''' OR btrim(coalesce(supplier_name,'''')) <> '''')';
  ELSIF p_module = 'driver' THEN
    v_guard := 'btrim(coalesce(driver_id,'''')) <> ''''';
  ELSE
    v_guard := 'btrim(coalesce(asset_no,'''')) <> ''''';   -- fleet, inspection, gatepass
  END IF;

  RETURN QUERY EXECUTE format(
    $q$
      SELECT DISTINCT %s AS k
      FROM public.%I
      WHERE (organisation_id IS NULL OR organisation_id = $1)
        AND ($2 IS NULL OR country IS NOT DISTINCT FROM $2)
        AND %s
    $q$, v_key, v_target, v_guard)
  USING v_org, p_country;
END $fn$;

GRANT EXECUTE ON FUNCTION public.import_target_table(text)  TO authenticated;
GRANT EXECUTE ON FUNCTION public.import_existing_keys(text, text) TO authenticated;
