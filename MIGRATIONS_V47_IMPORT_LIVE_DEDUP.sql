-- ─────────────────────────────────────────────────────────────────────────────
-- MIGRATIONS_V47 — Data Intake Center: live-table duplicate detection (Phase 2)
--
-- Phase 1 (V45/V46) deduplicated rows WITHIN a single import batch only. A record
-- that already exists in the live operational table would still be blindly
-- re-inserted on a second import, creating a duplicate live row. This migration
-- closes that gap: import_existing_keys() returns the set of natural-key strings
-- already present in the live target table for the caller's organisation, so the
-- Data Intake Center can mark a re-imported record as a duplicate and skip it
-- instead of inserting a second copy.
--
-- The natural key is built EXACTLY as the client validate.js keyParts() does:
-- norm(v) = lower(trim(v)); parts are joined with a U+0001 (SOH) separator —
-- chr(1) in SQL. The separator prevents component-boundary collisions
-- (e.g. "ab"+"c" vs "a"+"bc").
--   fleet : norm(country) || chr(1) || norm(asset_no)
--   tyre  : norm(country) || chr(1) || norm(serial_no)
--   stock : norm(country) || chr(1) || norm(site) || chr(1) || norm(description)
--
-- SECURITY DEFINER + org scope via app_current_org() (same pattern as V46). Read
-- only — it never writes. Modules without a live target table return an empty set.
--
-- Depends on V46 (import_target_table) + V42 helpers (app_current_org).
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Natural keys already present in a module's live table (org-scoped) ────────
CREATE OR REPLACE FUNCTION public.import_existing_keys(p_module text, p_country text)
RETURNS SETOF text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $fn$
DECLARE
  v_org    uuid := public.app_current_org();
  v_target text := public.import_target_table(p_module);
  v_key    text;
  v_guard  text;
BEGIN
  -- Modules without a live target table have nothing to dedup against.
  IF v_target IS NULL THEN
    RETURN;
  END IF;

  -- Build the natural key per module, mirroring validate.js keyParts() exactly:
  --   norm(v) = lower(btrim(v)); a NULL component contributes an empty string;
  --   parts are joined with chr(1) (U+0001 SOH), the same separator keyParts uses.
  -- Only the identifying component is required (matches keyParts() null guard):
  --   fleet → asset_no, tyre → serial_no, stock → site AND description.
  -- The guard is enforced below via the per-module identifier <> '' predicate.
  -- Org scope: NULL organisation_id (legacy/uncategorised) is treated as in-org,
  -- exactly like app_in_org(). Country is filtered when supplied.
  IF p_module = 'fleet' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(asset_no,'''')))';
  ELSIF p_module = 'tyre' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(serial_no,'''')))';
  ELSIF p_module = 'stock' THEN
    v_key := 'lower(btrim(coalesce(country,''''))) || chr(1) || lower(btrim(coalesce(site,''''))) '
          || '|| chr(1) || lower(btrim(coalesce(description,'''')))';
  ELSE
    -- Unknown / unsupported module → no keys.
    RETURN;
  END IF;

  -- Per-module identifier guard, mirroring keyParts()'s null rule precisely:
  --   keyParts returns null when (a) every component is blank, or (b) the LAST
  --   component is blank AND the 2nd component (index 1) is blank.
  --   fleet/tyre (2 parts): identifier is the 2nd part → require it non-blank.
  --   stock (3 parts): null only when site (index 1) AND description (last) are
  --     both blank → require (site <> '' OR description <> '').
  IF p_module = 'stock' THEN
    v_guard := '(btrim(coalesce(site,'''')) <> '''' OR btrim(coalesce(description,'''')) <> '''')';
  ELSIF p_module = 'tyre' THEN
    v_guard := 'btrim(coalesce(serial_no,'''')) <> ''''';
  ELSE -- fleet
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

COMMENT ON FUNCTION public.import_existing_keys(text, text) IS
  'Returns the set of natural-key strings already present in a module''s live table for the caller''s organisation. Used by the Data Intake Center to skip re-imports of existing records (live-table duplicate detection, V47). Key built identically to client validate.js keyParts(): norm(v)=lower(trim(v)), parts joined with chr(1). fleet=country|asset_no, tyre=country|serial_no, stock=country|site|description.';
