-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V48 — Data Intake Center: accident module live-dedup (Phase 3)
--
-- Extends import_existing_keys() (V47) with an 'accident' branch so re-imported
-- accident/insurance records are detected against the live accidents table.
--
-- Accident identity in this DB is the insurance claim no (preferred) or police
-- report no — there is NO accident_no column. The key mirrors the client
-- src/lib/import/validate.js NATURAL_KEY.accident exactly:
--   accident : norm(country) || chr(1) || norm(insurance_claim_no || police_report_no)
-- where `a || b` (JS) picks the first non-empty value, and norm(v)=lower(btrim(v)).
-- Parts joined with chr(1) (U+0001 SOH), the same separator keyParts() uses.
--
-- SECURITY DEFINER + org scope via app_current_org() (unchanged from V47). The
-- fleet/tyre/stock branches are reproduced verbatim so this is a clean
-- CREATE OR REPLACE of the whole function (idempotent, no behaviour change there).
--
-- Depends on V46 (import_target_table) + V47 + V42 helpers (app_current_org).
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
    -- claim no preferred, else police report no (first non-empty), mirroring
    -- JS `r.insurance_claim_no || r.police_report_no`.
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || '
          || 'lower(btrim(coalesce(nullif(btrim(coalesce(insurance_claim_no,'''')),''''), police_report_no, '''')))';
  ELSE
    RETURN;
  END IF;

  IF p_module = 'stock' THEN
    v_guard := '(btrim(coalesce(site,'''')) <> '''' OR btrim(coalesce(description,'''')) <> '''')';
  ELSIF p_module = 'tyre' THEN
    v_guard := 'btrim(coalesce(serial_no,'''')) <> ''''';
  ELSIF p_module = 'accident' THEN
    v_guard := '(btrim(coalesce(insurance_claim_no,'''')) <> '''' OR btrim(coalesce(police_report_no,'''')) <> '''')';
  ELSE
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
