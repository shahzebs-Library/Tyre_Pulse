-- ============================================================================
-- Retread jobs register (Retread Management page, 2026-10-05)
-- STATUS: APPLIED LIVE 2026-10-05 (as retread_jobs_register).
--
-- Why: the owner's Retread Management mockup shows a casing register (casing
-- serial, last vehicle, grade, cycle, vendor, status, turnaround, cost, outcome),
-- a retread pipeline by stage and vendor performance (success, turnaround, CPK).
-- Nothing in the schema records a casing being SENT to a retreader: retreads are
-- only visible today as tyre_records whose category mentions "retread", with no
-- vendor, no dates and no grade. This table is that missing record.
--
-- Starts EMPTY. Users create rows from the page ("New retread"). No seed rows.
--
-- Security (repo pattern): organisation_id default app_current_org() with a
-- RESTRICTIVE org wall on every command; RESTRICTIVE country + site SELECT walls
-- (null country / site stays visible, the app-wide convention); app_is_active()
-- read; app_is_elevated() write; nothing granted to anon; the trigger function
-- has a pinned search_path.
--
-- Verify (rolled back, as a real approved KSA-only user):
--   insert a KSA row -> 1 row; insert a UAE row -> refused by the country wall;
--   select from anon -> permission denied.
--
-- Rollback:
--   drop table if exists public.retread_jobs;
--   drop function if exists public.retread_jobs_touch();
-- ============================================================================

begin;

-- A first-cut retread_jobs table was created live on 2026-09-29 (migration
-- 20260929203713, no repo file): 0 rows, no view/function/client uses it, and its
-- columns do not fit this register. It is RENAMED aside (not dropped) so nothing is
-- lost; it can be dropped later once confirmed unused.
do $$
begin
  if to_regclass('public.retread_jobs') is not null
     and not exists (select 1 from information_schema.columns
                      where table_schema='public' and table_name='retread_jobs' and column_name='casing_serial') then
    alter table public.retread_jobs rename to retread_jobs_v0929;
    alter index if exists public.retread_jobs_pkey rename to retread_jobs_v0929_pkey;
    alter index if exists public.retread_jobs_org_country_idx rename to retread_jobs_v0929_org_country_idx;
    alter index if exists public.retread_jobs_vendor_idx rename to retread_jobs_v0929_vendor_idx;
    alter index if exists public.retread_jobs_serial_idx rename to retread_jobs_v0929_serial_idx;
    alter index if exists public.retread_jobs_tyre_idx rename to retread_jobs_v0929_tyre_idx;
  end if;
end $$;

create table if not exists public.retread_jobs (
  id               uuid primary key default gen_random_uuid(),
  organisation_id  uuid not null default public.app_current_org(),
  country          text,
  site             text,
  casing_serial    text not null check (char_length(btrim(casing_serial)) between 1 and 80),
  tyre_record_id   uuid references public.tyre_records(id) on delete set null,
  brand            text check (brand is null or char_length(brand) <= 80),
  size             text check (size is null or char_length(size) <= 40),
  last_asset_no    text check (last_asset_no is null or char_length(last_asset_no) <= 60),
  first_life_km    numeric(12,0) check (first_life_km is null or first_life_km >= 0),
  vendor_name      text check (vendor_name is null or char_length(vendor_name) <= 160),
  grade            text check (grade is null or grade in ('A+','A','A-','B+','B','B-','C','Reject')),
  cycle            integer not null default 1 check (cycle between 1 and 6),
  status           text not null default 'eligible'
                   check (status in ('eligible','at_vendor','qa','returned','rejected','cancelled')),
  inspected_at     date,
  sent_at          date,
  returned_at      date,
  cost             numeric(14,2) check (cost is null or cost >= 0),
  currency         text check (currency is null or currency ~ '^[A-Z]{3}$'),
  outcome          text not null default 'pending' check (outcome in ('pending','pass','fail')),
  life_km          numeric(12,0) check (life_km is null or life_km >= 0),
  warranty_months  integer check (warranty_months is null or warranty_months between 0 and 60),
  notes            text check (notes is null or char_length(notes) <= 1000),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint retread_jobs_dates_ordered check (returned_at is null or sent_at is null or returned_at >= sent_at)
);

comment on table public.retread_jobs is
  'One row per casing sent (or proposed) for retreading: vendor, grade, cycle, stage, turnaround, cost and outcome.';
comment on column public.retread_jobs.life_km is
  'Km run on the retread after it came back, filled when it is removed. Retread CPK = cost / life_km.';

create index if not exists retread_jobs_org_country_status_idx
  on public.retread_jobs (organisation_id, country, status);
create index if not exists retread_jobs_serial_idx
  on public.retread_jobs (organisation_id, upper(casing_serial));
create index if not exists retread_jobs_vendor_idx
  on public.retread_jobs (organisation_id, vendor_name);

create or replace function public.retread_jobs_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  new.casing_serial := upper(btrim(new.casing_serial));
  return new;
end $$;

drop trigger if exists trg_retread_jobs_touch on public.retread_jobs;
create trigger trg_retread_jobs_touch
  before insert or update on public.retread_jobs
  for each row execute function public.retread_jobs_touch();

-- site spelling follows the shared normaliser when it exists (V246/V524 pattern)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'normalize_site' and pronamespace = 'public'::regnamespace) then
    execute 'drop trigger if exists trg_zz_normalize_site on public.retread_jobs';
    execute 'create trigger trg_zz_normalize_site before insert or update on public.retread_jobs
             for each row execute function public.normalize_site()';
  end if;
end $$;

alter table public.retread_jobs enable row level security;

create policy retread_jobs_org_isolation on public.retread_jobs
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));

create policy retread_jobs_country_isolation on public.retread_jobs
  as restrictive for all to authenticated
  using (country is null or public.app_can_see_country(country))
  with check (country is null or public.app_can_see_country(country));

create policy retread_jobs_site_isolation on public.retread_jobs
  as restrictive for select to authenticated
  using (site is null or public.app_can_see_site(site));

create policy retread_jobs_read on public.retread_jobs
  for select to authenticated using ((select public.app_is_active()));

create policy retread_jobs_insert on public.retread_jobs
  for insert to authenticated with check ((select public.app_is_elevated()));
create policy retread_jobs_update on public.retread_jobs
  for update to authenticated using ((select public.app_is_elevated())) with check ((select public.app_is_elevated()));
create policy retread_jobs_delete on public.retread_jobs
  for delete to authenticated using ((select public.app_is_elevated()));

revoke all on public.retread_jobs from anon;
revoke all on function public.retread_jobs_touch() from public, anon, authenticated;
grant select, insert, update, delete on public.retread_jobs to authenticated;

commit;
