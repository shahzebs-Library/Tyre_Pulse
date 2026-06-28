-- MIGRATIONS_V38.sql
-- Add accident columns the web editor / bulk import / export already write.
-- Saving an accident on web was returning a 400 because these were missing.
-- Applied on Supabase as `add_accident_repair_claim_inspector_cols`.

alter table public.accidents add column if not exists repair_cost numeric;
alter table public.accidents add column if not exists insurance_claim_no text;
alter table public.accidents add column if not exists inspector text;
