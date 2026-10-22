-- AI Tyre Inspection hardening: atomic daily budget reservation, provider-attempt
-- accounting columns, stalled-lock reconciliation, reviewer-feedback aggregate.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply only on owner go-ahead, BEFORE deploying the
-- edge function version that calls ai_tyre_reserve_budget / ai_tyre_settle_budget
-- (the worker fails closed - no paid call - if these RPCs are missing).
--
-- database-migration-safety pre-flight
--  Data loss        : none. Only ADD COLUMN / CREATE TABLE / CREATE FUNCTION. No DROP/DELETE/UPDATE of rows.
--  Rename/removal   : none. Existing columns untouched; old clients never read the new ones.
--  Type change      : none.
--  CHECK constraints: no new CHECK on existing columns (failure_kind deliberately has none so a new
--                     worker vocabulary can never fail a save). New table has non-negative CHECKs only.
--  Locks            : ai_tyre_inspection_jobs is small. ADD COLUMN with constant default is metadata-only.
--                     No index build on a large table.
--  FK impact        : none.
--  Triggers         : none created/changed. No backfill UPDATE, so no trigger is fired.
--  RLS              : new table ai_tyre_daily_budget has RLS ON, NO policies, no grants to
--                     anon/authenticated (service-side only). The feedback RPC is SECURITY INVOKER, so the
--                     existing ai_tyre_jobs_org_read policy (org + inspections view) still applies.
--  SECURITY DEFINER : reserve/settle/reaper pin search_path, take a JOB id (never an org id from the
--                     caller) and are executable by service_role ONLY (revoked from public, anon, authenticated).
--  PostgREST        : no RAISE 40001. Refusals are returned as jsonb {ok:false}.
--  Duration         : milliseconds.
--
-- ROLLBACK (no business data is lost; the budget table only holds counters):
--   drop function if exists public.get_ai_tyre_review_feedback(date,date);
--   drop function if exists public.ai_tyre_fail_stale_processing(integer);
--   drop function if exists public.ai_tyre_settle_budget(uuid,numeric,boolean);
--   drop function if exists public.ai_tyre_reserve_budget(uuid,numeric,numeric);
--   drop table if exists public.ai_tyre_daily_budget;
--   alter table public.ai_tyre_inspection_jobs drop column if exists provider_attempts,
--     drop column if exists provider_called_at, drop column if exists failure_kind,
--     drop column if exists reserved_usd, drop column if exists budget_day,
--     drop column if exists budget_settled_at;
--
-- VERIFY after apply (read-only, service role):
--   select proname from pg_proc where proname like 'ai_tyre_%budget%';
--   select has_function_privilege('authenticated','public.ai_tyre_reserve_budget(uuid,numeric,numeric)','EXECUTE'); -- false
begin;

alter table public.ai_tyre_inspection_jobs
 add column if not exists provider_attempts integer not null default 0,
 add column if not exists provider_called_at timestamptz,
 add column if not exists failure_kind text,
 add column if not exists reserved_usd numeric(12,6),
 add column if not exists budget_day date,
 add column if not exists budget_settled_at timestamptz;

create table if not exists public.ai_tyre_daily_budget (
 day date primary key,
 reserved_usd numeric(12,6) not null default 0 check (reserved_usd >= 0),
 settled_usd numeric(12,6) not null default 0 check (settled_usd >= 0),
 unknown_cost_calls integer not null default 0 check (unknown_cost_calls >= 0),
 updated_at timestamptz not null default now()
);
alter table public.ai_tyre_daily_budget enable row level security;
revoke all on public.ai_tyre_daily_budget from public, anon, authenticated;
grant select, insert, update on public.ai_tyre_daily_budget to service_role;

-- Atomic reservation. The conditional UPDATE takes the day row lock, so concurrent workers are
-- serialised and each re-evaluates "reserved + settled + estimate <= limit" against the latest row.
create or replace function public.ai_tyre_reserve_budget(p_job uuid, p_estimate numeric, p_limit numeric)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_day date := (now() at time zone 'utc')::date; v_job public.ai_tyre_inspection_jobs; v_hit boolean;
begin
 if p_estimate is null or p_estimate <= 0 or p_limit is null or p_limit < 0 then
  return jsonb_build_object('ok', false, 'reason', 'Invalid reservation request');
 end if;
 select * into v_job from public.ai_tyre_inspection_jobs where id = p_job for update;
 if not found or v_job.status <> 'processing' then
  return jsonb_build_object('ok', false, 'reason', 'Job is not in processing state');
 end if;
 if v_job.reserved_usd is not null or v_job.provider_attempts > 0 then
  return jsonb_build_object('ok', false, 'reason', 'Job already reserved or attempted; no second paid call');
 end if;
 insert into public.ai_tyre_daily_budget(day) values (v_day) on conflict (day) do nothing;
 update public.ai_tyre_daily_budget
    set reserved_usd = reserved_usd + p_estimate, updated_at = now()
  where day = v_day and reserved_usd + settled_usd + p_estimate <= p_limit
  returning true into v_hit;
 if v_hit is not true then
  return jsonb_build_object('ok', false, 'reason', 'Daily AI spending limit reached');
 end if;
 update public.ai_tyre_inspection_jobs set reserved_usd = p_estimate, budget_day = v_day where id = p_job;
 return jsonb_build_object('ok', true, 'reserved', p_estimate, 'day', v_day);
end $$;

-- Settle a reservation exactly once. Unknown usage (p_actual null) after a provider call is charged
-- at the reservation (conservative) and counted in unknown_cost_calls; the job cost stays NULL.
create or replace function public.ai_tyre_settle_budget(p_job uuid, p_actual numeric, p_provider_called boolean)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_job public.ai_tyre_inspection_jobs; v_charge numeric;
begin
 select * into v_job from public.ai_tyre_inspection_jobs where id = p_job for update;
 if not found then return jsonb_build_object('ok', false, 'reason', 'Job not found'); end if;
 if v_job.reserved_usd is null or v_job.budget_day is null then
  return jsonb_build_object('ok', true, 'note', 'Nothing reserved');
 end if;
 if v_job.budget_settled_at is not null then
  return jsonb_build_object('ok', true, 'note', 'Already settled');
 end if;
 if p_provider_called is not true then
  update public.ai_tyre_daily_budget
     set reserved_usd = greatest(0, reserved_usd - v_job.reserved_usd), updated_at = now()
   where day = v_job.budget_day;
  update public.ai_tyre_inspection_jobs set reserved_usd = null, budget_day = null where id = p_job;
  return jsonb_build_object('ok', true, 'charged', 0);
 end if;
 v_charge := greatest(0, coalesce(p_actual, v_job.reserved_usd));
 update public.ai_tyre_daily_budget
    set reserved_usd = greatest(0, reserved_usd - v_job.reserved_usd),
        settled_usd = settled_usd + v_charge,
        unknown_cost_calls = unknown_cost_calls + (case when p_actual is null then 1 else 0 end),
        updated_at = now()
  where day = v_job.budget_day;
 update public.ai_tyre_inspection_jobs set budget_settled_at = now() where id = p_job;
 return jsonb_build_object('ok', true, 'charged', v_charge, 'usage_known', p_actual is not null);
end $$;

-- A job stuck in 'processing' may have reached the provider before the worker died. Fail it for
-- manual review (never retry) and settle its reservation conservatively.
create or replace function public.ai_tyre_fail_stale_processing(p_minutes integer default 15)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare r record; n integer := 0;
begin
 for r in select id, reserved_usd, budget_settled_at from public.ai_tyre_inspection_jobs
          where status = 'processing' and updated_at < now() - make_interval(mins => greatest(1, p_minutes))
          for update skip locked
 loop
  update public.ai_tyre_inspection_jobs
     set status = 'failed', failure_kind = 'stalled', updated_at = now(),
         error_message = 'Stalled while processing; provider may have been called and billed; manual review required'
   where id = r.id;
  if r.reserved_usd is not null and r.budget_settled_at is null then
   perform public.ai_tyre_settle_budget(r.id, null, true);
  end if;
  n := n + 1;
 end loop;
 return n;
end $$;

revoke all on function public.ai_tyre_reserve_budget(uuid, numeric, numeric) from public;
revoke all on function public.ai_tyre_reserve_budget(uuid, numeric, numeric) from anon, authenticated;
revoke all on function public.ai_tyre_settle_budget(uuid, numeric, boolean) from public;
revoke all on function public.ai_tyre_settle_budget(uuid, numeric, boolean) from anon, authenticated;
revoke all on function public.ai_tyre_fail_stale_processing(integer) from public;
revoke all on function public.ai_tyre_fail_stale_processing(integer) from anon, authenticated;
grant execute on function public.ai_tyre_reserve_budget(uuid, numeric, numeric) to service_role;
grant execute on function public.ai_tyre_settle_budget(uuid, numeric, boolean) to service_role;
grant execute on function public.ai_tyre_fail_stale_processing(integer) to service_role;

-- Reviewer-feedback aggregate: EVALUATION DATA ONLY. Counts of human decisions per model/prompt.
-- It does not train, tune or auto-update any model. SECURITY INVOKER: RLS on the jobs table scopes
-- it to the caller's organisation; the body additionally limits it to supervisor roles.
create or replace function public.get_ai_tyre_review_feedback(p_from date default null, p_to date default null)
returns table (
 model_version text, prompt_version text, jobs bigint, completed bigint, failed bigint,
 reviewed bigint, accepted bigint, rejected bigint, corrected bigint, unreviewed bigint,
 with_reviewer_note bigint, known_cost_usd numeric, unpriced_jobs bigint
) language sql stable security invoker set search_path = pg_catalog, public
set plan_cache_mode = force_custom_plan as $$
 select coalesce(j.model_version, 'unknown'), coalesce(j.prompt_version, 'unversioned'),
        count(*),
        count(*) filter (where j.status = 'completed'),
        count(*) filter (where j.status = 'failed'),
        count(*) filter (where j.review_status <> 'unreviewed'),
        count(*) filter (where j.review_status = 'accepted'),
        count(*) filter (where j.review_status = 'rejected'),
        count(*) filter (where j.review_status = 'corrected'),
        count(*) filter (where j.status = 'completed' and j.review_status = 'unreviewed'),
        count(*) filter (where j.review_status <> 'unreviewed' and coalesce(btrim(j.reviewer_note), '') <> ''),
        coalesce(sum(j.cost_usd), 0),
        count(*) filter (where j.cost_usd is null and j.status in ('completed', 'failed') and j.provider_attempts > 0)
   from public.ai_tyre_inspection_jobs j
  where (lower(coalesce(public.get_my_role(), '')) in ('admin', 'manager', 'director', 'maintenance supervisor')
         or public.is_super_admin())
    and (p_from is null or j.created_at >= p_from::timestamptz)
    and (p_to is null or j.created_at < (p_to + 1)::timestamptz)
  group by 1, 2
  order by 3 desc
$$;
revoke all on function public.get_ai_tyre_review_feedback(date, date) from public;
revoke all on function public.get_ai_tyre_review_feedback(date, date) from anon;
grant execute on function public.get_ai_tyre_review_feedback(date, date) to authenticated, service_role;

commit;
