-- ============================================================
-- TYREPULSE — MIGRATIONS V3
-- Run in Supabase SQL Editor AFTER MASTER_ENGINE.sql
-- Built by Shahzeb Rahman © 2026
-- ============================================================
-- What this adds:
--   • extra_fields jsonb  — stores any Excel columns not in the schema.
--     When you upload a spreadsheet with columns like "Driver Name",
--     "Truck Model", "PO Number" etc. that don't exist as dedicated
--     columns, they are automatically captured here as a JSON object.
--     You never lose data from your spreadsheet regardless of column names.
-- ============================================================

alter table public.tyre_records
  add column if not exists extra_fields jsonb default '{}';

comment on column public.tyre_records.extra_fields is
  'Stores any Excel/CSV columns that were not mapped to a canonical schema field at upload time. Example: {"Driver Name":"Ahmed","PO Number":"PO-1234"}';

-- Index for searching inside extra_fields (e.g. to find records with a specific driver)
create index if not exists tyre_records_extra_fields_idx
  on public.tyre_records using gin (extra_fields);
