-- ============================================================================
-- Feature Flags (Control Center, Engineering area)
-- ----------------------------------------------------------------------------
-- Additive only. Nothing dropped, no module row rewritten.
--
-- 1. modules gains kind ('release' | 'permission' | 'kill_switch'),
--    created_at and review_after (all nullable). Existing rows keep NULL:
--    their kind is derived in the UI from the item type and their creation
--    date is honestly unknown. created_at defaults to now() for NEW rows only
--    (the default is set after the column is added, so no backfill happens).
-- 2. flag_changes: a scheduled or approval-waiting change to a module state
--    or a platform switch. Super admin read; written only by the RPCs below.
--    admin_schedule_flag_change  schedule (or queue for approval when dual
--                                control is on) with a reason, audited.
--    admin_approve_flag_change   a DIFFERENT super admin approves (dual control).
--    admin_cancel_flag_change    cancel before it runs, with a reason.
--    apply_due_flag_changes()    cron "flag-changes-apply" every minute applies
--                                due, approved rows; no client role can call it.
-- 3. admin_flag_usage()  real usage behind the stale detection and the impact
--    lines: people per role, members per organization, org overrides stored,
--    wash records 30 days, AI calls 35 days + last call, subscriptions, new
--    records in 24 h on the four busiest tables, dual control state.
--
-- Pre-flight: modules is ~194 rows, nullable columns without defaults (no
-- rewrite); modules_status_check already allows live/maintenance/disabled.
-- New table flag_changes: RLS on, super-admin read, no client writes, no anon.
-- No org argument on any DEFINER function; every DEFINER function has a pinned
-- search_path and an in-body is_super_admin() gate (the cron applier has no
-- client grant at all).
--
-- Rollback:
--   select cron.unschedule('flag-changes-apply');
--   drop function public.apply_due_flag_changes(), public.admin_schedule_flag_change(text,text,text,timestamptz,text),
--     public.admin_approve_flag_change(uuid), public.admin_cancel_flag_change(uuid,text), public.admin_flag_usage();
--   drop table public.flag_changes;
--   alter table public.modules drop constraint modules_kind_check;  (columns may stay)
-- ============================================================================

-- ── 1. kind and expected life ───────────────────────────────────────────────
alter table public.modules add column if not exists kind text;
alter table public.modules add column if not exists created_at timestamptz;
alter table public.modules add column if not exists review_after date;
alter table public.modules alter column created_at set default now();
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'modules_kind_check') then
    alter table public.modules add constraint modules_kind_check
      check (kind is null or kind in ('release', 'permission', 'kill_switch'));
  end if;
end $$;

-- ── 2. scheduled changes ────────────────────────────────────────────────────
create table if not exists public.flag_changes (
  id            uuid primary key default gen_random_uuid(),
  target_type   text not null check (target_type in ('module', 'config')),
  target_key    text not null,
  new_state     text not null,
  run_at        timestamptz not null,
  status        text not null default 'scheduled'
                check (status in ('scheduled', 'awaiting_approval', 'applied', 'cancelled', 'failed')),
  reason        text not null,
  requested_by  uuid default auth.uid(),
  approved_by   uuid,
  approved_at   timestamptz,
  cancelled_by  uuid,
  cancel_reason text,
  applied_at    timestamptz,
  error         text,
  created_at    timestamptz not null default now(),
  constraint flag_changes_two_people check (approved_by is null or approved_by <> requested_by)
);
create index if not exists flag_changes_due_idx on public.flag_changes (status, run_at);
alter table public.flag_changes enable row level security;
drop policy if exists flag_changes_read on public.flag_changes;
create policy flag_changes_read on public.flag_changes for select to authenticated using (public.is_super_admin());
revoke all on public.flag_changes from anon;
revoke insert, update, delete, truncate on public.flag_changes from authenticated;

create or replace function public._flag_state_valid(p_type text, p_state text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_type = 'module' then p_state in ('live', 'maintenance', 'disabled')
    when p_type = 'config' then p_state in ('true', 'false')
    else false end
$$;
revoke all on function public._flag_state_valid(text, text) from public, anon;
grant execute on function public._flag_state_valid(text, text) to authenticated;

create or replace function public.admin_schedule_flag_change(
  p_target_type text, p_target_key text, p_new_state text, p_run_at timestamptz, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_status text;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can schedule a flag change' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  if not public._flag_state_valid(p_target_type, p_new_state) then
    raise exception 'That state is not valid for this item.' using errcode = '22023';
  end if;
  if p_target_type = 'module' and not exists (select 1 from public.modules where module_id = p_target_key) then
    raise exception 'That module does not exist.' using errcode = '22023';
  end if;
  if p_target_type = 'config' and not exists (select 1 from public.system_config where key = p_target_key) then
    raise exception 'That platform switch does not exist.' using errcode = '22023';
  end if;
  if p_run_at is null or p_run_at < now() - interval '1 minute' then
    raise exception 'Pick a time that is now or later.' using errcode = '22023';
  end if;
  v_status := case when public._dual_control_on() then 'awaiting_approval' else 'scheduled' end;
  insert into public.flag_changes (target_type, target_key, new_state, run_at, status, reason, requested_by)
  values (p_target_type, p_target_key, p_new_state, p_run_at, v_status, btrim(p_reason), auth.uid())
  returning id into v_id;
  perform public.log_console_event('flag_change_scheduled', null, 'flag_change',
    jsonb_build_object('id', v_id, 'target_type', p_target_type, 'target', p_target_key, 'state', p_new_state,
                       'run_at', p_run_at, 'status', v_status, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', v_status);
end $$;
revoke all on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) from public;
revoke all on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) from anon;
grant execute on function public.admin_schedule_flag_change(text, text, text, timestamptz, text) to authenticated;

create or replace function public.admin_approve_flag_change(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v public.flag_changes;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can approve a flag change' using errcode = '42501';
  end if;
  select * into v from public.flag_changes where id = p_id for update;
  if v.id is null or v.status <> 'awaiting_approval' then
    raise exception 'This change is not waiting for approval.' using errcode = '22023';
  end if;
  if v.requested_by = auth.uid() then
    raise exception 'A second super admin must approve this change.' using errcode = '42501';
  end if;
  update public.flag_changes set status = 'scheduled', approved_by = auth.uid(), approved_at = now() where id = p_id;
  perform public.log_console_event('flag_change_approved', null, 'flag_change', jsonb_build_object('id', p_id));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.admin_approve_flag_change(uuid) from public;
revoke all on function public.admin_approve_flag_change(uuid) from anon;
grant execute on function public.admin_approve_flag_change(uuid) to authenticated;

create or replace function public.admin_cancel_flag_change(p_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can cancel a flag change' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'Give a reason of at least 5 characters.' using errcode = '22023';
  end if;
  update public.flag_changes
     set status = 'cancelled', cancelled_by = auth.uid(), cancel_reason = btrim(p_reason)
   where id = p_id and status in ('scheduled', 'awaiting_approval');
  if not found then
    raise exception 'This change already ran or was cancelled.' using errcode = '22023';
  end if;
  perform public.log_console_event('flag_change_cancelled', null, 'flag_change',
    jsonb_build_object('id', p_id, 'reason', btrim(p_reason)));
  return jsonb_build_object('ok', true, 'id', p_id);
end $$;
revoke all on function public.admin_cancel_flag_change(uuid, text) from public;
revoke all on function public.admin_cancel_flag_change(uuid, text) from anon;
grant execute on function public.admin_cancel_flag_change(uuid, text) to authenticated;

create or replace function public.apply_due_flag_changes()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare r public.flag_changes; n int := 0; f int := 0;
begin
  for r in select * from public.flag_changes where status = 'scheduled' and run_at <= now() order by run_at limit 50 for update skip locked loop
    begin
      if r.target_type = 'module' then
        update public.modules set status = r.new_state, last_updated = now(),
          maintenance_note = case when r.new_state = 'maintenance' then left(r.reason, 500) else maintenance_note end
         where module_id = r.target_key;
      else
        update public.system_config set value = r.new_state, updated_at = now() where key = r.target_key;
      end if;
      update public.flag_changes set status = 'applied', applied_at = now() where id = r.id;
      n := n + 1;
    exception when others then
      update public.flag_changes set status = 'failed', error = left(sqlerrm, 300), applied_at = now() where id = r.id;
      f := f + 1;
    end;
  end loop;
  return jsonb_build_object('ok', true, 'applied', n, 'failed', f);
end $$;
revoke all on function public.apply_due_flag_changes() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if exists (select 1 from cron.job where jobname = 'flag-changes-apply') then
      perform cron.unschedule('flag-changes-apply');
    end if;
    perform cron.schedule('flag-changes-apply', '* * * * *', 'select public.apply_due_flag_changes();');
  end if;
end $$;

-- ── 3. usage behind stale detection and impact lines ───────────────────────
create or replace function public.admin_flag_usage()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  if not public.is_super_admin() then
    raise exception 'Only a super admin can read flag usage' using errcode = '42501';
  end if;
  select jsonb_build_object(
    'ok', true,
    'roles', coalesce((select jsonb_agg(jsonb_build_object('role', role, 'people', n) order by n desc, role)
                         from (select role, count(*) n from public.profiles
                                where coalesce(approved, false) and not coalesce(locked, false) and role is not null
                                group by role) r), '[]'::jsonb),
    'orgs', coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
                                'members', (select count(*) from public.profiles p where p.org_id = o.id),
                                'overrides', case when jsonb_typeof(o.settings -> 'feature_flags') = 'object'
                                                  then (select count(*) from jsonb_object_keys(o.settings -> 'feature_flags')) else 0 end)
                                order by o.name)
                        from public.organisations o), '[]'::jsonb),
    'wash_30d', (select count(*) from public.wash_records where created_at >= now() - interval '30 days'),
    'ai_calls_35d', (select count(*) from public.ai_token_logs where created_at >= now() - interval '35 days'),
    'ai_last', (select max(created_at) from public.ai_token_logs),
    'subscriptions', (select count(*) from public.org_subscriptions),
    'new_24h', jsonb_build_object(
      'tyre_records', (select count(*) from public.tyre_records where created_at >= now() - interval '24 hours'),
      'inspections', (select count(*) from public.inspections where created_at >= now() - interval '24 hours'),
      'work_orders', (select count(*) from public.work_orders where created_at >= now() - interval '24 hours'),
      'accidents', (select count(*) from public.accidents where created_at >= now() - interval '24 hours')
    ),
    'dual_control', public._dual_control_on(),
    'dual_control_changed_at', (select updated_at from public.system_config where key = 'dual_control_enabled')
  ) into v;
  return v;
end $$;
revoke all on function public.admin_flag_usage() from public;
revoke all on function public.admin_flag_usage() from anon;
grant execute on function public.admin_flag_usage() to authenticated;
