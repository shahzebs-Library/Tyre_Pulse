-- =============================================================================
-- ACCIDENT CASE MODEL - REPAIR CHAIN + FINANCE RPCs (Phase 2, items 10-14)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row.
--
-- RUN ORDER: this script RUNS AFTER V417 (02_DATA_MODEL.sql - the case model
-- tables, columns, RLS and the closure guard) AND AFTER 10_WORKSTREAM_RPCS.sql
-- (the per-team workstream RPCs), because it REUSES the internal context helper
-- public._accident_rpc_context(uuid) declared there rather than re-declaring it
-- (one definition, no drift). It writes the repair chain (accident_repair_orders /
-- accident_repair_tasks / accident_repair_quality_checks), the finance ledger
-- (accident_financial_transactions / accident_claim_recoveries) and the vehicle
-- downtime record (accident_vehicle_downtime) created by V417.
-- RE-CONFIRM THE NEXT-FREE MIGRATION NUMBER AT APPLY TIME: nothing here depends on
-- its own number; renumber freely if another batch lands first.
--
-- WHY IT EXISTS
--   The frontend can write these child rows directly through PostgREST under the
--   V417 per-capability RLS, and that is fine for a plain field edit. But the repair
--   and finance ACTIONS in the brief each need an ATOMIC, SERVER-VALIDATED
--   transition a raw table write cannot express:
--     * a repair route / workshop type / status typo must be REFUSED, not stored,
--     * money (quotation / approved / cost / recovery) must be NON-NEGATIVE,
--     * a repair may NOT be marked complete while a REQUIRED quality check has not
--       passed - mirrors the engine's workshop_qc gate: no QC evidence, no closure,
--     * a QC FAIL leaves the repair NOT complete (status qc_failed), never complete,
--     * a recovery may not claim 'recovered' with no recovered_at evidence.
--   These RPCs are that server boundary. No case MATHS are re-implemented here (they
--   live in the pure engine src/lib/accidentCase.js and its SQL mirror); this layer
--   validates, gates and writes.
--
-- SECURITY (house pattern - V416 / V398 / V229, identical to 10_WORKSTREAM_RPCS.sql)
--   Every RPC is SECURITY DEFINER with search_path pinned to 'public'. Because a
--   DEFINER function bypasses RLS, each one RE-CHECKS, in its own body, via the
--   shared helper public._accident_rpc_context(accident_id):
--     1. org: the target accident's organisation_id = app_current_org() OR super.
--     2. country + site: app_can_see_country() AND app_can_see_site() on the
--        accident's own country/site (the same scope the V417 RLS enforces).
--   Then a per-action capability gate: app_is_elevated() (Admin/Manager/Director)
--   OR app_user_can('accidents', <cap>) for the capability that owns the workstream
--   the action belongs to (the same map as 10_WORKSTREAM_RPCS._accident_ws_cap):
--     * repair order / task / complete / downtime -> 'execute_repair'
--       (downtime also allows 'validate', the Fleet coordination cap that owns the
--        vehicle's off-road status),
--     * quality check                              -> 'qc_repair',
--     * finance transaction / recovery             -> 'post_cost'.
--   So a non-elevated Workshop technician granted 'execute_repair' can run the
--   repair chain but not post money, a Finance officer granted 'post_cost' posts
--   costs but cannot sign off a QC, and a KSA-scoped user cannot touch an Egypt
--   case. anon EXECUTE is revoked on every function; authenticated is granted; the
--   in-body self-gate is the real boundary.
--
-- MIRROR DISCIPLINE
--   Every token list validated below is copied VERBATIM from the V417 CHECK
--   constraints on the target tables (repair_route, workshop_type,
--   accident_repair_orders.status, accident_repair_quality_checks.result,
--   accident_vehicle_downtime.vehicle_status, accident_financial_transactions
--   .txn_type / direction, accident_claim_recoveries.source / status). A DB write
--   would reject a bad token anyway; validating first turns a raw 23514 into a clean
--   message. Change a CHECK and the matching list here together.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists
--     public.accident_repair_order_upsert(uuid,text,text,text,numeric,date),
--     public.accident_repair_task_add(uuid,text,text,numeric,uuid,text),
--     public.accident_repair_task_complete(uuid,numeric,text),
--     public.accident_repair_qc(uuid,text,text),
--     public.accident_repair_complete(uuid,date,numeric),
--     public.accident_finance_txn_add(uuid,text,text,numeric,text),
--     public.accident_recovery_record(uuid,text,numeric,text,date),
--     public.accident_downtime_set(uuid,text,date,date);
-- =============================================================================

begin;

-- =============================================================================
-- 10. accident_repair_order_upsert - open (or update) the case repair order.
--   Repair is ONE workstream (03 sec 2.1), so a case carries ONE live repair
--   order: this updates the latest OPEN order (status not in completed/cancelled)
--   for the accident, and inserts a fresh one only when none is open. Validates the
--   route / workshop-type tokens against the V417 CHECKs and refuses a negative
--   quotation. Does NOT touch status/approval - opening an order leaves it 'planned'
--   and its money unapproved until the dedicated approval / complete actions run.
-- =============================================================================
create or replace function public.accident_repair_order_upsert(
  p_accident_id       uuid,
  p_repair_route      text,
  p_workshop_type     text,
  p_workshop_name     text,
  p_quotation_amount  numeric default null,
  p_planned_completion date   default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org      uuid;
  v_country  text;
  v_site     text;
  v_route    text := nullif(btrim(coalesce(p_repair_route, '')), '');
  v_wtype    text := nullif(btrim(coalesce(p_workshop_type, '')), '');
  v_wname    text := nullif(btrim(coalesce(p_workshop_name, '')), '');
  v_existing uuid;
  v_row      public.accident_repair_orders%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'execute_repair')) then
    raise exception 'Not permitted to open a repair order on this case.' using errcode = '42501';
  end if;

  if v_route is not null and v_route <> any (array[
       'none','temporary','internal','external','insurer_approved','dealer','specialist',
       'replacement','total_loss','disposal','under_review']) then
    raise exception 'Invalid repair route "%".', p_repair_route using errcode = '22023';
  end if;

  if v_wtype is not null and v_wtype <> any (array[
       'internal','external','insurer_approved','dealer','specialist']) then
    raise exception 'Invalid workshop type "%".', p_workshop_type using errcode = '22023';
  end if;

  if p_quotation_amount is not null and p_quotation_amount < 0 then
    raise exception 'Quotation amount cannot be negative.' using errcode = '22023';
  end if;

  -- Latest OPEN repair order for this case, if any (repair is one workstream).
  select id into v_existing
    from public.accident_repair_orders
   where accident_id = p_accident_id
     and status not in ('completed', 'cancelled')
   order by created_at desc, id desc
   limit 1;

  if v_existing is not null then
    update public.accident_repair_orders set
       repair_route     = coalesce(v_route, repair_route),
       workshop_type    = coalesce(v_wtype, workshop_type),
       workshop_name    = coalesce(v_wname, workshop_name),
       quotation_amount = coalesce(p_quotation_amount, quotation_amount),
       planned_completion = coalesce(p_planned_completion, planned_completion),
       updated_at       = now()
     where id = v_existing
    returning * into v_row;
  else
    insert into public.accident_repair_orders
      (organisation_id, accident_id, country, site, repair_route, workshop_type,
       workshop_name, quotation_amount, planned_completion, status,
       recommended_by, created_by, created_at, updated_at)
    values
      (v_org, p_accident_id, v_country, v_site, v_route, v_wtype,
       v_wname, p_quotation_amount, p_planned_completion, 'planned',
       auth.uid(), auth.uid(), now(), now())
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'repair_order', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 11a. accident_repair_task_add - break a repair order into a task.
--   Derives the case context from the repair order (so the caller cannot mis-scope
--   the task) and re-asserts org/country/site. Refuses a negative estimate.
--   Gate: elevated OR 'execute_repair'.
-- =============================================================================
create or replace function public.accident_repair_task_add(
  p_repair_order_id uuid,
  p_title           text,
  p_description     text    default null,
  p_estimated_hours numeric default null,
  p_assignee_id     uuid    default null,
  p_assignee_name   text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_ro      public.accident_repair_orders%rowtype;
  v_title   text := nullif(btrim(coalesce(p_title, '')), '');
  v_row     public.accident_repair_tasks%rowtype;
begin
  if p_repair_order_id is null then
    raise exception 'A repair order is required.' using errcode = '22023';
  end if;

  select * into v_ro from public.accident_repair_orders where id = p_repair_order_id;
  if v_ro.id is null then
    raise exception 'Repair order % not found.', p_repair_order_id using errcode = 'P0002';
  end if;

  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_ro.accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'execute_repair')) then
    raise exception 'Not permitted to add a repair task on this case.' using errcode = '42501';
  end if;

  if v_title is null then
    raise exception 'A task title is required.' using errcode = '22023';
  end if;
  if p_estimated_hours is not null and p_estimated_hours < 0 then
    raise exception 'Estimated hours cannot be negative.' using errcode = '22023';
  end if;

  insert into public.accident_repair_tasks
    (organisation_id, accident_id, repair_order_id, country, site, title, description,
     estimated_hours, assignee_id, assignee_name, status, created_by, created_at, updated_at)
  values
    (v_org, v_ro.accident_id, p_repair_order_id, v_country, v_site, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     p_estimated_hours, p_assignee_id, nullif(btrim(coalesce(p_assignee_name, '')), ''),
     case when p_assignee_id is not null then 'assigned' else 'open' end,
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'task', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 11b. accident_repair_task_complete - mark a repair task completed.
--   Derives the case context from the task's repair order. Refuses a negative
--   actual-hours figure. Idempotent: completing an already terminal task returns ok
--   unchanged. Gate: elevated OR the task's assignee OR 'execute_repair'.
-- =============================================================================
create or replace function public.accident_repair_task_complete(
  p_task_id      uuid,
  p_actual_hours numeric default null,
  p_note         text    default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_task    public.accident_repair_tasks%rowtype;
  v_uid     uuid := auth.uid();
begin
  if p_task_id is null then
    raise exception 'A task is required.' using errcode = '22023';
  end if;

  select * into v_task from public.accident_repair_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task % not found.', p_task_id using errcode = 'P0002';
  end if;

  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_task.accident_id);

  if not (public.app_is_elevated()
          or (v_task.assignee_id is not null and v_task.assignee_id = v_uid)
          or public.app_user_can('accidents', 'execute_repair')) then
    raise exception 'Not permitted to complete this repair task.' using errcode = '42501';
  end if;

  if p_actual_hours is not null and p_actual_hours < 0 then
    raise exception 'Actual hours cannot be negative.' using errcode = '22023';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    return jsonb_build_object('ok', true, 'task', to_jsonb(v_task), 'unchanged', true);
  end if;

  update public.accident_repair_tasks set
     status      = 'completed',
     actual_hours = coalesce(p_actual_hours, actual_hours),
     description = case
                     when nullif(btrim(coalesce(p_note, '')), '') is not null
                       then coalesce(description, '') ||
                            case when coalesce(description, '') = '' then '' else E'\n' end ||
                            btrim(p_note)
                     else description
                   end,
     updated_at  = now()
   where id = p_task_id
  returning * into v_task;

  return jsonb_build_object('ok', true, 'task', to_jsonb(v_task));
end
$$;

-- =============================================================================
-- 12. accident_repair_qc - record a workshop quality check on a repair order.
--   Validates the result against the V417 CHECK (pass / fail / conditional) and
--   writes the QC row with WHO / WHEN (inspector = the caller, inspected_at = now).
--   Reflects the outcome onto the repair order status so completeness reads it:
--     pass        -> qc_passed
--     fail        -> qc_failed  (the repair is explicitly NOT complete),
--     conditional -> qc_pending (rework needed before it can pass).
--   Gate: elevated OR 'qc_repair' (segregated from the repair capability, so the
--   technician who did the work does not sign off their own QC unless elevated).
-- =============================================================================
create or replace function public.accident_repair_qc(
  p_repair_order_id uuid,
  p_result          text,
  p_notes           text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_ro      public.accident_repair_orders%rowtype;
  v_result  text := lower(btrim(coalesce(p_result, '')));
  v_row     public.accident_repair_quality_checks%rowtype;
begin
  if p_repair_order_id is null then
    raise exception 'A repair order is required.' using errcode = '22023';
  end if;

  select * into v_ro from public.accident_repair_orders where id = p_repair_order_id;
  if v_ro.id is null then
    raise exception 'Repair order % not found.', p_repair_order_id using errcode = 'P0002';
  end if;

  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_ro.accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'qc_repair')) then
    raise exception 'Not permitted to record a quality check.' using errcode = '42501';
  end if;

  if v_result <> any (array['pass','fail','conditional']) then
    raise exception 'Invalid quality-check result "%".', p_result using errcode = '22023';
  end if;

  insert into public.accident_repair_quality_checks
    (organisation_id, accident_id, repair_order_id, country, site, inspector_id,
     inspected_at, result, remarks, created_by, created_at, updated_at)
  values
    (v_org, v_ro.accident_id, p_repair_order_id, v_country, v_site, auth.uid(),
     now(), v_result, nullif(btrim(coalesce(p_notes, '')), ''),
     auth.uid(), now(), now())
  returning * into v_row;

  -- Reflect the QC outcome onto the repair order (never marks it 'completed' - that
  -- is the deliberate accident_repair_complete action, which itself re-checks QC).
  update public.accident_repair_orders set
     status = case v_result
                when 'pass'        then 'qc_passed'
                when 'fail'        then 'qc_failed'
                when 'conditional' then 'qc_pending'
              end,
     updated_at = now()
   where id = p_repair_order_id;

  return jsonb_build_object(
    'ok', true,
    'quality_check', to_jsonb(v_row),
    'passed', (v_result = 'pass')
  );
end
$$;

-- =============================================================================
-- 13. accident_repair_complete - close out a repair order.
--   REFUSES completion while a REQUIRED quality check has not passed - the workshop
--   QC gate. Whether QC is required is read honestly from the case: if the
--   workshop_qc workstream row exists and is switched off (status not_required OR
--   not_applicable), QC is waived; otherwise a passing accident_repair_quality_checks
--   row (result='pass') for THIS repair order is mandatory evidence. No passing QC
--   and not waived -> the completion is refused, never silently allowed. Also
--   refuses a negative approved amount and a repair order already cancelled.
--   Gate: elevated OR 'execute_repair'.
-- =============================================================================
create or replace function public.accident_repair_complete(
  p_repair_order_id  uuid,
  p_actual_completion date,
  p_approved_amount  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org        uuid;
  v_country    text;
  v_site       text;
  v_ro         public.accident_repair_orders%rowtype;
  v_qc_required boolean := true;
  v_has_pass   boolean;
  v_row        public.accident_repair_orders%rowtype;
begin
  if p_repair_order_id is null then
    raise exception 'A repair order is required.' using errcode = '22023';
  end if;
  if p_actual_completion is null then
    raise exception 'An actual completion date is required.' using errcode = '22023';
  end if;

  select * into v_ro from public.accident_repair_orders where id = p_repair_order_id;
  if v_ro.id is null then
    raise exception 'Repair order % not found.', p_repair_order_id using errcode = 'P0002';
  end if;

  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_ro.accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'execute_repair')) then
    raise exception 'Not permitted to complete this repair order.' using errcode = '42501';
  end if;

  if v_ro.status = 'cancelled' then
    raise exception 'A cancelled repair order cannot be completed.' using errcode = '42501';
  end if;
  if v_ro.status = 'completed' then
    return jsonb_build_object('ok', true, 'repair_order', to_jsonb(v_ro), 'unchanged', true);
  end if;
  if p_approved_amount is not null and p_approved_amount < 0 then
    raise exception 'Approved amount cannot be negative.' using errcode = '22023';
  end if;

  -- Is QC required for this case? Waived only when the workshop_qc workstream is
  -- explicitly switched off (mirrors the engine's workshop_qc gate).
  select not (ws.status = 'not_required' or ws.not_applicable)
    into v_qc_required
    from public.accident_case_workstreams ws
   where ws.accident_id = v_ro.accident_id
     and ws.workstream_key = 'workshop_qc';
  v_qc_required := coalesce(v_qc_required, true);

  if v_qc_required then
    select exists (
      select 1 from public.accident_repair_quality_checks q
       where q.repair_order_id = p_repair_order_id
         and q.result = 'pass'
    ) into v_has_pass;

    if not v_has_pass then
      raise exception
        'Repair cannot be completed: a passing quality check is required.'
        using errcode = '42501';
    end if;
  end if;

  update public.accident_repair_orders set
     status            = 'completed',
     actual_completion = p_actual_completion,
     approved_amount   = coalesce(p_approved_amount, approved_amount),
     approved_by       = case when p_approved_amount is not null then auth.uid() else approved_by end,
     approved_at       = case when p_approved_amount is not null then now() else approved_at end,
     updated_at        = now()
   where id = p_repair_order_id
  returning * into v_row;

  return jsonb_build_object('ok', true, 'repair_order', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 14a. accident_finance_txn_add - post one cost / recovery line on the case ledger.
--   Validates txn_type + direction against the V417 CHECKs and refuses a negative
--   amount (money integrity: a cost or recovery line is always >= 0; the direction
--   column, not the sign, says whether it is a cost or a recovery). Stamps
--   posted_by / posted_at with WHO / WHEN. Gate: elevated OR 'post_cost'.
-- =============================================================================
create or replace function public.accident_finance_txn_add(
  p_accident_id uuid,
  p_txn_type    text,
  p_direction   text,
  p_amount      numeric,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org       uuid;
  v_country   text;
  v_site      text;
  v_txn_type  text := lower(btrim(coalesce(p_txn_type, '')));
  v_direction text := lower(btrim(coalesce(p_direction, '')));
  v_row       public.accident_financial_transactions%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'post_cost')) then
    raise exception 'Not permitted to post a financial transaction.' using errcode = '42501';
  end if;

  if v_txn_type <> any (array[
       'repair_estimate','internal_labour','internal_parts','external_repair','towing',
       'storage','third_party_cost','po_amount','invoice_amount','insurer_approved',
       'deductible','insurance_payment','third_party_recovery','unrecovered','company_loss']) then
    raise exception 'Invalid transaction type "%".', p_txn_type using errcode = '22023';
  end if;

  if v_direction <> any (array['cost','recovery','neutral']) then
    raise exception 'Invalid transaction direction "%".', p_direction using errcode = '22023';
  end if;

  if p_amount is null then
    raise exception 'A transaction amount is required.' using errcode = '22023';
  end if;
  if p_amount < 0 then
    raise exception 'Transaction amount cannot be negative.' using errcode = '22023';
  end if;

  insert into public.accident_financial_transactions
    (organisation_id, accident_id, country, site, txn_type, direction, amount,
     description, posted_by, posted_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_txn_type, v_direction, p_amount,
     nullif(btrim(coalesce(p_description, '')), ''), auth.uid(), now(),
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'transaction', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 14b. accident_recovery_record - record a claim recovery line.
--   Validates source + status against the V417 CHECKs, refuses a negative amount,
--   and refuses to assert 'recovered' with no recovered_at date - a recovery is only
--   marked recovered against dated evidence, never on assertion alone. Gate:
--   elevated OR 'post_cost'.
-- =============================================================================
create or replace function public.accident_recovery_record(
  p_accident_id uuid,
  p_source      text,
  p_amount      numeric,
  p_status      text,
  p_recovered_at date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org     uuid;
  v_country text;
  v_site    text;
  v_source  text := lower(btrim(coalesce(p_source, '')));
  v_status  text := lower(btrim(coalesce(p_status, '')));
  v_row     public.accident_claim_recoveries%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if not (public.app_is_elevated() or public.app_user_can('accidents', 'post_cost')) then
    raise exception 'Not permitted to record a recovery.' using errcode = '42501';
  end if;

  if v_source <> any (array['insurer','third_party','driver','other']) then
    raise exception 'Invalid recovery source "%".', p_source using errcode = '22023';
  end if;

  if v_status <> any (array[
       'pending','in_progress','partial','recovered','written_off','not_applicable']) then
    raise exception 'Invalid recovery status "%".', p_status using errcode = '22023';
  end if;

  if p_amount is not null and p_amount < 0 then
    raise exception 'Recovery amount cannot be negative.' using errcode = '22023';
  end if;

  -- A recovery marked recovered must carry the date it was recovered (evidence).
  if v_status = 'recovered' and p_recovered_at is null then
    raise exception 'A recovered date is required to mark a recovery as recovered.'
      using errcode = '22023';
  end if;

  insert into public.accident_claim_recoveries
    (organisation_id, accident_id, country, site, source, amount, status,
     recovered_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_source, p_amount, v_status,
     p_recovered_at, auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'recovery', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 14c. accident_downtime_set - set the vehicle's off-road status on the case.
--   The vehicle carries ONE downtime record per case, so this updates the latest
--   row and inserts only when none exists. Validates vehicle_status against the
--   V417 CHECK. Gate: elevated OR 'execute_repair' OR 'validate' (Fleet owns the
--   asset's off-road state).
-- =============================================================================
create or replace function public.accident_downtime_set(
  p_accident_id        uuid,
  p_vehicle_status     text,
  p_offroad_start      date default null,
  p_expected_return_date date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_org      uuid;
  v_country  text;
  v_site     text;
  v_status   text := nullif(btrim(coalesce(p_vehicle_status, '')), '');
  v_existing uuid;
  v_row      public.accident_vehicle_downtime%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if not (public.app_is_elevated()
          or public.app_user_can('accidents', 'execute_repair')
          or public.app_user_can('accidents', 'validate')) then
    raise exception 'Not permitted to set vehicle downtime.' using errcode = '42501';
  end if;

  if v_status is not null and v_status <> any (array[
       'operational','restricted','awaiting_recovery','off_road_accident','under_inspection',
       'under_repair','ready_for_inspection','rejected_after_repair','returned_to_operation',
       'total_loss','disposed']) then
    raise exception 'Invalid vehicle status "%".', p_vehicle_status using errcode = '22023';
  end if;

  select id into v_existing
    from public.accident_vehicle_downtime
   where accident_id = p_accident_id
   order by created_at desc, id desc
   limit 1;

  if v_existing is not null then
    update public.accident_vehicle_downtime set
       vehicle_status      = coalesce(v_status, vehicle_status),
       offroad_start       = coalesce(p_offroad_start, offroad_start),
       expected_return_date = coalesce(p_expected_return_date, expected_return_date),
       updated_at          = now()
     where id = v_existing
    returning * into v_row;
  else
    insert into public.accident_vehicle_downtime
      (organisation_id, accident_id, country, site, vehicle_status, offroad_start,
       expected_return_date, created_by, created_at, updated_at)
    values
      (v_org, p_accident_id, v_country, v_site, v_status, p_offroad_start,
       p_expected_return_date, auth.uid(), now(), now())
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'downtime', to_jsonb(v_row));
end
$$;

-- -----------------------------------------------------------------------------
-- GRANTS - anon revoked, authenticated granted; the in-body self-gate is the real
-- boundary (house pattern, V416).
-- -----------------------------------------------------------------------------
revoke all on function public.accident_repair_order_upsert(uuid,text,text,text,numeric,date) from anon;
revoke all on function public.accident_repair_task_add(uuid,text,text,numeric,uuid,text) from anon;
revoke all on function public.accident_repair_task_complete(uuid,numeric,text) from anon;
revoke all on function public.accident_repair_qc(uuid,text,text) from anon;
revoke all on function public.accident_repair_complete(uuid,date,numeric) from anon;
revoke all on function public.accident_finance_txn_add(uuid,text,text,numeric,text) from anon;
revoke all on function public.accident_recovery_record(uuid,text,numeric,text,date) from anon;
revoke all on function public.accident_downtime_set(uuid,text,date,date) from anon;

grant execute on function public.accident_repair_order_upsert(uuid,text,text,text,numeric,date) to authenticated;
grant execute on function public.accident_repair_task_add(uuid,text,text,numeric,uuid,text) to authenticated;
grant execute on function public.accident_repair_task_complete(uuid,numeric,text) to authenticated;
grant execute on function public.accident_repair_qc(uuid,text,text) to authenticated;
grant execute on function public.accident_repair_complete(uuid,date,numeric) to authenticated;
grant execute on function public.accident_finance_txn_add(uuid,text,text,numeric,text) to authenticated;
grant execute on function public.accident_recovery_record(uuid,text,numeric,text,date) to authenticated;
grant execute on function public.accident_downtime_set(uuid,text,date,date) to authenticated;

commit;
-- =============================================================================
