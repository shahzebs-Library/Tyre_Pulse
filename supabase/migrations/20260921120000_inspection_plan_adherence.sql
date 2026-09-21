-- Inspection planning: team assignment, bulk upload batches, and adherence.
--
-- WHY. `inspection_schedules` held 1 row while 1,341 inspections had been
-- carried out, i.e. the fleet was inspected reactively and nothing could be
-- reported as planned or missed. Three things were missing and are added here:
--   1. a plan can name the PERSON and TEAM that must do it (it only ever held
--      a free-text inspector name),
--   2. a plan carries the upload batch that created it, so a spreadsheet load
--      is traceable and reversible,
--   3. plan adherence (done / started / missed) is DERIVED, never stored, so
--      it can never go stale.
--
-- Additive only: every column is nullable or defaulted, and no existing column,
-- policy or trigger is altered. Existing rows keep working unchanged.

-- 1. Assignment + batch columns -------------------------------------------
alter table public.inspection_schedules
  add column if not exists assigned_to uuid references public.profiles(id) on delete set null,
  add column if not exists team        text,
  add column if not exists plan_ref    text,
  add column if not exists grace_days  integer not null default 2;

comment on column public.inspection_schedules.assigned_to is
  'Profile that must carry out this plan. inspector_name stays as the free-text label for legacy rows and for people without an account.';
comment on column public.inspection_schedules.team is
  'Crew/team label used to group a plan. Free text so a company can use its own crew names.';
comment on column public.inspection_schedules.plan_ref is
  'Batch reference of the upload that created this plan. Lets one spreadsheet load be found and undone as a unit.';
comment on column public.inspection_schedules.grace_days is
  'Days after the planned date that still count as done. Past this with no inspection, the plan reads as missed.';

alter table public.inspection_schedules
  drop constraint if exists inspection_schedules_grace_days_chk;
alter table public.inspection_schedules
  add constraint inspection_schedules_grace_days_chk check (grace_days between 0 and 30);

create index if not exists inspection_schedules_org_country_date_idx
  on public.inspection_schedules (organisation_id, country, scheduled_date);
create index if not exists inspection_schedules_assigned_to_idx
  on public.inspection_schedules (assigned_to) where assigned_to is not null;
create index if not exists inspection_schedules_plan_ref_idx
  on public.inspection_schedules (plan_ref) where plan_ref is not null;

-- 2. The one definition of a plan's state ----------------------------------
-- MIRROR: src/lib/schedulePlan.js planState(). Change both together;
-- src/test/schedulePlan.test.js pins the shared case table.
create or replace function public.inspection_plan_state(
  p_scheduled_date date,
  p_grace_days integer,
  p_status text,
  p_matched_status text,
  p_today date
) returns text
language sql
immutable
as $$
  select case
    when lower(coalesce(p_status, '')) = 'cancelled' then 'Cancelled'
    when p_matched_status is null and p_scheduled_date is null then 'Upcoming'
    when lower(coalesce(p_matched_status, '')) = 'done' then 'Done'
    when p_matched_status is not null then 'Started'
    when p_today > p_scheduled_date + make_interval(days => coalesce(p_grace_days, 2)) then 'Missed'
    when p_today >= p_scheduled_date then 'Due'
    else 'Upcoming'
  end
$$;

comment on function public.inspection_plan_state(date, integer, text, text, date) is
  'Plan state from its date, grace window and the inspection that matched it. Done beats Started beats Missed. No stored state, so it cannot go stale.';

-- 3. Adherence: what was planned, what got done, what was missed ------------
-- SECURITY INVOKER on purpose. RLS runs for the caller, so a country argument
-- can only NARROW what they already see, never widen it (the V585 rule). A
-- DEFINER function here would step outside org/country isolation.
--
-- MATCHING RULE, stated because it is a real limit: an inspection carries no
-- link back to the plan that asked for it, so a plan counts as carried out when
-- THAT VEHICLE has an inspection dated inside the plan's window
-- [scheduled_date, scheduled_date + grace_days]. An inspection before the
-- planned date does not close the plan - the plan has not come due yet.
create or replace function public.get_schedule_adherence(
  p_country text default null,
  p_from date default null,
  p_to date default null
) returns table (
  id uuid,
  asset_no text,
  site text,
  country text,
  scheduled_date date,
  inspection_time text,
  inspection_type text,
  priority text,
  raw_status text,
  notes text,
  team text,
  plan_ref text,
  grace_days integer,
  assigned_to uuid,
  assigned_name text,
  inspector_name text,
  vehicle_type text,
  matched_inspection_id uuid,
  matched_date date,
  matched_status text,
  matched_inspector text,
  plan_state text,
  days_late integer
)
language sql
stable
security invoker
set search_path = public
as $$
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
        and i.inspection_date >= p.scheduled_date
        and i.inspection_date <= p.scheduled_date + make_interval(days => coalesce(p.grace_days, 2))
      -- a finished inspection closes the plan ahead of one still in progress
      order by (lower(coalesce(i.status, '')) = 'done') desc, i.inspection_date asc, i.id asc
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
$$;

comment on function public.get_schedule_adherence(text, date, date) is
  'One row per inspection plan in the window with the inspection that fulfilled it and the resulting state. SECURITY INVOKER so org/country RLS applies to the caller.';

revoke all on function public.get_schedule_adherence(text, date, date) from public;
grant execute on function public.get_schedule_adherence(text, date, date) to authenticated, service_role;

-- 4. Coverage: which vehicles are in the plan, and which are not ------------
-- Answers "which vehicle will we get in the schedule" per site, so a planner
-- can see where the plan does not reach before deciding what to schedule.
create or replace function public.get_plan_coverage(
  p_country text default null,
  p_horizon_days integer default 30
) returns table (
  site text,
  active_assets integer,
  planned_assets integer,
  inspected_recently integer,
  never_inspected integer,
  overdue_assets integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select (now() at time zone 'UTC')::date as today,
           greatest(1, least(coalesce(p_horizon_days, 30), 365)) as horizon
  ),
  fleet as (
    select upper(btrim(f.asset_no)) as asset_key,
           coalesce(nullif(btrim(f.site), ''), 'Not assigned') as site
    from public.vehicle_fleet f
    where coalesce(f.status, 'Active') = 'Active'
      and (p_country is null or p_country = 'All' or f.country = p_country)
      and coalesce(btrim(f.asset_no), '') <> ''
  ),
  last_seen as (
    select upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date
    from public.inspections i
    where coalesce(btrim(i.asset_no), '') <> ''
    group by 1
  ),
  planned as (
    select distinct upper(btrim(s.asset_no)) as asset_key
    from public.inspection_schedules s cross join params pa
    where s.scheduled_date between pa.today and pa.today + pa.horizon
      and lower(coalesce(s.status, '')) <> 'cancelled'
      and (p_country is null or p_country = 'All' or s.country is null or s.country = p_country)
  )
  select
    f.site,
    count(*)::integer                                                              as active_assets,
    count(*) filter (where pl.asset_key is not null)::integer                      as planned_assets,
    count(*) filter (where ls.last_date >= pa.today - pa.horizon)::integer         as inspected_recently,
    count(*) filter (where ls.last_date is null)::integer                          as never_inspected,
    count(*) filter (where pl.asset_key is null
                       and (ls.last_date is null or ls.last_date < pa.today - pa.horizon))::integer as overdue_assets
  from fleet f
  cross join params pa
  left join last_seen ls on ls.asset_key = f.asset_key
  left join planned  pl on pl.asset_key = f.asset_key
  group by f.site
  order by 6 desc, 2 desc
$$;

comment on function public.get_plan_coverage(text, integer) is
  'Per-site planning coverage: active vehicles, how many are already planned inside the horizon, and how many are overdue with no plan.';

revoke all on function public.get_plan_coverage(text, integer) from public;
grant execute on function public.get_plan_coverage(text, integer) to authenticated, service_role;

-- 5. The pick list: vehicles that need a plan, worst first -----------------
create or replace function public.get_unplanned_assets(
  p_country text default null,
  p_horizon_days integer default 30,
  p_site text default null,
  p_limit integer default 300
) returns table (
  asset_no text,
  site text,
  vehicle_type text,
  country text,
  last_inspected date,
  days_since integer,
  total_unplanned integer
)
language sql
stable
security invoker
set search_path = public
as $$
  with params as (
    select (now() at time zone 'UTC')::date as today,
           greatest(1, least(coalesce(p_horizon_days, 30), 365)) as horizon,
           greatest(1, least(coalesce(p_limit, 300), 2000))      as cap
  ),
  fleet as (
    select upper(btrim(f.asset_no)) as asset_key,
           btrim(f.asset_no)        as asset_no,
           coalesce(nullif(btrim(f.site), ''), 'Not assigned') as site,
           f.vehicle_type, f.country
    from public.vehicle_fleet f
    where coalesce(f.status, 'Active') = 'Active'
      and (p_country is null or p_country = 'All' or f.country = p_country)
      and (p_site is null or p_site = '' or upper(btrim(f.site)) = upper(btrim(p_site)))
      and coalesce(btrim(f.asset_no), '') <> ''
  ),
  last_seen as (
    select upper(btrim(i.asset_no)) as asset_key, max(i.inspection_date) as last_date
    from public.inspections i
    where coalesce(btrim(i.asset_no), '') <> ''
    group by 1
  ),
  planned as (
    select distinct upper(btrim(s.asset_no)) as asset_key
    from public.inspection_schedules s cross join params pa
    where s.scheduled_date between pa.today and pa.today + pa.horizon
      and lower(coalesce(s.status, '')) <> 'cancelled'
      and (p_country is null or p_country = 'All' or s.country is null or s.country = p_country)
  ),
  gap as (
    select f.asset_no, f.site, f.vehicle_type, f.country,
           ls.last_date,
           case when ls.last_date is null then null else (pa.today - ls.last_date)::integer end as days_since
    from fleet f
    cross join params pa
    left join last_seen ls on ls.asset_key = f.asset_key
    left join planned  pl on pl.asset_key = f.asset_key
    where pl.asset_key is null
  )
  select g.asset_no, g.site, g.vehicle_type, g.country, g.last_date, g.days_since,
         (select count(*) from gap)::integer as total_unplanned
  from gap g
  -- never inspected first, then the longest since a visit
  order by (g.last_date is null) desc, g.days_since desc nulls last, g.asset_no
  limit (select cap from params)
$$;

comment on function public.get_unplanned_assets(text, integer, text, integer) is
  'Active vehicles with no live plan inside the horizon, never-inspected first. total_unplanned is the true total so a capped list can say how much it is hiding.';

revoke all on function public.get_unplanned_assets(text, integer, text, integer) from public;
grant execute on function public.get_unplanned_assets(text, integer, text, integer) to authenticated, service_role;
