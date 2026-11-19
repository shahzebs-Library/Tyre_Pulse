-- FILE 07: record the manual run in supabase_migrations.schema_migrations so the ledger matches the database.
-- Columns (verified read-only): version text PK, statements text[], name text, created_by text, idempotency_key text unique, rollback text[].
-- Recent rows hold the full SQL; a short marker is used here and the file is identified by its sha256.
insert into supabase_migrations.schema_migrations (version, name, statements, created_by)
select '20261118100000', 'oem_catalog_advanced',
       array['-- applied manually from supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql, sha256 46d2df34de13b7999c334730b4d8a254704223f382e2591e85574310b23b2412, by the owner in the SQL editor on 2026-11-19'],
       'owner (SQL editor)'
where to_regclass('public.oem_figures') is not null
on conflict do nothing;
select version, name, created_by from supabase_migrations.schema_migrations where version = '20261118100000';   -- 1 row
-- AFTER this file succeeds (agent does it on the branch once you say "executed"): move
--   supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql  ->  supabase/migrations/
-- and update the paths in supabase/tests/oem_catalog_access.test.mjs and supabase/tests/oem_execution_package.test.mjs.
