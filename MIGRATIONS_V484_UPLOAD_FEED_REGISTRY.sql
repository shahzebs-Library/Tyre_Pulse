-- V484 - Daily coverage watches ANY table you upload, not a hardcoded four.
-- STATUS: APPLIED LIVE (project jhssdmeruxtrlqnwfksc) + verified.
--
-- Coverage used to hardcode job_cards / expenses / tyre_records / production_m3
-- inside the RPC, so a feed the owner uploads (SCO, SANY, line items, washes,
-- meters) simply never appeared and a missed day there was invisible.
-- The watched set is now a REGISTRY: adding a feed is a row, not a code change.
--
-- Injection safety: the RPC builds dynamic SQL from this table, so a row may
-- only name a REAL base table + REAL date column - enforced by a trigger that
-- checks information_schema, and writes are super-admin only.
--
-- ROLLBACK: drop table public.upload_feeds cascade;  (then re-apply the V394
-- body of _upload_coverage_detail_for_org and the V389c body of
-- _upload_coverage_for_org, both of which hardcoded the four sources).

create table if not exists public.upload_feeds (
  id            uuid primary key default gen_random_uuid(),
  src           text not null unique,
  label         text not null,
  table_name    text not null,
  date_column   text not null,
  site_column   text,                       -- null = feed has no site dimension
  active        boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.upload_feeds enable row level security;

drop policy if exists upload_feeds_read on public.upload_feeds;
create policy upload_feeds_read on public.upload_feeds
  for select to authenticated using (public.app_is_active());

drop policy if exists upload_feeds_write on public.upload_feeds;
create policy upload_feeds_write on public.upload_feeds
  for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- A registry row is a piece of SQL identity. Reject anything that is not a real
-- base table + real column, so the dynamic query can never be steered.
create or replace function public.upload_feeds_validate()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' and table_name = new.table_name
  ) then
    raise exception 'No such table: %', new.table_name using errcode='22023';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=new.table_name and column_name=new.date_column
  ) then
    raise exception 'No such column %.%', new.table_name, new.date_column using errcode='22023';
  end if;
  if new.site_column is not null and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name=new.table_name and column_name=new.site_column
  ) then
    raise exception 'No such column %.%', new.table_name, new.site_column using errcode='22023';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_upload_feeds_validate on public.upload_feeds;
create trigger trg_upload_feeds_validate before insert or update on public.upload_feeds
  for each row execute function public.upload_feeds_validate();

-- Seed: the four already watched, plus every other real upload target.
insert into public.upload_feeds (src, label, table_name, date_column, site_column, sort_order) values
  ('job_cards',     'Job cards',          'work_orders',           'opened_at',      'site', 1),
  ('expenses',      'Expenses',           'parts_consumption',     'event_date',     'site', 2),
  ('tyre_records',  'Tyre records',       'tyre_records',          'issue_date',     'site', 3),
  ('production_m3', 'Production (m3)',    'production_logs',       'period_date',    'site', 4),
  ('wo_line_items', 'Job card line items','work_order_line_items', 'created_at',     'site', 5),
  ('sco_costs',     'SCO costs',          'sco_costs',             'period_date',    null,   6),
  ('sany_invoices', 'SANY invoices',      'sany_invoices',         'period_date',    null,   7),
  ('inspections',   'Inspections',        'inspections',           'inspection_date','site', 8),
  ('odometer',      'Meter readings (km)','odometer_logs',         'reading_date',   'site', 9),
  ('engine_hours',  'Meter readings (hours)','engine_hours_logs',  'reading_date',   null,  10),
  ('wash_records',  'Vehicle washing',    'wash_records',          'wash_date',      'site',11),
  ('accidents',     'Accidents',          'accidents',             'incident_date',  'site',12)
on conflict (src) do update
  set label=excluded.label, table_name=excluded.table_name,
      date_column=excluded.date_column, site_column=excluded.site_column,
      sort_order=excluded.sort_order, updated_at=now();

comment on table public.upload_feeds is
  'Feeds watched by Daily Coverage. Add a row to watch a new upload; the RPC reads this registry instead of a hardcoded list.';
