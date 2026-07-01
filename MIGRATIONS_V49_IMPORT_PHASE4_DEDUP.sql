-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V49 — Data Intake Center: Phase 4 adapter live-dedup
--
-- Extends import_existing_keys() with branches for the four Phase-4 modules that
-- have live target tables (import_target_table, V46):
--   inspection → inspections, workorder → work_orders,
--   warranty   → warranty_claims, gatepass → gate_passes
--
-- Each key mirrors the client src/lib/import/validate.js NATURAL_KEY exactly:
--   norm(v)=lower(btrim(v)); parts joined with chr(1) (U+0001 SOH). Date columns
--   are cast ::text (transformRow emits ISO 'YYYY-MM-DD', matching date::text).
--     inspection : country | asset_no | inspection_type | inspection_date | inspector
--     workorder  : country | work_order_no
--     warranty   : country | serial_number | claim_no
--     gatepass   : country | asset_no | pass_date   (no gatepass-no column exists)
--
-- The fleet/tyre/stock/accident branches are reproduced verbatim so this is a
-- clean CREATE OR REPLACE (idempotent, no behaviour change there).
-- SECURITY DEFINER + org scope via app_current_org() (unchanged).
--
-- Suppliers / drivers / GPS-ERP / custom remain staging-only (no live target,
-- surfaced via the Custom Field Catalogue) and intentionally have no branch.
--
-- Depends on V46/V47/V48 + V42 helpers (app_current_org).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.import_existing_keys(p_module text, p_country text)
RETURNS SETOF text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org    uuid := public.app_current_org();
  v_target text := public.import_target_table(p_module);
  v_key    text;
  v_guard  text;
BEGIN
  IF v_target IS NULL THEN
    RETURN;
  END IF;

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
  ELSE
    -- fleet, inspection, gatepass: asset_no is the practical identifier.
    v_guard := 'btrim(coalesce(asset_no,'''')) <> ''''';
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

GRANT EXECUTE ON FUNCTION public.import_existing_keys(text, text) TO authenticated;
