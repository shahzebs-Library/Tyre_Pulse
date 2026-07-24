-- =============================================================================
-- MIGRATIONS_V358_STORE_SITE_MAP.sql
-- Per-SITE expense: map parts_consumption.store_code -> the app's site vocabulary.
--
-- The parts_consumption grid records the ERP store_code, which does NOT match the
-- app's governed `sites` vocabulary, so per-site expense previously fell back to
-- legacy sources. This adds:
--   1. public.store_site_map  - one row per (org, country, store_code) -> site.
--   2. SEED  - only the store_codes that ALREADY equal a site name exactly
--      (case/space-insensitive). No fabricated mappings; the rest stay Unmapped
--      until an admin maps them in the Expense Report "By site" panel.
--   3. get_expense_by_site(country, from, to)  - per-site tyre/spare/oil/total
--      expense, grouping unmapped store_codes as 'Unmapped: <store_code>'.
--   4. set_store_site_map(country, store_code, site)  - elevated upsert.
--
-- Blast radius: purely additive (a new table + two new RPCs). Does NOT touch
-- get_parts_expense_snapshot. Depends on existing helpers app_current_org(),
-- app_is_active(), app_is_elevated(), is_super_admin(), set_updated_at().
-- Idempotent: IF NOT EXISTS / DROP POLICY IF EXISTS / ON CONFLICT DO NOTHING.
-- Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.store_site_map (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT public.app_current_org(),
  country          text,
  store_code       text NOT NULL,
  site             text NOT NULL,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT store_site_map_org_country_store_uidx UNIQUE (organisation_id, country, store_code)
);

CREATE INDEX IF NOT EXISTS idx_store_site_map_org        ON public.store_site_map (organisation_id);
CREATE INDEX IF NOT EXISTS idx_store_site_map_lookup     ON public.store_site_map (organisation_id, country, store_code);

DROP TRIGGER IF EXISTS set_updated_at_store_site_map ON public.store_site_map;
CREATE TRIGGER set_updated_at_store_site_map BEFORE UPDATE ON public.store_site_map
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
--    RESTRICTIVE org isolation for ALL; PERMISSIVE SELECT for active members;
--    INSERT/UPDATE/DELETE for elevated roles.
-- ---------------------------------------------------------------------------
ALTER TABLE public.store_site_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS store_site_map_org_isolation ON public.store_site_map;
CREATE POLICY store_site_map_org_isolation ON public.store_site_map
  AS RESTRICTIVE FOR ALL
  USING (organisation_id = public.app_current_org() OR public.is_super_admin())
  WITH CHECK (organisation_id = public.app_current_org() OR public.is_super_admin());

DROP POLICY IF EXISTS store_site_map_select ON public.store_site_map;
CREATE POLICY store_site_map_select ON public.store_site_map
  FOR SELECT USING (public.app_is_active());

DROP POLICY IF EXISTS store_site_map_insert ON public.store_site_map;
CREATE POLICY store_site_map_insert ON public.store_site_map
  FOR INSERT WITH CHECK (public.app_is_elevated());

DROP POLICY IF EXISTS store_site_map_update ON public.store_site_map;
CREATE POLICY store_site_map_update ON public.store_site_map
  FOR UPDATE USING (public.app_is_elevated())
  WITH CHECK (public.app_is_elevated());

DROP POLICY IF EXISTS store_site_map_delete ON public.store_site_map;
CREATE POLICY store_site_map_delete ON public.store_site_map
  FOR DELETE USING (public.app_is_elevated());

REVOKE ALL ON public.store_site_map FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.store_site_map TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. SEED exact matches (store_code that already equals a site name, per org+country).
--    No fabricated mappings - only where UPPER(BTRIM(store_code)) = UPPER(BTRIM(name)).
-- ---------------------------------------------------------------------------
INSERT INTO public.store_site_map (organisation_id, country, store_code, site)
SELECT DISTINCT pc.organisation_id, pc.country, pc.store_code, s.name
FROM public.parts_consumption pc
JOIN public.sites s
  ON s.organisation_id = pc.organisation_id
 AND UPPER(BTRIM(s.country)) IS NOT DISTINCT FROM UPPER(BTRIM(pc.country))
 AND UPPER(BTRIM(s.name)) = UPPER(BTRIM(pc.store_code))
WHERE pc.store_code IS NOT NULL AND BTRIM(pc.store_code) <> ''
ON CONFLICT (organisation_id, country, store_code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4. RPC: per-site expense (tyre / spare / oil / total / lines), mapped via
--    store_site_map, unmapped store_codes shown as 'Unmapped: <store_code>'.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.get_expense_by_site(text, date, date);
CREATE OR REPLACE FUNCTION public.get_expense_by_site(
  p_country text DEFAULT NULL,
  p_from    date DEFAULT NULL,
  p_to      date DEFAULT NULL
)
RETURNS TABLE(site text, tyre numeric, spare numeric, oil numeric, total numeric, lines bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH org AS (SELECT public.app_current_org() AS oid)
  SELECT
    COALESCE(m.site, 'Unmapped: ' || pc.store_code) AS site,
    round(COALESCE(sum(pc.tyre_cost), 0))  AS tyre,
    round(COALESCE(sum(pc.spare_cost), 0)) AS spare,
    round(COALESCE(sum(pc.oil_cost), 0))   AS oil,
    round(COALESCE(sum(pc.line_cost), 0))  AS total,
    count(*)::bigint                        AS lines
  FROM public.parts_consumption pc
  LEFT JOIN public.store_site_map m
    ON m.organisation_id = pc.organisation_id
   AND m.country IS NOT DISTINCT FROM pc.country
   AND m.store_code = pc.store_code
  WHERE pc.organisation_id = (SELECT oid FROM org)
    AND (SELECT oid FROM org) IS NOT NULL
    AND public.app_is_active()
    AND (p_country IS NULL OR pc.country = p_country)
    AND (p_from IS NULL OR pc.event_date >= p_from)
    AND (p_to   IS NULL OR pc.event_date <= p_to)
  GROUP BY COALESCE(m.site, 'Unmapped: ' || pc.store_code)
  ORDER BY total DESC;
$$;

REVOKE ALL ON FUNCTION public.get_expense_by_site(text, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_expense_by_site(text, date, date) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. RPC: elevated upsert of one store_code -> site mapping.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.set_store_site_map(text, text, text);
CREATE OR REPLACE FUNCTION public.set_store_site_map(
  p_country    text,
  p_store_code text,
  p_site       text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_org uuid := public.app_current_org();
BEGIN
  IF v_org IS NULL OR NOT public.app_is_elevated() THEN
    RAISE EXCEPTION 'Not authorized to edit the store to site map.';
  END IF;
  IF p_store_code IS NULL OR BTRIM(p_store_code) = '' THEN
    RAISE EXCEPTION 'A store code is required.';
  END IF;
  IF p_site IS NULL OR BTRIM(p_site) = '' THEN
    RAISE EXCEPTION 'A site is required.';
  END IF;

  INSERT INTO public.store_site_map (organisation_id, country, store_code, site, created_by)
  VALUES (v_org, NULLIF(BTRIM(p_country), ''), BTRIM(p_store_code), BTRIM(p_site), auth.uid())
  ON CONFLICT (organisation_id, country, store_code)
  DO UPDATE SET site = EXCLUDED.site, updated_at = now();
END; $$;

REVOKE ALL ON FUNCTION public.set_store_site_map(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_store_site_map(text, text, text) TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP FUNCTION IF EXISTS public.set_store_site_map(text, text, text);
--   DROP FUNCTION IF EXISTS public.get_expense_by_site(text, date, date);
--   DROP TABLE IF EXISTS public.store_site_map;
-- =============================================================================
