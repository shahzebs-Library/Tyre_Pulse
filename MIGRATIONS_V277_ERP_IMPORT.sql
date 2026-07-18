-- =============================================================================
-- MIGRATIONS_V277_ERP_IMPORT.sql
-- ERP Data Import staging tables. The web "ERP Data Import" feature parses the
-- filled ERP template tabs, SAVES the rows into these REVIEW tables (never
-- straight into the master tables), and shows a review grid so a user can
-- cross-check every detail before promotion.
--
-- What this does:
--   1. CREATE public.erp_asset_import        (Asset Master ERP Extended tab)
--   2. CREATE public.erp_tyre_change_import  (Tyre Change Log tab)
--   3. CREATE public.erp_tyre_expense_import (Tyre Expense - Purchase tab)
--   Each is org-isolated, country + site scoped (where a site column exists),
--   read for any active member, write for Admin / Manager / Director.
--   Every row carries a batch_id (one uuid per upload) so a whole batch can be
--   reviewed together and reverted in one delete.
--
-- Production m3 is NOT staged here: it loads directly into the EXISTING
-- public.production_logs table via the app service (createProduction). No
-- schema change for m3.
--
-- Blast radius: purely additive (three brand new tables). Depends on existing
-- helpers app_current_org(), app_can_see_country(text), app_can_see_site(text),
-- app_is_active(), get_my_role().
-- Idempotent: CREATE TABLE IF NOT EXISTS / ADD COLUMN IF NOT EXISTS /
-- DROP POLICY IF EXISTS / CREATE INDEX IF NOT EXISTS.
-- Reversible: see the footer.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Asset Master (ERP Extended) staging table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_asset_import (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL DEFAULT public.app_current_org(),
  country            text,
  batch_id           uuid NOT NULL,
  source_row         integer,
  asset_no           text,
  plate_no           text,
  asset_type         text,
  site               text,
  make               text,
  model_year         integer,
  current_km         numeric,
  hour_meter         numeric,
  status             text,
  capacity           text,
  shift              text,
  operator           text,
  second_user        text,
  insurance_name     text,
  insurance_type     text,
  insurance_start    date,
  insurance_end      date,
  operating_card_no  text,
  card_issue_date    date,
  card_expiry_date   date,
  licence_issue      date,
  licence_expiry     date,
  purchase_value     numeric,
  net_book_value     numeric,
  monthly_dep        numeric,
  age_of_asset       text,
  opr_start_date     date,
  org_ou             text,
  finance_asset_no   text,
  remarks            text,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_asset_import_org   ON public.erp_asset_import (organisation_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_import_batch ON public.erp_asset_import (batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_asset_import_asset ON public.erp_asset_import (asset_no);

-- ---------------------------------------------------------------------------
-- 2. Tyre Change Log staging table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_tyre_change_import (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL DEFAULT public.app_current_org(),
  country            text,
  batch_id           uuid NOT NULL,
  source_row         integer,
  asset_no           text,
  tire_pos           text,
  serial_no          text,
  tyre_size          text,
  tyre_brand         text,
  fix_date           date,
  fix_km             numeric,
  fix_hour           numeric,
  remove_date        date,
  remove_km          numeric,
  remove_hour        numeric,
  total_km           numeric,
  old_serial_no      text,
  old_tyre_brand     text,
  job_card           text,
  version            text,
  site               text,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_tyre_change_import_org    ON public.erp_tyre_change_import (organisation_id);
CREATE INDEX IF NOT EXISTS idx_erp_tyre_change_import_batch  ON public.erp_tyre_change_import (batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_tyre_change_import_asset  ON public.erp_tyre_change_import (asset_no);
CREATE INDEX IF NOT EXISTS idx_erp_tyre_change_import_serial ON public.erp_tyre_change_import (serial_no);

-- ---------------------------------------------------------------------------
-- 3. Tyre Expense - Purchase staging table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.erp_tyre_expense_import (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id    uuid NOT NULL DEFAULT public.app_current_org(),
  country            text,
  batch_id           uuid NOT NULL,
  source_row         integer,
  serial_no          text,
  asset_no           text,
  job_card           text,
  purchase_date      date,
  supplier           text,
  unit_cost          numeric,
  currency           text,
  quantity           numeric,
  invoice_no         text,
  po_no              text,
  tyre_brand         text,
  tyre_size          text,
  notes              text,
  created_by         uuid DEFAULT auth.uid(),
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_tyre_expense_import_org    ON public.erp_tyre_expense_import (organisation_id);
CREATE INDEX IF NOT EXISTS idx_erp_tyre_expense_import_batch  ON public.erp_tyre_expense_import (batch_id);
CREATE INDEX IF NOT EXISTS idx_erp_tyre_expense_import_serial ON public.erp_tyre_expense_import (serial_no);

-- ---------------------------------------------------------------------------
-- 4. Row Level Security (mirror MIGRATIONS_V270_WASH_MODULE.sql)
--    RESTRICTIVE org AND country (AND site where present) isolation intersect
--    with a PERMISSIVE SELECT for any active member and elevated-role writes.
-- ---------------------------------------------------------------------------

-- ==== erp_asset_import ====
ALTER TABLE public.erp_asset_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_asset_import_org_isolation ON public.erp_asset_import;
CREATE POLICY erp_asset_import_org_isolation ON public.erp_asset_import
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS erp_asset_import_country_isolation ON public.erp_asset_import;
CREATE POLICY erp_asset_import_country_isolation ON public.erp_asset_import
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_country(country));

DROP POLICY IF EXISTS erp_asset_import_site_isolation ON public.erp_asset_import;
CREATE POLICY erp_asset_import_site_isolation ON public.erp_asset_import
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_site(site));

DROP POLICY IF EXISTS erp_asset_import_select ON public.erp_asset_import;
CREATE POLICY erp_asset_import_select ON public.erp_asset_import
  FOR SELECT USING (public.app_is_active());

DROP POLICY IF EXISTS erp_asset_import_insert ON public.erp_asset_import;
CREATE POLICY erp_asset_import_insert ON public.erp_asset_import
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_asset_import_update ON public.erp_asset_import;
CREATE POLICY erp_asset_import_update ON public.erp_asset_import
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_asset_import_delete ON public.erp_asset_import;
CREATE POLICY erp_asset_import_delete ON public.erp_asset_import
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.erp_asset_import FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_asset_import TO authenticated;

-- ==== erp_tyre_change_import ====
ALTER TABLE public.erp_tyre_change_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_tyre_change_import_org_isolation ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_org_isolation ON public.erp_tyre_change_import
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS erp_tyre_change_import_country_isolation ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_country_isolation ON public.erp_tyre_change_import
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_country(country));

DROP POLICY IF EXISTS erp_tyre_change_import_site_isolation ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_site_isolation ON public.erp_tyre_change_import
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_site(site));

DROP POLICY IF EXISTS erp_tyre_change_import_select ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_select ON public.erp_tyre_change_import
  FOR SELECT USING (public.app_is_active());

DROP POLICY IF EXISTS erp_tyre_change_import_insert ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_insert ON public.erp_tyre_change_import
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_tyre_change_import_update ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_update ON public.erp_tyre_change_import
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_tyre_change_import_delete ON public.erp_tyre_change_import;
CREATE POLICY erp_tyre_change_import_delete ON public.erp_tyre_change_import
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.erp_tyre_change_import FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_tyre_change_import TO authenticated;

-- ==== erp_tyre_expense_import (no site column -> org + country scope only) ====
ALTER TABLE public.erp_tyre_expense_import ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS erp_tyre_expense_import_org_isolation ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_org_isolation ON public.erp_tyre_expense_import
  AS RESTRICTIVE FOR ALL
  USING (organisation_id IS NOT DISTINCT FROM public.app_current_org())
  WITH CHECK (organisation_id IS NOT DISTINCT FROM public.app_current_org());

DROP POLICY IF EXISTS erp_tyre_expense_import_country_isolation ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_country_isolation ON public.erp_tyre_expense_import
  AS RESTRICTIVE FOR SELECT
  USING (public.app_can_see_country(country));

DROP POLICY IF EXISTS erp_tyre_expense_import_select ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_select ON public.erp_tyre_expense_import
  FOR SELECT USING (public.app_is_active());

DROP POLICY IF EXISTS erp_tyre_expense_import_insert ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_insert ON public.erp_tyre_expense_import
  FOR INSERT WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_tyre_expense_import_update ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_update ON public.erp_tyre_expense_import
  FOR UPDATE USING (public.get_my_role() IN ('Admin','Manager','Director'))
  WITH CHECK (public.get_my_role() IN ('Admin','Manager','Director'));

DROP POLICY IF EXISTS erp_tyre_expense_import_delete ON public.erp_tyre_expense_import;
CREATE POLICY erp_tyre_expense_import_delete ON public.erp_tyre_expense_import
  FOR DELETE USING (public.get_my_role() IN ('Admin','Manager','Director'));

REVOKE ALL ON public.erp_tyre_expense_import FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.erp_tyre_expense_import TO authenticated;

-- =============================================================================
-- Reversal (manual):
--   DROP TABLE IF EXISTS public.erp_asset_import;
--   DROP TABLE IF EXISTS public.erp_tyre_change_import;
--   DROP TABLE IF EXISTS public.erp_tyre_expense_import;
-- =============================================================================
