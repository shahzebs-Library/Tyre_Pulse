-- AI Tyre Inspection: (2) atomic MONTHLY budget reservation, (3) bounded retry / admin re-queue of failed jobs.
--
-- STATUS: AUTHORED, NOT APPLIED. Apply on owner go-ahead BEFORE redeploying the ai-tyre-inspection edge
-- function that calls these RPCs (the worker fails closed - no paid call - if ai_tyre_reserve_budget_atomic
-- is missing).
--
-- database-migration-safety pre-flight
--  Data loss        : none. ADD COLUMN / CREATE FUNCTION only. No DROP, no DELETE, no UPDATE of existing rows.
--  Rename/removal   : none. Existing RPCs (ai_tyre_reserve_budget / settle / fail_stale) are untouched and reused.
--  Type change      : none.
--  CHECK constraints: none added (failure_kind stays free text so a new worker vocabulary can never fail a save).
--  Locks            : jobs table is small; ADD COLUMN with constant default is metadata-only. No index builds.
--  FK impact        : none (retried_by is a plain uuid, no FK, so a deleted user never blocks a job).
--  Triggers         : none created/changed. No backfill UPDATE, so no trigger fires.
--  RLS / grants     : all three functions are SECURITY DEFINER, pinned search_path, service_role ONLY
--                     (revoked from public, anon, authenticated). They take a JOB id / explicit org id supplied
--                     by the edge function after its own role + org check; no client can call them.
--  PostgREST        : refusals are jsonb {ok:false}; no RAISE 40001.
--  Duration         : milliseconds (month ledger is one aggregate scan under an advisory lock).
--
-- Money rules preserved:
--  * Monthly reservation is evaluated UNDER pg_advisory_xact_lock, so concurrent workers are serialised and
--    each sees the others' in-flight reservations (reserved, not yet called). Overshoot is therefore bounded
--    to zero by the cap itself, not by workers x reservation. Unreadable/corrupt ledger => refuse (fail closed).
--  * A job that may have been billed is NEVER requeued automatically. Only failure kinds proven not to bill
--    (photo_unavailable, provider_rate_limited = 429/500/502/503/504, photo_unusable) are auto-retried. An admin may
--    force a possibly-billed job with p_include_billed = true; its estimated prior spend is carried in
--    prior_billed_usd so the month ledger keeps counting it.
--
-- ROLLBACK (no business data lost):
--   drop function if exists public.ai_tyre_auto_requeue(integer,integer,integer);
--   drop function if exists public.ai_tyre_requeue_jobs(uuid,uuid[],boolean,uuid);
--   drop function if exists public.ai_tyre_reserve_budget_atomic(uuid,numeric,numeric,numeric);
--   alter table public.ai_tyre_inspection_jobs drop column if exists retry_count,
--     drop column if exists prior_billed_usd, drop column if exists last_retry_at, drop column if exists retried_by;
--
-- VERIFY after apply (read-only, service role):
--   select proname from pg_proc where proname in ('ai_tyre_reserve_budget_atomic','ai_tyre_requeue_jobs','ai_tyre_auto_requeue');
--   select has_function_privilege('authenticated','public.ai_tyre_requeue_jobs(uuid,uuid[],boolean,uuid)','EXECUTE'); -- false
begin;

alter table public.ai_tyre_inspection_jobs
 add column if not exists retry_count integer not null default 0,
 add column if not exists prior_billed_usd numeric(12,6) not null default 0,
 add column if not exists last_retry_at timestamptz,
 add column if not exists retried_by uuid;

-- Atomic daily + monthly reservation. p_month_limit <= 0 means "no monthly cap" (daily still applies).
create or replace function public.ai_tyre_reserve_budget_atomic(
 p_job uuid, p_estimate numeric, p_daily_limit numeric, p_month_limit numeric)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_since timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
        v_other numeric; v_tyre numeric; v_bad integer; v_res jsonb;
begin
 if p_estimate is null or p_estimate <= 0 then
  return jsonb_build_object('ok', false, 'reason', 'Invalid reservation request');
 end if;
 if p_month_limit is not null and p_month_limit > 0 then
  -- Serialise every monthly decision: the next worker waits, then sees this one's reservation.
  perform pg_advisory_xact_lock(hashtext('ai_tyre_month_budget'));
  select count(*) into v_bad from public.ai_token_logs where created_at >= v_since and cost_usd < 0;
  if v_bad > 0 then
   return jsonb_build_object('ok', false, 'scope', 'monthly', 'reason', 'AI monthly spend could not be read');
  end if;
  select coalesce(sum(cost_usd), 0) into v_other from public.ai_token_logs
   where created_at >= v_since and coalesce(feature, '') <> 'ai_tyre_inspection' and cost_usd is not null;
  select coalesce(sum(
           (case
              when provider_called_at >= v_since then coalesce(cost_usd, reserved_usd, p_estimate)
              when provider_called_at is null and reserved_usd is not null and budget_settled_at is null then reserved_usd
              else 0 end) + coalesce(prior_billed_usd, 0)), 0)
    into v_tyre from public.ai_tyre_inspection_jobs
   where provider_called_at >= v_since or last_retry_at >= v_since
      or (provider_called_at is null and reserved_usd is not null and budget_settled_at is null);
  if v_other + v_tyre + p_estimate > p_month_limit + 0.000000001 then
   return jsonb_build_object('ok', false, 'scope', 'monthly',
    'reason', format('Monthly AI budget reached (%s of %s USD)', round(v_other + v_tyre, 2), round(p_month_limit, 2)));
  end if;
 end if;
 v_res := public.ai_tyre_reserve_budget(p_job, p_estimate, coalesce(p_daily_limit, 0));
 return v_res;
end $$;

-- Re-queue failed jobs. p_include_billed = false only re-queues kinds that cannot have been billed.
create or replace function public.ai_tyre_requeue_jobs(
 p_org uuid, p_job_ids uuid[], p_include_billed boolean default false, p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.ai_tyre_inspection_jobs; n integer := 0; v_skipped jsonb := '[]'::jsonb;
        v_safe boolean; v_carry numeric;
begin
 if p_org is null or p_job_ids is null or cardinality(p_job_ids) = 0 or cardinality(p_job_ids) > 100 then
  return jsonb_build_object('ok', false, 'reason', 'Between 1 and 100 job ids required');
 end if;
 for r in select * from public.ai_tyre_inspection_jobs
           where id = any(p_job_ids) and organisation_id = p_org for update
 loop
  if r.status <> 'failed' then
   v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'not_failed'); continue;
  end if;
  v_safe := coalesce(r.failure_kind, '') in ('photo_unavailable', 'provider_rate_limited', 'photo_unusable');
  if not v_safe and p_include_billed is not true then
   v_skipped := v_skipped || jsonb_build_object('id', r.id, 'reason', 'may_have_been_billed'); continue;
  end if;
  v_carry := 0;
  if not v_safe and r.provider_called_at is not null then
   v_carry := coalesce(r.cost_usd, r.reserved_usd, 0.01);
  end if;
  update public.ai_tyre_inspection_jobs set
    status = 'pending', attempts = 0, provider_attempts = 0, provider_called_at = null,
    failure_kind = null, error_message = null, reserved_usd = null, budget_day = null, budget_settled_at = null,
    cost_usd = null, input_tokens = null, output_tokens = null, total_tokens = null,
    prior_billed_usd = prior_billed_usd + v_carry, retry_count = retry_count + 1,
    last_retry_at = now(), retried_by = p_actor, updated_at = now()
  where id = r.id;
  n := n + 1;
 end loop;
 return jsonb_build_object('ok', true, 'requeued', n, 'skipped', v_skipped);
end $$;

-- Automatic bounded retry with exponential backoff (base * 2^retry_count minutes). Only kinds that cannot
-- have been billed. Called by the worker before it drains the queue.
create or replace function public.ai_tyre_auto_requeue(
 p_max_retries integer default 3, p_base_minutes integer default 10, p_limit integer default 50)
returns integer language plpgsql security definer set search_path = pg_catalog, public as $$
declare n integer;
begin
 with due as (
  select id from public.ai_tyre_inspection_jobs
   where status = 'failed' and failure_kind in ('photo_unavailable', 'provider_rate_limited')
     and retry_count < greatest(0, least(coalesce(p_max_retries, 3), 10))
     and updated_at <= now() - make_interval(mins => greatest(1, coalesce(p_base_minutes, 10)) * (power(2, retry_count))::int)
   order by updated_at asc limit greatest(1, least(coalesce(p_limit, 50), 200))
   for update skip locked)
 update public.ai_tyre_inspection_jobs j set
    status = 'pending', attempts = 0, provider_attempts = 0, provider_called_at = null,
    failure_kind = null, error_message = null, reserved_usd = null, budget_day = null, budget_settled_at = null,
    cost_usd = null, input_tokens = null, output_tokens = null, total_tokens = null,
    retry_count = j.retry_count + 1, last_retry_at = now(), updated_at = now()
  from due where j.id = due.id;
 get diagnostics n = row_count;
 return n;
end $$;

revoke all on function public.ai_tyre_reserve_budget_atomic(uuid, numeric, numeric, numeric) from public;
revoke all on function public.ai_tyre_reserve_budget_atomic(uuid, numeric, numeric, numeric) from anon, authenticated;
revoke all on function public.ai_tyre_requeue_jobs(uuid, uuid[], boolean, uuid) from public;
revoke all on function public.ai_tyre_requeue_jobs(uuid, uuid[], boolean, uuid) from anon, authenticated;
revoke all on function public.ai_tyre_auto_requeue(integer, integer, integer) from public;
revoke all on function public.ai_tyre_auto_requeue(integer, integer, integer) from anon, authenticated;
grant execute on function public.ai_tyre_reserve_budget_atomic(uuid, numeric, numeric, numeric) to service_role;
grant execute on function public.ai_tyre_requeue_jobs(uuid, uuid[], boolean, uuid) to service_role;
grant execute on function public.ai_tyre_auto_requeue(integer, integer, integer) to service_role;

commit;
