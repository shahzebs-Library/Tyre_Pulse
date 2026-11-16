-- =====================================================================================
-- Layout versions and verified per-layout position mappings
--
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local staging copy
--         only. Nothing here ran on production. Do not apply without the owner's approval.
-- ORDER:  1 of 3. Then 20261116090000_tyre_position_service.sql, then
--         20261116091000_observation_erp_decide_on_position_service.sql.
--
-- WHY (owner decisions 2026-11-15):
--   A. LAYOUT HISTORY must exist BEFORE any admin edit can reinterpret history.
--      vehicle_diagram_configs keeps one row per vehicle type and an edit overwrites it, so an
--      old inspection would be read on a layout that did not exist when it was made.
--      vehicle_diagram_config_versions keeps every state with valid_from / valid_to. An edit
--      of vehicle_diagram_configs closes the open version and opens a new one (trigger); the
--      history itself cannot be edited. The position service resolves a record on the version
--      in force on the record's date.
--   B. NO UNIVERSAL "rear centre / rear rear" MAPPING for pumps (or any layout). An ERP spelling
--      the layout cannot place stays pending. Once a mapping is VERIFIED against the real axle
--      diagram and known ERP replacements, it is recorded here PER LAYOUT as data:
--      tyre_layout_position_mappings (layout_key, erp_code -> slot, who verified, evidence).
--      The table ships EMPTY. Nothing is mapped until an Admin records it.
--
-- WHAT IT CREATES: two tables, their policies, three trigger functions, three triggers.
--      It changes no existing row and no existing object. Rows already in
--      vehicle_diagram_configs (0 in production on 2026-11-15) get ONE opening version marked
--      basis 'backfill' from their updated_at: what was in force BEFORE that moment is not
--      known, and the service says so instead of guessing.
--
-- WORDING NOTE: the words "delete" appear in this file only in "before update or delete"
--      triggers that REFUSE the change, in "after insert or update or delete" (to close a
--      version when a layout is removed), and in this header. No statement removes a row.
--
-- VERIFY (rolled back):
--   begin;
--   insert into public.vehicle_diagram_configs (organisation_id, vehicle_type, config, active)
--     values ('<org>', 'ZZ TEST', '{"axles":[{"kind":"steer"},{"kind":"drive","dual":true}]}', true);
--   update public.vehicle_diagram_configs set config = '{"axles":[{"kind":"steer"},{"kind":"steer"},{"kind":"drive","dual":true}]}'
--     where vehicle_type = 'ZZ TEST';
--   select count(*), count(valid_to) from public.vehicle_diagram_config_versions where vehicle_type = 'ZZ TEST'; -- 2, 1
--   rollback;
--
-- ROLLBACK (only while both tables are still empty of anything worth keeping; export first):
--   drop trigger if exists vehicle_diagram_configs_version on public.vehicle_diagram_configs;
--   drop table if exists public.tyre_layout_position_mappings;
--   drop table if exists public.vehicle_diagram_config_versions;
--   drop function if exists public.vehicle_diagram_config_versioning();
--   drop function if exists public.vehicle_diagram_config_versions_guard();
--   drop function if exists public.tyre_layout_position_mappings_guard();
-- =====================================================================================

create table if not exists public.vehicle_diagram_config_versions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  config_id uuid,
  vehicle_type text not null,
  config jsonb not null,
  active boolean not null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  basis text not null default 'recorded' check (basis in ('recorded', 'backfill')),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (valid_to is null or valid_to >= valid_from)
);
create index if not exists vehicle_diagram_config_versions_lookup
  on public.vehicle_diagram_config_versions (organisation_id, vehicle_type, valid_from desc);
create unique index if not exists vehicle_diagram_config_versions_one_open
  on public.vehicle_diagram_config_versions (organisation_id, vehicle_type) where valid_to is null;
alter table public.vehicle_diagram_config_versions enable row level security;

create table if not exists public.tyre_layout_position_mappings (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  layout_key text not null,
  erp_code text not null,
  slot text not null,
  evidence text not null check (length(btrim(evidence)) between 10 and 2000),
  verified_by uuid not null default auth.uid(),
  verified_at timestamptz not null default now(),
  active boolean not null default true,
  unique (organisation_id, layout_key, erp_code)
);
alter table public.tyre_layout_position_mappings enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicle_diagram_config_versions' and policyname = 'vdc_versions_org') then
    create policy vdc_versions_org on public.vehicle_diagram_config_versions as restrictive
      for all to authenticated
      using (organisation_id = (select public.app_current_org()))
      with check (organisation_id = (select public.app_current_org()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'vehicle_diagram_config_versions' and policyname = 'vdc_versions_read') then
    create policy vdc_versions_read on public.vehicle_diagram_config_versions
      for select to authenticated using ((select public.app_is_active()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tyre_layout_position_mappings' and policyname = 'tlpm_org') then
    create policy tlpm_org on public.tyre_layout_position_mappings as restrictive
      for all to authenticated
      using (organisation_id = (select public.app_current_org()))
      with check (organisation_id = (select public.app_current_org()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tyre_layout_position_mappings' and policyname = 'tlpm_read') then
    create policy tlpm_read on public.tyre_layout_position_mappings
      for select to authenticated using ((select public.app_is_active()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tyre_layout_position_mappings' and policyname = 'tlpm_insert') then
    create policy tlpm_insert on public.tyre_layout_position_mappings
      for insert to authenticated with check ((select public.app_is_org_admin()) and verified_by = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'tyre_layout_position_mappings' and policyname = 'tlpm_update') then
    create policy tlpm_update on public.tyre_layout_position_mappings
      for update to authenticated using ((select public.app_is_org_admin())) with check ((select public.app_is_org_admin()));
  end if;
end $$;

-- History is written by the trigger only. Mappings: Admin may add one or switch it off.
revoke all on public.vehicle_diagram_config_versions from public, anon, authenticated;
grant select on public.vehicle_diagram_config_versions to authenticated;
revoke all on public.tyre_layout_position_mappings from public, anon, authenticated;
grant select, insert on public.tyre_layout_position_mappings to authenticated;
grant update (active) on public.tyre_layout_position_mappings to authenticated;

-- An edit of a layout never overwrites history: it closes the open version and opens a new one.
create or replace function public.vehicle_diagram_config_versioning()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_diagram_config_versions
      (organisation_id, config_id, vehicle_type, config, active, valid_from, basis, created_by)
    values (new.organisation_id, new.id, new.vehicle_type, new.config, new.active, v_now, 'recorded', auth.uid());
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.config is not distinct from old.config and new.active is not distinct from old.active
       and new.vehicle_type is not distinct from old.vehicle_type
       and new.organisation_id is not distinct from old.organisation_id then
      return new;
    end if;
    perform set_config('tyre_pulse.layout_versioning', 'on', true);
    update public.vehicle_diagram_config_versions set valid_to = v_now
      where organisation_id = old.organisation_id and vehicle_type = old.vehicle_type and valid_to is null;
    insert into public.vehicle_diagram_config_versions
      (organisation_id, config_id, vehicle_type, config, active, valid_from, basis, created_by)
    values (new.organisation_id, new.id, new.vehicle_type, new.config, new.active, v_now, 'recorded', auth.uid());
    perform set_config('tyre_pulse.layout_versioning', 'off', true);
    return new;
  end if;
  perform set_config('tyre_pulse.layout_versioning', 'on', true);
  update public.vehicle_diagram_config_versions set valid_to = v_now
    where organisation_id = old.organisation_id and vehicle_type = old.vehicle_type and valid_to is null;
  perform set_config('tyre_pulse.layout_versioning', 'off', true);
  return old;
end $$;

-- The history cannot be rewritten. The only change allowed is the versioning trigger closing
-- an open version (valid_to from empty to a time), nothing else.
create or replace function public.vehicle_diagram_config_versions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('tyre_pulse.layout_versioning', true), 'off') = 'on'
     and old.valid_to is null and new.valid_to is not null
     and (to_jsonb(new) - 'valid_to') = (to_jsonb(old) - 'valid_to') then
    return new;
  end if;
  raise exception 'Layout history is append-only' using errcode = 'PT409';
end $$;

-- A verified mapping is never rewritten: it can only be switched off, and a new one recorded.
create or replace function public.tyre_layout_position_mappings_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (to_jsonb(new) - 'active') = (to_jsonb(old) - 'active') then
    return new;
  end if;
  raise exception 'A verified position mapping cannot be rewritten. Switch it off and record a new one' using errcode = 'PT409';
end $$;

revoke all on function public.vehicle_diagram_config_versioning() from public, anon, authenticated;
revoke all on function public.vehicle_diagram_config_versions_guard() from public, anon, authenticated;
revoke all on function public.tyre_layout_position_mappings_guard() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'vehicle_diagram_configs_version' and tgrelid = 'public.vehicle_diagram_configs'::regclass) then
    create trigger vehicle_diagram_configs_version
      after insert or update or delete on public.vehicle_diagram_configs
      for each row execute function public.vehicle_diagram_config_versioning();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'vehicle_diagram_config_versions_guard' and tgrelid = 'public.vehicle_diagram_config_versions'::regclass) then
    create trigger vehicle_diagram_config_versions_guard
      before update or delete on public.vehicle_diagram_config_versions
      for each row execute function public.vehicle_diagram_config_versions_guard();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'tyre_layout_position_mappings_guard' and tgrelid = 'public.tyre_layout_position_mappings'::regclass) then
    create trigger tyre_layout_position_mappings_guard
      before update or delete on public.tyre_layout_position_mappings
      for each row execute function public.tyre_layout_position_mappings_guard();
  end if;
end $$;

-- Opening version for layouts that already exist. What was in force before updated_at is not
-- recorded anywhere, so the version is marked 'backfill' and the service treats an earlier
-- record as "layout changed since record" (pending), never as resolved.
insert into public.vehicle_diagram_config_versions
  (organisation_id, config_id, vehicle_type, config, active, valid_from, basis, created_by)
select c.organisation_id, c.id, c.vehicle_type, c.config, c.active, c.updated_at, 'backfill', c.created_by
from public.vehicle_diagram_configs c
where not exists (select 1 from public.vehicle_diagram_config_versions v
                  where v.organisation_id = c.organisation_id and v.vehicle_type = c.vehicle_type);

select anum_integration.apply_reader_policies();
