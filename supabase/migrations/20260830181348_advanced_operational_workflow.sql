-- Advanced operational workflow for Daily Operations / Action Center.
-- Depends on action_items (V186), shifts (V149), app_current_org(),
-- get_my_role(), set_updated_at(). Deliberately not deployed by this change.

alter table public.action_items
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists site text,
  add column if not exists shift_id uuid references public.shifts(id) on delete set null,
  add column if not exists blocked_reason text,
  add column if not exists escalated_reason text,
  add column if not exists escalated_at timestamptz,
  add column if not exists escalated_by uuid references auth.users(id) on delete set null,
  add column if not exists sla_due_at timestamptz,
  add column if not exists sla_breached_at timestamptz,
  add column if not exists approval_status text not null default 'not_required',
  add column if not exists approval_requested_at timestamptz,
  add column if not exists approval_requested_by uuid references auth.users(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_by uuid references auth.users(id) on delete set null,
  add column if not exists approval_note text,
  add column if not exists completed_at timestamptz;

do $$
declare v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.action_items'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%status%'
    and pg_get_constraintdef(c.oid) ilike '%acknowledged%'
  limit 1;
  if v_name is not null then
    execute format('alter table public.action_items drop constraint %I', v_name);
  end if;
end $$;

alter table public.action_items
  drop constraint if exists action_items_status_check,
  add constraint action_items_status_check check (status in
    ('open','acknowledged','in_progress','blocked','escalated',
     'pending_approval','resolved','dismissed')),
  drop constraint if exists action_items_approval_status_check,
  add constraint action_items_approval_status_check check (approval_status in
    ('not_required','pending','approved','rejected')),
  drop constraint if exists action_items_blocked_reason_check,
  add constraint action_items_blocked_reason_check check
    (status <> 'blocked' or nullif(btrim(blocked_reason), '') is not null),
  drop constraint if exists action_items_escalated_reason_check,
  add constraint action_items_escalated_reason_check check
    (status <> 'escalated' or nullif(btrim(escalated_reason), '') is not null),
  drop constraint if exists action_items_resolution_check,
  add constraint action_items_resolution_check check
    (status not in ('resolved','dismissed') or nullif(btrim(resolution), '') is not null);

create index if not exists action_items_org_assignee_active_idx
  on public.action_items (organisation_id, assigned_user_id, status, sla_due_at)
  where status not in ('resolved','dismissed');
create index if not exists action_items_org_site_shift_active_idx
  on public.action_items (organisation_id, site, shift_id, priority_score desc)
  where status not in ('resolved','dismissed');
create index if not exists action_items_org_sla_due_idx
  on public.action_items (organisation_id, sla_due_at)
  where sla_due_at is not null and status not in ('resolved','dismissed');

create table if not exists public.action_item_history (
  id bigint generated always as identity primary key,
  organisation_id uuid not null,
  action_item_id uuid not null references public.action_items(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null check (event_type in
    ('created','updated','assigned','acknowledged','started','blocked','escalated',
     'approval_requested','approved','rejected','resolved','dismissed','reopened')),
  from_status text,
  to_status text,
  reason text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now()
);
create index if not exists action_item_history_item_time_idx
  on public.action_item_history (action_item_id, created_at desc);
create index if not exists action_item_history_org_time_idx
  on public.action_item_history (organisation_id, created_at desc);

alter table public.action_item_history enable row level security;
drop policy if exists action_item_history_read on public.action_item_history;
create policy action_item_history_read on public.action_item_history for select
  to authenticated
  using (organisation_id = (select public.app_current_org()));
revoke all on public.action_item_history from anon, authenticated;
grant select on public.action_item_history to authenticated;

-- Operational records are retained; dismissal is the auditable alternative to
-- deletion. This also guarantees that history cannot disappear by cascade.
drop policy if exists action_items_delete on public.action_items;
revoke delete on public.action_items from authenticated;

create or replace function public.action_item_before_write()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare
  v_allowed boolean;
  v_role text;
begin
  if tg_op = 'UPDATE' and new.organisation_id is distinct from old.organisation_id then
    raise exception 'organisation_id is immutable' using errcode = '42501';
  end if;

  if tg_op = 'INSERT' then
    new.organisation_id := public.app_current_org();
    if new.organisation_id is null then
      raise exception 'An organisation membership is required' using errcode = '42501';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status and
     (new.approval_status is distinct from old.approval_status or
      new.approval_requested_at is distinct from old.approval_requested_at or
      new.approval_requested_by is distinct from old.approval_requested_by or
      new.approved_at is distinct from old.approved_at or
      new.approved_by is distinct from old.approved_by or
      new.completed_at is distinct from old.completed_at or
      new.escalated_at is distinct from old.escalated_at or
      new.escalated_by is distinct from old.escalated_by) then
    raise exception 'Lifecycle audit fields may only change through a status transition'
      using errcode = '42501';
  end if;

  if new.status is distinct from old.status then
    v_allowed := case old.status
      when 'open' then new.status in ('acknowledged','in_progress','blocked','escalated','dismissed')
      when 'acknowledged' then new.status in ('open','in_progress','blocked','escalated','dismissed')
      when 'in_progress' then new.status in ('blocked','escalated','pending_approval','resolved','dismissed')
      when 'blocked' then new.status in ('in_progress','escalated','dismissed')
      when 'escalated' then new.status in ('in_progress','blocked','pending_approval','resolved','dismissed')
      when 'pending_approval' then new.status in ('in_progress','resolved','dismissed')
      when 'resolved' then new.status in ('open','in_progress')
      when 'dismissed' then new.status = 'open'
      else false end;
    if not v_allowed then
      raise exception 'Invalid action item transition: % -> %', old.status, new.status
        using errcode = '23514';
    end if;

    if old.status = 'pending_approval' then
      v_role := public.get_my_role();
      if v_role not in ('Admin','Manager','Director') then
        raise exception 'Supervisor approval requires Admin, Manager, or Director role'
          using errcode = '42501';
      end if;
      if new.status in ('in_progress','dismissed') then
        new.approval_status := 'rejected';
      end if;
    end if;

    if new.status = 'escalated' then
      new.escalated_at := coalesce(new.escalated_at, now());
      new.escalated_by := coalesce(new.escalated_by, auth.uid());
    elsif new.status = 'pending_approval' then
      new.approval_status := 'pending';
      new.approval_requested_at := coalesce(new.approval_requested_at, now());
      new.approval_requested_by := coalesce(new.approval_requested_by, auth.uid());
    elsif new.status = 'resolved' then
      if old.status = 'pending_approval' then
        new.approval_status := 'approved';
        new.approved_at := coalesce(new.approved_at, now());
        new.approved_by := coalesce(new.approved_by, auth.uid());
      end if;
      new.completed_at := coalesce(new.completed_at, now());
    elsif old.status in ('resolved','dismissed') then
      new.completed_at := null;
      new.approval_status := 'not_required';
      new.approved_at := null;
      new.approved_by := null;
    end if;
  end if;
  return new;
end $$;

create or replace function public.action_item_record_history()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'created';
  elsif new.status is distinct from old.status then
    v_event := case new.status
      when 'acknowledged' then 'acknowledged'
      when 'in_progress' then case when old.status = 'pending_approval' then 'rejected'
                                   when old.status in ('resolved','dismissed') then 'reopened' else 'started' end
      when 'blocked' then 'blocked'
      when 'escalated' then 'escalated'
      when 'pending_approval' then 'approval_requested'
      when 'resolved' then case when old.status = 'pending_approval' then 'approved' else 'resolved' end
      when 'dismissed' then 'dismissed'
      when 'open' then 'reopened'
      else 'updated' end;
  elsif new.assigned_user_id is distinct from old.assigned_user_id then
    v_event := 'assigned';
  else
    v_event := 'updated';
  end if;
  insert into public.action_item_history
    (organisation_id, action_item_id, actor_id, event_type, from_status, to_status, reason, metadata)
  values
    (new.organisation_id, new.id, auth.uid(), v_event,
     case when tg_op = 'UPDATE' then old.status end, new.status,
     coalesce(new.blocked_reason, new.escalated_reason, new.approval_note, new.resolution),
     jsonb_build_object('assigned_user_id', new.assigned_user_id, 'site', new.site,
                        'shift_id', new.shift_id, 'sla_due_at', new.sla_due_at));
  return new;
end $$;
revoke all on function public.action_item_record_history() from public, anon, authenticated;

drop trigger if exists action_item_before_write_trigger on public.action_items;
create trigger action_item_before_write_trigger before insert or update on public.action_items
  for each row execute function public.action_item_before_write();
drop trigger if exists action_item_history_trigger on public.action_items;
create trigger action_item_history_trigger after insert or update on public.action_items
  for each row execute function public.action_item_record_history();

create or replace function public.transition_action_item(
  p_action_item_id uuid, p_to_status text, p_reason text default null,
  p_resolution text default null, p_approval_note text default null
) returns public.action_items
language plpgsql security invoker set search_path = '' as $$
declare v_item public.action_items;
begin
  update public.action_items
  set status = lower(btrim(p_to_status)),
      blocked_reason = case when lower(btrim(p_to_status)) = 'blocked' then nullif(btrim(p_reason),'') else blocked_reason end,
      escalated_reason = case when lower(btrim(p_to_status)) = 'escalated' then nullif(btrim(p_reason),'') else escalated_reason end,
      resolution = case when lower(btrim(p_to_status)) in ('resolved','dismissed') then nullif(btrim(p_resolution),'') else resolution end,
      approval_note = coalesce(nullif(btrim(p_approval_note),''), approval_note)
  where id = p_action_item_id
    and organisation_id = public.app_current_org()
  returning * into v_item;
  if not found then raise exception 'Action item not found or inaccessible' using errcode = 'P0002'; end if;
  return v_item;
end $$;
revoke all on function public.transition_action_item(uuid,text,text,text,text) from public, anon;
grant execute on function public.transition_action_item(uuid,text,text,text,text) to authenticated;

create table if not exists public.shift_handovers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text,
  site text,
  shift_id uuid references public.shifts(id) on delete set null,
  handed_over_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  to_user_id uuid references auth.users(id) on delete set null,
  summary text not null,
  open_item_count integer not null default 0 check (open_item_count >= 0),
  status text not null default 'draft' check (status in ('draft','submitted','accepted','rejected')),
  submitted_at timestamptz,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.shift_handover_items (
  handover_id uuid not null references public.shift_handovers(id) on delete cascade,
  action_item_id uuid not null references public.action_items(id) on delete restrict,
  notes text,
  primary key (handover_id, action_item_id)
);
create index if not exists shift_handovers_org_site_time_idx
  on public.shift_handovers (organisation_id, site, created_at desc);
create index if not exists shift_handovers_recipient_status_idx
  on public.shift_handovers (to_user_id, status, created_at desc);
create index if not exists shift_handover_items_action_idx
  on public.shift_handover_items (action_item_id);

drop trigger if exists set_updated_at_shift_handovers on public.shift_handovers;
create trigger set_updated_at_shift_handovers before update on public.shift_handovers
  for each row execute function public.set_updated_at();

alter table public.shift_handovers enable row level security;
alter table public.shift_handover_items enable row level security;
drop policy if exists shift_handovers_read on public.shift_handovers;
create policy shift_handovers_read on public.shift_handovers for select to authenticated
  using (organisation_id = (select public.app_current_org()));
drop policy if exists shift_handovers_insert on public.shift_handovers;
create policy shift_handovers_insert on public.shift_handovers for insert to authenticated
  with check (organisation_id = (select public.app_current_org()) and handed_over_by = (select auth.uid()));
drop policy if exists shift_handovers_update on public.shift_handovers;
create policy shift_handovers_update on public.shift_handovers for update to authenticated
  using (organisation_id = (select public.app_current_org()) and
    (handed_over_by = (select auth.uid()) or public.get_my_role() in ('Admin','Manager','Director')))
  with check (organisation_id = (select public.app_current_org()));
drop policy if exists shift_handover_items_read on public.shift_handover_items;
create policy shift_handover_items_read on public.shift_handover_items for select to authenticated
  using (exists (select 1 from public.shift_handovers h where h.id = handover_id));
drop policy if exists shift_handover_items_write on public.shift_handover_items;
create policy shift_handover_items_write on public.shift_handover_items for all to authenticated
  using (exists (select 1 from public.shift_handovers h where h.id = handover_id and
    h.organisation_id = (select public.app_current_org()) and h.handed_over_by = (select auth.uid()) and h.status = 'draft'))
  with check (exists (select 1 from public.shift_handovers h join public.action_items a on a.id = action_item_id
    where h.id = handover_id and h.organisation_id = (select public.app_current_org())
      and a.organisation_id = h.organisation_id and h.handed_over_by = (select auth.uid()) and h.status = 'draft'));
revoke all on public.shift_handovers, public.shift_handover_items from anon;
grant select, insert, update on public.shift_handovers to authenticated;
grant select, insert, update, delete on public.shift_handover_items to authenticated;

-- Atomic work-order stock reservations --------------------------------------
create table if not exists public.work_order_stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  work_order_id uuid not null references public.work_orders(id) on delete restrict,
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  status text not null default 'reserved' check (status in ('reserved','released')),
  reserved_by uuid not null references auth.users(id) on delete restrict,
  reserved_at timestamptz not null default now(),
  released_by uuid references auth.users(id) on delete set null,
  released_at timestamptz,
  release_reason text,
  unique (organisation_id, idempotency_key)
);
create table if not exists public.work_order_stock_reservation_lines (
  reservation_id uuid not null references public.work_order_stock_reservations(id) on delete restrict,
  stock_id uuid not null references public.stock(id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 100000),
  primary key (reservation_id, stock_id)
);
create unique index if not exists work_order_stock_one_active_idx
  on public.work_order_stock_reservations (organisation_id, work_order_id)
  where status = 'reserved';
create index if not exists work_order_stock_reservations_work_order_idx
  on public.work_order_stock_reservations (organisation_id, work_order_id, reserved_at desc);
create index if not exists work_order_stock_lines_stock_idx
  on public.work_order_stock_reservation_lines (stock_id);

alter table public.work_order_stock_reservations enable row level security;
alter table public.work_order_stock_reservation_lines enable row level security;
drop policy if exists work_order_stock_reservations_read on public.work_order_stock_reservations;
create policy work_order_stock_reservations_read on public.work_order_stock_reservations
  for select to authenticated
  using (organisation_id = (select public.app_current_org()));
drop policy if exists work_order_stock_reservation_lines_read on public.work_order_stock_reservation_lines;
create policy work_order_stock_reservation_lines_read on public.work_order_stock_reservation_lines
  for select to authenticated
  using (exists (
    select 1 from public.work_order_stock_reservations r
    where r.id = reservation_id and r.organisation_id = (select public.app_current_org())
  ));
revoke all on public.work_order_stock_reservations,
  public.work_order_stock_reservation_lines from anon, authenticated;
grant select on public.work_order_stock_reservations,
  public.work_order_stock_reservation_lines to authenticated;

create schema if not exists private;
revoke create on schema private from public, anon, authenticated;

create or replace function private.reserve_work_order_stock_internal(
  p_work_order_id uuid, p_lines jsonb, p_idempotency_key text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_reservation public.work_order_stock_reservations;
  v_line record;
  v_stock public.stock;
begin
  if v_actor is null or v_org is null then
    raise exception 'Authentication and organisation membership are required' using errcode = '42501';
  end if;
  if p_work_order_id is null or nullif(btrim(p_idempotency_key), '') is null
     or length(p_idempotency_key) > 160 then
    raise exception 'A work order and valid idempotency key are required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'At least one stock item is required' using errcode = '22023';
  end if;

  -- Confirm the parent belongs to this tenant before touching inventory.
  perform 1 from public.work_orders
   where id = p_work_order_id and organisation_id = v_org for update;
  if not found then
    raise exception 'Work order not found or inaccessible' using errcode = 'P0002';
  end if;

  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_reservation.id,
      'work_order_id', v_reservation.work_order_id, 'status', v_reservation.status,
      'idempotent', true);
  end if;

  if exists (select 1 from public.work_order_stock_reservations
             where organisation_id = v_org and work_order_id = p_work_order_id and status = 'reserved') then
    raise exception 'This work order already has an active stock reservation' using errcode = '23505';
  end if;

  insert into public.work_order_stock_reservations
    (organisation_id, work_order_id, idempotency_key, reserved_by)
  values (v_org, p_work_order_id, btrim(p_idempotency_key), v_actor)
  returning * into v_reservation;

  -- Aggregate duplicate stock IDs, lock in UUID order to avoid deadlocks, then
  -- deduct and record each line in the same transaction.
  for v_line in
    select (x->>'stock_id')::uuid as stock_id, sum((x->>'qty')::numeric) as qty
    from jsonb_array_elements(p_lines) x
    group by (x->>'stock_id')::uuid
    order by (x->>'stock_id')::uuid
  loop
    if v_line.qty is null or v_line.qty <> trunc(v_line.qty) or v_line.qty <= 0 or v_line.qty > 100000 then
      raise exception 'Reservation quantity must be a whole number between 1 and 100000'
        using errcode = '22023';
    end if;
    select * into v_stock from public.stock
     where id = v_line.stock_id and organisation_id = v_org for update;
    if not found then
      raise exception 'Stock item % not found or inaccessible', v_line.stock_id using errcode = 'P0002';
    end if;
    if coalesce(v_stock.quantity, 0) < v_line.qty then
      raise exception 'Insufficient stock for item % (available %, requested %)',
        v_line.stock_id, coalesce(v_stock.quantity, 0), v_line.qty using errcode = '23514';
    end if;
    update public.stock set quantity = coalesce(quantity, 0) - v_line.qty::integer,
      updated_at = now() where id = v_line.stock_id and organisation_id = v_org;
    insert into public.work_order_stock_reservation_lines(reservation_id, stock_id, quantity)
      values (v_reservation.id, v_line.stock_id, v_line.qty::integer);
  end loop;

  return jsonb_build_object('reservation_id', v_reservation.id,
    'work_order_id', p_work_order_id, 'status', 'reserved', 'idempotent', false,
    'line_count', (select count(*) from public.work_order_stock_reservation_lines
                   where reservation_id = v_reservation.id));
exception when unique_violation then
  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object('reservation_id', v_reservation.id,
      'work_order_id', v_reservation.work_order_id, 'status', v_reservation.status,
      'idempotent', true);
  end if;
  raise;
end $$;

create or replace function private.release_work_order_stock_internal(
  p_work_order_id uuid, p_reason text
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_actor uuid := auth.uid();
  v_reservation public.work_order_stock_reservations;
  v_line record;
begin
  if v_actor is null or v_org is null then
    raise exception 'Authentication and organisation membership are required' using errcode = '42501';
  end if;
  select * into v_reservation from public.work_order_stock_reservations
   where organisation_id = v_org and work_order_id = p_work_order_id and status = 'reserved'
   for update;
  if not found then
    return jsonb_build_object('work_order_id', p_work_order_id, 'status', 'not_reserved', 'released', false);
  end if;

  for v_line in
    select stock_id, quantity from public.work_order_stock_reservation_lines
    where reservation_id = v_reservation.id order by stock_id
  loop
    perform 1 from public.stock where id = v_line.stock_id and organisation_id = v_org for update;
    if not found then
      raise exception 'Reserved stock item % is no longer available to this tenant', v_line.stock_id
        using errcode = 'P0002';
    end if;
    update public.stock set quantity = coalesce(quantity, 0) + v_line.quantity,
      updated_at = now() where id = v_line.stock_id and organisation_id = v_org;
  end loop;
  update public.work_order_stock_reservations
  set status = 'released', released_by = v_actor, released_at = now(),
      release_reason = nullif(left(btrim(p_reason), 500), '')
  where id = v_reservation.id;
  return jsonb_build_object('reservation_id', v_reservation.id,
    'work_order_id', p_work_order_id, 'status', 'released', 'released', true);
end $$;

revoke all on function private.reserve_work_order_stock_internal(uuid,jsonb,text) from public, anon;
revoke all on function private.release_work_order_stock_internal(uuid,text) from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.reserve_work_order_stock_internal(uuid,jsonb,text) to authenticated;
grant execute on function private.release_work_order_stock_internal(uuid,text) to authenticated;

create or replace function public.reserve_work_order_stock(
  p_work_order_id uuid, p_lines jsonb, p_idempotency_key text
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.reserve_work_order_stock_internal(p_work_order_id, p_lines, p_idempotency_key)
$$;
create or replace function public.release_work_order_stock(
  p_work_order_id uuid, p_reason text default null
) returns jsonb language sql security invoker set search_path = '' as $$
  select private.release_work_order_stock_internal(p_work_order_id, p_reason)
$$;
revoke all on function public.reserve_work_order_stock(uuid,jsonb,text) from public, anon;
revoke all on function public.release_work_order_stock(uuid,text) from public, anon;
grant execute on function public.reserve_work_order_stock(uuid,jsonb,text) to authenticated;
grant execute on function public.release_work_order_stock(uuid,text) to authenticated;

-- Postgres Changes publication. This does not modify the locked realtime schema.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'action_items') then
      alter publication supabase_realtime add table public.action_items;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'action_item_history') then
      alter publication supabase_realtime add table public.action_item_history;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
                   and schemaname = 'public' and tablename = 'shift_handovers') then
      alter publication supabase_realtime add table public.shift_handovers;
    end if;
  end if;
end $$;
