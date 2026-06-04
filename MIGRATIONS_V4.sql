-- ============================================================
-- TYREPULSE — MIGRATIONS V4
-- Run in Supabase SQL Editor AFTER MIGRATIONS_V3.sql
-- Built by Shahzeb Rahman © 2026
-- ============================================================
-- What this adds:
--   • country column on rca_records so Root Cause Analysis
--     records can be filtered by country (KSA / UAE / Egypt)
--     matching the rest of the application.
-- ============================================================

alter table public.rca_records
  add column if not exists country text default 'KSA'
    check (country in ('KSA','UAE','Egypt'));

-- Backfill existing rows from the linked tyre_records where possible
update public.rca_records r
set country = t.country
from public.tyre_records t
where t.serial_no = r.tyre_serial
  and r.country = 'KSA'   -- only rows still at default
  and t.country is not null;

-- Index for fast country filtering
create index if not exists rca_records_country_idx
  on public.rca_records (country);
