-- ============================================================================
-- MIGRATIONS_V56_IMPORT_NOTNULL_DEFAULTS.sql
-- Make imports resilient for 5 of the 10 modules whose target tables had
-- NOT-NULL columns with NO default that the Data Intake Center cannot always
-- map from a sparse source file. A live per-module commit probe proved these
-- failed the whole batch:
--   driver.driver_id, accident.site, warranty_claims.claim_no,
--   work_orders.work_type, inspections.title, inspections.scheduled_date, inspections.site
--
-- The commit RPC (import_commit_batch) OMITS unmapped columns, so a column
-- DEFAULT now applies when the file lacks that column → the row commits with a
-- clear placeholder instead of failing. The original source value is preserved
-- in import_rows.custom_data + the live row's custom_data regardless. App forms
-- are unaffected (they always supply real values). Metadata-only, instant,
-- backward-compatible.
--
-- Verified: after this, all 10 modules commit a minimal realistic row (10/10).
--
-- Rollback:
--   ALTER TABLE public.drivers         ALTER COLUMN driver_id      DROP DEFAULT;
--   ALTER TABLE public.accidents       ALTER COLUMN site           DROP DEFAULT;
--   ALTER TABLE public.warranty_claims ALTER COLUMN claim_no       DROP DEFAULT;
--   ALTER TABLE public.work_orders     ALTER COLUMN work_type      DROP DEFAULT;
--   ALTER TABLE public.inspections     ALTER COLUMN title          DROP DEFAULT;
--   ALTER TABLE public.inspections     ALTER COLUMN scheduled_date DROP DEFAULT;
--   ALTER TABLE public.inspections     ALTER COLUMN site           DROP DEFAULT;
-- ============================================================================

ALTER TABLE public.drivers          ALTER COLUMN driver_id      SET DEFAULT ('DRV-' || substr(gen_random_uuid()::text, 1, 8));
ALTER TABLE public.accidents        ALTER COLUMN site           SET DEFAULT 'Unassigned';
ALTER TABLE public.warranty_claims  ALTER COLUMN claim_no       SET DEFAULT ('WC-'  || substr(gen_random_uuid()::text, 1, 8));
ALTER TABLE public.work_orders      ALTER COLUMN work_type      SET DEFAULT 'Other';
ALTER TABLE public.inspections      ALTER COLUMN title          SET DEFAULT 'Imported inspection';
ALTER TABLE public.inspections      ALTER COLUMN scheduled_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.inspections      ALTER COLUMN site           SET DEFAULT 'Unassigned';
