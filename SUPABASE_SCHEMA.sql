-- ============================================================
-- TYREPULSE DATABASE SCHEMA
-- Run this in your Supabase SQL Editor
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ── USERS (extends Supabase Auth) ─────────────────────────
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  full_name text,
  role text default 'Reporter' check (role in ('Admin','Manager','Director','Reporter')),
  region text default 'KSA',
  avatar_url text,
  created_at timestamptz default now()
);

-- ── TYRE RECORDS ──────────────────────────────────────────
create table if not exists public.tyre_records (
  id uuid default uuid_generate_v4() primary key,
  sr text,
  issue_date date,
  description text,
  brand text,
  serial_no text,
  qty integer default 1,
  job_card text,
  mis_number text,
  asset_no text,
  site text,
  remarks text,
  remarks_cleaned text,
  category text,
  risk_level text,
  source_sheet text,
  source_file text,
  region text default 'KSA',
  country text,
  position text,
  km_at_fitment numeric,
  km_at_removal numeric,
  uploaded_by uuid references public.profiles(id),
  cost_per_tyre numeric default 1200,
  cleaned boolean default false,
  created_at timestamptz default now()
);

-- ── STOCK RECORDS ─────────────────────────────────────────
create table if not exists public.stock_records (
  id uuid default uuid_generate_v4() primary key,
  site text not null,
  description text,
  stock_qty integer default 0,
  min_level integer default 5,
  critical_level integer default 3,
  stock_status text,
  reorder_qty integer default 0,
  management_action text,
  region text default 'KSA',
  country text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);

-- ── BUDGETS ───────────────────────────────────────────────
create table if not exists public.budgets (
  id uuid default uuid_generate_v4() primary key,
  site text not null,
  region text default 'KSA',
  monthly_budget numeric not null default 25000,
  year integer default extract(year from now()),
  month integer default extract(month from now()),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  unique(site, region, year, month)
);

-- ── CORRECTIVE ACTIONS ────────────────────────────────────
create table if not exists public.corrective_actions (
  id uuid default uuid_generate_v4() primary key,
  title text not null,
  priority text default 'Medium' check (priority in ('High','Medium','Low')),
  site text,
  region text default 'KSA',
  description text,
  assigned_to text,
  status text default 'Open' check (status in ('Open','In Progress','Closed')),
  photos jsonb default '[]',
  root_cause text,
  asset_no text,
  tyre_serial text,
  country text,
  created_by uuid references public.profiles(id),
  closed_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  closed_at timestamptz
);

-- ── ROOT CAUSE ANALYSIS ───────────────────────────────────
create table if not exists public.rca_records (
  id uuid default uuid_generate_v4() primary key,
  asset_no text,
  tyre_serial text,
  brand text,
  site text,
  region text default 'KSA',
  failure_date date,
  km_at_failure numeric,
  hours_at_failure numeric,
  root_cause text,
  contributing_factors jsonb default '[]',
  photos jsonb default '[]',
  ai_analysis text,
  country text,
  corrective_action_id uuid references public.corrective_actions(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz default now()
);

-- ── UPLOAD HISTORY ────────────────────────────────────────
create table if not exists public.upload_history (
  id uuid default uuid_generate_v4() primary key,
  file_names jsonb default '[]',
  records_added integer default 0,
  records_skipped integer default 0,
  skip_log jsonb default '[]',
  mapping_used jsonb default '{}',
  region text default 'KSA',
  country text,
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz default now()
);

-- ── COLUMN MAPPING MEMORY ─────────────────────────────────
create table if not exists public.column_mappings (
  id uuid default uuid_generate_v4() primary key,
  fingerprint text unique not null,
  mapping jsonb not null,
  file_name text,
  confirmed_by uuid references public.profiles(id),
  use_count integer default 1,
  created_at timestamptz default now(),
  last_used_at timestamptz default now()
);

-- ── AI CLEANING LOG ───────────────────────────────────────
create table if not exists public.cleaning_log (
  id uuid default uuid_generate_v4() primary key,
  original_text text,
  cleaned_text text,
  category text,
  confidence text,
  tyre_record_id uuid references public.tyre_records(id),
  cleaned_by_model text default 'claude-sonnet-4',
  created_at timestamptz default now()
);

-- ── SETTINGS ─────────────────────────────────────────────
create table if not exists public.settings (
  id uuid default uuid_generate_v4() primary key,
  key text unique not null,
  value jsonb,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz default now()
);

-- ── INDEXES for performance ───────────────────────────────
create index if not exists idx_tyre_records_site on public.tyre_records(site);
create index if not exists idx_tyre_records_asset on public.tyre_records(asset_no);
create index if not exists idx_tyre_records_date on public.tyre_records(issue_date);
create index if not exists idx_tyre_records_brand on public.tyre_records(brand);
create index if not exists idx_tyre_records_mis on public.tyre_records(mis_number);
create index if not exists idx_tyre_records_jobcard on public.tyre_records(job_card);
create index if not exists idx_tyre_records_region on public.tyre_records(region);
create index if not exists idx_corrective_status on public.corrective_actions(status);


-- ── INSPECTIONS ───────────────────────────────────────────
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

-- ── KPI TARGETS ───────────────────────────────────────────
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

-- ── STOCK MOVEMENTS ───────────────────────────────────────
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

-- ── ROW LEVEL SECURITY ────────────────────────────────────
alter table public.profiles enable row level security;
alter table public.tyre_records enable row level security;
alter table public.stock_records enable row level security;
alter table public.budgets enable row level security;
alter table public.corrective_actions enable row level security;
alter table public.rca_records enable row level security;
alter table public.upload_history enable row level security;
alter table public.column_mappings enable row level security;
alter table public.cleaning_log enable row level security;
alter table public.settings enable row level security;

-- Allow authenticated users to read/write all data
create policy "Auth users full access" on public.tyre_records for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.stock_records for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.budgets for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.corrective_actions for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.rca_records for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.upload_history for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.column_mappings for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.cleaning_log for all using (auth.role() = 'authenticated');
create policy "Auth users full access" on public.settings for all using (auth.role() = 'authenticated');
create policy "Users can view all profiles" on public.profiles for select using (auth.role() = 'authenticated');
create policy "Users can update own profile" on public.profiles for update using (auth.uid() = id);

-- ── DEFAULT SETTINGS ─────────────────────────────────────
insert into public.settings (key, value) values
  ('cost_per_tyre', '1200'),
  ('default_region', '"KSA"'),
  ('company_name', '"Readymix Concrete Company"'),
  ('currency', '"SAR"')
on conflict (key) do nothing;

-- ── STORAGE BUCKET FOR PHOTOS ─────────────────────────────
-- Run this separately if needed:
-- insert into storage.buckets (id, name, public) values ('tyre-photos', 'tyre-photos', true);
-- create policy "Auth users can upload" on storage.objects for insert with check (auth.role() = 'authenticated');
-- create policy "Public read photos" on storage.objects for select using (bucket_id = 'tyre-photos');
