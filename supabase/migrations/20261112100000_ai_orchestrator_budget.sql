-- 20261112100000_ai_orchestrator_budget.sql
-- STATUS: APPLIED LIVE 2026-11-10 (owner go-ahead) via Supabase MCP apply_migration.
-- Applied before redeploying the ai-orchestrator edge function (see "Deploy order" below).
--
-- WHY
--   ai-orchestrator enforced the monthly AI budget read-then-call: it summed ai_token_logs.cost_usd for
--   the month, compared it with system_config.ai_monthly_budget_usd, then called Anthropic. Two requests
--   that start together both read the same total and both proceed, so the cap overshoots by
--   (concurrent requests x per-request cost). The tyre-photo worker already solved this with an atomic
--   reservation under an advisory lock (20261026095000). This migration gives the orchestrator the same
--   design and makes BOTH paths see each other's in-flight reservations.
--
-- WHAT
--   1. Table public.ai_budget_reservations: one row per orchestrator attempt (the attempt id IS the row id).
--      status: reserved (in flight, counted at reserved_usd)
--              settled  (actual cost written to ai_token_logs, row no longer counted here)
--              unknown  (a provider call failed and may have been billed; counted at
--                        greatest(reserved_usd, actual_usd) for the rest of the month = fail closed)
--              released (no provider call was made; counted at 0)
--   2. public.ai_month_spend_usd(p_unknown_job_usd): the ONE month ledger across ai_token_logs (non tyre
--      features), ai_tyre_inspection_jobs and ai_budget_reservations. Returns NULL on corrupt data.
--   3. public.ai_orchestrator_reserve_budget(...): reads system_config itself (ai_enabled,
--      ai_orchestrator_enabled, ai_monthly_budget_usd), takes the SAME advisory lock as the tyre worker
--      (hashtext('ai_tyre_month_budget')) so both features are serialised against one cap, and reserves.
--      Idempotent on p_attempt: a retried reserve returns the existing row, never a second reservation.
--   4. public.ai_orchestrator_settle_budget(...): idempotent on p_attempt. The FIRST settle writes exactly
--      one ai_token_logs row (success, or error) and moves the reservation out of 'reserved'; any later
--      settle for the same attempt returns {ok:true, already:true} and writes nothing, so a retry never
--      double counts. 'released' writes no token log (nothing was sent to the provider).
--   5. ai_tyre_reserve_budget_atomic is re-created with ONE change: its month total now comes from
--      ai_month_spend_usd, so in-flight orchestrator reservations count against the tyre path too. The
--      body is otherwise the live definition read with pg_get_functiondef on 2026-11-10 (identical to
--      20261026095000).
--
-- database-migration-safety pre-flight
--  Data loss        : none. CREATE TABLE / CREATE FUNCTION / one CREATE OR REPLACE. No DROP, DELETE or UPDATE.
--  Rename/removal   : none.
--  Type change      : none.
--  CHECK constraints: only on the NEW table (status vocabulary, reserved_usd > 0, actual_usd >= 0).
--  Locks            : CREATE TABLE only; ai_token_logs and ai_tyre_inspection_jobs are not altered.
--  Triggers         : none created. Inserts into ai_token_logs fire the existing trg_ai_token_logs_set_org
--                     (fills organisation_id from user_id) - harmless; we also pass organisation_id.
--                     ai_token_logs is append-only (prevent_audit_mutation): we only INSERT, never update.
--  RLS / grants     : table RLS on, no client write policy; super-admin SELECT only (monitoring).
--                     All functions SECURITY DEFINER, search_path pinned, revoked from PUBLIC, anon and
--                     authenticated, granted to service_role ONLY. The edge function resolves the caller's
--                     org/user after its own role check and passes them in; no client can call these.
--  PostgREST        : refusals are jsonb {ok:false,...}; never RAISE 40001 (PT409 rule).
--  Duration         : milliseconds (three month-bounded aggregates under an advisory lock).
--  Anon reader      : new table, so ends with anum_integration.apply_reader_policies() (V102000 rule).
--
-- Deploy order
--   1. apply this migration;  2. redeploy ai-orchestrator (index.ts + budget.ts + policy.ts + _shared/auth.ts)
--      and ai-tyre-inspection (budget.ts + index.ts, for the ai_tyre_inspection_enabled switch).
--   If the orchestrator is deployed FIRST: with a monthly cap set (live: ai_monthly_budget_usd = 20) every
--   orchestrator request returns 503 until this migration exists (fail closed, by design). With no cap it
--   runs in legacy mode (no reservation, token log written directly).
--
-- VERIFY after apply (read-only, as postgres / service role):
--   select to_regclass('public.ai_budget_reservations');                                       -- not null
--   select proname from pg_proc where proname in ('ai_month_spend_usd','ai_orchestrator_reserve_budget',
--     'ai_orchestrator_settle_budget');                                                        -- 3 rows
--   select has_function_privilege('authenticated','public.ai_orchestrator_reserve_budget(uuid,uuid,uuid,numeric,text)','EXECUTE'); -- false
--   select has_function_privilege('anon','public.ai_orchestrator_settle_budget(uuid,text,numeric,boolean,text,integer,integer,integer,text,integer)','EXECUTE'); -- false
--   select public.ai_month_spend_usd(0.01);    -- equals the month spend the Operations tab shows (+ tyre ledger)
--   Rolled-back functional test (one execute_sql call per step; never end a test DO block in RAISE):
--     begin;
--     select public.ai_orchestrator_reserve_budget('00000000-0000-0000-0000-0000000000a1', null, null, 0.2);
--     select public.ai_orchestrator_reserve_budget('00000000-0000-0000-0000-0000000000a1', null, null, 0.2); -- same row, idempotent:true
--     select public.ai_orchestrator_settle_budget('00000000-0000-0000-0000-0000000000a1','success',0.03,true,'claude-haiku-4-5',100,50,200,null,900);
--     select public.ai_orchestrator_settle_budget('00000000-0000-0000-0000-0000000000a1','success',0.03,true,'claude-haiku-4-5',100,50,200,null,900); -- already:true
--     rollback;
--
-- ROLLBACK (no business data lost; reservation rows are an audit of in-flight attempts only):
--   -- restore the tyre function first (20261026095000 body), then:
--   drop function if exists public.ai_orchestrator_settle_budget(uuid,text,numeric,boolean,text,integer,integer,integer,text,integer);
--   drop function if exists public.ai_orchestrator_reserve_budget(uuid,uuid,uuid,numeric,text);
--   drop function if exists public.ai_month_spend_usd(numeric);
--   drop table if exists public.ai_budget_reservations;
--   NOTE: an MCP execute_sql containing DROP waits for approval and times out - run rollback in the SQL editor.

begin;

create table if not exists public.ai_budget_reservations (
  id              uuid primary key,
  feature         text not null default 'orchestrator',
  organisation_id uuid,
  user_id         uuid,
  reserved_usd    numeric(12,6) not null check (reserved_usd > 0),
  actual_usd      numeric(12,6) check (actual_usd is null or actual_usd >= 0),
  status          text not null default 'reserved'
                    check (status in ('reserved', 'settled', 'unknown', 'released')),
  token_log_id    uuid,
  error           text,
  created_at      timestamptz not null default now(),
  settled_at      timestamptz
);
create index if not exists ai_budget_reservations_month_idx
  on public.ai_budget_reservations (created_at) where status in ('reserved', 'unknown');
create index if not exists ai_budget_reservations_org_idx
  on public.ai_budget_reservations (organisation_id, created_at desc);

alter table public.ai_budget_reservations enable row level security;
revoke all on public.ai_budget_reservations from public, anon, authenticated;
grant select on public.ai_budget_reservations to authenticated;
drop policy if exists ai_budget_reservations_super_read on public.ai_budget_reservations;
create policy ai_budget_reservations_super_read on public.ai_budget_reservations
  for select to authenticated using ((select public.is_super_admin()));
grant all on public.ai_budget_reservations to service_role;

comment on table public.ai_budget_reservations is
  'Atomic AI budget reservations (one row per ai-orchestrator attempt). reserved/unknown rows count against '
  'system_config.ai_monthly_budget_usd via ai_month_spend_usd(); settled rows are counted through their '
  'ai_token_logs row instead. Written only by SECURITY DEFINER RPCs (service_role).';

-- One month ledger for every AI feature. NULL = a cost is corrupt (negative), caller must fail closed.
create or replace function public.ai_month_spend_usd(p_unknown_job_usd numeric default 0.01)
returns numeric language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_since timestamptz := date_trunc('month', now() at time zone 'utc') at time zone 'utc';
        v_bad integer; v_other numeric; v_tyre numeric; v_orch numeric;
begin
 select count(*) into v_bad from public.ai_token_logs where created_at >= v_since and cost_usd < 0;
 if v_bad > 0 then return null; end if;
 select coalesce(sum(cost_usd), 0) into v_other from public.ai_token_logs
  where created_at >= v_since and coalesce(feature, '') <> 'ai_tyre_inspection' and cost_usd is not null;
 select coalesce(sum(
          (case
             when provider_called_at >= v_since then coalesce(cost_usd, reserved_usd, p_unknown_job_usd)
             when provider_called_at is null and reserved_usd is not null and budget_settled_at is null then reserved_usd
             else 0 end) + coalesce(prior_billed_usd, 0)), 0)
   into v_tyre from public.ai_tyre_inspection_jobs
  where provider_called_at >= v_since or last_retry_at >= v_since
     or (provider_called_at is null and reserved_usd is not null and budget_settled_at is null);
 select coalesce(sum(case status
          when 'reserved' then reserved_usd
          when 'unknown'  then greatest(reserved_usd, coalesce(actual_usd, 0))
          else 0 end), 0)
   into v_orch from public.ai_budget_reservations
  where created_at >= v_since and status in ('reserved', 'unknown');
 return v_other + v_tyre + v_orch;
end $$;

-- Parse a system_config value that may be JSON-quoted ("20") into text.
create or replace function public._ai_cfg_text(p_key text)
returns text language sql stable security definer set search_path = pg_catalog, public as $$
  select nullif(btrim(btrim(value::text), '"'), '') from public.system_config where key = p_key limit 1
$$;

create or replace function public.ai_orchestrator_reserve_budget(
  p_attempt uuid, p_org uuid, p_user uuid, p_estimate numeric, p_feature text default 'orchestrator')
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.ai_budget_reservations; v_enabled text; v_feat text; v_limit_raw text;
        v_limit numeric := 0; v_spent numeric;
begin
 if p_attempt is null or p_estimate is null or p_estimate <= 0 or p_estimate > 5 then
  return jsonb_build_object('ok', false, 'state', 'invalid', 'reason', 'Invalid reservation request');
 end if;

 -- Idempotent retry: the same attempt id never reserves twice.
 select * into v_row from public.ai_budget_reservations where id = p_attempt;
 if found then
  return jsonb_build_object('ok', v_row.status = 'reserved', 'idempotent', true, 'attempt_id', v_row.id,
    'state', v_row.status, 'reserved_usd', v_row.reserved_usd);
 end if;

 v_enabled := lower(coalesce(public._ai_cfg_text('ai_enabled'), 'true'));
 v_feat    := lower(coalesce(public._ai_cfg_text('ai_orchestrator_enabled'), 'true'));
 if v_enabled in ('false', '0', 'off', 'no') or v_feat in ('false', '0', 'off', 'no') then
  return jsonb_build_object('ok', false, 'state', 'disabled', 'reason', 'AI is switched off by an administrator');
 end if;
 v_limit_raw := public._ai_cfg_text('ai_monthly_budget_usd');
 if v_limit_raw is not null then
  begin
   v_limit := v_limit_raw::numeric;
  exception when others then
   return jsonb_build_object('ok', false, 'state', 'unavailable', 'reason', 'AI monthly budget setting is invalid');
  end;
  if v_limit < 0 then
   return jsonb_build_object('ok', false, 'state', 'unavailable', 'reason', 'AI monthly budget setting is invalid');
  end if;
 end if;

 -- Same lock as ai_tyre_reserve_budget_atomic: one serialised decision per cap, across both features.
 perform pg_advisory_xact_lock(hashtext('ai_tyre_month_budget'));

 -- Re-check after waiting for the lock (a concurrent retry of this attempt may have just inserted it).
 select * into v_row from public.ai_budget_reservations where id = p_attempt;
 if found then
  return jsonb_build_object('ok', v_row.status = 'reserved', 'idempotent', true, 'attempt_id', v_row.id,
    'state', v_row.status, 'reserved_usd', v_row.reserved_usd);
 end if;

 if v_limit > 0 then
  v_spent := public.ai_month_spend_usd(p_estimate);
  if v_spent is null then
   return jsonb_build_object('ok', false, 'state', 'unavailable', 'reason', 'AI monthly spend could not be read');
  end if;
  if v_spent + p_estimate > v_limit + 0.000000001 then
   return jsonb_build_object('ok', false, 'state', 'reached', 'limit_usd', v_limit, 'spent_usd', round(v_spent, 6),
     'reason', format('Monthly AI budget reached (%s of %s USD)', round(v_spent, 2), round(v_limit, 2)));
  end if;
 end if;

 insert into public.ai_budget_reservations (id, feature, organisation_id, user_id, reserved_usd)
 values (p_attempt, coalesce(nullif(btrim(p_feature), ''), 'orchestrator'), p_org, p_user, p_estimate);

 return jsonb_build_object('ok', true, 'idempotent', false, 'attempt_id', p_attempt,
   'state', case when v_limit > 0 then 'ok' else 'uncapped' end,
   'reserved_usd', p_estimate, 'limit_usd', nullif(v_limit, 0), 'spent_usd', round(v_spent, 6));
end $$;

-- p_outcome: success | error | released.  p_cost_known=false on an error means "may have been billed".
create or replace function public.ai_orchestrator_settle_budget(
  p_attempt uuid, p_outcome text, p_actual_usd numeric, p_cost_known boolean,
  p_model text, p_prompt_tokens integer, p_completion_tokens integer,
  p_http_status integer, p_error text, p_latency_ms integer)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_row public.ai_budget_reservations; v_log uuid; v_status text; v_cost numeric;
begin
 if p_attempt is null or p_outcome is null or p_outcome not in ('success', 'error', 'released') then
  return jsonb_build_object('ok', false, 'reason', 'Invalid settle request');
 end if;
 if p_actual_usd is not null and p_actual_usd < 0 then
  return jsonb_build_object('ok', false, 'reason', 'Invalid cost');
 end if;

 select * into v_row from public.ai_budget_reservations where id = p_attempt for update;
 if not found then
  return jsonb_build_object('ok', false, 'reason', 'Unknown attempt');
 end if;
 if v_row.status <> 'reserved' then
  -- Idempotent: already settled/unknown/released. Never write a second token log row.
  return jsonb_build_object('ok', true, 'already', true, 'state', v_row.status, 'token_log_id', v_row.token_log_id);
 end if;

 if p_outcome = 'released' then
  update public.ai_budget_reservations
     set status = 'released', actual_usd = 0, settled_at = now(), error = left(p_error, 500)
   where id = p_attempt;
  return jsonb_build_object('ok', true, 'already', false, 'state', 'released');
 end if;

 -- success always has a known cost; an error without a known cost is charged conservatively.
 if p_outcome = 'success' or coalesce(p_cost_known, false) then
  v_status := 'settled'; v_cost := coalesce(p_actual_usd, 0);
 else
  v_status := 'unknown'; v_cost := null;
 end if;

 insert into public.ai_token_logs (user_id, organisation_id, model, feature, prompt_tokens, completion_tokens,
   total_tokens, cost_usd, status, http_status, error, latency_ms)
 values (v_row.user_id, v_row.organisation_id, coalesce(nullif(p_model, ''), 'unknown'), v_row.feature,
   greatest(coalesce(p_prompt_tokens, 0), 0), greatest(coalesce(p_completion_tokens, 0), 0),
   greatest(coalesce(p_prompt_tokens, 0), 0) + greatest(coalesce(p_completion_tokens, 0), 0),
   v_cost, case when p_outcome = 'success' then 'success' else 'error' end, p_http_status,
   case when v_status = 'unknown'
        then left(coalesce(p_error, 'AI request failed') || ' (cost unknown, reservation kept)', 500)
        else left(p_error, 500) end,
   p_latency_ms)
 returning id into v_log;

 update public.ai_budget_reservations
    set status = v_status, actual_usd = p_actual_usd, token_log_id = v_log, settled_at = now(),
        error = left(p_error, 500)
  where id = p_attempt;

 return jsonb_build_object('ok', true, 'already', false, 'state', v_status, 'token_log_id', v_log);
end $$;

-- Tyre worker: ONE change - the month total now includes orchestrator reservations via ai_month_spend_usd.
create or replace function public.ai_tyre_reserve_budget_atomic(
 p_job uuid, p_estimate numeric, p_daily_limit numeric, p_month_limit numeric)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_spent numeric; v_res jsonb;
begin
 if p_estimate is null or p_estimate <= 0 then
  return jsonb_build_object('ok', false, 'reason', 'Invalid reservation request');
 end if;
 if p_month_limit is not null and p_month_limit > 0 then
  perform pg_advisory_xact_lock(hashtext('ai_tyre_month_budget'));
  v_spent := public.ai_month_spend_usd(p_estimate);
  if v_spent is null then
   return jsonb_build_object('ok', false, 'scope', 'monthly', 'reason', 'AI monthly spend could not be read');
  end if;
  if v_spent + p_estimate > p_month_limit + 0.000000001 then
   return jsonb_build_object('ok', false, 'scope', 'monthly',
    'reason', format('Monthly AI budget reached (%s of %s USD)', round(v_spent, 2), round(p_month_limit, 2)));
  end if;
 end if;
 v_res := public.ai_tyre_reserve_budget(p_job, p_estimate, coalesce(p_daily_limit, 0));
 return v_res;
end $$;

revoke all on function public.ai_month_spend_usd(numeric) from public, anon, authenticated;
revoke all on function public._ai_cfg_text(text) from public, anon, authenticated;
revoke all on function public.ai_orchestrator_reserve_budget(uuid, uuid, uuid, numeric, text) from public, anon, authenticated;
revoke all on function public.ai_orchestrator_settle_budget(uuid, text, numeric, boolean, text, integer, integer, integer, text, integer) from public, anon, authenticated;
revoke all on function public.ai_tyre_reserve_budget_atomic(uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function public.ai_month_spend_usd(numeric) to service_role;
grant execute on function public._ai_cfg_text(text) to service_role;
grant execute on function public.ai_orchestrator_reserve_budget(uuid, uuid, uuid, numeric, text) to service_role;
grant execute on function public.ai_orchestrator_settle_budget(uuid, text, numeric, boolean, text, integer, integer, integer, text, integer) to service_role;
grant execute on function public.ai_tyre_reserve_budget_atomic(uuid, numeric, numeric, numeric) to service_role;

-- Feature kill switches (default ON). Only inserted when absent; never overwrites an admin's choice.
insert into public.system_config (key, value, category, description)
select k, 'true', 'ai', d from (values
  ('ai_orchestrator_enabled', 'AI copilot (ai-orchestrator) on/off. Off = requests refused before any paid call.'),
  ('ai_tyre_inspection_enabled', 'AI tyre photo inspection worker on/off. Off = no paid photo calls.')) v(k, d)
where not exists (select 1 from public.system_config s where s.key = v.k);

select anum_integration.apply_reader_policies();

commit;
