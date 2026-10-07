-- 20261007090000_inspection_plan_match_window
--
-- WHY
--   A signed and approved inspection still showed its plan as "Missed"/"Overdue".
--   get_schedule_adherence() matched an inspection to a plan ONLY when it was done
--   on the plan day or up to grace_days (default 2) after. Measured 2026-10-07:
--   TM666 planned 27 Sep, approved inspection 24 Sep -> Missed; MP079 planned
--   30 Sep, approved 3 Oct -> Missed; PL067, TM706, BH022, PL088 the same.
--   Separately, nothing ever moved inspection_schedules.status off 'Scheduled'
--   (245 of 245 plans), so the web planner's per-inspector "Missed" counted
--   every past plan, inspected or not.
--
-- RULE (one definition, used by the RPC AND the trigger)
--   An inspection completes a plan for the same asset when it is done from
--   7 days BEFORE the plan date (inspection_plan_early_days()) up to the day
--   before the NEXT non-cancelled plan for that asset (no next plan = open).
--   Same organisation; country must agree when both are set (the same asset
--   code is a different machine in another country, V376).
--   grace_days still decides when an UNMATCHED plan turns from Due to Missed.
--   One inspection a few days before a plan can satisfy both the previous
--   (late) plan and that one (early): the vehicle was inspected, both count.
--
-- PRE-FLIGHT
--   Data loss: none. Backfill only sets status Scheduled/In Progress ->
--     'Completed' on plans the new rule matches to a Done inspection. Prior
--     status snapshotted in _bak.inspection_plan_complete_20261007.
--   Two record fixes (owner approved): PL053 157fa28c status Done + rejected
--     -> In Progress, unlocked; TM402 8c652d05 rejected but locked -> unlocked.
--     Snapshotted in _bak.inspection_fix_20261007. trg_lock_inspection_content
--     is disabled ONLY for that one UPDATE and re-enabled in the same txn
--     (the MCP session has no profile, so the lock trigger refuses it).
--   Rename/removal: none. RPC signature and output columns unchanged, so the
--     web board and every Flutter build keep working with no release.
--   CHECK: inspection_schedules has no status CHECK ('Completed' already used
--     by the web planner vocabulary).
--   Locks/duration: 245 plans, ~1.7k inspections. Trivial.
--   Triggers fired by the backfill: trg_inspection_schedules_updated_at,
--     trg_notify_plan_assigned_update (only notifies on assigned_to change).
--   SECURITY DEFINER: complete_inspection_plans_on_done() runs as a trigger,
--     pinned search_path, scoped to NEW.organisation_id, never raises (an
--     approval must not fail because a plan could not be updated). Trigger
--     functions need no EXECUTE grant; revoked from public/anon/authenticated.
--   get_schedule_adherence stays SECURITY INVOKER (RLS still applies).
--
-- ROLLBACK
--   drop trigger if exists trg_complete_inspection_plans on public.inspections;
--   drop function if exists public.complete_inspection_plans_on_done();
--   re-apply get_schedule_adherence from 20260921074351_inspection_plan_adherence.sql;
--   update public.inspection_schedules s set status = b.old_status
--     from _bak.inspection_plan_complete_20261007 b where b.id = s.id;
--   drop function if exists public.inspection_plan_early_days();
--   (record fixes: restore status/locked from _bak.inspection_fix_20261007,
--    with trg_lock_inspection_content disabled for that statement.)

create or replace function public.inspection_plan_early_days()
returns integer language sql immutable parallel safe as $$ select 7 $$;
alter function public.inspection_plan_early_days() set search_path = '';

-- ── Adherence: the new matching window ───────────────────────────────────────
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
  ),
  matched as (
    select
      p.id as plan_id,
      i.id as insp_id,
      i.inspection_date,
      i.status as insp_status,
      i.inspector
    from plans p
    left join lateral (
      select i.id, i.inspection_date, i.status, i.inspector
      from public.inspections i
      where upper(btrim(i.asset_no)) = upper(btrim(p.asset_no))
        and i.organisation_id is not distinct from p.organisation_id
        and (i.country is null or p.country is null or i.country = p.country)
        and i.inspection_date >= p.scheduled_date - public.inspection_plan_early_days()
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
    ) i on true
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
    m.insp_id                                     as matched_inspection_id,
    m.inspection_date                             as matched_date,
    m.insp_status                                 as matched_status,
    m.inspector                                   as matched_inspector,
    public.inspection_plan_state(p.scheduled_date, p.grace_days, p.status, m.insp_status, p.today) as plan_state,
    case
      when m.inspection_date is not null then greatest(0, (m.inspection_date - p.scheduled_date))::integer
      when p.today > p.scheduled_date then (p.today - p.scheduled_date)::integer
      else 0
    end                                           as days_late
  from plans p
  left join matched m   on m.plan_id = p.id
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

-- ── Trigger: a finished inspection marks its plan(s) Completed ───────────────
create or replace function public.complete_inspection_plans_on_done()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if NEW.status is distinct from 'Done' or NEW.inspection_date is null or NEW.asset_no is null then
    return null;
  end if;
  if TG_OP = 'UPDATE' and OLD.status is not distinct from 'Done'
     and OLD.inspection_date is not distinct from NEW.inspection_date
     and OLD.asset_no is not distinct from NEW.asset_no then
    return null;
  end if;
  begin
    update public.inspection_schedules p
       set status = 'Completed'
     where upper(btrim(p.asset_no)) = upper(btrim(NEW.asset_no))
       and p.organisation_id is not distinct from NEW.organisation_id
       and (p.country is null or NEW.country is null or p.country = NEW.country)
       and lower(coalesce(p.status, 'scheduled')) in ('scheduled', 'in progress', '')
       and NEW.inspection_date >= p.scheduled_date - public.inspection_plan_early_days()
       and not exists (
         select 1 from public.inspection_schedules q
         where q.id <> p.id
           and upper(btrim(q.asset_no)) = upper(btrim(p.asset_no))
           and q.organisation_id is not distinct from p.organisation_id
           and (q.country is null or p.country is null or q.country = p.country)
           and lower(coalesce(q.status, '')) not in ('cancelled', 'canceled')
           and q.scheduled_date > p.scheduled_date
           and q.scheduled_date <= NEW.inspection_date
       );
  exception when others then
    null;
  end;
  return null;
end;
$function$;

revoke all on function public.complete_inspection_plans_on_done() from public;
revoke all on function public.complete_inspection_plans_on_done() from anon;
revoke all on function public.complete_inspection_plans_on_done() from authenticated;

create trigger trg_complete_inspection_plans
  after insert or update of status, inspection_date, asset_no on public.inspections
  for each row execute function public.complete_inspection_plans_on_done();

-- ── Backfill: plans the new rule already matches to a Done inspection ───────
create schema if not exists _bak;
create table if not exists _bak.inspection_plan_complete_20261007 as
  select s.id, s.status as old_status, now() as snapped_at
  from public.inspection_schedules s
  join public.get_schedule_adherence(null, date '2000-01-01', date '2100-12-31') a on a.id = s.id
  where a.plan_state = 'Done'
    and lower(coalesce(s.status, 'scheduled')) in ('scheduled', 'in progress', '');

update public.inspection_schedules s
   set status = 'Completed'
  from _bak.inspection_plan_complete_20261007 b
 where b.id = s.id;

-- ── Two inconsistent inspection records (owner approved) ────────────────────
create table if not exists _bak.inspection_fix_20261007 as
  select id, status, locked, locked_at, now() as snapped_at
  from public.inspections
  where id in ('157fa28c-1215-4730-9851-beff30761fd6', '8c652d05-5bc5-4d7c-a412-f7d088a2edb5');

alter table public.inspections disable trigger trg_lock_inspection_content;
update public.inspections
   set status = 'In Progress', locked = false, locked_at = null
 where id = '157fa28c-1215-4730-9851-beff30761fd6' and approval_status = 'rejected';
update public.inspections
   set locked = false, locked_at = null
 where id = '8c652d05-5bc5-4d7c-a412-f7d088a2edb5' and approval_status = 'rejected';
alter table public.inspections enable trigger trg_lock_inspection_content;
