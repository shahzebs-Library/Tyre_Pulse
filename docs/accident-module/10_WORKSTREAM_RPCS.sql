-- =============================================================================
-- ACCIDENT CASE MODEL - PER-TEAM WORKSTREAM RPCs (Phase 2, items 6-14)
-- =============================================================================
-- STATUS: AUTHORED, NOT YET APPLIED. This file is a REVIEW ARTIFACT only. It has
-- NOT been run against any database and carries no `supabase_migrations` row.
--
-- RUN ORDER: this script RUNS AFTER V417 (02_DATA_MODEL.sql - the case model
-- tables, columns, RLS and the closure-enforcement guard) AND AFTER V418
-- (08_ENGINE_SQL_MIRROR.sql - the SQL twin of src/lib/accidentCase.js). It calls
-- V417 tables (accident_case_workstreams / accident_case_tasks /
-- accident_case_approvals / accident_closure_reviews) and, when present, the V418
-- mirror function public.accident_can_fully_close(...) to enforce the closure gate.
-- RE-CONFIRM THE NEXT-FREE MIGRATION NUMBER AT APPLY TIME: V417 and V418 are the
-- accident model / engine-mirror artifacts; if the accident batch lands as those
-- numbers this file takes the next free number after them; if the standing
-- V419-V422 batch (PROJECT_MEMORY part 13) or any other migration lands first,
-- renumber this file accordingly. Nothing here depends on its own number.
--
-- WHY IT EXISTS
--   The frontend contract src/lib/api/accidentCase.js writes workstream / task /
--   closure rows directly through PostgREST, governed by the V417 per-capability
--   RLS write policies. Those direct writes are correct for a plain field edit, but
--   the per-team ACTIONS in the brief (a team sets its workstream status, marks a
--   section not applicable with an approved reason, assigns an owner, raises and
--   closes a task, requests and decides a closure) each need an ATOMIC,
--   SERVER-VALIDATED transition that a raw table write cannot express:
--     * a status / key typo must be refused (not silently stored),
--     * a Not Applicable on a spine workstream must be refused outright (§8.3),
--     * an NA must carry an approval, recorded on the ledger,
--     * a fully-closed closure decision must satisfy the closure gate BEFORE the
--       approved review row exists (the V417 guard reads that row to ALLOW closure,
--       so recording it without the gate check would be the bypass the guard exists
--       to prevent).
--   These RPCs are that server boundary. The case MATHS are NOT re-implemented here
--   (they live in the pure engine src/lib/accidentCase.js and its V418 SQL mirror);
--   this layer validates, gates, writes and, for closure, delegates the gate to the
--   mirror.
--
-- SECURITY (house pattern - V416 / V398 / V229)
--   Every RPC is SECURITY DEFINER with search_path pinned to 'public'. Because a
--   DEFINER function bypasses RLS, each one RE-CHECKS, in its own body:
--     1. org: the target accident's organisation_id = app_current_org() OR super.
--     2. country + site: app_can_see_country() AND app_can_see_site() on the
--        accident's own country/site (the same scope the V417 RLS enforces).
--     3. capability: app_is_elevated() (Admin/Manager/Director) OR
--        app_user_can('accidents', <cap>) for the capability that owns the action
--        (the C2/C3 map in V417 PART E / PART F). So a non-elevated Insurance Claims
--        Officer granted 'edit_insurance' can act on the insurance workstream but
--        not the repair one, and a KSA-scoped user cannot touch an Egypt case.
--   anon EXECUTE is revoked on every function; authenticated is granted; the
--   in-body self-gate is the real boundary. Idempotent-safe where it makes sense
--   (status/assign upsert the single (accident_id, workstream_key) row).
--
-- MIRROR DISCIPLINE
--   The ten workstream keys, the twelve workstream-status tokens, the NON_WAIVABLE
--   spine set (incident_evidence / liability / finance) and the three closure-level
--   tokens below are copied VERBATIM from src/lib/accidentCase.js
--   (WORKSTREAM_KEYS, WORKSTREAM_STATUS_TOKENS, NON_WAIVABLE, closureLevel). Change
--   this file and that engine together, exactly like accident_stage_order <->
--   STAGE_FLOW.
--
-- ROLLBACK (paste and run to reverse this file)
--   drop function if exists
--     public.accident_ws_set_status(uuid,text,text,text),
--     public.accident_ws_mark_na(uuid,text,text,uuid),
--     public.accident_ws_assign(uuid,text,uuid,text,text),
--     public.accident_task_create(uuid,text,text,uuid,text,text,text,timestamptz,text),
--     public.accident_task_complete(uuid,text),
--     public.accident_request_closure(uuid,text,text,uuid),
--     public.accident_decide_closure(uuid,text,text,uuid,text,jsonb),
--     public._accident_ws_cap(text),
--     public._accident_rpc_context(uuid);
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- INTERNAL HELPER A - workstream_key -> owning accident capability.
--   Mirrors the intent of the V417 PART E cap_map for the dedicated per-team
--   tables, applied at the workstream grain so segregation of duties holds for a
--   direct workstream action. IMMUTABLE: it reads nothing but its argument.
--   Returns NULL for an unknown key so the caller can decide how to gate.
-- -----------------------------------------------------------------------------
create or replace function public._accident_ws_cap(p_key text)
returns text
language sql
immutable
set search_path to 'public'
as $$
  select case p_key
    when 'incident_evidence' then 'submit'
    when 'fleet_validation'  then 'validate'
    when 'liability'         then 'approve_liability'
    when 'insurance'         then 'edit_insurance'
    when 'assessment'        then 'assess'
    when 'repair'            then 'execute_repair'
    when 'workshop_qc'       then 'qc_repair'
    when 'handover'          then 'accept_handover'
    when 'finance'           then 'post_cost'
    when 'corrective'        then 'approve_liability'
    else null
  end
$$;

-- -----------------------------------------------------------------------------
-- INTERNAL HELPER B - resolve + authorise the case CONTEXT for an action.
--   Loads the accident's organisation_id / country / site under DEFINER (bypassing
--   RLS) and RE-ASSERTS the org + country + site boundary that RLS would otherwise
--   enforce, raising 42501 (insufficient_privilege) or P0002 (no_data_found) on
--   failure. Every RPC below calls this FIRST. Not granted to anon; the outer
--   DEFINER RPCs call it as their owner, so no authenticated grant is needed.
-- -----------------------------------------------------------------------------
create or replace function public._accident_rpc_context(
  p_accident_id uuid,
  out v_org uuid,
  out v_country text,
  out v_site text
)
returns record
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_cur uuid;
begin
  if p_accident_id is null then
    raise exception 'An incident is required.' using errcode = '22023';
  end if;

  select a.organisation_id, a.country, a.site
    into v_org, v_country, v_site
    from public.accidents a
   where a.id = p_accident_id;

  if v_org is null then
    raise exception 'Incident % not found.', p_accident_id using errcode = 'P0002';
  end if;

  v_cur := public.app_current_org();
  if not ((v_org = v_cur) or public.is_super_admin()) then
    raise exception 'Not permitted for this organisation.' using errcode = '42501';
  end if;

  if not (public.app_can_see_country(v_country) and public.app_can_see_site(v_site)) then
    raise exception 'Not permitted for this case country/site scope.' using errcode = '42501';
  end if;
end
$$;

revoke all on function public._accident_ws_cap(text) from public;
revoke all on function public._accident_rpc_context(uuid) from public;

-- =============================================================================
-- 1. accident_ws_set_status - set (or upsert) one workstream's status + note.
--   Validates the key is one of the ten and the status is one of the twelve
--   WORKSTREAM_STATUS tokens, so a typo never lands a row the completeness /
--   closure engine cannot read. Idempotent: upserts the single
--   (accident_id, workstream_key) row and stamps the lifecycle timestamps.
-- =============================================================================
create or replace function public.accident_ws_set_status(
  p_accident_id   uuid,
  p_workstream_key text,
  p_status        text,
  p_note          text default null
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
  v_cap     text;
  v_status  text := lower(btrim(coalesce(p_status, '')));
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_row     public.accident_case_workstreams%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if p_workstream_key is null or p_workstream_key <> any (array[
       'incident_evidence','fleet_validation','liability','insurance','assessment',
       'repair','workshop_qc','handover','finance','corrective']) then
    raise exception 'Unknown workstream "%".', p_workstream_key using errcode = '22023';
  end if;

  if v_status <> any (array[
       'not_required','not_started','assigned','in_progress','waiting_info',
       'waiting_approval','waiting_external','on_hold','completed','rejected',
       'reopened','cancelled']) then
    raise exception 'Invalid workstream status "%".', p_status using errcode = '22023';
  end if;

  -- Capability gate: elevated OR the workstream's owning cap OR the cross-workstream
  -- 'validate' (Fleet Supervisor) cap that opens and steers workstreams.
  v_cap := coalesce(public._accident_ws_cap(p_workstream_key), 'validate');
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', v_cap)
          or public.app_user_can('accidents', 'validate')) then
    raise exception 'Not permitted to update this workstream.' using errcode = '42501';
  end if;

  insert into public.accident_case_workstreams
    (organisation_id, accident_id, country, site, workstream_key, status, notes,
     assigned_at, started_at, completed_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, p_workstream_key, v_status, v_note,
     case when v_status = 'assigned'    then now() end,
     case when v_status = 'in_progress' then now() end,
     case when v_status = 'completed'   then now() end,
     auth.uid(), now(), now())
  on conflict (accident_id, workstream_key) do update set
     status       = excluded.status,
     notes        = coalesce(excluded.notes, public.accident_case_workstreams.notes),
     assigned_at  = coalesce(public.accident_case_workstreams.assigned_at, excluded.assigned_at),
     started_at   = coalesce(public.accident_case_workstreams.started_at, excluded.started_at),
     completed_at = case
                      when excluded.status = 'completed'
                        then coalesce(public.accident_case_workstreams.completed_at, now())
                      else public.accident_case_workstreams.completed_at
                    end,
     updated_at   = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'workstream', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 2. accident_ws_mark_na - mark a workstream Not Applicable with an APPROVED
--   reason envelope (WHO / WHEN / WHY). Refuses the NON_WAIVABLE spine
--   (incident_evidence / liability / finance) outright - those can never be
--   switched off, no matter who approves (accidentCase.NON_WAIVABLE, brief §8.3).
--   Approval is MANDATORY (p_approved_by): a bare switch-off does not satisfy the
--   closure gate. Writes status=not_required + na_reason/na_by/na_at, and records
--   the approval on the accident_case_approvals ledger as an na_waiver.
-- =============================================================================
create or replace function public.accident_ws_mark_na(
  p_accident_id    uuid,
  p_workstream_key text,
  p_reason         text,
  p_approved_by    uuid default null
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
  v_cap     text;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_row     public.accident_case_workstreams%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if p_workstream_key is null or p_workstream_key <> any (array[
       'incident_evidence','fleet_validation','liability','insurance','assessment',
       'repair','workshop_qc','handover','finance','corrective']) then
    raise exception 'Unknown workstream "%".', p_workstream_key using errcode = '22023';
  end if;

  -- NON_WAIVABLE: the spine of the case can never be marked not applicable.
  if p_workstream_key = any (array['incident_evidence','liability','finance']) then
    raise exception
      'Workstream "%" is mandatory and cannot be marked not applicable.', p_workstream_key
      using errcode = '42501';
  end if;

  if v_reason is null then
    raise exception 'A reason is required to mark a workstream not applicable.'
      using errcode = '22023';
  end if;

  -- Approval is required for a valid NA envelope (§8.3 / naEnvelopeValid).
  if p_approved_by is null then
    raise exception 'An approver is required to mark a workstream not applicable.'
      using errcode = '42501';
  end if;

  v_cap := coalesce(public._accident_ws_cap(p_workstream_key), 'validate');
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', v_cap)
          or public.app_user_can('accidents', 'validate')) then
    raise exception 'Not permitted to waive this workstream.' using errcode = '42501';
  end if;

  insert into public.accident_case_workstreams
    (organisation_id, accident_id, country, site, workstream_key, status, required,
     not_applicable, na_reason, na_by, na_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, p_workstream_key, 'not_required', false,
     true, v_reason, auth.uid(), now(), auth.uid(), now(), now())
  on conflict (accident_id, workstream_key) do update set
     status         = 'not_required',
     required       = false,
     not_applicable = true,
     na_reason      = excluded.na_reason,
     na_by          = excluded.na_by,
     na_at          = now(),
     updated_at     = now()
  returning * into v_row;

  -- Record the approval on the case-approvals ledger (na_waiver), so WHO approved
  -- the waiver is auditable even though the workstream row stores only na_by (WHO
  -- marked it). The closure gate reads a valid NA envelope; the ledger keeps the
  -- approval accountable.
  insert into public.accident_case_approvals
    (organisation_id, accident_id, country, site, approval_type, workstream_key,
     requested_by, requested_at, decided_by, decided_at, decision, reason,
     created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, 'na_waiver', p_workstream_key,
     auth.uid(), now(), p_approved_by, now(), 'approved', v_reason,
     auth.uid(), now(), now());

  return jsonb_build_object('ok', true, 'workstream', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 3. accident_ws_assign - assign an owner / role / team to a workstream.
--   Upserts owner_id / owner_role / team + assigned_at; promotes a fresh
--   (not_started / null) workstream to 'assigned' without disturbing an already
--   in-progress one. Gate: elevated OR the workstream's owning cap OR 'validate'
--   (the Fleet coordination cap that hands work out).
-- =============================================================================
create or replace function public.accident_ws_assign(
  p_accident_id    uuid,
  p_workstream_key text,
  p_owner_id       uuid,
  p_owner_role     text default null,
  p_team           text default null
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
  v_cap     text;
  v_row     public.accident_case_workstreams%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if p_workstream_key is null or p_workstream_key <> any (array[
       'incident_evidence','fleet_validation','liability','insurance','assessment',
       'repair','workshop_qc','handover','finance','corrective']) then
    raise exception 'Unknown workstream "%".', p_workstream_key using errcode = '22023';
  end if;

  v_cap := coalesce(public._accident_ws_cap(p_workstream_key), 'validate');
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', v_cap)
          or public.app_user_can('accidents', 'validate')) then
    raise exception 'Not permitted to assign this workstream.' using errcode = '42501';
  end if;

  insert into public.accident_case_workstreams
    (organisation_id, accident_id, country, site, workstream_key, status,
     owner_id, owner_role, team, assigned_at, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, p_workstream_key, 'assigned',
     p_owner_id, nullif(btrim(coalesce(p_owner_role, '')), ''),
     nullif(btrim(coalesce(p_team, '')), ''), now(), auth.uid(), now(), now())
  on conflict (accident_id, workstream_key) do update set
     owner_id    = excluded.owner_id,
     owner_role  = coalesce(excluded.owner_role, public.accident_case_workstreams.owner_role),
     team        = coalesce(excluded.team, public.accident_case_workstreams.team),
     assigned_at = coalesce(public.accident_case_workstreams.assigned_at, now()),
     status      = case
                     when public.accident_case_workstreams.status in ('not_started')
                       then 'assigned'
                     else public.accident_case_workstreams.status
                   end,
     updated_at  = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'workstream', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 4a. accident_task_create - raise an actionable task on a case (role inbox).
--   Validates priority + the optional workstream_key. Gate: elevated OR the
--   owning cap of the task's workstream (or 'submit' for a general case task) OR
--   'validate'. Returns the created task.
-- =============================================================================
create or replace function public.accident_task_create(
  p_accident_id    uuid,
  p_title          text,
  p_workstream_key text default null,
  p_assignee_id    uuid default null,
  p_assignee_role  text default null,
  p_team           text default null,
  p_priority       text default 'medium',
  p_due_at         timestamptz default null,
  p_description    text default null
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
  v_cap      text;
  v_priority text := lower(btrim(coalesce(p_priority, 'medium')));
  v_title    text := nullif(btrim(coalesce(p_title, '')), '');
  v_ws       text := nullif(btrim(coalesce(p_workstream_key, '')), '');
  v_row      public.accident_case_tasks%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_title is null then
    raise exception 'A task title is required.' using errcode = '22023';
  end if;

  if v_priority <> any (array['low','medium','high','critical']) then
    raise exception 'Invalid task priority "%".', p_priority using errcode = '22023';
  end if;

  if v_ws is not null and v_ws <> any (array[
       'incident_evidence','fleet_validation','liability','insurance','assessment',
       'repair','workshop_qc','handover','finance','corrective']) then
    raise exception 'Unknown workstream "%".', p_workstream_key using errcode = '22023';
  end if;

  v_cap := coalesce(public._accident_ws_cap(v_ws), 'submit');
  if not (public.app_is_elevated()
          or public.app_user_can('accidents', v_cap)
          or public.app_user_can('accidents', 'submit')
          or public.app_user_can('accidents', 'validate')) then
    raise exception 'Not permitted to create a task on this case.' using errcode = '42501';
  end if;

  insert into public.accident_case_tasks
    (organisation_id, accident_id, country, site, workstream_key, title, description,
     assignee_id, assignee_role, team, priority, due_at, status,
     created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_ws, v_title,
     nullif(btrim(coalesce(p_description, '')), ''),
     p_assignee_id, nullif(btrim(coalesce(p_assignee_role, '')), ''),
     nullif(btrim(coalesce(p_team, '')), ''), v_priority, p_due_at,
     case when p_assignee_id is not null then 'assigned' else 'open' end,
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'task', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 4b. accident_task_complete - mark a task completed. Derives the case context
--   from the task itself and re-asserts org/country/site scope. Gate: elevated OR
--   the caller is the task's assignee OR the owning cap of the task's workstream
--   (or 'submit'). Idempotent: completing an already-completed task is a no-op
--   that still returns ok.
-- =============================================================================
create or replace function public.accident_task_complete(
  p_task_id uuid,
  p_note    text default null
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
  v_task     public.accident_case_tasks%rowtype;
  v_cap      text;
  v_uid      uuid := auth.uid();
begin
  if p_task_id is null then
    raise exception 'A task is required.' using errcode = '22023';
  end if;

  select * into v_task from public.accident_case_tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task % not found.', p_task_id using errcode = 'P0002';
  end if;

  -- Re-assert org + country + site scope via the task's parent case.
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(v_task.accident_id);

  v_cap := coalesce(public._accident_ws_cap(v_task.workstream_key), 'submit');
  if not (public.app_is_elevated()
          or (v_task.assignee_id is not null and v_task.assignee_id = v_uid)
          or public.app_user_can('accidents', v_cap)
          or public.app_user_can('accidents', 'submit')) then
    raise exception 'Not permitted to complete this task.' using errcode = '42501';
  end if;

  if v_task.status in ('completed', 'cancelled') then
    return jsonb_build_object('ok', true, 'task', to_jsonb(v_task), 'unchanged', true);
  end if;

  update public.accident_case_tasks set
     status       = 'completed',
     completed_at = now(),
     completed_by = v_uid,
     description  = case
                      when nullif(btrim(coalesce(p_note, '')), '') is not null
                        then coalesce(description, '') ||
                             case when coalesce(description, '') = '' then '' else E'\n' end ||
                             btrim(p_note)
                      else description
                    end,
     updated_at   = now()
   where id = p_task_id
  returning * into v_task;

  return jsonb_build_object('ok', true, 'task', to_jsonb(v_task));
end
$$;

-- =============================================================================
-- 5a. accident_request_closure - submit a case for closure review at a level.
--   Records a closure-review row (decision 'returned' = submitted, awaiting the
--   manager's decision - matches src/lib/api/accidentCase.requestClosure). Level
--   is one of the three closure levels (accidentCase.closureLevel tokens). Gate:
--   elevated OR 'close_case', with the lighter interim levels also open to
--   'submit' (a case owner may request an interim sign-off).
-- =============================================================================
create or replace function public.accident_request_closure(
  p_accident_id uuid,
  p_level       text,
  p_remarks     text default null,
  p_reviewer_id uuid default null
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
  v_level   text := lower(btrim(coalesce(p_level, '')));
  v_row     public.accident_closure_reviews%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_level <> any (array['operationally_completed','financially_open','fully_closed']) then
    raise exception 'Invalid closure level "%".', p_level using errcode = '22023';
  end if;

  -- Requesting a FULL closure needs the close_case cap; the interim levels are also
  -- open to a case owner (submit).
  if v_level = 'fully_closed' then
    if not (public.app_is_elevated() or public.app_user_can('accidents', 'close_case')) then
      raise exception 'Not permitted to request full closure.' using errcode = '42501';
    end if;
  else
    if not (public.app_is_elevated()
            or public.app_user_can('accidents', 'close_case')
            or public.app_user_can('accidents', 'submit')) then
      raise exception 'Not permitted to request closure review.' using errcode = '42501';
    end if;
  end if;

  insert into public.accident_closure_reviews
    (organisation_id, accident_id, country, site, level, reviewer_id, decision,
     blockers, remarks, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_level, p_reviewer_id, 'returned',
     '[]'::jsonb, nullif(btrim(coalesce(p_remarks, '')), ''),
     auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'review', to_jsonb(v_row));
end
$$;

-- =============================================================================
-- 5b. accident_decide_closure - record a manager's closure-review decision.
--   Gate: elevated OR 'close_case'. For an APPROVED fully_closed decision this
--   function ENFORCES the closure gate BEFORE writing the approved review, by
--   delegating to the V418 mirror public.accident_can_fully_close(...) when it is
--   present: because the V417 BEFORE-UPDATE guard enforce_accident_closure reads an
--   approved fully_closed review to ALLOW accidents.closure_level=fully_closed,
--   letting an approved review be minted without the gate check would be exactly the
--   bypass that guard exists to stop. When the mirror is not yet applied the review
--   is still recorded and the V417 guard remains the closure floor. This RPC never
--   flips accidents.closure_level / case_status itself - that is the phase-later
--   derive / close action; here we only record the reviewed decision on the ledger.
-- =============================================================================
create or replace function public.accident_decide_closure(
  p_accident_id uuid,
  p_level       text,
  p_decision    text,
  p_reviewer_id uuid default null,
  p_remarks     text default null,
  p_blockers    jsonb default '[]'::jsonb
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
  v_level    text := lower(btrim(coalesce(p_level, '')));
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_case     jsonb;
  v_ws       jsonb;
  v_route    text;
  v_gate     jsonb;
  v_row      public.accident_closure_reviews%rowtype;
begin
  select org, country, site
    into v_org, v_country, v_site
    from public._accident_rpc_context(p_accident_id);

  if v_level <> any (array['operationally_completed','financially_open','fully_closed']) then
    raise exception 'Invalid closure level "%".', p_level using errcode = '22023';
  end if;
  if v_decision <> any (array['approved','rejected','returned']) then
    raise exception 'Invalid closure decision "%".', p_decision using errcode = '22023';
  end if;
  if jsonb_typeof(coalesce(p_blockers, '[]'::jsonb)) is distinct from 'array' then
    raise exception 'Blockers must be a JSON array.' using errcode = '22023';
  end if;

  -- Only a manager-level actor decides closure.
  if not (public.app_is_elevated() or public.app_user_can('accidents', 'close_case')) then
    raise exception 'Not permitted to decide closure.' using errcode = '42501';
  end if;

  -- Gate enforcement for an APPROVED full closure: the case must genuinely pass
  -- accident_can_fully_close (the SQL twin of accidentCase.canFullyClose). Guarded
  -- by to_regprocedure so this file also applies cleanly if the V418 mirror has not
  -- landed yet; when the mirror is absent the V417 trigger stays the floor.
  if v_decision = 'approved' and v_level = 'fully_closed'
     and to_regprocedure(
           'public.accident_can_fully_close(jsonb,jsonb,text,jsonb,timestamptz)') is not null then
    select to_jsonb(a) into v_case from public.accidents a where a.id = p_accident_id;
    select coalesce(jsonb_agg(to_jsonb(w)), '[]'::jsonb) into v_ws
      from public.accident_case_workstreams w where w.accident_id = p_accident_id;
    v_route := coalesce((v_case ->> 'route_key'), 'standard');

    execute
      'select public.accident_can_fully_close($1,$2,$3,$4,$5)'
      into v_gate
      using v_case, v_ws, v_route, '{}'::jsonb, now();

    if v_gate is not null and coalesce((v_gate ->> 'ok')::boolean, false) is not true then
      raise exception 'Closure gate not satisfied: %',
        coalesce(v_gate -> 'blockers', '[]'::jsonb)::text
        using errcode = '42501';
    end if;
  end if;

  insert into public.accident_closure_reviews
    (organisation_id, accident_id, country, site, level, reviewer_id, reviewed_at,
     decision, blockers, remarks, created_by, created_at, updated_at)
  values
    (v_org, p_accident_id, v_country, v_site, v_level, coalesce(p_reviewer_id, auth.uid()),
     now(), v_decision, coalesce(p_blockers, '[]'::jsonb),
     nullif(btrim(coalesce(p_remarks, '')), ''), auth.uid(), now(), now())
  returning * into v_row;

  return jsonb_build_object('ok', true, 'review', to_jsonb(v_row));
end
$$;

-- -----------------------------------------------------------------------------
-- GRANTS - anon revoked, authenticated granted; the in-body self-gate is the real
-- boundary (house pattern, V416).
-- -----------------------------------------------------------------------------
revoke all on function public.accident_ws_set_status(uuid,text,text,text) from anon;
revoke all on function public.accident_ws_mark_na(uuid,text,text,uuid) from anon;
revoke all on function public.accident_ws_assign(uuid,text,uuid,text,text) from anon;
revoke all on function public.accident_task_create(uuid,text,text,uuid,text,text,text,timestamptz,text) from anon;
revoke all on function public.accident_task_complete(uuid,text) from anon;
revoke all on function public.accident_request_closure(uuid,text,text,uuid) from anon;
revoke all on function public.accident_decide_closure(uuid,text,text,uuid,text,jsonb) from anon;

grant execute on function public.accident_ws_set_status(uuid,text,text,text) to authenticated;
grant execute on function public.accident_ws_mark_na(uuid,text,text,uuid) to authenticated;
grant execute on function public.accident_ws_assign(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.accident_task_create(uuid,text,text,uuid,text,text,text,timestamptz,text) to authenticated;
grant execute on function public.accident_task_complete(uuid,text) to authenticated;
grant execute on function public.accident_request_closure(uuid,text,text,uuid) to authenticated;
grant execute on function public.accident_decide_closure(uuid,text,text,uuid,text,jsonb) to authenticated;

commit;
-- =============================================================================
