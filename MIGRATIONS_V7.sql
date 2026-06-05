-- ============================================================
-- TYREPULSE — MIGRATIONS V7
-- Fixes missing tables and fields discovered in audit
-- Run in Supabase SQL Editor
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- ── Add missing fields to tyre_records ──────────────────────
alter table public.tyre_records
  add column if not exists km_at_fitment numeric,
  add column if not exists km_at_removal numeric,
  add column if not exists country text,
  add column if not exists position text;

-- ── Create missing inspections table ────────────────────────
create table if not exists public.inspections (
  id uuid default uuid_generate_v4() primary key,
  asset_no text,
  inspection_type text default 'Routine'
    check (inspection_type in ('Routine','Pressure Check','Visual','Full Inspection','Pre-Trip')),
  scheduled_date date not null,
  completed_date date,
  status text default 'Scheduled'
    check (status in ('Scheduled','In Progress','Done','Overdue','Cancelled')),
  site text,
  country text,
  region text default 'KSA',
  inspector_name text,
  findings text,
  photos jsonb default '[]',
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_inspections_asset on public.inspections(asset_no);
create index if not exists idx_inspections_status on public.inspections(status);
create index if not exists idx_inspections_date on public.inspections(scheduled_date);
alter table public.inspections enable row level security;
create policy "inspections_authenticated" on public.inspections for all using (auth.role()='authenticated');

-- ── Create missing kpi_targets table ────────────────────────
create table if not exists public.kpi_targets (
  id uuid default uuid_generate_v4() primary key,
  month integer not null check (month between 1 and 12),
  year integer not null,
  region text default 'KSA',
  country text,
  target_cost numeric,
  target_high_risk_count integer,
  target_overdue_actions integer,
  target_cpk numeric,
  target_replacement_count integer,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique (month, year, region)
);
alter table public.kpi_targets enable row level security;
create policy "kpi_targets_authenticated" on public.kpi_targets for all using (auth.role()='authenticated');

-- ── Create missing stock_movements table ────────────────────
create table if not exists public.stock_movements (
  id uuid default uuid_generate_v4() primary key,
  stock_record_id uuid references public.stock_records(id) on delete cascade,
  site text not null,
  region text default 'KSA',
  country text,
  brand text,
  tyre_size text,
  movement_type text not null
    check (movement_type in ('RECEIVED','ISSUED','RETURNED','ADJUSTED','TRANSFERRED')),
  qty_change integer not null,
  qty_after integer,
  reference_no text,
  notes text,
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);
create index if not exists idx_stock_movements_site on public.stock_movements(site);
create index if not exists idx_stock_movements_created on public.stock_movements(created_at desc);
alter table public.stock_movements enable row level security;
create policy "stock_movements_authenticated" on public.stock_movements for all using (auth.role()='authenticated');

-- ── Add country field to tables that only had region ────────
alter table public.corrective_actions add column if not exists country text;
alter table public.rca_records add column if not exists country text;
alter table public.stock_records add column if not exists country text;
alter table public.upload_history add column if not exists country text;
