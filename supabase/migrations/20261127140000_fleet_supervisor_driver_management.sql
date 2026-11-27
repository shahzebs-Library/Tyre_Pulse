-- Fleet Supervisor runs their own team: take a driver onto the team, give the
-- driver a vehicle, move or take the vehicle back, release the driver, and
-- see the full history. A signed and approved vehicle handover moves the
-- vehicle to the receiving driver on its own.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's yes.
-- A dry run inside a rolled-back transaction passed on 2026-11-27 (see VERIFY).
--
-- WHAT WAS WRONG (measured live 2026-11-27, impersonating the real Fleet
-- Supervisor f3a70480 in rolled-back transactions):
--   * driver_team_assignments holds 0 rows and drivers.assigned_asset_no is
--     blank on all 674 drivers, so no driver has a vehicle or a supervisor.
--   * private.driver_workspace_access() returns 'none' for that supervisor on
--     ALL 674 drivers: 'supervisor' access needs an open assignment that names
--     them, and only a 'manager' (fleet_master edit) may write one. The Fleet
--     Supervisor role does not hold fleet_master edit. So:
--       assign_team  -> 42501 Driver unavailable
--       create_fine  -> 42501 Driver unavailable
--       charge_issue -> 42501 Driver unavailable
--       driver_workspace_options('vehicles') -> 42501 Access denied
--       driver_workspace() roster -> 0 drivers
--     The fine and charge workflows were complete and simply unreachable.
--   * drivers.site is NULL on ALL 674 drivers while driver_fines.site and
--     driver_charges.site are NOT NULL. Even with supervisor access (proved in
--     the dry run) create_fine and charge_issue fail with 23502. Item 6 fills a
--     blank driver site from the vehicle they are given.
--   * Handover sign-off already refuses a supervisor who created the record,
--     collected a signature, or is linked to either driver
--     (decide_handover_approval). Verified: self decide -> 42501. Nothing to
--     add there; this migration does not touch it.
--
-- WHAT THIS ADDS (additive; no table, column or existing function changes):
--   1. private.fs_role_ok(): Fleet Supervisor, Fleet Incharge, an elevated role
--      or a super admin.
--   2. private.fs_team_state(driver): 'mine' (open assignment names the caller
--      as supervisor), 'available' (no open assignment, or one with no
--      supervisor), 'other' (another supervisor's team) or 'none' (outside the
--      caller's org/country/site scope, not active, wrong role, or the caller is
--      that driver's own login).
--   3. public.fleet_supervisor_drivers(view, search, offset): the caller's team
--      ('mine') or drivers they may take on ('available'), with the current
--      vehicle, open charges, open fines and the vehicle's last odometer.
--   4. public.fleet_supervisor_assignment_history(driver): every assignment
--      row, newest first, with names.
--   5. public.fleet_supervisor_command(action, payload, request_id):
--        take_driver | assign_vehicle | unassign_vehicle | release_driver.
--      History is kept by closing the open row (ends_at) and opening a new one;
--      nothing is ever updated in place or deleted. Idempotent on
--      (actor, request_id) through private.driver_workspace_requests, logged to
--      driver_workspace_events and notified to the driver's linked login, the
--      same way the existing driver workspace actions are.
--      A vehicle already held by another driver is NOT taken silently: the call
--      returns {ok:false, conflict:{driver_id, driver_name}} and writes nothing.
--      The phone or web asks, then resends with move_from_driver = that id.
--   6. drivers.assigned_asset_no follows the open assignment (trigger), so the
--      web Driver Intelligence page and the driver list show the real vehicle;
--      a blank drivers.site is filled from that vehicle (never overwritten).
--   7. When a handover reaches 'approved' and names to_driver_id, the vehicle
--      moves to the receiving driver: any other open holder loses it and the
--      receiver gets it, keeping their supervisor (or the approving supervisor
--      when they had none). A failure here never blocks the approval; it is
--      raised as a WARNING.
--
-- OWNER DECISION BAKED IN (change before applying if wrong): a Fleet
-- Supervisor may take on ANY active driver in their own country and site scope
-- who has no supervisor yet. All three live Fleet Supervisors are KSA with
-- sites = ['ALL'], so each may take any unassigned KSA driver. Once a driver is
-- on someone's team, another supervisor cannot take them (a manager reassigns
-- them through the existing assign_team action).
--
-- VERIFY (impersonate a Fleet Supervisor, rolled back):
--   select set_config('request.jwt.claims','{"sub":"f3a70480-b65a-4cb9-8d6e-bee0811e658c","role":"authenticated"}',true);
--   set local role authenticated;
--   select jsonb_array_length(public.fleet_supervisor_drivers('available','',0)->'rows'); -- > 0
--   select public.fleet_supervisor_command('take_driver', jsonb_build_object('driver_id',<d>,'reason','Joins my site team'), gen_random_uuid());
--   select private.driver_workspace_access(<d>); -- 'supervisor'
--   select public.fleet_supervisor_command('assign_vehicle', jsonb_build_object('driver_id',<d>,'vehicle_id',<v>,'reason','Daily mixer'), gen_random_uuid());
--   reset role;
--   select assigned_asset_no from drivers where id=<d>;  -- the vehicle asset_no
--   select count(*) from driver_team_assignments where driver_id=<d>; -- 2 (history kept)
--   rollback;
--
-- ROLLBACK:
--   drop trigger if exists trg_zz_handover_moves_vehicle on public.handover_reports;
--   drop trigger if exists trg_fs_sync_assigned_asset on public.driver_team_assignments;
--   drop function if exists private.fs_handover_moves_vehicle();
--   drop function if exists private.fs_sync_assigned_asset();
--   drop function if exists public.fleet_supervisor_command(text, jsonb, uuid);
--   drop function if exists public.fleet_supervisor_assignment_history(uuid);
--   drop function if exists public.fleet_supervisor_drivers(text, text, integer);
--   drop function if exists private.fs_reassign(uuid, uuid, uuid, uuid, text, uuid);
--   drop function if exists private.fs_team_state(uuid);
--   drop function if exists private.fs_role_ok();
--   -- assignment rows written while it was live stay (they are real history).

begin;

create or replace function private.fs_role_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(auth.uid() is not null and public.app_is_active() and (
    public.is_super_admin()
    or public.app_is_elevated()
    or public.get_my_role() = any (array['Fleet Supervisor', 'Fleet Incharge'])
  ), false);
$$;

create or replace function private.fs_team_state(p_driver uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  d public.drivers%rowtype;
  open_sup uuid;
  has_open boolean;
begin
  select * into d from public.drivers where id = p_driver;
  if not found or d.organisation_id is distinct from public.app_current_org()
     or not private.fs_role_ok()
     or not private.driver_workspace_scope(d.organisation_id, d.country, d.site)
     or exists (select 1 from public.driver_account_links l
                 where l.driver_id = d.id and l.user_id = auth.uid()) then
    return 'none';
  end if;
  select true, a.supervisor_id into has_open, open_sup
    from public.driver_team_assignments a
   where a.driver_id = d.id and a.ends_at is null
   order by a.starts_at desc
   limit 1;
  if open_sup = auth.uid() then return 'mine'; end if;
  if lower(coalesce(d.status, 'active')) <> 'active' then return 'none'; end if;
  if not coalesce(has_open, false) or open_sup is null then return 'available'; end if;
  return 'other';
end $$;

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

create or replace function public.fleet_supervisor_drivers(
  p_view text default 'mine', p_search text default '', p_offset integer default 0)
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
  if coalesce(p_view, '') not in ('mine', 'available') or p_offset is null
     or p_offset < 0 or p_offset > 1000000 or length(coalesce(p_search, '')) > 160 then
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
      'country', d.country,
      'status', d.status,
      'login_linked', exists (select 1 from public.driver_account_links l where l.driver_id = d.id),
      'assignment_id', a.id,
      'assigned_since', a.starts_at,
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
      and (case when p_view = 'mine' then a.supervisor_id = uid
                else lower(coalesce(d.status, 'active')) = 'active'
                     and (a.id is null or a.supervisor_id is null) end)
      and (coalesce(p_search, '') = ''
           or concat_ws(' ', d.driver_name, d.driver_id, d.site, v.asset_no, v.registration_no)
              ilike '%' || p_search || '%')
    order by d.driver_name, d.id
    limit 101 offset p_offset
  ) q;

  return jsonb_build_object('view', p_view, 'rows', result);
end $$;

create or replace function public.fleet_supervisor_assignment_history(p_driver_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  state text := private.fs_team_state(p_driver_id);
  access text := private.driver_workspace_access(p_driver_id);
begin
  if state not in ('mine', 'available') and access not in ('manager', 'supervisor') then
    raise exception 'Driver unavailable' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'team_state', state,
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
  state text;
  holder_state text;
  holder_name text;
  v_reason text := btrim(coalesce(p_payload->>'reason', ''));
  new_id uuid;
  answer jsonb;
begin
  if actor is null or org is null or not private.fs_role_ok() then
    raise exception 'Access denied' using errcode = '42501';
  end if;
  if p_request_id is null or jsonb_typeof(p_payload) is distinct from 'object'
     or octet_length(p_payload::text) > 20000
     or coalesce(p_action, '') not in ('take_driver', 'assign_vehicle', 'unassign_vehicle', 'release_driver') then
    raise exception 'Invalid request' using errcode = '22023';
  end if;
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

  select * into d from public.drivers
   where id = nullif(p_payload->>'driver_id', '')::uuid and organisation_id = org
   for update;
  if not found then raise exception 'Driver unavailable' using errcode = '42501'; end if;
  state := private.fs_team_state(d.id);
  if state = 'other' then
    raise exception 'This driver is on another supervisor''s team. A manager can move them.' using errcode = '42501';
  end if;
  if state not in ('mine', 'available') then
    raise exception 'Driver unavailable' using errcode = '42501';
  end if;

  select * into cur from public.driver_team_assignments
   where driver_id = d.id and ends_at is null
   order by starts_at desc limit 1
   for update;

  case p_action
  when 'take_driver' then
    if state = 'mine' then raise exception 'This driver is already on your team' using errcode = '22023'; end if;
    new_id := private.fs_reassign(d.id, actor, cur.manager_id, cur.vehicle_id, v_reason, actor);

  when 'assign_vehicle' then
    select * into v from public.vehicle_fleet
     where id = nullif(p_payload->>'vehicle_id', '')::uuid;
    if not found or v.organisation_id is distinct from org
       or not private.driver_workspace_scope(v.organisation_id, v.country, v.site)
       or v.country is distinct from d.country then
      raise exception 'Vehicle outside your scope or in another country' using errcode = '42501';
    end if;
    if state = 'mine' and cur.vehicle_id = v.id then
      raise exception 'This vehicle is already assigned to this driver' using errcode = '22023';
    end if;
    select * into holder from public.driver_team_assignments
     where vehicle_id = v.id and ends_at is null and driver_id <> d.id
     order by starts_at desc limit 1
     for update;
    if found then
      select driver_name into holder_name from public.drivers where id = holder.driver_id;
      if nullif(p_payload->>'move_from_driver', '')::uuid is distinct from holder.driver_id then
        -- Nothing written and the request id is NOT stored: the caller asks the
        -- user, then resends with move_from_driver to confirm the move.
        return jsonb_build_object('ok', false, 'driver_id', d.id, 'action', p_action,
          'conflict', jsonb_build_object('driver_id', holder.driver_id, 'driver_name', holder_name,
                                         'asset_no', v.asset_no));
      end if;
      holder_state := private.fs_team_state(holder.driver_id);
      if holder_state not in ('mine', 'available') then
        raise exception 'This vehicle is held by a driver on another team. A manager can move it.' using errcode = '42501';
      end if;
      perform private.fs_reassign(holder.driver_id, holder.supervisor_id, holder.manager_id, null,
        'Vehicle ' || coalesce(v.asset_no, '') || ' moved to ' || coalesce(d.driver_name, 'another driver') || ': ' || v_reason,
        actor);
      insert into public.driver_workspace_events(organisation_id, driver_id, actor_id, action, details)
      values (org, holder.driver_id, actor, 'supervisor_vehicle_moved_away',
              jsonb_build_object('vehicle_id', v.id, 'to_driver_id', d.id, 'reason', v_reason));
    end if;
    new_id := private.fs_reassign(d.id, actor, cur.manager_id, v.id, v_reason, actor);

  when 'unassign_vehicle' then
    if state <> 'mine' or cur.vehicle_id is null then
      raise exception 'This driver has no vehicle on your team' using errcode = '22023';
    end if;
    new_id := private.fs_reassign(d.id, actor, cur.manager_id, null, v_reason, actor);

  when 'release_driver' then
    if state <> 'mine' then
      raise exception 'This driver is not on your team' using errcode = '22023';
    end if;
    -- The driver keeps the vehicle and manager; only the supervisor link ends.
    new_id := private.fs_reassign(d.id, null, cur.manager_id, cur.vehicle_id, v_reason, actor);
  end case;

  insert into public.driver_workspace_events(organisation_id, driver_id, actor_id, action, details)
  values (org, d.id, actor, 'supervisor_' || p_action, p_payload);

  insert into public.notifications(user_id, type, title, body, entity_type, entity_id)
  select l.user_id, 'driver_workspace', 'Your vehicle or supervisor changed',
         'Open your driver workspace to see the change.', 'driver_workspace', d.id
    from public.driver_account_links l
   where l.driver_id = d.id and l.user_id <> actor;

  answer := jsonb_build_object('ok', true, 'driver_id', d.id,
                               'id', coalesce(new_id, d.id), 'action', p_action);
  insert into private.driver_workspace_requests values (actor, p_request_id, p_action, p_payload, answer);
  return answer;
end $$;

-- drivers.assigned_asset_no follows the open assignment.
create or replace function private.fs_sync_assigned_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  asset text;
  vsite text;
begin
  select v.asset_no, v.site into asset, vsite
    from public.driver_team_assignments a
    join public.vehicle_fleet v on v.id = a.vehicle_id
   where a.driver_id = new.driver_id and a.ends_at is null
   order by a.starts_at desc limit 1;
  -- drivers.site is NULL on all 674 drivers (measured 2026-11-27) while
  -- driver_fines.site and driver_charges.site are NOT NULL, so no fine or
  -- charge could ever be issued. A driver with no site takes the site of the
  -- vehicle they are given; a site someone recorded is never overwritten.
  update public.drivers
     set assigned_asset_no = asset,
         site = coalesce(nullif(btrim(site), ''), vsite)
   where id = new.driver_id
     and (assigned_asset_no is distinct from asset
          or (nullif(btrim(site), '') is null and vsite is not null));
  return null;
end $$;

drop trigger if exists trg_fs_sync_assigned_asset on public.driver_team_assignments;
create trigger trg_fs_sync_assigned_asset
  after insert or update of ends_at, vehicle_id on public.driver_team_assignments
  for each row execute function private.fs_sync_assigned_asset();

-- An approved handover moves the vehicle to the receiving driver.
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
    select * into v from public.vehicle_fleet
     where organisation_id = new.organisation_id and asset_no = new.asset_no
       and (new.country is null or country = new.country)
     order by (country = new.country) desc nulls last
     limit 1;
    if not found then return null; end if;

    for holder in
      select * from public.driver_team_assignments
       where vehicle_id = v.id and ends_at is null and driver_id <> new.to_driver_id
    loop
      perform private.fs_reassign(holder.driver_id, holder.supervisor_id, holder.manager_id, null,
        'Handed over vehicle ' || v.asset_no || ' (' || doc || ')', actor);
    end loop;

    select * into cur from public.driver_team_assignments
     where driver_id = new.to_driver_id and ends_at is null
     order by starts_at desc limit 1;
    if cur.vehicle_id is distinct from v.id then
      perform private.fs_reassign(new.to_driver_id,
        coalesce(cur.supervisor_id, new.supervisor_by), cur.manager_id, v.id,
        'Took over vehicle ' || v.asset_no || ' (' || doc || ')', actor);
    end if;
  exception when others then
    raise warning 'Handover % approved but the vehicle assignment did not move: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists trg_zz_handover_moves_vehicle on public.handover_reports;
create trigger trg_zz_handover_moves_vehicle
  after update of approval_status on public.handover_reports
  for each row execute function private.fs_handover_moves_vehicle();

revoke all on function private.fs_role_ok() from public, anon;
revoke all on function private.fs_team_state(uuid) from public, anon;
revoke all on function private.fs_reassign(uuid, uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.fs_sync_assigned_asset() from public, anon, authenticated;
revoke all on function private.fs_handover_moves_vehicle() from public, anon, authenticated;
grant execute on function private.fs_role_ok() to authenticated;
grant execute on function private.fs_team_state(uuid) to authenticated;

revoke all on function public.fleet_supervisor_drivers(text, text, integer) from public, anon;
revoke all on function public.fleet_supervisor_assignment_history(uuid) from public, anon;
revoke all on function public.fleet_supervisor_command(text, jsonb, uuid) from public, anon;
grant execute on function public.fleet_supervisor_drivers(text, text, integer) to authenticated;
grant execute on function public.fleet_supervisor_assignment_history(uuid) to authenticated;
grant execute on function public.fleet_supervisor_command(text, jsonb, uuid) to authenticated;

commit;
