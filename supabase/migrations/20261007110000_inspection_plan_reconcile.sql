-- 20261007110000_inspection_plan_reconcile
--
-- WHY (review of 20261007090000, Codex P1, verified)
--   That migration kept inspection_schedules.status in step in ONE direction only:
--   an inspection becoming Done marked its plan Completed. Two paths left the
--   stored status wrong while get_schedule_adherence (derived live) was right:
--     1. A plan created AFTER an already-Done inspection inside the 7-day early
--        window stayed 'Scheduled' (plan uploads cover days already inspected).
--     2. Deleting a Done inspection, or one leaving Done / moving asset or date,
--        left its plan 'Completed' with no evidence behind it.
--   Also: a new or cancelled plan moves the boundary of the plan before it.
--
-- FIX
--   * ONE matching definition, inspection_plan_best_match(plan_id), used by both
--     get_schedule_adherence and the reconciler, so they cannot drift.
--   * inspection_schedules.completed_inspection_id records WHICH inspection
--     completed a plan. Only plans the system completed (id not null) are ever
--     reopened; a plan someone set Completed by hand (id null) is never touched.
--   * reconcile_inspection_plans(org, asset) recomputes every non-cancelled plan
--     of one asset. Called from triggers on BOTH tables, for the old and new
--     asset of the row. pg_trigger_depth() guard stops the schedules trigger
--     re-entering when the reconciler itself updates plans.
--   * Failures never block the write; they are logged to system_logs.
--
-- PRE-FLIGHT
--   Additive column (nullable, no default) on a 245-row table. No data loss.
--   get_schedule_adherence: same signature and columns; output re-verified
--   identical before/after (state counts Done 9 / Due 42 / Missed 160 /
--   Started 2 / Upcoming 32).
--   Supersedes trg_complete_inspection_plans (20261007090000): it is DISABLED,
--   not dropped (a DROP inside an MCP migration stalls on approval and times
--   out). Drop it and complete_inspection_plans_on_done() in a later cleanup.
--   SECURITY DEFINER fns: pinned search_path, scoped by org passed from the row,
--   revoked from public/anon/authenticated (internal only).
--   Backfill: completed_inspection_id set on the 9 plans 20261007090000 completed.
--
-- ROLLBACK
--   drop trigger trg_reconcile_plans_on_inspection on public.inspections;
--   drop trigger trg_reconcile_plans_on_schedule on public.inspection_schedules;
--   re-apply get_schedule_adherence + trigger from 20261007090000;
--   alter table public.inspection_schedules drop column completed_inspection_id;
--   drop function public.reconcile_inspection_plans(uuid, text),
--     public.reconcile_plans_on_inspection(), public.reconcile_plans_on_schedule(),
--     public.inspection_plan_best_match(uuid);

alter table public.inspection_schedules add column if not exists completed_inspection_id uuid;
comment on column public.inspection_schedules.completed_inspection_id is
  'Inspection that completed this plan automatically (reconcile_inspection_plans). Null = not completed by the system.';

-- ── The one matching rule ────────────────────────────────────────────────────
create or replace function public.inspection_plan_best_match(p_plan_id uuid)
returns table(id uuid, inspection_date date, status text, inspector text)
language sql
stable
set search_path to 'public'
as $function$
  select i.id, i.inspection_date, i.status, i.inspector
  from public.inspection_schedules p
  join public.inspections i
    on upper(btrim(i.asset_no)) = upper(btrim(p.asset_no))
   and i.organisation_id is not distinct from p.organisation_id
   and (i.country is null or p.country is null or i.country = p.country)
   and i.inspection_date >= p.scheduled_date - public.inspection_plan_early_days()
  where p.id = p_plan_id
    and not exists (
      select 1 from public.inspection_schedules q
      where q.id <> p.id
        and upper(btrim(q.asset_no)) = upper(btrim(p.asset_no))
        and q.organisation_id is not distinct from p.organisation_id
        and (q.country is null or p.country is null or q.country = p.country)
        and lower(coalesce(q.status, '')) not in ('cancelled', 'canceled')
        and q.scheduled_date > p.scheduled_date
        and q.scheduled_date <= i.inspection_date
    )
  order by (lower(coalesce(i.status, '')) = 'done') desc,
           abs(i.inspection_date - p.scheduled_date) asc, i.inspection_date asc, i.id asc
  limit 1
$function$;

-- ── Adherence reads the shared rule ─────────────────────────────────────────
create or replace function public.get_schedule_adherence(p_country text default null::text, p_from date default null::date, p_to date default null::date)
 returns table(id uuid, asset_no text, site text, country text, scheduled_date date, inspection_time text, inspection_type text, priority text, raw_status text, notes text, team text, plan_ref text, grace_days integer, assigned_to uuid, assigned_name text, inspector_name text, vehicle_type text, matched_inspection_id uuid, matched_date date, matched_status text, matched_inspector text, plan_state text, days_late integer)
 language sql
 stable
 set search_path to 'public'
as $function$
  with bounds as (
    select
      coalesce(p_from, (now() at time zone 'UTC')::date - 30) as d_from,
      coalesce(p_to,   (now() at time zone 'UTC')::date + 30) as d_to,
      (now() at time zone 'UTC')::date                        as today
  ),
  plans as (
    select s.*, b.today
    from public.inspection_schedules s cross join bounds b
    where s.scheduled_date between b.d_from and b.d_to
      and (p_country is null or p_country = 'All' or s.country is null or s.country = p_country)
  )
  select
    p.id,
    p.asset_no,
    coalesce(p.site, f.site)                      as site,
    p.country,
    p.scheduled_date,
    p.inspection_time,
    p.inspection_type,
    p.priority,
    p.status                                      as raw_status,
    p.notes,
    p.team,
    p.plan_ref,
    coalesce(p.grace_days, 2)                     as grace_days,
    p.assigned_to,
    pr.full_name                                  as assigned_name,
    p.inspector_name,
    f.vehicle_type,
    m.id                                          as matched_inspection_id,
    m.inspection_date                             as matched_date,
    m.status                                      as matched_status,
    m.inspector                                   as matched_inspector,
    public.inspection_plan_state(p.scheduled_date, p.grace_days, p.status, m.status, p.today) as plan_state,
    case
      when m.inspection_date is not null then greatest(0, (m.inspection_date - p.scheduled_date))::integer
      when p.today > p.scheduled_date then (p.today - p.scheduled_date)::integer
      else 0
    end                                           as days_late
  from plans p
  left join lateral public.inspection_plan_best_match(p.id) m on true
  left join public.profiles pr on pr.id = p.assigned_to
  left join lateral (
    select f.site, f.vehicle_type
    from public.vehicle_fleet f
    where upper(btrim(f.asset_no)) = upper(btrim(p.asset_no))
    order by (f.country is not distinct from p.country) desc, f.id
    limit 1
  ) f on true
  order by p.scheduled_date asc, p.asset_no asc
$function$;

-- ── Two-way reconciler for one asset ─────────────────────────────────────────
create or replace function public.reconcile_inspection_plans(p_org uuid, p_asset text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if p_asset is null or btrim(p_asset) = '' then return; end if;
  with plans as (
    select s.id, s.status, s.completed_inspection_id,
           (select m.id from public.inspection_plan_best_match(s.id) m
             where lower(coalesce(m.status, '')) = 'done') as done_id
    from public.inspection_schedules s
    where upper(btrim(s.asset_no)) = upper(btrim(p_asset))
      and s.organisation_id is not distinct from p_org
      and lower(coalesce(s.status, '')) not in ('cancelled', 'canceled')
  )
  update public.inspection_schedules s
     set status = case when p.done_id is not null then 'Completed' else 'Scheduled' end,
         completed_inspection_id = p.done_id
    from plans p
   where s.id = p.id
     and (
       -- evidence exists: complete an open plan, or re-point a system completion
       (p.done_id is not null and (
          lower(coalesce(p.status, 'scheduled')) in ('scheduled', 'in progress', '')
          or (p.completed_inspection_id is not null and p.completed_inspection_id <> p.done_id)))
       -- evidence gone: reopen only what the system completed
       or (p.done_id is null and p.completed_inspection_id is not null)
     );
end;
$function$;

create or replace function public.reconcile_plans_on_inspection()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  begin
    if TG_OP in ('INSERT', 'UPDATE') then
      perform public.reconcile_inspection_plans(NEW.organisation_id, NEW.asset_no);
    end if;
    if TG_OP in ('UPDATE', 'DELETE') and (TG_OP = 'DELETE'
        or OLD.asset_no is distinct from NEW.asset_no
        or OLD.organisation_id is distinct from NEW.organisation_id) then
      perform public.reconcile_inspection_plans(OLD.organisation_id, OLD.asset_no);
    end if;
  exception when others then
    begin
      insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
      values (coalesce(NEW.organisation_id, OLD.organisation_id), 'inspection_planner', 'error',
              'reconcile_plans_on_inspection', 'Plan status could not be reconciled', jsonb_build_object('sqlstate', SQLSTATE));
    exception when others then null;
    end;
  end;
  return null;
end;
$function$;

create or replace function public.reconcile_plans_on_schedule()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  -- The reconciler updates inspection_schedules itself; do not re-enter.
  if pg_trigger_depth() > 1 then return null; end if;
  begin
    if TG_OP in ('INSERT', 'UPDATE') then
      perform public.reconcile_inspection_plans(NEW.organisation_id, NEW.asset_no);
    end if;
    if TG_OP in ('UPDATE', 'DELETE') and (TG_OP = 'DELETE'
        or OLD.asset_no is distinct from NEW.asset_no
        or OLD.organisation_id is distinct from NEW.organisation_id) then
      perform public.reconcile_inspection_plans(OLD.organisation_id, OLD.asset_no);
    end if;
  exception when others then
    begin
      insert into public.system_logs (organisation_id, module_id, severity, source, message, detail)
      values (coalesce(NEW.organisation_id, OLD.organisation_id), 'inspection_planner', 'error',
              'reconcile_plans_on_schedule', 'Plan status could not be reconciled', jsonb_build_object('sqlstate', SQLSTATE));
    exception when others then null;
    end;
  end;
  return null;
end;
$function$;

revoke all on function public.reconcile_inspection_plans(uuid, text) from public, anon, authenticated;
revoke all on function public.reconcile_plans_on_inspection() from public, anon, authenticated;
revoke all on function public.reconcile_plans_on_schedule() from public, anon, authenticated;
revoke all on function public.inspection_plan_best_match(uuid) from public, anon;
grant execute on function public.inspection_plan_best_match(uuid) to authenticated, service_role;

create trigger trg_reconcile_plans_on_inspection
  after insert or update of status, inspection_date, asset_no, country, organisation_id or delete
  on public.inspections
  for each row execute function public.reconcile_plans_on_inspection();

create trigger trg_reconcile_plans_on_schedule
  after insert or update of scheduled_date, asset_no, status, country, organisation_id or delete
  on public.inspection_schedules
  for each row execute function public.reconcile_plans_on_schedule();

-- The one-way trigger from 20261007090000 is superseded.
alter table public.inspections disable trigger trg_complete_inspection_plans;

-- Backfill: the 9 plans 20261007090000 completed were system completions.
update public.inspection_schedules s
   set completed_inspection_id = m.id
  from _bak.inspection_plan_complete_20261007 b
  cross join lateral public.inspection_plan_best_match(b.id) m
 where s.id = b.id and s.status = 'Completed' and lower(coalesce(m.status, '')) = 'done'
   and s.completed_inspection_id is null;
