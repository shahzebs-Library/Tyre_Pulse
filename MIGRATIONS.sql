-- ============================================================
-- TYREPULSE PHASE 2 MIGRATIONS
-- Run in Supabase SQL Editor AFTER the main SUPABASE_SCHEMA.sql
-- Built by Shahzeb Rahman © 2026
-- ============================================================

-- ── 1. ADD due_date TO corrective_actions ─────────────────
alter table public.corrective_actions
  add column if not exists due_date timestamptz;

-- ── 2. INSPECTIONS TABLE ──────────────────────────────────
create table if not exists public.inspections (
  id            uuid default uuid_generate_v4() primary key,
  title         text not null,
  inspection_type text default 'Routine'
    check (inspection_type in ('Routine','Pressure','Visual','Full','Pre-Trip')),
  site          text not null,
  asset_no      text,
  tyre_serial   text,
  region        text default 'KSA',
  scheduled_date date not null,
  completed_date date,
  status        text default 'Scheduled'
    check (status in ('Scheduled','In Progress','Done','Overdue','Cancelled')),
  findings      text,
  inspector     text,
  notes         text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz default now()
);

create index if not exists idx_inspections_site   on public.inspections(site);
create index if not exists idx_inspections_status on public.inspections(status);
create index if not exists idx_inspections_date   on public.inspections(scheduled_date);
create index if not exists idx_inspections_asset  on public.inspections(asset_no);

alter table public.inspections enable row level security;
create policy "Auth users full access" on public.inspections
  for all using (auth.role() = 'authenticated');

-- ── 3. STOCK MOVEMENTS TABLE ──────────────────────────────
create table if not exists public.stock_movements (
  id            uuid default uuid_generate_v4() primary key,
  stock_id      uuid references public.stock_records(id) on delete cascade,
  site          text not null,
  description   text,
  movement_type text default 'Adjustment'
    check (movement_type in ('In','Out','Adjustment','Initial','Reorder','Scrap')),
  qty_before    integer not null default 0,
  qty_change    integer not null,
  qty_after     integer not null,
  reason        text,
  reference_no  text,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz default now()
);

create index if not exists idx_stock_movements_stock_id on public.stock_movements(stock_id);
create index if not exists idx_stock_movements_site     on public.stock_movements(site);
create index if not exists idx_stock_movements_date     on public.stock_movements(created_at);

alter table public.stock_movements enable row level security;
create policy "Auth users full access" on public.stock_movements
  for all using (auth.role() = 'authenticated');

-- ── 4. AUDIT LOG TABLE ────────────────────────────────────
create table if not exists public.audit_log (
  id           uuid default uuid_generate_v4() primary key,
  table_name   text not null,
  record_id    uuid,
  action       text not null check (action in ('INSERT','UPDATE','DELETE')),
  old_data     jsonb,
  new_data     jsonb,
  changed_by   uuid references public.profiles(id),
  changed_at   timestamptz default now()
);

create index if not exists idx_audit_log_table  on public.audit_log(table_name);
create index if not exists idx_audit_log_record on public.audit_log(record_id);
create index if not exists idx_audit_log_user   on public.audit_log(changed_by);
create index if not exists idx_audit_log_date   on public.audit_log(changed_at);

alter table public.audit_log enable row level security;
create policy "Auth users full access" on public.audit_log
  for all using (auth.role() = 'authenticated');

-- ── 5. KPI TARGETS TABLE ──────────────────────────────────
create table if not exists public.kpi_targets (
  id              uuid default uuid_generate_v4() primary key,
  metric          text not null,
  target_value    numeric not null,
  year            integer not null default extract(year from now()),
  month           integer,
  site            text,
  region          text default 'KSA',
  created_by      uuid references public.profiles(id),
  updated_at      timestamptz default now(),
  unique(metric, year, month, site)
);

alter table public.kpi_targets enable row level security;
create policy "Auth users full access" on public.kpi_targets
  for all using (auth.role() = 'authenticated');

-- ── 6. Supabase Storage bucket for tyre-photos ───────────
-- Run these two lines in a separate SQL execution if you haven't:
-- insert into storage.buckets (id, name, public) values ('tyre-photos', 'tyre-photos', true) on conflict do nothing;
-- create policy "Auth upload" on storage.objects for insert with check (auth.role() = 'authenticated' and bucket_id = 'tyre-photos');
-- create policy "Public read" on storage.objects for select using (bucket_id = 'tyre-photos');

-- ── 7. ADD indexes for new analytics queries ───────────────
create index if not exists idx_tyre_records_category   on public.tyre_records(category);
create index if not exists idx_tyre_records_risk_level on public.tyre_records(risk_level);
create index if not exists idx_tyre_records_cleaned    on public.tyre_records(cleaned);
create index if not exists idx_corrective_due          on public.corrective_actions(due_date);
create index if not exists idx_corrective_site         on public.corrective_actions(site);
