-- Fleet supervisors share ONE pool of drivers: give a driver a vehicle, move
-- or take the vehicle back, keep a full history, issue charges and fines. A
-- signed and approved vehicle handover moves the vehicle to the receiving
-- driver on its own.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's yes.
-- RENUMBERED 2026-11-27 from 20261127140000 (that timestamp is already taken by
-- the applied 20261127140000_workshop_signoff_separation). Apply AFTER
-- 20261127170000_driver_workspace_notification_entity_uuid: without it every
-- fine and charge still fails with 42804.
--
-- OWNER RULE (2026-11-27, replaces the earlier "take a driver onto my team"
-- design): drivers belong to the fleet foremen and fleet supervisors as a
-- SHARED POOL. Every Fleet Supervisor / Fleet Foreman / Fleet Incharge in scope
-- can see and manage ANY driver in that scope. There is no exclusive team that
-- locks the others out; duties change often. Driver type and region are
-- FILTERS, never ownership. A "responsible supervisor" may be recorded as an
-- optional label; it never decides who may act.
--
-- WHAT WAS WRONG (measured live 2026-11-27, impersonating Fleet Supervisor
-- f3a70480 in rolled-back transactions):
--   * driver_team_assignments holds 0 rows; drivers.assigned_asset_no and
--     drivers.site are blank on all 674 drivers; drivers.region is NULL on all.
--   * private.driver_workspace_access() returns 'none' for that supervisor on
--     all 674 drivers: 'supervisor' access needed an open assignment naming
--     them, and only a fleet_master editor may write one. So create_fine,
--     charge_issue, driver_workspace_options('vehicles') and the
--     driver_workspace() roster were all unreachable for the Fleet Supervisor.
--   * driver_fines.site / driver_charges.site are NOT NULL while every driver
--     site is NULL, so a fine or charge fails 23502 even with access (item 7
--     fills a blank driver site from the vehicle they are given).
--
-- WHAT THIS DOES
--   1. private.fs_pool_role(): the caller's role is exactly one of
--      'Fleet Supervisor', 'Fleet Foreman', 'Fleet Incharge' (approved, not
--      locked: get_my_role()). The pool roles, NOT elevated roles.
--      private.fs_role_ok(): fs_pool_role() OR app_is_elevated() (Admin /
--      Manager / Director) OR super admin. Stated explicitly on purpose:
--      elevated roles may use the fleet_supervisor_* screens, but only the
--      three pool roles gain new driver workspace ACCESS from item 2.
--   2. Widens the driver workspace access decision for the pool roles, by an
--      ANCHORED replacement of the LIVE bodies (each anchor must occur exactly
--      once or the migration aborts; nothing is retyped):
--        private.driver_workspace_access(uuid)      +'supervisor' for a pool role
--        private.driver_workspace_read(uuid,int)    the roster's inlined copy of
--                                                   the same decision
--        public.driver_workspace_options(...)       'vehicles' search for a pool role
--      Effect: create_fine / review_fine / charge_issue / fine approve-return-
--      cancel and the roster work for any driver in the pool role's scope.
--      ORDER IS UNCHANGED: the 'driver' branch (the caller's own linked driver)
--      is still checked FIRST, and scope (org / country / site) is still checked
--      BEFORE the new branch, so a pool role still sees nothing outside scope and
--      a pool role that is itself a linked driver still gets 'driver' on its own
--      record. create_fine/review_fine/charge decisions still refuse a caller
--      linked to that driver. The Driver role is not a pool role, so nothing in
--      20261127163000_driver_own_data_scope (RESTRICTIVE SELECT policies keyed
--      on app_role() = 'driver') is touched or weakened.
--   3. drivers.driver_category (nullable, free text up to 60) + the existing
--      drivers.region: filters only. Set through set_driver_profile below.
--   4. One vehicle = one current driver: unique index on
--      driver_team_assignments(vehicle_id) where ends_at is null and vehicle_id
--      is not null (the table already has one open row per driver).
--   5. public.fleet_supervisor_drivers(view, search, offset, category, region):
--      view 'all' | 'with_vehicle' | 'without_vehicle'; current vehicle, the
--      optional responsible supervisor label, open charges / fines and the
--      vehicle's last odometer. Plus fleet_supervisor_driver_filters() for the
--      category / region / site drop-downs.
--   6. public.fleet_supervisor_command(action, payload, request_id):
--        assign_vehicle | unassign_vehicle | set_responsible | set_driver_profile
--      take_driver / release_driver are GONE (no ownership). History is kept by
--      closing the open row and opening a new one; nothing is updated in place
--      or deleted. Idempotent on (actor, request_id), logged to
--      driver_workspace_events, notified to the driver's linked login and to the
--      manager / responsible supervisor on the driver's assignment.
--      assign_vehicle never changes the responsible label. A vehicle held by
--      another driver is NOT moved silently: {ok:false, conflict:{...}} and
--      nothing is written; the app asks and resends with move_from_driver.
--      A vehicle held by an INACTIVE driver can be freed the same way.
--      A malformed id returns 22023 'Invalid request' instead of 22P02.
--   7. drivers.assigned_asset_no follows the open assignment (trigger); a blank
--      drivers.site is filled from that vehicle (never overwritten). Every such
--      change writes a driver_workspace_events row ('vehicle_sync').
--   8. An approved handover naming from_driver_id and to_driver_id moves the
--      vehicle: ONLY the open row of from_driver_id holding that vehicle is
--      closed. If someone else holds it, a WARNING is raised and nothing moves.
--      The receiver keeps their own responsible label; no supervisor is added
--      silently. A failure never blocks the approval.
--   9. 'Fleet Foreman' registered in custom_roles so the role can be assigned
--      (normalize_profiles_role() silently rewrites an unknown role to Reporter).
--      A custom role is deny-by-default in the module matrix: it grants nothing.
--  10. REVIEW FIXES 2026-11-27 (still AUTHORED, NOT APPLIED):
--      a. No top-level DROP: both triggers use CREATE OR REPLACE TRIGGER (PG 17.6).
--      b. No one approves their own work: the supervisor-stage approve / return of
--         a fine (driver_fine_enterprise_command) refuses the fine's created_by,
--         and charge_supervisor_review (driver_charge_command) refuses the charge's
--         issued_by. Admin / super admin exempt, as in guard_parts_request_decision.
--         Anchored, exact-once, bodies saved to _bak first (item 2b).
--      c. assign / move / unassign need private.fs_vehicle_writer_ok(): a pool
--         role, a super admin, or Admin / Manager / Director WITH fleet_master
--         edit. Reading the pool is unchanged (fs_role_ok).
--      d. The former holder's notice is generic ("Vehicle X was reassigned"), no
--         colleague name.
--      e. A concurrent assign that hits the one-vehicle-one-driver index
--         (unique_violation) answers {ok:false, conflict:{...}} like any other
--         conflict, with nothing written. The legacy assign_team path lives in
--         driver_workspace_command, which this file does not patch: not changed.
--      f. Handover trigger fails closed (WARNING, no move) when the handover has
--         no country, and requires the receiving driver's country = the vehicle's.
--      g. % and _ in the pool search are escaped (literal match).
--
-- VERIFY: see the bottom of this file.
--
-- ROLLBACK:
--   drop trigger if exists trg_zz_handover_moves_vehicle on public.handover_reports;
--   drop trigger if exists trg_fs_sync_assigned_asset on public.driver_team_assignments;
--   drop function if exists private.fs_handover_moves_vehicle();
--   drop function if exists private.fs_sync_assigned_asset();
--   drop function if exists public.fleet_supervisor_command(text, jsonb, uuid);
--   drop function if exists public.fleet_supervisor_assignment_history(uuid);
--   drop function if exists public.fleet_supervisor_driver_filters();
--   drop function if exists public.fleet_supervisor_drivers(text, text, integer, text, text);
--   drop function if exists private.fs_notify_driver_people(uuid, uuid, text, text);
--   drop function if exists private.fs_reassign(uuid, uuid, uuid, uuid, text, uuid);
--   drop function if exists private.fs_driver_ok(uuid);
--   drop function if exists private.fs_uuid(text);
--   drop index if exists public.driver_team_vehicle_current;
--   -- restore driver_workspace_access / driver_workspace_read /
--   -- driver_workspace_options / driver_fine_enterprise_command /
--   -- driver_charge_command by executing each def in _bak.fs_pool_access_v171000
--   -- (saved below), then drop private.fs_vehicle_writer_ok(),
--   -- private.fs_role_ok() and private.fs_pool_role().
--   alter table public.drivers drop constraint if exists drivers_driver_category_len;
--   -- drivers.driver_category itself stays (nullable; may hold real values).
--   -- Fleet Foreman role: remove ONLY if no profile holds it, else those users
--   -- are rewritten to Reporter on their next profile write:
--   --   select count(*) from public.profiles where role = 'Fleet Foreman';  -- must be 0
--   --   then delete the custom_roles row named 'Fleet Foreman' (owner approval;
--   --   it is a delete, so run it by hand in the SQL editor).
--   -- Assignment rows written while it was live stay (they are real history).

begin;

-- 0. Keep the five bodies this file rewrites, for the rollback.
create schema if not exists _bak;
create table if not exists _bak.fs_pool_access_v171000 (
  fn text primary key, def text not null, saved_at timestamptz not null default now());
insert into _bak.fs_pool_access_v171000(fn, def)
select p.oid::regprocedure::text, pg_get_functiondef(p.oid)
  from pg_proc p
 where p.oid in ('private.driver_workspace_access(uuid)'::regprocedure,
                 'private.driver_workspace_read(uuid,integer)'::regprocedure,
                 'public.driver_workspace_options(text,text,integer)'::regprocedure,
                 'private.driver_fine_enterprise_command(text,jsonb,uuid)'::regprocedure,
                 'private.driver_charge_command(text,jsonb,uuid)'::regprocedure)
on conflict (fn) do nothing;

-- 1. Roles.
create or replace function private.fs_pool_role()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.uid() is not null and public.app_is_active()
    and public.get_my_role() = any (array['Fleet Supervisor', 'Fleet Foreman', 'Fleet Incharge']), false);
$$;

create or replace function private.fs_role_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  -- Pool roles, plus elevated roles (Admin / Manager / Director) and super admin.
  select coalesce(auth.uid() is not null and public.app_is_active() and (
    private.fs_pool_role() or public.is_super_admin() or public.app_is_elevated()
  ), false);
$$;

-- Who may give, move or take back a vehicle: a pool role, a super admin, or an
-- elevated role (Admin / Manager / Director) that ALSO holds fleet_master edit.
-- Reading the pool (fs_role_ok) does not need fleet_master edit.
create or replace function private.fs_vehicle_writer_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.uid() is not null and public.app_is_active() and (
    private.fs_pool_role() or public.is_super_admin()
    or (public.app_is_elevated() and coalesce(public.app_user_can('fleet_master', 'edit'), false))
  ), false);
$$;

-- 2. Widen the driver workspace access decision (anchored, counted).
do $$
declare
  def text;
  n integer;
  a1 constant text := '  IF EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=d.id AND a.organisation_id=d.organisation_id';
  r1 constant text := '  IF private.fs_pool_role() THEN RETURN ''supervisor''; END IF;' || chr(10) || a1;
  a2 constant text := '  v_mgr boolean; v_fin boolean; v_view boolean;';
  r2 constant text := '  v_mgr boolean; v_fin boolean; v_view boolean; v_pool boolean;';
  a3 constant text := '    v_view := public.app_user_can(''driver_workspace'',''view'');';
  r3 constant text := a3 || chr(10) || '    v_pool := private.fs_pool_role();';
  a4 constant text := '        WHEN EXISTS(SELECT 1 FROM public.driver_team_assignments a WHERE a.driver_id=drv.id';
  r4 constant text := '        WHEN coalesce(v_pool,false) THEN ''supervisor''' || chr(10) || a4;
  a5 constant text := 'IF NOT can_manage AND p_kind=''vehicles'' AND NOT EXISTS(';
  r5 constant text := 'IF NOT can_manage AND p_kind=''vehicles'' AND NOT private.fs_pool_role() AND NOT EXISTS(';
  a6 constant text := 'IF NOT can_manage AND p_kind NOT IN (''vehicles'') THEN';
begin
  def := pg_get_functiondef('private.driver_workspace_access(uuid)'::regprocedure);
  if position('fs_pool_role' in def) > 0 then raise exception 'driver_workspace_access already patched'; end if;
  n := (length(def) - length(replace(def, a1, ''))) / length(a1);
  if n <> 1 then raise exception 'driver_workspace_access: anchor found % times, expected 1', n; end if;
  execute replace(def, a1, r1);

  def := pg_get_functiondef('private.driver_workspace_read(uuid,integer)'::regprocedure);
  foreach n in array array[
    (length(def) - length(replace(def, a2, ''))) / length(a2),
    (length(def) - length(replace(def, a3, ''))) / length(a3),
    (length(def) - length(replace(def, a4, ''))) / length(a4)] loop
    if n <> 1 then raise exception 'driver_workspace_read: an anchor was found % times, expected 1', n; end if;
  end loop;
  execute replace(replace(replace(def, a2, r2), a3, r3), a4, r4);

  def := pg_get_functiondef('public.driver_workspace_options(text,text,integer)'::regprocedure);
  n := (length(def) - length(replace(def, a5, ''))) / length(a5);
  if n <> 1 then raise exception 'driver_workspace_options: anchor found % times, expected 1', n; end if;
  if position(a6 in def) = 0 then raise exception 'driver_workspace_options: vehicles-only guard missing; review'; end if;
  execute replace(def, a5, r5);
end $$;

-- 2b. No one approves their own work (owner rule). The new pool 'supervisor'
-- access lets the person who issued a fine or charge reach its supervisor stage,
-- so the supervisor-stage approve / return refuses its creator. Exempt: Admin and
-- super admin, the same exemption as guard_parts_request_decision
-- (20261127140000). Anchored replacement of the LIVE bodies (as already patched
-- by 20261127170000); each anchor must occur exactly once.
do $$
declare
  def text;
  n integer;
  af constant text := '    choice:=p_payload->>''decision'';';
  rf constant text := af || chr(10)
    || '    IF choice IN (''approve'',''return'') AND f.review_stage=''supervisor'' AND f.created_by=actor'
    || ' AND NOT (coalesce(public.is_super_admin(),false) OR public.get_my_role()=''Admin'') THEN'
    || ' RAISE EXCEPTION ''You issued this fine, so another supervisor has to approve or return it'' USING ERRCODE=''42501''; END IF;';
  ac constant text := '    IF NOT is_staff THEN RAISE EXCEPTION ''Supervisor review not permitted'' USING ERRCODE=''42501''; END IF;';
  rc constant text := ac || chr(10)
    || '    IF c.issued_by = actor AND NOT (coalesce(public.is_super_admin(),false) OR public.get_my_role() = ''Admin'') THEN'
    || ' RAISE EXCEPTION ''You issued this charge, so another supervisor has to review it'' USING ERRCODE=''42501''; END IF;';
begin
  def := pg_get_functiondef('private.driver_fine_enterprise_command(text,jsonb,uuid)'::regprocedure);
  if position('You issued this fine' in def) > 0 then raise exception 'driver_fine_enterprise_command already patched'; end if;
  n := (length(def) - length(replace(def, af, ''))) / length(af);
  if n <> 1 then raise exception 'driver_fine_enterprise_command: anchor found % times, expected 1', n; end if;
  execute replace(def, af, rf);

  def := pg_get_functiondef('private.driver_charge_command(text,jsonb,uuid)'::regprocedure);
  if position('You issued this charge' in def) > 0 then raise exception 'driver_charge_command already patched'; end if;
  n := (length(def) - length(replace(def, ac, ''))) / length(ac);
  if n <> 1 then raise exception 'driver_charge_command: anchor found % times, expected 1', n; end if;
  execute replace(def, ac, rc);
end $$;

-- 3. Driver type filter.
alter table public.drivers add column if not exists driver_category text;
do $$ begin
  alter table public.drivers add constraint drivers_driver_category_len
    check (driver_category is null or length(btrim(driver_category)) between 1 and 60);
exception when duplicate_object then null; end $$;

-- 4. One vehicle = one current driver.
create unique index if not exists driver_team_vehicle_current
  on public.driver_team_assignments (vehicle_id)
  where ends_at is null and vehicle_id is not null;

-- 9. Register the Fleet Foreman role (grants nothing by itself).
insert into public.custom_roles (organisation_id, name, description, active)
select r.organisation_id, 'Fleet Foreman', 'Fleet foreman: shares the driver pool with fleet supervisors', true
  from public.custom_roles r
 where r.name = 'Fleet Supervisor'
   and not exists (select 1 from public.custom_roles x where x.name = 'Fleet Foreman')
 limit 1;

-- Helpers.
create or replace function private.fs_uuid(p text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return btrim(p)::uuid;
exception when invalid_text_representation then
  raise exception 'Invalid request' using errcode = '22023';
end $$;

-- TRUE when a pool role (or elevated) may act on this driver: same org, in
-- scope, and not the caller's own linked driver record.
create or replace function private.fs_driver_ok(p_driver uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select d.organisation_id = public.app_current_org()
       and private.fs_role_ok()
       and private.driver_workspace_scope(d.organisation_id, d.country, d.site)
       and not exists (select 1 from public.driver_account_links l
                        where l.driver_id = d.id and l.user_id = auth.uid())
      from public.drivers d where d.id = p_driver), false);
$$;

-- Closes the driver's open assignment (if any) and opens the replacement.
-- The ONLY writer of a new row in this file, so history is always kept.
create or replace function private.fs_reassign(
  p_driver uuid, p_supervisor uuid, p_manager uuid, p_vehicle uuid,
  p_reason text, p_actor uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_id uuid;
  org uuid;
begin
  select organisation_id into org from public.drivers where id = p_driver;
  update public.driver_team_assignments
     set ends_at = greatest(now(), starts_at)
   where driver_id = p_driver and ends_at is null;
  if p_supervisor is null and p_manager is null and p_vehicle is null then
    return null;
  end if;
  insert into public.driver_team_assignments
    (driver_id, organisation_id, supervisor_id, manager_id, vehicle_id, reason, assigned_by)
  values (p_driver, org, p_supervisor, p_manager, p_vehicle,
          left(btrim(p_reason), 2000), p_actor)
  returning id into new_id;
  return new_id;
end $$;

-- Inbox notice to the driver's linked login and to the manager / responsible
-- supervisor on the driver's current (or just closed) assignment.
create or replace function private.fs_notify_driver_people(
  p_driver uuid, p_actor uuid, p_title text, p_body text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
  select distinct u, 'driver_workspace', p_title, p_body, 'driver_workspace', p_driver
    from (
      select l.user_id u from public.driver_account_links l where l.driver_id = p_driver
      union all
      select x.u from (
        select a.manager_id, a.supervisor_id from public.driver_team_assignments a
         where a.driver_id = p_driver
         order by (a.ends_at is null) desc, a.starts_at desc limit 1) a
      cross join lateral (values (a.manager_id), (a.supervisor_id)) x(u)
    ) r
   where u is not null and u is distinct from p_actor;
$$;

-- 5. The pool list.
create or replace function public.fleet_supervisor_drivers(
  p_view text default 'all', p_search text default '', p_offset integer default 0,
  p_category text default null, p_region text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = 'force_custom_plan'
as $$
declare
  org uuid := public.app_current_org();
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null or org is null or not private.fs_role_ok() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if coalesce(p_view, '') not in ('all', 'with_vehicle', 'without_vehicle') or p_offset is null
     or p_offset < 0 or p_offset > 1000000 or length(coalesce(p_search, '')) > 160
     or length(coalesce(p_category, '')) > 60 or length(coalesce(p_region, '')) > 60 then
    raise exception 'Invalid request' using errcode = '22023';
  end if;

  select coalesce(jsonb_agg(r order by r->>'driver_name', r->>'id'), '[]'::jsonb) into result
  from (
    select jsonb_build_object(
      'id', d.id,
      'driver_id', d.driver_id,
      'driver_name', d.driver_name,
      'phone', d.phone,
      'site', d.site,
      'region', d.region,
      'driver_category', d.driver_category,
      'country', d.country,
      'status', d.status,
      'login_linked', exists (select 1 from public.driver_account_links l where l.driver_id = d.id),
      'assignment_id', a.id,
      'assigned_since', a.starts_at,
      'responsible_id', a.supervisor_id,
      'responsible_name', coalesce(ps.full_name, ps.username),
      'vehicle_id', v.id,
      'asset_no', v.asset_no,
      'registration_no', v.registration_no,
      'vehicle_type', v.vehicle_type,
      'open_charges', (select count(*) from public.driver_charges c
                        where c.driver_id = d.id
                          and c.status not in ('deducted', 'waived', 'cancelled_wrongly_issued')),
      'open_fines', (select count(*) from public.driver_fines f
                      where f.driver_id = d.id and f.status = 'open'),
      'last_km', o.odometer_km,
      'last_km_date', o.reading_date
    ) r
    from public.drivers d
    left join lateral (
      select x.* from public.driver_team_assignments x
       where x.driver_id = d.id and x.ends_at is null
       order by x.starts_at desc limit 1) a on true
    left join public.profiles ps on ps.id = a.supervisor_id
    left join public.vehicle_fleet v on v.id = a.vehicle_id
    left join lateral (
      select ol.odometer_km, ol.reading_date from public.odometer_logs ol
       where v.id is not null and ol.organisation_id = v.organisation_id
         and ol.asset_no = v.asset_no
         and (ol.country is null or ol.country = v.country)
       order by ol.reading_date desc nulls last, ol.created_at desc
       limit 1) o on true
    where d.organisation_id = org
      and private.driver_workspace_scope(d.organisation_id, d.country, d.site)
      and not exists (select 1 from public.driver_account_links l
                       where l.driver_id = d.id and l.user_id = uid)
      and (p_view = 'all'
           or (p_view = 'with_vehicle' and v.id is not null)
           or (p_view = 'without_vehicle' and v.id is null))
      and (nullif(btrim(coalesce(p_category, '')), '') is null
           or lower(btrim(d.driver_category)) = lower(btrim(p_category)))
      and (nullif(btrim(coalesce(p_region, '')), '') is null
           or lower(btrim(d.region)) = lower(btrim(p_region)))
      and (coalesce(p_search, '') = ''
           or concat_ws(' ', d.driver_name, d.driver_id, d.site, d.region, d.driver_category,
                        v.asset_no, v.registration_no)
              ilike '%' || replace(replace(replace(p_search, '\', '\\'), '%', '\%'), '_', '\_') || '%')
    order by d.driver_name, d.id
    limit 101 offset p_offset
  ) q;

  return jsonb_build_object('view', p_view, 'rows', result);
end $$;

create or replace function public.fleet_supervisor_driver_filters()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  org uuid := public.app_current_org();
begin
  if auth.uid() is null or org is null or not private.fs_role_ok() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'categories', coalesce(jsonb_agg(distinct btrim(d.driver_category)) filter (where nullif(btrim(d.driver_category), '') is not null), '[]'),
      'regions', coalesce(jsonb_agg(distinct btrim(d.region)) filter (where nullif(btrim(d.region), '') is not null), '[]'),
      'sites', coalesce(jsonb_agg(distinct btrim(d.site)) filter (where nullif(btrim(d.site), '') is not null), '[]'))
      from public.drivers d
     where d.organisation_id = org
       and private.driver_workspace_scope(d.organisation_id, d.country, d.site));
end $$;

create or replace function public.fleet_supervisor_assignment_history(p_driver_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.fs_driver_ok(p_driver_id)
     and private.driver_workspace_access(p_driver_id) not in ('manager', 'supervisor') then
    raise exception 'Driver unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'starts_at', a.starts_at,
        'ends_at', a.ends_at,
        'reason', a.reason,
        'vehicle_id', a.vehicle_id,
        'asset_no', v.asset_no,
        'registration_no', v.registration_no,
        'supervisor_name', coalesce(ps.full_name, ps.username),
        'manager_name', coalesce(pm.full_name, pm.username),
        'assigned_by_name', coalesce(pb.full_name, pb.username)
      ) order by a.starts_at desc, a.id)
      from (select * from public.driver_team_assignments
             where driver_id = p_driver_id order by starts_at desc limit 200) a
      left join public.vehicle_fleet v on v.id = a.vehicle_id
      left join public.profiles ps on ps.id = a.supervisor_id
      left join public.profiles pm on pm.id = a.manager_id
      left join public.profiles pb on pb.id = a.assigned_by), '[]'::jsonb));
end $$;

-- 6. Commands.
create or replace function public.fleet_supervisor_command(
  p_action text, p_payload jsonb, p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  org uuid := public.app_current_org();
  d public.drivers%rowtype;
  v public.vehicle_fleet%rowtype;
  cur public.driver_team_assignments%rowtype;
  holder public.driver_team_assignments%rowtype;
  previous private.driver_workspace_requests%rowtype;
  holder_name text;
  v_reason text := btrim(coalesce(p_payload->>'reason', ''));
  v_driver uuid;
  v_vehicle uuid;
  v_move uuid;
  v_resp uuid;
  v_cat text;
  v_reg text;
  new_id uuid;
  answer jsonb;
begin
  if actor is null or org is null or not private.fs_role_ok() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 20000
     or coalesce(p_action, '') not in ('assign_vehicle', 'unassign_vehicle',
                                       'set_responsible', 'set_driver_profile') then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
  v_driver := private.fs_uuid(p_payload->>'driver_id');
  v_vehicle := private.fs_uuid(p_payload->>'vehicle_id');
  v_move := private.fs_uuid(p_payload->>'move_from_driver');
  v_resp := private.fs_uuid(p_payload->>'responsible_id');

  perform pg_advisory_xact_lock(hashtextextended(actor::text || p_request_id::text, 0));
  select * into previous from private.driver_workspace_requests
   where actor_id = actor and request_id = p_request_id;
  if found then
    if previous.action <> p_action or previous.payload <> p_payload then
      raise exception 'Request already used' using errcode = '22023';
    end if;
    return previous.result;
  end if;

  if length(v_reason) not between 3 and 2000 then
    raise exception 'Write a reason (at least 3 characters)' using errcode = '22023';
  end if;

  select * into d from public.drivers where id = v_driver and organisation_id = org for update;
  if not found or not private.fs_driver_ok(d.id) then
    raise exception 'Driver unavailable' using errcode = '42501';
  end if;
  if p_action in ('assign_vehicle', 'unassign_vehicle') and not private.fs_vehicle_writer_ok() then
    raise exception 'You need fleet master edit access to assign or move vehicles' using errcode = '42501';
  end if;

  select * into cur from public.driver_team_assignments
   where driver_id = d.id and ends_at is null
   order by starts_at desc limit 1
   for update;

  case p_action
  when 'assign_vehicle' then
    if lower(coalesce(d.status, 'active')) <> 'active' then
      raise exception 'This driver is not active' using errcode = '22023';
    end if;
    select * into v from public.vehicle_fleet where id = v_vehicle;
    if not found or v.organisation_id is distinct from org
       or not private.driver_workspace_scope(v.organisation_id, v.country, v.site)
       or v.country is distinct from d.country then
      raise exception 'Vehicle outside your scope or in another country' using errcode = '42501';
    end if;
    if cur.vehicle_id = v.id then
      raise exception 'This vehicle is already assigned to this driver' using errcode = '22023';
    end if;
    select * into holder from public.driver_team_assignments
     where vehicle_id = v.id and ends_at is null and driver_id <> d.id
     order by starts_at desc limit 1
     for update;
    begin
    if found then
      select driver_name into holder_name from public.drivers where id = holder.driver_id;
      if v_move is distinct from holder.driver_id then
        -- Nothing written and the request id is NOT stored: the caller asks,
        -- then resends with move_from_driver to confirm the move.
        return jsonb_build_object('ok', false, 'driver_id', d.id, 'action', p_action,
          'conflict', jsonb_build_object('driver_id', holder.driver_id, 'driver_name', holder_name,
                                         'asset_no', v.asset_no));
      end if;
      -- Any holder in the caller's scope may lose the vehicle, active or not.
      if not private.fs_driver_ok(holder.driver_id) then
        raise exception 'This vehicle is held by a driver outside your scope' using errcode = '42501';
      end if;
      perform private.fs_reassign(holder.driver_id, holder.supervisor_id, holder.manager_id, null,
        'Vehicle ' || coalesce(v.asset_no, '') || ' moved to ' || coalesce(d.driver_name, 'another driver') || ': ' || v_reason,
        actor);
      insert into public.driver_workspace_events(organisation_id, driver_id, actor_id, action, details)
      values (org, holder.driver_id, actor, 'supervisor_vehicle_moved_away',
              jsonb_build_object('vehicle_id', v.id, 'to_driver_id', d.id, 'reason', v_reason));
      -- Generic on purpose: the former holder is not told who received it.
      perform private.fs_notify_driver_people(holder.driver_id, actor,
        'Vehicle reassigned',
        'Vehicle ' || coalesce(v.asset_no, '') || ' was reassigned.');
    end if;
    -- No implicit ownership: the responsible label stays what it was.
    new_id := private.fs_reassign(d.id, cur.supervisor_id, cur.manager_id, v.id, v_reason, actor);
    exception when unique_violation then
      -- Another session gave this vehicle out between our check and our write.
      -- Everything in this block is undone; answer like any other conflict and
      -- do NOT store the request id, so the caller can ask and resend.
      select * into holder from public.driver_team_assignments
       where vehicle_id = v.id and ends_at is null and driver_id <> d.id
       order by starts_at desc limit 1;
      select driver_name into holder_name from public.drivers where id = holder.driver_id;
      return jsonb_build_object('ok', false, 'driver_id', d.id, 'action', p_action,
        'conflict', jsonb_build_object('driver_id', holder.driver_id, 'driver_name', holder_name,
                                       'asset_no', v.asset_no));
    end;

  when 'unassign_vehicle' then
    if cur.vehicle_id is null then
      raise exception 'This driver has no vehicle' using errcode = '22023';
    end if;
    new_id := private.fs_reassign(d.id, cur.supervisor_id, cur.manager_id, null, v_reason, actor);

  when 'set_responsible' then
    -- An optional label. Null clears it. Never a gate.
    if v_resp is not null and not exists (
         select 1 from public.profiles p
          where p.id = v_resp and p.org_id = org and coalesce(p.approved, true)
            and not coalesce(p.locked, false)
            and p.role = any (array['Fleet Supervisor', 'Fleet Foreman', 'Fleet Incharge'])) then
      raise exception 'Pick an active fleet supervisor, foreman or incharge' using errcode = '22023';
    end if;
    if cur.supervisor_id is not distinct from v_resp then
      raise exception 'Nothing to change' using errcode = '22023';
    end if;
    new_id := private.fs_reassign(d.id, v_resp, cur.manager_id, cur.vehicle_id, v_reason, actor);

  when 'set_driver_profile' then
    v_cat := nullif(btrim(coalesce(p_payload->>'driver_category', '')), '');
    v_reg := nullif(btrim(coalesce(p_payload->>'region', '')), '');
    if length(coalesce(v_cat, '')) > 60 or length(coalesce(v_reg, '')) > 60 then
      raise exception 'Invalid request' using errcode = '22023';
    end if;
    update public.drivers set driver_category = v_cat, region = v_reg where id = d.id;
    new_id := d.id;
  end case;

  insert into public.driver_workspace_events(organisation_id, driver_id, actor_id, action, details)
  values (org, d.id, actor, 'supervisor_' || p_action, p_payload);

  if p_action in ('assign_vehicle', 'unassign_vehicle') then
    perform private.fs_notify_driver_people(d.id, actor, 'Vehicle assignment changed',
      'Open the driver workspace to see the change.');
  end if;

  answer := jsonb_build_object('ok', true, 'driver_id', d.id,
                               'id', coalesce(new_id, d.id), 'action', p_action);
  insert into private.driver_workspace_requests values (actor, p_request_id, p_action, p_payload, answer);
  return answer;
end $$;

-- 7. drivers.assigned_asset_no follows the open assignment, audited.
create or replace function private.fs_sync_assigned_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset text;
  vsite text;
  old_asset text;
  old_site text;
  org uuid;
  actor uuid := auth.uid();
begin
  select v.asset_no, v.site into asset, vsite
    from public.driver_team_assignments a
    join public.vehicle_fleet v on v.id = a.vehicle_id
   where a.driver_id = new.driver_id and a.ends_at is null
   order by a.starts_at desc limit 1;
  select assigned_asset_no, site, organisation_id into old_asset, old_site, org
    from public.drivers where id = new.driver_id;
  if old_asset is not distinct from asset
     and not (nullif(btrim(old_site), '') is null and vsite is not null) then
    return null;
  end if;
  -- A blank driver site takes the vehicle's site; a recorded site is never overwritten.
  update public.drivers
     set assigned_asset_no = asset,
         site = coalesce(nullif(btrim(site), ''), vsite)
   where id = new.driver_id;
  insert into public.driver_workspace_events(organisation_id, driver_id, actor_id, action, details)
  values (org, new.driver_id,
          case when exists (select 1 from public.profiles where id = actor) then actor end,
          'vehicle_sync',
          jsonb_build_object('assigned_asset_no_from', old_asset, 'assigned_asset_no_to', asset,
                             'site_from', old_site,
                             'site_to', coalesce(nullif(btrim(old_site), ''), vsite),
                             'assignment_id', new.id));
  return null;
end $$;

create or replace trigger trg_fs_sync_assigned_asset
  after insert or update of ends_at, vehicle_id on public.driver_team_assignments
  for each row execute function private.fs_sync_assigned_asset();

-- 8. An approved handover moves the vehicle from from_driver_id to to_driver_id.
create or replace function private.fs_handover_moves_vehicle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.vehicle_fleet%rowtype;
  holder public.driver_team_assignments%rowtype;
  cur public.driver_team_assignments%rowtype;
  actor uuid := coalesce(auth.uid(), new.incharge_by, new.supervisor_by);
  doc text := coalesce(new.document_no, new.report_no, new.id::text);
begin
  if new.approval_status is distinct from 'approved'
     or old.approval_status is not distinct from 'approved'
     or new.to_driver_id is null then
    return null;
  end if;
  begin
    -- Fail closed: without a country the asset number may name another
    -- country's machine (asset numbers repeat across countries).
    if new.country is null then
      raise warning 'Handover % approved but has no country; vehicle assignment not moved', new.id;
      return null;
    end if;
    select * into v from public.vehicle_fleet
     where organisation_id = new.organisation_id and asset_no = new.asset_no
       and country = new.country
     limit 1;
    if not found then return null; end if;
    if not exists (select 1 from public.drivers rd
                    where rd.id = new.to_driver_id and rd.organisation_id = new.organisation_id
                      and rd.country = v.country) then
      raise warning 'Handover % approved but the receiving driver is not in the vehicle''s country; nothing moved', new.id;
      return null;
    end if;

    select * into holder from public.driver_team_assignments
     where vehicle_id = v.id and ends_at is null
     order by starts_at desc limit 1;
    if found and holder.driver_id = new.to_driver_id then
      return null;  -- already with the receiver
    end if;
    if found and holder.driver_id is distinct from new.from_driver_id then
      raise warning 'Handover % approved, but vehicle % is held by driver %, not the handing-over driver %; nothing moved',
        new.id, v.asset_no, holder.driver_id, new.from_driver_id;
      return null;
    end if;
    if found then
      perform private.fs_reassign(holder.driver_id, holder.supervisor_id, holder.manager_id, null,
        'Handed over vehicle ' || v.asset_no || ' (' || doc || ')', actor);
      perform private.fs_notify_driver_people(holder.driver_id, actor, 'Vehicle handed over',
        'Vehicle ' || v.asset_no || ' was handed over (' || doc || ').');
    end if;

    select * into cur from public.driver_team_assignments
     where driver_id = new.to_driver_id and ends_at is null
     order by starts_at desc limit 1;
    -- The receiver keeps their own responsible label; none is added here.
    perform private.fs_reassign(new.to_driver_id, cur.supervisor_id, cur.manager_id, v.id,
      'Took over vehicle ' || v.asset_no || ' (' || doc || ')', actor);
    perform private.fs_notify_driver_people(new.to_driver_id, actor, 'Vehicle handed over to you',
      'Vehicle ' || v.asset_no || ' is now assigned to you (' || doc || ').');
  exception when others then
    raise warning 'Handover % approved but the vehicle assignment did not move: %', new.id, sqlerrm;
  end;
  return null;
end $$;

create or replace trigger trg_zz_handover_moves_vehicle
  after update of approval_status on public.handover_reports
  for each row execute function private.fs_handover_moves_vehicle();

-- Grants (Supabase grants EXECUTE to PUBLIC/anon at create: revoke both).
revoke all on function private.fs_pool_role() from public, anon;
revoke all on function private.fs_role_ok() from public, anon;
revoke all on function private.fs_vehicle_writer_ok() from public, anon;
revoke all on function private.fs_driver_ok(uuid) from public, anon;
revoke all on function private.fs_uuid(text) from public, anon;
revoke all on function private.fs_reassign(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.fs_notify_driver_people(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function private.fs_sync_assigned_asset() from public, anon, authenticated;
revoke all on function private.fs_handover_moves_vehicle() from public, anon, authenticated;
grant execute on function private.fs_pool_role() to authenticated;
grant execute on function private.fs_role_ok() to authenticated;
grant execute on function private.fs_vehicle_writer_ok() to authenticated;
grant execute on function private.fs_driver_ok(uuid) to authenticated;
grant execute on function private.fs_uuid(text) to authenticated;

revoke all on function public.fleet_supervisor_drivers(text, text, integer, text, text) from public, anon;
revoke all on function public.fleet_supervisor_driver_filters() from public, anon;
revoke all on function public.fleet_supervisor_assignment_history(uuid) from public, anon;
revoke all on function public.fleet_supervisor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.fleet_supervisor_drivers(text, text, integer, text, text) to authenticated;
grant execute on function public.fleet_supervisor_driver_filters() to authenticated;
grant execute on function public.fleet_supervisor_assignment_history(uuid) to authenticated;
grant execute on function public.fleet_supervisor_command(text, jsonb, uuid) to authenticated;

commit;

-- VERIFY (results filled in from the rolled-back live run below).
-- DRY RUN 2026-11-27 (re-run after the review fixes; live, inside one DO block
-- that ends in RAISE, so all of it rolled back; 20261127170000 applied first in
-- the same block). Drivers d1 d479c9ed (AABISH ALI KHAN), d2 8ff9e58e
-- (AAMIR KHAN), vehicle BH007. Second Fleet Supervisor 96307e3d; Manager 34793423.
--   As Fleet Supervisor f3a70480:
--     fs_pool_role()                         true
--     driver_workspace_access(d1)            'supervisor'   (was 'none')
--     driver_workspace() roster              101 (page cap; was 0)
--     fleet_supervisor_drivers('all')        101 (page cap)
--     search '%' / search '_'                0 / 0 (literal; unescaped both matched 101)
--     driver_workspace_options('vehicles')   rows returned (was 42501)
--     assign BH007 -> d1                     ok
--     assign BH007 -> d2                     {ok:false, conflict:{d1, AABISH ALI KHAN}}
--     forced unique_violation on the move    {ok:false, conflict:{AABISH ALI KHAN}};
--                                            d1 still holds BH007 (nothing written)
--     assign BH007 -> d2 + move_from_driver  ok; d1 asset null, d2 asset BH007 site NHC
--     malformed driver_id                    22023 Invalid request (not 22P02)
--     take_driver                            22023 Invalid request (removed)
--     set_driver_profile d2                  ok; category filter returns 1 row
--     driver_filters()                       {sites:[NHC], regions:[Central], categories:[Transit mixer driver]}
--     assignment history d2                  1 row
--     create_fine on d2                      ok (no 42804, no 23502)
--     fine at supervisor stage, creator:     approve 42501 "You issued this fine ...";
--                                            return 42501
--     same fine, other supervisor 96307e3d:  approve ok, stage -> finance
--     charge issued_by f3a70480, creator:    charge_supervisor_review approve 42501
--                                            "You issued this charge ..."
--     same charge, other supervisor:         approve ok, status supervisor_approved
--     vehicle_sync audit events              3
--     second open row for BH007              refused 23505 (separate rolled-back check)
--   As Manager 34793423 with fleet_master edit = false:
--     fleet_supervisor_drivers('all')        101 (reading still allowed)
--     unassign_vehicle                       42501 "You need fleet master edit access ..."
--   As Driver 07540a9c (20261127163000 intact):
--     app_role() 'driver'; access(d2) 'none'; access(own driver) 'driver';
--     drivers visible 1; driver_team_assignments visible 0; driver_fines visible 0;
--     fleet_supervisor_drivers -> 42501.
--   NOT EXERCISED: the moved-away notice text (d1 had no linked login or label,
--   so it had no recipient; the text is in code) and the handover trigger (no
--   handover_reports rows exist; a planted one needs the full signature set);
--   re-test both on the first real case.
