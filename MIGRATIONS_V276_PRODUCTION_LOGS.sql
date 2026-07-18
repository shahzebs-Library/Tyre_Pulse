-- =============================================================================
-- MIGRATIONS_V276_PRODUCTION_LOGS.sql
-- Unit-aware Cost Intelligence - LOCATION-WISE production output (m3).
--
-- What this does:
--   1. CREATE public.production_logs - one row per site (optionally per asset)
--      per period, recording the running output in cubic metres (m3) so a
--      unit-aware cost metric (cost per m3) can be computed for volume assets
--      (concrete pumps, water treatment, etc). Org-isolated, country + site
--      scoped, elevated-role writes. km and engine-hours already have their own
--      logs (odometer_logs, engine_hours_logs); m3 had no home until now.
--
-- Blast radius: purely additive (a brand new table). Depends on existing
-- helpers app_current_org(), app_can_see_country(text), app_can_see_site(text),
-- app_is_active(), set_updated_at(), get_my_role().
-- Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS / CREATE INDEX IF NOT EXISTS.
-- Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.production_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT public.app_current_org(),
  country          text,
  site             text NOT NULL,
  asset_no         text,
  period_date      date NOT NULL,
  m3               numeric NOT NULL,
  source           text,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Idempotent column adds (safe if an earlier partial version of the table exists).
ALTER TABLE public.production_logs
  ADD COLUMN IF NOT EXISTS country     text,
  ADD COLUMN IF NOT EXISTS asset_no    text,
  ADD COLUMN IF NOT EXISTS source      text,
  ADD COLUMN IF NOT EXISTS notes       text,
  ADD COLUMN IF NOT EXISTS created_by  uuid DEFAULT auth.uid();

CREATE INDEX IF NOT EXISTS idx_production_logs_org    ON public.production_logs (organisation_id);
CREATE INDEX IF NOT EXISTS idx_production_logs_site   ON public.production_logs (site);
CREATE INDEX IF NOT EXISTS idx_production_logs_period ON public.production_logs (period_date DESC);

DROP TRIGGER IF EXISTS set_updated_at_production_logs ON public.production_logs;
CREATE TRIGGER set_updated_at_production_logs BEFORE UPDATE ON public.production_logs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
--    RESTRICTIVE isolation (org AND country AND site) intersect with a
--    PERMISSIVE SELECT for any active member and elevated-role writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.production_logs ENABLE ROW LEVEL SECURITY;

-- Org isolation (outer wall): a row is only ever visible/writable within its org.
DROP POLICY IF EXISTS production_logs_org_isolation ON public.production_logs;
CREATE POLICY production_logs_org_isolation ON public.production_logs
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

-- Country isolation (inner wall): null-country rows are visible to all members.
DROP POLICY IF EXISTS production_logs_country_isolation ON public.production_logs;
CREATE POLICY production_logs_country_isolation ON public.production_logs
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_country(country));

-- Site ABAC (V269 pattern): null-site rows visible to all; scoped users see
-- only their assigned sites; admins/super see all.
DROP POLICY IF EXISTS production_logs_site_isolation ON public.production_logs;
CREATE POLICY production_logs_site_isolation ON public.production_logs
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_site(site));

-- Permissive read: any active member (scoped by the RESTRICTIVE policies above).
DROP POLICY IF EXISTS production_logs_select ON public.production_logs;
CREATE POLICY production_logs_select ON public.production_logs
  FOR SELECT USING (public.app_is_active());

-- Writes: elevated roles only (Admin / Manager / Director).
DROP POLICY IF EXISTS production_logs_insert ON public.production_logs;
CREATE POLICY production_logs_insert ON public.production_logs
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS production_logs_update ON public.production_logs;
CREATE POLICY production_logs_update ON public.production_logs
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS production_logs_delete ON public.production_logs;
CREATE POLICY production_logs_delete ON public.production_logs
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

-- Deny anon; grant authenticated (the policies above are the real boundary).
REVOKE ALL ON public.production_logs FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_logs TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP TABLE IF EXISTS public.production_logs;
-- =============================================================================
