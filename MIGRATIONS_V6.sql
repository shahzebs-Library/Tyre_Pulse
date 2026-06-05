-- TYREPULSE — MIGRATIONS V6
-- Run in Supabase SQL Editor AFTER MIGRATIONS_V5.sql
create table if not exists public.vehicle_fleet (
  id uuid default uuid_generate_v4() primary key,
  asset_no text not null unique,
  fleet_number text,
  make text,
  model text,
  vehicle_type text,
  year integer,
  department text,
  operator_name text,
  site text,
  country text default 'KSA',
  region text default 'KSA',
  expected_km_per_tyre integer,
  min_days_between_changes integer default 30,
  max_tyres_per_day integer default 2,
  tyre_size text,
  tyre_brand_preferred text,
  monthly_tyre_budget numeric,
  status text default 'Active' check (status in ('Active','Inactive','Retired','Transferred')),
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  created_by uuid references public.profiles(id)
);
create index if not exists idx_vehicle_fleet_asset on public.vehicle_fleet(asset_no);
alter table public.vehicle_fleet enable row level security;
create policy "vf_select" on public.vehicle_fleet for select using (auth.role()='authenticated');
create policy "vf_insert" on public.vehicle_fleet for insert with check (auth.role()='authenticated');
create policy "vf_update" on public.vehicle_fleet for update using (auth.role()='authenticated');
create policy "vf_delete" on public.vehicle_fleet for delete using (public.get_my_role() in ('Admin','Manager'));
