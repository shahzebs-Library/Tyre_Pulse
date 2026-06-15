-- MIGRATIONS_V28.sql
-- Performance tuning for the 132k-row tyre_records table.
-- 1) Drop redundant/duplicate indexes (equivalents remain) to speed up bulk
--    Excel uploads and reclaim space on the free-plan storage budget.
-- 2) Raise the PostgREST per-request row cap from the 1000 default so the
--    client pagination helper (fetchAllPages) pulls the full dataset in a
--    handful of requests instead of ~132. RLS still gates every row.

DROP INDEX IF EXISTS public.idx_tyre_records_asset;        -- dup of idx_tyre_records_asset_no
DROP INDEX IF EXISTS public.idx_tyre_brand;                -- dup of idx_tyre_records_brand
DROP INDEX IF EXISTS public.idx_tyre_records_issue_dt;     -- dup of idx_tyre_records_date
DROP INDEX IF EXISTS public.idx_tyre_records_country_date; -- dup of idx_tyre_country_date (DESC)
DROP INDEX IF EXISTS public.idx_tyre_records_risk;         -- partial dup of idx_tyre_records_risk_level
DROP INDEX IF EXISTS public.tyre_records_extra_fields_idx; -- dup gin of idx_tyre_records_extra_fields
DROP INDEX IF EXISTS public.idx_tyre_records_batch;        -- dup of idx_tyre_records_upload_batch

-- Raise PostgREST max-rows for the API role (default 1000).
ALTER ROLE authenticator SET pgrst.db_max_rows = '50000';
NOTIFY pgrst, 'reload config';
