-- =============================================================================
-- MIGRATIONS_V270_WASH_MODULE.sql
-- Vehicle Washing module - log vehicle washes (quick use) and report on them.
--
-- What this does:
--   1. CREATE public.wash_records - one row per vehicle wash, org-isolated,
--      country + site scoped, elevated-role writes. Covers wash type, bay,
--      water usage, cost, duration, odometer, and lifecycle status.
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
CREATE TABLE IF NOT EXISTS public.wash_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id  uuid NOT NULL DEFAULT public.app_current_org(),
  country          text,
  site             text,
  area             text,
  asset_no         text NOT NULL,
  vehicle_type     text,
  wash_date        date NOT NULL DEFAULT current_date,
  wash_time        text,
  wash_type        text,
  bay              text,
  washed_by        text,
  water_liters     numeric,
  cost             numeric,
  duration_min     numeric,
  status           text NOT NULL DEFAULT 'Completed',
  odometer_km      numeric,
  notes            text,
  created_by       uuid DEFAULT auth.uid(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Idempotent column adds (safe if an earlier partial version of the table exists).
ALTER TABLE public.wash_records
  ADD COLUMN IF NOT EXISTS country      text,
  ADD COLUMN IF NOT EXISTS site         text,
  ADD COLUMN IF NOT EXISTS area         text,
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS wash_time    text,
  ADD COLUMN IF NOT EXISTS wash_type    text,
  ADD COLUMN IF NOT EXISTS bay          text,
  ADD COLUMN IF NOT EXISTS washed_by    text,
  ADD COLUMN IF NOT EXISTS water_liters numeric,
  ADD COLUMN IF NOT EXISTS cost         numeric,
  ADD COLUMN IF NOT EXISTS duration_min numeric,
  ADD COLUMN IF NOT EXISTS odometer_km  numeric,
  ADD COLUMN IF NOT EXISTS notes        text;

-- Controlled vocabularies (idempotent add via DO guards). Both nullable.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wash_records_wash_type_check') THEN
    ALTER TABLE public.wash_records ADD CONSTRAINT wash_records_wash_type_check
      CHECK (wash_type IS NULL OR wash_type IN
        ('Exterior','Interior','Full','Engine Bay','Undercarriage','Steam','Waterless'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'wash_records_status_check') THEN
    ALTER TABLE public.wash_records ADD CONSTRAINT wash_records_status_check
      CHECK (status IN ('Scheduled','In Progress','Completed','Cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_wash_records_org       ON public.wash_records (organisation_id);
CREATE INDEX IF NOT EXISTS idx_wash_records_asset     ON public.wash_records (asset_no);
CREATE INDEX IF NOT EXISTS idx_wash_records_date      ON public.wash_records (wash_date DESC);
CREATE INDEX IF NOT EXISTS idx_wash_records_site      ON public.wash_records (site);

DROP TRIGGER IF EXISTS set_updated_at_wash_records ON public.wash_records;
CREATE TRIGGER set_updated_at_wash_records BEFORE UPDATE ON public.wash_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Row Level Security
--    RESTRICTIVE isolation (org AND country AND site) intersect with a
--    PERMISSIVE SELECT for any active member and elevated-role writes.
-- ---------------------------------------------------------------------------
ALTER TABLE public.wash_records ENABLE ROW LEVEL SECURITY;

-- Org isolation (outer wall): a row is only ever visible/writable within its org.
DROP POLICY IF EXISTS wash_records_org_isolation ON public.wash_records;
CREATE POLICY wash_records_org_isolation ON public.wash_records
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

-- Country isolation (inner wall): null-country rows are visible to all members.
DROP POLICY IF EXISTS wash_records_country_isolation ON public.wash_records;
CREATE POLICY wash_records_country_isolation ON public.wash_records
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_country(country));

-- Site ABAC (V269 pattern): null-site rows visible to all; scoped users see
-- only their assigned sites; admins/super see all.
DROP POLICY IF EXISTS wash_records_site_isolation ON public.wash_records;
CREATE POLICY wash_records_site_isolation ON public.wash_records
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_site(site));

-- Permissive read: any active member (scoped by the RESTRICTIVE policies above).
DROP POLICY IF EXISTS wash_records_select ON public.wash_records;
CREATE POLICY wash_records_select ON public.wash_records
  FOR SELECT USING (public.app_is_active());

-- Writes: elevated roles only (Admin / Manager / Director).
DROP POLICY IF EXISTS wash_records_insert ON public.wash_records;
CREATE POLICY wash_records_insert ON public.wash_records
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS wash_records_update ON public.wash_records;
CREATE POLICY wash_records_update ON public.wash_records
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS wash_records_delete ON public.wash_records;
CREATE POLICY wash_records_delete ON public.wash_records
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

-- Deny anon; grant authenticated (the policies above are the real boundary).
REVOKE ALL ON public.wash_records FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wash_records TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP TABLE IF EXISTS public.wash_records;
-- =============================================================================
