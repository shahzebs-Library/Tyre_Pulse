-- Vehicle reservations: real detail columns + an append-only history ledger.
-- Adds driver, project, cost centre, approval and rejection stamps, odometer
-- out/in, actual pickup and return times, and links to a gate pass and a
-- handover report. Approving or rejecting needs an elevated role; the stamps
-- are written by the server, never trusted from the client.

alter table public.vehicle_reservations
  add column if not exists project text,
  add column if not exists cost_centre text,
  add column if not exists driver_id uuid,
  add column if not exists driver_name text,
  add column if not exists approved_by_id uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists rejected_by_id uuid,
  add column if not exists rejected_at timestamptz,
  add column if not exists rejected_reason text,
  add column if not exists odometer_out numeric,
  add column if not exists odometer_in numeric,
  add column if not exists actual_pickup_at timestamptz,
  add column if not exists actual_return_at timestamptz,
  add column if not exists gate_pass_id uuid references public.gate_passes(id) on delete set null,
  add column if not exists handover_id uuid references public.handover_reports(id) on delete set null;

alter table public.vehicle_reservations drop constraint if exists vehicle_reservations_odometer_chk;
alter table public.vehicle_reservations add constraint vehicle_reservations_odometer_chk check (
  (odometer_out is null or odometer_out >= 0)
  and (odometer_in is null or odometer_in >= 0)
  and (odometer_in is null or odometer_out is null or odometer_in >= odometer_out)
);

create index if not exists vehicle_reservations_asset_start_idx on public.vehicle_reservations (organisation_id, asset_no, start_at);

-- Guard + stamp: approval and rejection need an elevated role; pickup and return times fill themselves.
create or replace function public.vehicle_reservation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_elevated boolean := (auth.uid() is null) or coalesce(public.app_is_elevated(), false) or coalesce(public.is_super_admin(), false);
begin
  if v_uid is not null then
    select full_name into v_name from public.profiles where id = v_uid;
  end if;

  if tg_op = 'INSERT' then
    if new.status = 'approved' and not v_elevated then
      raise exception 'Only a manager can create an approved reservation.' using errcode = '42501';
    end if;
    if new.status = 'approved' then
      new.approved_by_id := coalesce(new.approved_by_id, v_uid);
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(nullif(btrim(new.approved_by), ''), v_name);
    end if;
    if new.status = 'out' then new.actual_pickup_at := coalesce(new.actual_pickup_at, now()); end if;
    if new.status = 'returned' then new.actual_return_at := coalesce(new.actual_return_at, now()); end if;
    return new;
  end if;

  -- Server-owned stamps cannot be forged by a client update.
  if new.approved_by_id is distinct from old.approved_by_id and new.status is not distinct from old.status then
    new.approved_by_id := old.approved_by_id;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'approved' then
      if not v_elevated then
        raise exception 'Only a manager can approve a reservation.' using errcode = '42501';
      end if;
      new.approved_by_id := v_uid;
      new.approved_at := now();
      new.approved_by := coalesce(v_name, nullif(btrim(new.approved_by), ''));
      new.rejected_at := null; new.rejected_by_id := null; new.rejected_reason := null;
    elsif new.status = 'out' then
      new.actual_pickup_at := coalesce(new.actual_pickup_at, now());
    elsif new.status = 'returned' then
      new.actual_return_at := coalesce(new.actual_return_at, now());
    end if;
  end if;

  if new.rejected_at is distinct from old.rejected_at and new.rejected_at is not null then
    if not v_elevated then
      raise exception 'Only a manager can reject a reservation.' using errcode = '42501';
    end if;
    if nullif(btrim(coalesce(new.rejected_reason, '')), '') is null then
      raise exception 'A reason is needed to reject a reservation.' using errcode = '22023';
    end if;
    new.rejected_by_id := v_uid;
    new.rejected_at := now();
    new.status := 'cancelled';
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_reservation_guard on public.vehicle_reservations;
create trigger trg_vehicle_reservation_guard
  before insert or update on public.vehicle_reservations
  for each row execute function public.vehicle_reservation_guard();
revoke all on function public.vehicle_reservation_guard() from public, anon, authenticated;

-- History ledger, written only by the trigger.
create table if not exists public.vehicle_reservation_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid default public.app_current_org(),
  country text,
  reservation_id uuid not null references public.vehicle_reservations(id) on delete cascade,
  event_type text not null check (event_type in ('created', 'status', 'approved', 'rejected', 'checked_out', 'returned', 'edited')),
  from_status text,
  to_status text,
  detail jsonb,
  actor_id uuid,
  actor_name text,
  at timestamptz not null default now()
);
create index if not exists vehicle_reservation_events_res_idx on public.vehicle_reservation_events (reservation_id, at desc, id);

alter table public.vehicle_reservation_events enable row level security;
drop policy if exists vre_org_isolation on public.vehicle_reservation_events;
create policy vre_org_isolation on public.vehicle_reservation_events as restrictive for all to authenticated
  using ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()))
  with check ((organisation_id = (select public.app_current_org())) or (select public.is_super_admin()));
drop policy if exists vre_country_isolation on public.vehicle_reservation_events;
create policy vre_country_isolation on public.vehicle_reservation_events as restrictive for select to authenticated
  using ((country is null) or (select public.is_super_admin()) or (select public.app_sees_all_countries())
    or (lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}'::text[]))));
drop policy if exists vre_select on public.vehicle_reservation_events;
create policy vre_select on public.vehicle_reservation_events for select to authenticated
  using (public.is_approved_and_unlocked());
revoke all on public.vehicle_reservation_events from anon;
revoke insert, update, delete, truncate on public.vehicle_reservation_events from authenticated;
grant select on public.vehicle_reservation_events to authenticated;

create or replace function public.vehicle_reservation_log()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
  v_type text;
  v_changed text[];
begin
  if v_uid is not null then select full_name into v_name from public.profiles where id = v_uid; end if;
  if tg_op = 'INSERT' then
    insert into public.vehicle_reservation_events (organisation_id, country, reservation_id, event_type, to_status, actor_id, actor_name)
    values (new.organisation_id, new.country, new.id, 'created', new.status, v_uid, v_name);
    return new;
  end if;

  if new.rejected_at is distinct from old.rejected_at and new.rejected_at is not null then
    v_type := 'rejected';
  elsif new.status is distinct from old.status then
    v_type := case new.status when 'approved' then 'approved' when 'out' then 'checked_out' when 'returned' then 'returned' else 'status' end;
  end if;

  select array_agg(n.key order by n.key) into v_changed
  from jsonb_each(to_jsonb(new)) n
  join jsonb_each(to_jsonb(old)) o on o.key = n.key
  where n.value is distinct from o.value
    and n.key not in ('updated_at', 'status', 'approved_at', 'approved_by_id', 'rejected_at', 'rejected_by_id', 'actual_pickup_at', 'actual_return_at');

  if v_type is not null then
    insert into public.vehicle_reservation_events (organisation_id, country, reservation_id, event_type, from_status, to_status, detail, actor_id, actor_name)
    values (new.organisation_id, new.country, new.id, v_type, old.status, new.status,
      jsonb_strip_nulls(jsonb_build_object('reason', new.rejected_reason, 'odometer_out', case when v_type = 'checked_out' then new.odometer_out end,
        'odometer_in', case when v_type = 'returned' then new.odometer_in end, 'fields', to_jsonb(v_changed))),
      v_uid, v_name);
  elsif v_changed is not null then
    insert into public.vehicle_reservation_events (organisation_id, country, reservation_id, event_type, from_status, to_status, detail, actor_id, actor_name)
    values (new.organisation_id, new.country, new.id, 'edited', old.status, new.status, jsonb_build_object('fields', to_jsonb(v_changed)), v_uid, v_name);
  end if;
  return new;
end $$;

drop trigger if exists trg_vehicle_reservation_log on public.vehicle_reservations;
create trigger trg_vehicle_reservation_log
  after insert or update on public.vehicle_reservations
  for each row execute function public.vehicle_reservation_log();
revoke all on function public.vehicle_reservation_log() from public, anon, authenticated;

-- The driver picks from the driver register.
alter table public.vehicle_reservations drop constraint if exists vehicle_reservations_driver_fk;
alter table public.vehicle_reservations add constraint vehicle_reservations_driver_fk foreign key (driver_id) references public.drivers(id) on delete set null;
