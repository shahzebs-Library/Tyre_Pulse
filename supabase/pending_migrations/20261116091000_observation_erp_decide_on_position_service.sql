-- =====================================================================================
-- observation_erp_decide on the shared tyre position service (FOLLOW-UP)
--
-- STATUS: AUTHORED, NOT APPLIED. Draft for owner review. Tested on the local staging copy
--         (tp_position: main's applied migration first, then the two follow-up files).
--         Nothing here ran on production.
--         Do not apply without the owner's approval (withdrawn 2026-11-15 pending this revision).
--         Production today: the interim lock IS applied (version 20261115120856), so signed-in
--         users have no EXECUTE on decide or the two wrappers. This file grants it again, on
--         purpose, together with the corrected rules.
-- ORDER:  3 of 3. After 20261115120000_observation_erp_reconciliation.sql (applied to production
--         as version 20261115090615), 20261116085000_tyre_layout_versions_and_position_mappings.sql
--         and 20261116090000_tyre_position_service.sql.
--
-- LIVE STATE THIS BUILDS ON (read from production, SELECT only, 2026-11-15):
--   tables observation_erp_links, observation_erp_link_events (RLS on, 3 policies each, 0 rows,
--   authenticated SELECT only, NO reader policies); observation_erp_decide(uuid,uuid,text,text)
--   definer, empty search_path; confirm_ / reject_observation_erp_link wrappers; the events
--   append-only trigger. None of those objects is created, removed or altered here except the
--   BODY of observation_erp_decide.
--
-- WHAT CHANGES:
--   1. observation_erp_decide: SAME name, SAME arguments, SAME five-key result
--      (ok, decision, action_id, work_order_id, already_linked), same error codes and wording
--      for every live guard (caller, reason, own inspection damage action, tenant + country +
--      asset, country scope, job card number, chronology, already linked). The wheel is no
--      longer found with the hard-coded CASE table. Both the inspection slot and the ERP code
--      are resolved on the ASSET'S OWN layout by the position service; anything not resolved
--      (ambiguous, missing, inconsistent, unknown layout) is refused with PT409 and stays
--      pending manual review. The CASE table keyed the layout on the words in the inspection's
--      vehicle type, treated every non mixer as "R1 is rear axle 1", and let an unknown slot
--      fall through as raw text.
--   2. Serial SUPPORTS, it never confirms on its own (owner decision 2026-11-15). Live requires
--      the ERP row to carry the observed serial, which a replacement tyre never does; that
--      filter is gone. A real (strong) observed serial on the job card is reported as support,
--      and the observed serial on a DIFFERENT wheel blocks the match. When the wheel position
--      is unresolved, Confirm is REFUSED even with a matching serial. The only way through is
--      a documented exception with INDEPENDENT approval, always two different people:
--        a) a reviewer REQUESTS it (request_observation_erp_serial_exception, reason of at least
--           20 characters). This records a pending request and links nothing.
--        b) a DIFFERENT person who holds the separate capability corrective_actions /
--           erp_serial_exception (Admin and super admin by default, grantable per company in
--           Access Control) APPROVES it (approve_observation_erp_serial_exception) or refuses
--           it (refuse_...). The requester can never approve or refuse their own request,
--           whatever their role; this is checked in the functions, in the one writer and by a
--           table constraint. The requester may withdraw it.
--      The evidence is evaluated again at approval, for the approver's own company, country
--      and site scope. Request, approval, refusal and withdrawal each keep who, when and why
--      (table observation_erp_exception_requests: rows are never removed and a decided
--      request can never be changed), and an approved one is recorded on the link and in the
--      append-only history as exception_basis = 'serial_only' with the request id.
--   2b. PERMISSIONS are enforced inside the functions, never by the screen: signed in, approved,
--      not locked, own company, country in scope, site in scope, reviewer role (Admin, Manager,
--      Director) not switched off in Access Control (corrective_actions / approve revoke).
--   2c. observation_erp_rules(): tells the client which rules the database runs. The web client
--      offers Confirm / Reject only when this matches its own version.
--   3. Site: the reviewer must be able to see the action's, inspection's and job card's site.
--   3b. The link and history rows gain three nullable columns: position_evidence (what the
--      service found at decision time), exception_basis (null, or 'serial_only') and
--      exception_request_id. Existing rows are not touched.
--   3c. ONE new table, observation_erp_exception_requests (ships empty; company and country
--      walls; signed-in users may only read; written only by the functions here).
--   4. New read-only helper observation_erp_evaluate(action, job card): the same checks, returns
--      the evidence and writes nothing. decide calls it, so the two cannot disagree.
--   5. Reader policies for the two live tables (rule for any new table, missed by the applied
--      migration): anum_integration.apply_reader_policies().
--
-- WHAT IT NEVER DOES: remove anything, touch an existing link or
--       history row (tested: byte-identical before and after), change a tyre cost, a tyre
--       record, a work order or an inspection, close an action or change its status.
--
-- WORDING NOTE: no statement here removes a row or an object. Outside this header the word
--       "delete" appears once, in the definition of the trigger that REFUSES removing an
--       exception request ("before update or delete"). The Supabase confirm prompt may ask
--       for approval because of that word; it is unavoidable for an append-only guard.
--
-- VERIFY (rolled back; as an elevated user of the action's organisation and country):
--   begin;
--   select public.observation_erp_evaluate('<action>', '<work order>');          -- evidence, no write
--   select public.confirm_observation_erp_link('<action>', '<work order>', 'Reviewed job card');
--   select status, closed_at, work_order_id from public.corrective_actions where id = '<action>'; -- status unchanged
--   select has_function_privilege('anon', 'public.observation_erp_evaluate(uuid,uuid)', 'execute'); -- f
--   select count(*) from pg_policies where tablename like 'observation_erp_link%' and policyname like 'anum_reader%'; -- 8
--   rollback;
--
-- ROLLBACK: run 20261116091000_observation_erp_decide_ROLLBACK.sql (the exact live function;
--       verified on staging to give md5 272f785a2a32256bfe2b83b99d131c1b, the production value).
--       That file also takes EXECUTE away from signed-in users again, so the interim lock is
--       back in place and the earlier function cannot be called through the API.
--       The added columns, the (empty or historical) exception request table, the reader
--       policies and the position service functions may stay: the live function reads none.
-- =====================================================================================

-- -------------------------------------------------------------------------------------
-- observation_erp_evaluate: READ ONLY. Every guard of the live decide function, then what
-- the ERP tyre records on one job card say about the observed wheel.
--   state  offered_for_review     dated movement on the SAME canonical wheel. A person may confirm.
--          pending_manual_review  the wheel could not be established on this machine. A matching
--                                 serial does NOT change this (serial_supports = true is reported;
--                                 serial_exception_possible says a documented exception may be
--                                 recorded by an Admin)
--          inconsistent           observed serial on a different wheel, or the inspection was
--                                 recorded against another wheel plan than the asset has
--          different_wheel        the job card moved other wheels only
--          no_dated_movement      same wheel, no movement on or after the inspection day
--          no_tyre_movement       no tyre record names this job card
-- Mirror of evaluateErpCandidate in src/lib/erpObservationMatch.js.
-- -------------------------------------------------------------------------------------
create or replace function public.observation_erp_evaluate(p_action_id uuid, p_work_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_action public.corrective_actions%rowtype;
  v_inspection public.inspections%rowtype;
  v_work public.work_orders%rowtype;
  v_country text;
  v_day date;
  v_token text;
  v_layout jsonb;
  v_recorded jsonb;
  v_serial text;
  v_strong boolean;
  r record;
  c jsonb;
  v_rows int := 0;
  v_same int := 0;
  v_same_dated int := 0;
  v_pending int := 0;
  v_different int := 0;
  v_serial_rows int := 0;
  v_serial_pending_dated int := 0;
  v_serial_other_wheel int := 0;
  v_reasons jsonb := '{}'::jsonb;
  v_dated boolean;
  v_is_serial boolean;
  v_state text;
  v_canonical text;
  v_layout_conflict boolean := false;
begin
  -- Signed in, approved and not locked, in a company, a reviewer role, and not switched off
  -- for this person or role (Access Control: corrective_actions / approve, revoke).
  if auth.uid() is null or v_org is null or not public.app_is_active()
     or not public.app_is_elevated()
     or public.app_cap_revoked('corrective_actions', 'approve') then
    raise exception 'Not authorised to confirm ERP evidence' using errcode = '42501';
  end if;
  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org;
  if not found or v_action.source_type <> 'inspection' or v_action.source_detail not like 'damage:%' then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;
  select * into v_inspection from public.inspections
    where id = v_action.source_id and organisation_id = v_org;
  select * into v_work from public.work_orders
    where id = p_work_order_id and organisation_id = v_org;
  if v_inspection.id is null or v_work.id is null
     or v_action.country is distinct from v_work.country
     or v_work.country is distinct from v_inspection.country
     or upper(btrim(v_work.asset_no)) is distinct from upper(btrim(v_inspection.asset_no))
     or upper(btrim(v_action.asset_no)) is distinct from upper(btrim(v_work.asset_no)) then
    raise exception 'ERP job card must match inspection tenant, country and asset' using errcode = 'PT409';
  end if;
  v_country := v_work.country;
  if not (public.is_super_admin() or public.app_sees_all_countries()
          or lower(btrim(v_country)) = any(coalesce(public.app_country_scope(),'{}'::text[]))) then
    raise exception 'Country is outside permitted scope' using errcode = '42501';
  end if;
  if not (public.app_can_see_site(v_action.site) and public.app_can_see_site(v_inspection.site)
          and public.app_can_see_site(v_work.site)) then
    raise exception 'Site is outside permitted scope' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(v_work.work_order_no,'')), '') is null then
    raise exception 'Job card number missing' using errcode = 'PT409';
  end if;

  v_day := coalesce(v_inspection.inspection_date, v_inspection.created_at::date);
  -- damage:R1Ro -> R1Ro (mirror of positionFromSourceDetail).
  v_token := btrim(split_part(v_action.source_detail, ':', 2));
  if v_token = 'unknown position' then v_token := ''; end if;

  -- ONE layout for both sides: the asset's own, as registered.
  v_layout := public.tyre_asset_layout(v_org, v_country, v_work.asset_no, v_inspection.vehicle_type, v_day);
  if v_layout->>'status' = 'resolved' and nullif(btrim(coalesce(v_inspection.vehicle_type, '')), '') is not null then
    v_recorded := public.tyre_type_layout(v_org, v_inspection.vehicle_type, v_work.asset_no,
      (v_layout->>'axle_count')::integer, v_day);
    v_layout_conflict := v_recorded->>'status' = 'resolved' and v_recorded->>'key' is distinct from v_layout->>'key';
  end if;

  v_serial := upper(btrim(coalesce(v_action.tyre_serial, '')));
  v_strong := public.tyre_serial_is_strong(v_serial);

  for r in
    select coalesce(nullif(btrim(t.tyre_position), ''), nullif(btrim(t.position), ''), '') as pos,
           t.serial_no, t.issue_date, t.removal_date
    from public.tyre_records t
    where t.organisation_id = v_org and t.country = v_country
      and upper(btrim(t.asset_no)) = upper(btrim(v_work.asset_no))
      and upper(btrim(t.job_card)) = upper(btrim(v_work.work_order_no))
  loop
    v_rows := v_rows + 1;
    v_dated := coalesce(r.removal_date >= v_day, false) or coalesce(r.issue_date >= v_day, false);
    v_is_serial := v_strong and upper(btrim(coalesce(r.serial_no, ''))) = v_serial;
    if v_is_serial then v_serial_rows := v_serial_rows + 1; end if;
    if v_layout_conflict then
      c := jsonb_build_object('match', null, 'status', 'inconsistent', 'reason', 'inspection_layout_differs_from_asset');
    else
      c := public.tyre_position_compare(v_layout, v_token, r.pos);
    end if;
    if (c->>'match')::boolean is true then
      v_same := v_same + 1;
      v_canonical := c->>'canonical';
      if v_dated then v_same_dated := v_same_dated + 1; end if;
    elsif (c->>'match')::boolean is false then
      v_different := v_different + 1;
      if v_is_serial then v_serial_other_wheel := v_serial_other_wheel + 1; end if;
    else
      v_pending := v_pending + 1;
      if v_is_serial and v_dated then v_serial_pending_dated := v_serial_pending_dated + 1; end if;
      v_reasons := v_reasons || jsonb_build_object(c->>'reason',
        coalesce((v_reasons->>(c->>'reason'))::int, 0) + 1);
    end if;
  end loop;

  v_state := case
    when v_rows = 0 then 'no_tyre_movement'
    when v_layout_conflict or v_serial_other_wheel > 0 then 'inconsistent'
    when v_same_dated > 0 then 'offered_for_review'
    when v_pending > 0 then 'pending_manual_review'
    when v_same > 0 then 'no_dated_movement'
    else 'different_wheel' end;

  return jsonb_build_object(
    'ok', true, 'rules_version', 'position-service-3',
    'state', v_state, 'eligible_to_confirm', v_state = 'offered_for_review',
    'canonical', v_canonical, 'layout_key', v_layout->>'key', 'layout_status', v_layout->>'status',
    'layout_reason', v_layout->>'reason',
    'observation', public.tyre_position_resolve(v_layout, v_token, 'slot'),
    'tyre_rows', v_rows, 'same_wheel', v_same, 'same_wheel_dated', v_same_dated,
    'pending', v_pending, 'different_wheel', v_different, 'pending_reasons', v_reasons,
    'serial_is_strong', v_strong, 'serial_rows', v_serial_rows, 'serial_other_wheel', v_serial_other_wheel,
    'serial_supports', (v_serial_rows > 0 and v_serial_other_wheel = 0),
    'serial_exception_possible', (v_state = 'pending_manual_review' and v_serial_pending_dated > 0),
    'work_order_no', v_work.work_order_no, 'country', v_country,
    'work_opened_before_inspection', (v_work.opened_at is null or v_work.opened_at::date < v_day),
    'snapshot', jsonb_build_object(
      'work_order_no', v_work.work_order_no, 'asset_no', v_work.asset_no,
      'country', v_work.country, 'status', v_work.status, 'description', v_work.description,
      'notes', v_work.notes, 'opened_at', v_work.opened_at,
      'completed_at', v_work.completed_at));
end $$;

-- Two nullable columns on the live tables. No existing row is changed.
alter table public.observation_erp_links add column if not exists position_evidence jsonb;
alter table public.observation_erp_links add column if not exists exception_basis text;
alter table public.observation_erp_link_events add column if not exists position_evidence jsonb;
alter table public.observation_erp_link_events add column if not exists exception_basis text;
alter table public.observation_erp_links add column if not exists exception_request_id uuid;
alter table public.observation_erp_link_events add column if not exists exception_request_id uuid;

-- -------------------------------------------------------------------------------------
-- Exception requests: the two-person record. A row is written when a reviewer asks for a
-- documented serial exception and is completed, once, when a DIFFERENT authorised person
-- approves or refuses it (or the requester withdraws it). Rows are never removed; a decided
-- request never changes again. No signed-in user can write this table directly.
-- -------------------------------------------------------------------------------------
create table if not exists public.observation_erp_exception_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  country text,
  action_id uuid not null references public.corrective_actions(id),
  work_order_id uuid not null references public.work_orders(id),
  exception_basis text not null check (exception_basis = 'serial_only'),
  request_reason text not null check (length(btrim(request_reason)) between 20 and 2000),
  position_evidence jsonb not null,
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  status text not null default 'pending' check (status in ('pending', 'approved', 'refused', 'withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  -- independent approval: whoever approves or refuses is never the person who asked
  constraint observation_erp_exception_two_person check (
    status not in ('approved', 'refused') or (decided_by is not null and decided_by <> requested_by)),
  constraint observation_erp_exception_withdrawn_by_requester check (
    status <> 'withdrawn' or decided_by = requested_by),
  constraint observation_erp_exception_decided check ((status = 'pending') = (decided_at is null))
);
create unique index if not exists observation_erp_exception_one_pending
  on public.observation_erp_exception_requests (action_id, work_order_id) where status = 'pending';
create index if not exists observation_erp_exception_org_status
  on public.observation_erp_exception_requests (organisation_id, status, requested_at desc);
alter table public.observation_erp_exception_requests enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_exception_requests' and policyname = 'observation_erp_exception_org') then
    create policy observation_erp_exception_org on public.observation_erp_exception_requests as restrictive
      for all to authenticated
      using (organisation_id = (select public.app_current_org()))
      with check (organisation_id = (select public.app_current_org()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_exception_requests' and policyname = 'observation_erp_exception_country') then
    create policy observation_erp_exception_country on public.observation_erp_exception_requests as restrictive
      for select to authenticated
      using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
             or lower(btrim(country)) = any(coalesce((select public.app_country_scope()), '{}'::text[])));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'observation_erp_exception_requests' and policyname = 'observation_erp_exception_read') then
    create policy observation_erp_exception_read on public.observation_erp_exception_requests
      for select to authenticated using ((select public.app_is_active()));
  end if;
end $$;
revoke all on public.observation_erp_exception_requests from public, anon, authenticated;
grant select on public.observation_erp_exception_requests to authenticated;

-- A request row changes exactly once: pending to approved / refused / withdrawn, by the
-- functions below (they set a transaction flag). Nothing else may be changed and no row may
-- be removed.
create or replace function public.observation_erp_exception_requests_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE'
     and coalesce(current_setting('tyre_pulse.erp_exception_decide', true), 'off') = 'on'
     and old.status = 'pending' and new.status in ('approved', 'refused', 'withdrawn')
     and (to_jsonb(new) - 'status' - 'decided_by' - 'decided_at' - 'decision_note')
       = (to_jsonb(old) - 'status' - 'decided_by' - 'decided_at' - 'decision_note') then
    return new;
  end if;
  raise exception 'Exception requests are append-only' using errcode = 'PT409';
end $$;
revoke all on function public.observation_erp_exception_requests_guard() from public, anon, authenticated;
do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'observation_erp_exception_requests_guard'
                 and tgrelid = 'public.observation_erp_exception_requests'::regclass) then
    create trigger observation_erp_exception_requests_guard
      before update or delete on public.observation_erp_exception_requests
      for each row execute function public.observation_erp_exception_requests_guard();
  end if;
end $$;

-- -------------------------------------------------------------------------------------
-- observation_erp_decide_core: the one writer. Not callable by app roles; reached only through
-- observation_erp_decide (normal) and approve_observation_erp_serial_exception (independent
-- approver).
--   p_exception   null, or 'serial_only'
--   p_request_id  required with p_exception: the pending request, made by SOMEBODY ELSE
-- -------------------------------------------------------------------------------------
create or replace function public.observation_erp_decide_core(
  p_action_id uuid, p_work_order_id uuid, p_reason text, p_decision text, p_exception text, p_request_id uuid, p_approval_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_request public.observation_erp_exception_requests%rowtype;
  v_org uuid := public.app_current_org();
  v_eval jsonb;
  v_evidence jsonb;
  v_action public.corrective_actions%rowtype;
  v_existing public.observation_erp_links%rowtype;
begin
  -- Signed in, approved and not locked, in a company, a reviewer role, and not switched off
  -- for this person or role (Access Control: corrective_actions / approve, revoke).
  if auth.uid() is null or v_org is null or not public.app_is_active()
     or not public.app_is_elevated()
     or public.app_cap_revoked('corrective_actions', 'approve') then
    raise exception 'Not authorised to confirm ERP evidence' using errcode = '42501';
  end if;
  if p_decision not in ('confirmed','rejected') or length(btrim(coalesce(p_reason,''))) not between 5 and 2000 then
    raise exception 'Decision and reason are required' using errcode = '22023';
  end if;

  select * into v_action from public.corrective_actions
    where id = p_action_id and organisation_id = v_org for update;
  if not found or v_action.source_type <> 'inspection' or v_action.source_detail not like 'damage:%' then
    raise exception 'Only own inspection tyre actions may be linked' using errcode = '42501';
  end if;

  -- Tenant, country, site, asset and job card guards, and the wheel evidence.
  v_eval := public.observation_erp_evaluate(p_action_id, p_work_order_id);
  v_evidence := v_eval - 'snapshot';

  if p_decision = 'confirmed' and (v_eval->>'work_opened_before_inspection')::boolean then
    raise exception 'Job card predates the inspection. Manual investigation required' using errcode = 'PT409';
  end if;
  if p_decision = 'confirmed' and p_exception is null and not (v_eval->>'eligible_to_confirm')::boolean then
    if v_eval->>'state' in ('pending_manual_review', 'inconsistent') then
      raise exception 'The inspected wheel could not be matched on this vehicle (%). Pending manual review',
        v_eval->>'state' using errcode = 'PT409';
    end if;
    raise exception 'No ERP tyre movement matches the action position or serial' using errcode = 'PT409';
  end if;
  if p_exception is not null then
    -- A documented exception: only for an unresolved wheel with the observed real serial
    -- leaving on this job card, never for a different wheel or an inconsistent record.
    if p_exception <> 'serial_only' or p_decision <> 'confirmed'
       or not (v_eval->>'serial_exception_possible')::boolean then
      raise exception 'A serial exception does not apply to this job card' using errcode = 'PT409';
    end if;
    -- Independent approval, enforced in the one writer: a pending request for exactly this
    -- action and job card, raised by a different person than the one approving now.
    select * into v_request from public.observation_erp_exception_requests
      where id = p_request_id and organisation_id = v_org for update;
    if v_request.id is null or v_request.status <> 'pending'
       or v_request.action_id <> p_action_id or v_request.work_order_id <> p_work_order_id then
      raise exception 'No pending exception request for this job card' using errcode = 'PT409';
    end if;
    if v_request.requested_by = auth.uid() then
      raise exception 'An exception must be approved by a different person than the one who requested it' using errcode = '42501';
    end if;
  elsif p_request_id is not null then
    raise exception 'A serial exception does not apply to this job card' using errcode = 'PT409';
  end if;

  select * into v_existing from public.observation_erp_links where action_id=p_action_id for update;
  if p_decision='confirmed' then
    if v_existing.id is not null and v_existing.work_order_id <> p_work_order_id then
      raise exception 'Action already linked to another confirmed job card' using errcode='PT409';
    end if;
    if v_action.work_order_id is not null and v_action.work_order_id <> p_work_order_id then
      raise exception 'Corrective action already linked to a different work order' using errcode='PT409';
    end if;
    if v_existing.id is null then
      insert into public.observation_erp_links
        (organisation_id,country,action_id,work_order_id,source_job_card,work_order_snapshot,decision_note,reviewed_by,
         position_evidence,exception_basis,exception_request_id)
      values (v_org,v_eval->>'country',p_action_id,p_work_order_id,v_eval->>'work_order_no',v_eval->'snapshot',p_reason,auth.uid(),
         v_evidence,p_exception,p_request_id);
      update public.corrective_actions set work_order_id=p_work_order_id where id=p_action_id;
    end if;
  end if;
  insert into public.observation_erp_link_events
    (organisation_id,country,action_id,work_order_id,source_job_card,work_order_snapshot,decision,reason,reviewer,
     position_evidence,exception_basis,exception_request_id)
  values(v_org,v_eval->>'country',p_action_id,p_work_order_id,v_eval->>'work_order_no',v_eval->'snapshot',p_decision,p_reason,auth.uid(),
     v_evidence,p_exception,p_request_id);
  if p_exception is not null then
    perform set_config('tyre_pulse.erp_exception_decide', 'on', true);
    update public.observation_erp_exception_requests
      set status = 'approved', decided_by = auth.uid(), decided_at = clock_timestamp(),
          decision_note = btrim(p_approval_note)
      where id = p_request_id;
    perform set_config('tyre_pulse.erp_exception_decide', 'off', true);
  end if;
  return jsonb_build_object('ok',true,'decision',p_decision,
    'action_id',p_action_id,'work_order_id',p_work_order_id,
    'already_linked',(v_existing.id is not null));
end $$;

-- Same signature and five-key result as the live function. No exception path from here.
create or replace function public.observation_erp_decide(
  p_action_id uuid, p_work_order_id uuid, p_reason text, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  return public.observation_erp_decide_core(p_action_id, p_work_order_id, p_reason, p_decision, null, null, null);
end $$;

-- observation_erp_rules: READ ONLY, no arguments, reads no business row. Tells the client
-- which rules this database runs, so the screen offers a decision only when the database and
-- the client share the same validated rules. Absent on the old database = not available.
create or replace function public.observation_erp_rules()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'rules_version', 'position-service-3',
    'can_review', coalesce(auth.uid() is not null and public.app_current_org() is not null
      and public.app_is_active() and public.app_is_elevated()
      and not public.app_cap_revoked('corrective_actions', 'approve'), false),
    -- a reviewer may ASK for a documented exception; somebody else must approve it
    'can_request_exception', coalesce(auth.uid() is not null and public.app_current_org() is not null
      and public.app_is_active() and public.app_is_elevated()
      and not public.app_cap_revoked('corrective_actions', 'approve'), false),
    'can_approve_exception', coalesce(auth.uid() is not null and public.app_is_active()
      and public.app_is_elevated()
      and public.app_user_can('corrective_actions', 'erp_serial_exception'), false),
    'exception_needs_second_person', true)
$$;

-- The documented exception, step 1 of 2: a reviewer ASKS. Nothing is linked. The same gates
-- as a normal review (through observation_erp_evaluate: company, country, site, role), a real
-- reason, and the evidence must allow an exception at all.
create or replace function public.request_observation_erp_serial_exception(
  p_action_id uuid, p_work_order_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_eval jsonb;
  v_id uuid;
begin
  if length(btrim(coalesce(p_reason, ''))) not between 20 and 2000 then
    raise exception 'A serial exception needs a written reason of at least 20 characters' using errcode = '22023';
  end if;
  v_eval := public.observation_erp_evaluate(p_action_id, p_work_order_id);   -- raises 42501 / PT409
  if (v_eval->>'work_opened_before_inspection')::boolean then
    raise exception 'Job card predates the inspection. Manual investigation required' using errcode = 'PT409';
  end if;
  if not (v_eval->>'serial_exception_possible')::boolean then
    raise exception 'A serial exception does not apply to this job card' using errcode = 'PT409';
  end if;
  if exists (select 1 from public.observation_erp_links l where l.action_id = p_action_id) then
    raise exception 'Action already linked to a confirmed job card' using errcode = 'PT409';
  end if;
  begin
    insert into public.observation_erp_exception_requests
      (organisation_id, country, action_id, work_order_id, exception_basis, request_reason, position_evidence, requested_by)
    values (v_org, v_eval->>'country', p_action_id, p_work_order_id, 'serial_only', btrim(p_reason),
            v_eval - 'snapshot', auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'An exception request for this job card is already waiting for approval' using errcode = 'PT409';
  end;
  return jsonb_build_object('ok', true, 'request_id', v_id, 'status', 'pending');
end $$;

-- Step 2 of 2: a DIFFERENT person who holds the separate capability approves. The evidence
-- is evaluated again, for the approver's own scope, by the one writer.
create or replace function public.approve_observation_erp_serial_exception(p_request_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_request public.observation_erp_exception_requests%rowtype;
  v_out jsonb;
begin
  if auth.uid() is null or v_org is null or not public.app_is_active()
     or not public.app_user_can('corrective_actions', 'erp_serial_exception') then
    raise exception 'Not authorised to approve a serial exception' using errcode = '42501';
  end if;
  if length(btrim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'An approval note is required' using errcode = '22023';
  end if;
  select * into v_request from public.observation_erp_exception_requests
    where id = p_request_id and organisation_id = v_org for update;
  if v_request.id is null then
    raise exception 'Exception request not found' using errcode = '42501';
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This exception request was already decided' using errcode = 'PT409';
  end if;
  if v_request.requested_by = auth.uid() then
    raise exception 'An exception must be approved by a different person than the one who requested it' using errcode = '42501';
  end if;
  v_out := public.observation_erp_decide_core(v_request.action_id, v_request.work_order_id,
    v_request.request_reason, 'confirmed', 'serial_only', v_request.id, p_note);
  return v_out || jsonb_build_object('request_id', v_request.id, 'requested_by', v_request.requested_by);
end $$;

-- Refuse (an authorised person other than the requester) or withdraw (the requester only).
-- Links nothing. The request row keeps who, when and why.
create or replace function public.close_observation_erp_serial_exception(p_request_id uuid, p_outcome text, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org uuid := public.app_current_org();
  v_request public.observation_erp_exception_requests%rowtype;
begin
  if auth.uid() is null or v_org is null or not public.app_is_active() then
    raise exception 'Not authorised' using errcode = '42501';
  end if;
  if p_outcome not in ('refused', 'withdrawn') or length(btrim(coalesce(p_note, ''))) not between 5 and 2000 then
    raise exception 'Outcome and a note are required' using errcode = '22023';
  end if;
  select * into v_request from public.observation_erp_exception_requests
    where id = p_request_id and organisation_id = v_org for update;
  if v_request.id is null then
    raise exception 'Exception request not found' using errcode = '42501';
  end if;
  if p_outcome = 'withdrawn' and v_request.requested_by is distinct from auth.uid() then
    raise exception 'Only the person who made the request can withdraw it' using errcode = '42501';
  end if;
  if p_outcome = 'refused' then
    if v_request.requested_by = auth.uid()
       or not public.app_user_can('corrective_actions', 'erp_serial_exception') then
      raise exception 'Not authorised to refuse this exception request' using errcode = '42501';
    end if;
    -- same scope as an approval: the refuser must be able to see the country and the site
    if not (public.is_super_admin() or public.app_sees_all_countries() or v_request.country is null
            or lower(btrim(v_request.country)) = any(coalesce(public.app_country_scope(), '{}'::text[])))
       or not public.app_can_see_site((select a.site from public.corrective_actions a where a.id = v_request.action_id)) then
      raise exception 'Not authorised to refuse this exception request' using errcode = '42501';
    end if;
  end if;
  if v_request.status <> 'pending' then
    raise exception 'This exception request was already decided' using errcode = 'PT409';
  end if;
  perform set_config('tyre_pulse.erp_exception_decide', 'on', true);
  update public.observation_erp_exception_requests
    set status = p_outcome, decided_by = auth.uid(), decided_at = clock_timestamp(), decision_note = btrim(p_note)
    where id = p_request_id;
  perform set_config('tyre_pulse.erp_exception_decide', 'off', true);
  return jsonb_build_object('ok', true, 'request_id', p_request_id, 'status', p_outcome);
end $$;

revoke all on function public.observation_erp_evaluate(uuid, uuid) from public, anon;
grant execute on function public.observation_erp_evaluate(uuid, uuid) to authenticated;
revoke all on function public.observation_erp_decide_core(uuid, uuid, text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.observation_erp_decide_core(uuid, uuid, text, text, text, uuid, text) to service_role;
-- Deliberate re-grant. create or replace keeps whatever ACL is there, and the interim lock
-- (20261116084000) may have taken EXECUTE away from authenticated. From here the function
-- runs the corrected rules and checks company, country, site and role itself, so signed-in
-- users may call it again, directly or through the two wrappers.
revoke all on function public.observation_erp_decide(uuid, uuid, text, text) from public, anon;
grant execute on function public.observation_erp_decide(uuid, uuid, text, text) to authenticated, service_role;
revoke all on function public.confirm_observation_erp_link(uuid, uuid, text) from public, anon;
grant execute on function public.confirm_observation_erp_link(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.reject_observation_erp_link(uuid, uuid, text) from public, anon;
grant execute on function public.reject_observation_erp_link(uuid, uuid, text) to authenticated, service_role;
revoke all on function public.observation_erp_rules() from public, anon;
grant execute on function public.observation_erp_rules() to authenticated;
revoke all on function public.request_observation_erp_serial_exception(uuid, uuid, text) from public, anon;
grant execute on function public.request_observation_erp_serial_exception(uuid, uuid, text) to authenticated;
revoke all on function public.approve_observation_erp_serial_exception(uuid, text) from public, anon;
grant execute on function public.approve_observation_erp_serial_exception(uuid, text) to authenticated;
revoke all on function public.close_observation_erp_serial_exception(uuid, text, text) from public, anon;
grant execute on function public.close_observation_erp_serial_exception(uuid, text, text) to authenticated;

-- The two live tables were created without the read-only reporting role's policies, and
-- this file creates one table.
select anum_integration.apply_reader_policies();
