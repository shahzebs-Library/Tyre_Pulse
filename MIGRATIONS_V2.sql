-- ============================================================
-- TYREPULSE — V2 MIGRATIONS
-- Run AFTER SUPABASE_SCHEMA.sql + MIGRATIONS.sql + BACKEND_RLS.sql
-- Adds: multi-country support (KSA / UAE / Egypt) + CPK tracking
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- ── Country column on all core tables ────────────────────────────────────────
alter table public.tyre_records       add column if not exists country text default 'KSA';
alter table public.stock_records      add column if not exists country text default 'KSA';
alter table public.budgets            add column if not exists country text default 'KSA';
alter table public.corrective_actions add column if not exists country text default 'KSA';
alter table public.inspections        add column if not exists country text default 'KSA';
alter table public.kpi_targets        add column if not exists country text default 'KSA';
alter table public.rca_records        add column if not exists country text default 'KSA';

-- Backfill existing records from the region column
update public.tyre_records       set country = region where region is not null and region != '' and country = 'KSA';
update public.stock_records      set country = region where region is not null and region != '' and country = 'KSA';
update public.budgets            set country = region where region is not null and region != '' and country = 'KSA';
update public.corrective_actions set country = region where region is not null and region != '' and country = 'KSA';

-- ── CPK (Cost Per Kilometre) on tyre_records ─────────────────────────────────
alter table public.tyre_records add column if not exists km_at_fitment  numeric;
alter table public.tyre_records add column if not exists km_at_removal  numeric;
-- CPK = cost_per_tyre / (km_at_removal - km_at_fitment)

-- ── Country-specific currency defaults ───────────────────────────────────────
insert into public.settings (key, value) values ('currency_KSA',   '"SAR"') on conflict (key) do nothing;
insert into public.settings (key, value) values ('currency_UAE',   '"AED"') on conflict (key) do nothing;
insert into public.settings (key, value) values ('currency_Egypt', '"EGP"') on conflict (key) do nothing;

-- ── Performance indexes for country-filtered queries ─────────────────────────
create index if not exists idx_tyre_records_country       on public.tyre_records(country);
create index if not exists idx_tyre_records_country_date  on public.tyre_records(country, issue_date);
create index if not exists idx_stock_records_country      on public.stock_records(country);
create index if not exists idx_budgets_country            on public.budgets(country);
create index if not exists idx_corrective_actions_country on public.corrective_actions(country);
create index if not exists idx_tyre_records_cpk           on public.tyre_records(km_at_fitment, km_at_removal) where km_at_fitment is not null;

-- ── RLS policies for country column (extend existing) ────────────────────────
-- No new policies needed — existing row-level policies already apply.
-- Country is just a filterable data column, not a row-visibility boundary.

-- ============================================================
-- VERIFY
-- select country, count(*) from public.tyre_records group by country;
-- select key, value from public.settings where key like 'currency_%';
-- ============================================================
