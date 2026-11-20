-- =============================================================================
-- 20261120108000_inv_approvals.sql
-- STATUS: AUTHORED, NOT APPLIED. Mandatory inventory approvals. Requires 20261120100000..107000
--         and the live governed approval engine (20260910182201 governed_approval_policies,
--         20260919100000 region routing). Rollback: 20261120108000_inv_approvals_ROLLBACK.sql
--
-- WHAT IS REUSED FROM THE EXISTING ENGINE (no second policy engine):
--   * approval_policies stays the ONE place approval routes are authored, versioned,
--     published and retired (Approval Policies screen, approval_policy_save/publish).
--     Its entity_type CHECK is widened with four inventory types:
--       inventory_stock_adjustment, inventory_recount_assignment,
--       inventory_opening_balance_batch, inventory_cost_reconciliation.
--   * approval_private.resolve(...) picks the route exactly as for inspections and
--     work orders (priority, specificity, country, region, site, role, person).
--   * Stage semantics come from the policy stages (name, approver_user_id |
--     approver_role, require_signature, prevent_self_approval, distinct_reviewer).
-- WHAT IS ADDED (a thin adapter, because decide_approval / approval_private.document /
-- approval_private.context hard-code inspection, checklist, work_order and tyre_change,
-- and person_eligible hard-codes workshop roles; changing them would change live
-- inspection and checklist approvals):
--   * inventory_approval_requests (one active request per entity, route snapshot)
--     and inventory_approval_decisions (append-only stage decisions);
--   * inv_request_approval(p_payload {entity_type, entity_id, idempotency_key,
--     proposal?, reason?}) and inv_approval_decide(p_payload {request_id, decision
--     approve|reject, note, signature?, idempotency_key});
--   * view v_inv_pending_approvals (can_decide + blocked_reason per request).
-- SAFE DEFAULT when no inventory policy is published for the company: one stage
-- "Elevated approver" = Admin / Manager / Director (app_is_elevated) who is not the
-- creator, preparer, counter or recounter. If policies exist for the type but none
-- matches (or two tie) the request is REFUSED (no silent fallback), as the live
-- engine does for documents.
--
-- POSTING GATES (database triggers, so every path is covered, not just one RPC):
--   * inventory_adjustments -> 'posted' needs an approved stock_adjustment request
--     whose snapshot qty_change still matches; the request is consumed.
--   * opening_balance_batches -> 'approved' needs an approved opening_balance_batch
--     request (and CHECK approved_by <> prepared_by).
--   * inventory_audits.recount_counter_id set/changed needs an approved
--     recount_assignment request for exactly that counter; the recounter can never
--     be the original counter or anyone who already counted the audit
--     (CHECK + trigger).
--   * inv_cost_reconcile (below) needs an approved cost_reconciliation request and
--     stock:financial_post; resolver <> creator (CHECK on the table).
-- SEPARATION OF DUTIES enforced at decision time AND re-checked at consumption: the
-- approver is never the requester, the counter, a recounter, anyone who counted the
-- audit, the audit creator, the adjustment proposer, the opening-batch preparer, or
-- the reconciliation creator / proposer; the requester can never approve their own
-- request (CHECK).
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 0. Approval policies: four inventory entity types (the existing engine)
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.approval_policies') is not null then
    alter table public.approval_policies drop constraint if exists approval_policies_entity_type_check;
    alter table public.approval_policies add constraint approval_policies_entity_type_check check (entity_type = any (array[
      'inspection','checklist','work_order','tyre_change',
      'inventory_stock_adjustment','inventory_recount_assignment','inventory_opening_balance_batch',
      'inventory_cost_reconciliation']));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Requests and decisions
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_approval_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text, site text,
  entity_type text not null check (entity_type in ('stock_adjustment','recount_assignment','opening_balance_batch',
    'cost_reconciliation')),
  entity_id uuid not null,
  entity_ref text,
  proposal jsonb not null default '{}'::jsonb,
  snapshot jsonb not null default '{}'::jsonb,
  reason text,
  route_source text not null check (route_source in ('policy','default')),
  policy_id uuid, policy_version integer,
  stages jsonb not null check (jsonb_typeof(stages) = 'array' and jsonb_array_length(stages) between 1 and 5),
  current_stage integer not null default 0,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','consumed')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid, decided_at timestamptz,
  consumed_by uuid, consumed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint inventory_approval_requests_self_chk check (decided_by is null or decided_by <> requested_by)
);
create unique index if not exists inventory_approval_requests_active_uq
  on public.inventory_approval_requests (entity_type, entity_id) where status in ('pending','approved');
create index if not exists inventory_approval_requests_org_idx on public.inventory_approval_requests (organisation_id, status);
select public._inv_secure_table('inventory_approval_requests', true, true);

create table if not exists public.inventory_approval_decisions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  request_id uuid not null references public.inventory_approval_requests(id),
  stage_index integer not null,
  stage_name text not null,
  decision text not null check (decision in ('approved','rejected')),
  actor_id uuid not null,
  note text, signature text,
  decided_at timestamptz not null default now(),
  unique (request_id, stage_index)
);
select public._inv_secure_table('inventory_approval_decisions', false, false);

create or replace function public.inv_approval_append_only()
returns trigger language plpgsql set search_path = public as $fn$
begin
  raise exception 'Approval decisions are append-only.' using errcode = '42501';
end $fn$;
drop trigger if exists trg_inv_approval_decisions_append_only on public.inventory_approval_decisions;
create trigger trg_inv_approval_decisions_append_only before update or delete on public.inventory_approval_decisions
  for each row execute function public.inv_approval_append_only();

-- ---------------------------------------------------------------------------
-- 2. Entity facts: scope, state, people who may never approve it
-- ---------------------------------------------------------------------------
-- Returns {org, country, site, ref, state_ok, state, conflicts[], snapshot}.
create or replace function public._inv_approval_entity(p_type text, p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare a public.inventory_audits%rowtype; adj public.inventory_adjustments%rowtype;
  b public.opening_balance_batches%rowtype; r public.inventory_cost_reconciliations%rowtype;
  v_conf uuid[];
begin
  if p_type = 'stock_adjustment' then
    select * into adj from public.inventory_adjustments where id = p_id;
    if not found then return null; end if;
    select * into a from public.inventory_audits where id = adj.audit_id;
    v_conf := array_remove(array[adj.proposed_by, a.created_by, a.counter_id, a.recount_counter_id], null)
      || coalesce((select array_agg(distinct counter_id) from public.inventory_count_lines where audit_id = a.id), '{}');
    return jsonb_build_object('org', adj.organisation_id, 'country', a.country, 'site', a.site, 'ref', a.ref,
      'state', adj.status, 'state_ok', adj.status = 'proposed', 'conflicts', to_jsonb(v_conf),
      'snapshot', jsonb_build_object('qty_change', adj.qty_change, 'stock_id', adj.stock_id));
  elsif p_type = 'recount_assignment' then
    select * into a from public.inventory_audits where id = p_id;
    if not found then return null; end if;
    v_conf := array_remove(array[a.created_by, a.counter_id, a.recount_counter_id], null)
      || coalesce((select array_agg(distinct counter_id) from public.inventory_count_lines where audit_id = a.id), '{}');
    return jsonb_build_object('org', a.organisation_id, 'country', a.country, 'site', a.site, 'ref', a.ref,
      'state', a.status, 'state_ok', a.status in ('investigation','reconciliation') and a.current_round < 3,
      'conflicts', to_jsonb(v_conf), 'snapshot', jsonb_build_object('round', a.current_round));
  elsif p_type = 'opening_balance_batch' then
    select * into b from public.opening_balance_batches where id = p_id;
    if not found then return null; end if;
    return jsonb_build_object('org', b.organisation_id, 'country', b.country, 'site', b.site, 'ref', b.reference,
      'state', b.status, 'state_ok', b.status = 'submitted', 'conflicts', to_jsonb(array[b.prepared_by]),
      'snapshot', jsonb_build_object('lines', (select count(*) from public.opening_balance_lines where batch_id = b.id)));
  elsif p_type = 'cost_reconciliation' then
    select * into r from public.inventory_cost_reconciliations where id = p_id;
    if not found then return null; end if;
    return jsonb_build_object('org', r.organisation_id, 'country', r.country, 'site', r.site, 'ref', r.id::text,
      'state', r.status, 'state_ok', r.status = 'open',
      'conflicts', to_jsonb(array_remove(array[r.created_by, r.proposed_by], null)),
      'snapshot', jsonb_build_object('unvalued_qty', r.unvalued_qty, 'consumed', r.consumed, 'stock_id', r.stock_id));
  end if;
  return null;
end $fn$;

create or replace function public._inv_approval_cap(p_type text)
returns text language sql immutable set search_path = public as $$
  select case p_type when 'stock_adjustment' then 'adjustment_approve' when 'recount_assignment' then 'discrepancy_review'
    when 'opening_balance_batch' then 'adjustment_approve' when 'cost_reconciliation' then 'financial_post' end
$$;

-- NULL when the caller may decide the request's current stage; otherwise the reason.
create or replace function public._inv_approval_block_reason(p_request uuid)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_approval_requests%rowtype; e jsonb; s jsonb; v_uid uuid := auth.uid(); v_role text;
begin
  select * into r from public.inventory_approval_requests where id = p_request;
  if not found or r.organisation_id is distinct from public.app_current_org() then return 'not_found'; end if;
  if r.status <> 'pending' then return 'not_pending'; end if;
  if v_uid is null or not public.is_approved_and_unlocked() then return 'not_authorised'; end if;
  if not public._inv_scope_ok(r.country, r.site) then return 'out_of_scope'; end if;
  if v_uid = r.requested_by then return 'segregation_of_duties: requester'; end if;
  e := public._inv_approval_entity(r.entity_type, r.entity_id);
  if e is null then return 'entity_missing'; end if;
  if e->'conflicts' ? v_uid::text then return 'segregation_of_duties: creator, preparer, counter or recounter'; end if;
  if r.entity_type = 'recount_assignment' and r.proposal->>'counter_id' = v_uid::text then
    return 'segregation_of_duties: proposed recounter';
  end if;
  s := r.stages -> r.current_stage;
  if coalesce((s->>'distinct_reviewer')::boolean, true)
     and exists (select 1 from public.inventory_approval_decisions d where d.request_id = r.id and d.actor_id = v_uid) then
    return 'segregation_of_duties: already decided an earlier stage';
  end if;
  v_role := lower(regexp_replace(coalesce(public.get_my_role(), ''), '\s+', '_', 'g'));
  if nullif(s->>'approver_user_id', '') is not null then
    if s->>'approver_user_id' <> v_uid::text then return 'not_stage_approver'; end if;
  elsif nullif(s->>'approver_role', '') is not null then
    if lower(regexp_replace(s->>'approver_role', '\s+', '_', 'g')) <> v_role then return 'not_stage_approver'; end if;
  elsif not public.app_is_elevated() then
    return 'default_route_needs_elevated_approver';
  end if;
  if not (public.inv_can(public._inv_approval_cap(r.entity_type)) or public.app_is_elevated()) then
    return 'missing_capability: ' || public._inv_approval_cap(r.entity_type);
  end if;
  return null;
end $fn$;

-- ---------------------------------------------------------------------------
-- 3. Request and decide (client RPCs: one p_payload, idempotency_key inside)
-- ---------------------------------------------------------------------------
create or replace function public.inv_request_approval(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_type text := lower(btrim(coalesce(p_payload->>'entity_type', ''))); v_id uuid; e jsonb; v_res jsonb;
  v_route jsonb; v_stages jsonb; v_src text := 'default'; v_pol uuid; v_ver int; v_prop jsonb := coalesce(p_payload->'proposal', '{}'::jsonb);
  v_req public.inventory_approval_requests%rowtype; v_cnt uuid; v_cost numeric; v_res_kind text;
begin
  v_res := public._inv_req_begin('inv_request_approval', p_payload);
  if v_res is not null then return v_res; end if;
  if v_type not in ('stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation') then
    raise exception 'entity_type must be stock_adjustment, recount_assignment, opening_balance_batch or cost_reconciliation.'
      using errcode = '22023';
  end if;
  begin v_id := (p_payload->>'entity_id')::uuid; exception when others then v_id := null; end;
  if v_id is null then raise exception 'entity_id is required.' using errcode = '22023'; end if;
  -- serialise requests for one entity
  perform pg_advisory_xact_lock(hashtextextended('inv:approval:' || v_type || ':' || v_id::text, 0));
  e := public._inv_approval_entity(v_type, v_id);
  if e is null or (e->>'org')::uuid is distinct from public.app_current_org() then
    raise exception 'Record not found.' using errcode = 'P0002';
  end if;
  if not public._inv_scope_ok(e->>'country', e->>'site') then
    raise exception 'This record is outside your country or site scope.' using errcode = '42501';
  end if;
  if not (e->>'state_ok')::boolean then
    raise exception 'This record cannot be sent for approval in state %.', e->>'state' using errcode = '22023';
  end if;
  -- who may ask
  if v_type = 'stock_adjustment' and not (public.inv_can('discrepancy_review') or public.app_is_elevated()) then
    raise exception 'Stock permission "discrepancy_review" is required.' using errcode = '42501';
  elsif v_type = 'recount_assignment' and not public.inv_can('recount') then
    raise exception 'Stock permission "recount" is required.' using errcode = '42501';
  elsif v_type = 'opening_balance_batch' and not (e->'conflicts' ? auth.uid()::text or public.app_is_elevated()) then
    raise exception 'Only the preparer (or an elevated user) sends an opening balance for approval.' using errcode = '42501';
  elsif v_type = 'cost_reconciliation' and not (public.inv_can('financial_post') or public.inv_can('view_value')) then
    raise exception 'Stock permission "financial_post" or "view_value" is required.' using errcode = '42501';
  end if;
  -- the proposal
  if v_type = 'recount_assignment' then
    begin v_cnt := coalesce(nullif(v_prop->>'counter_id', ''), nullif(p_payload->>'recount_counter_id', ''))::uuid;
    exception when others then v_cnt := null; end;
    if v_cnt is null then raise exception 'proposal.counter_id (the recounter) is required.' using errcode = '22023'; end if;
    if e->'conflicts' ? v_cnt::text then
      raise exception 'A recount must be done by a different person who has not counted this audit.' using errcode = '42501';
    end if;
    v_prop := jsonb_build_object('counter_id', v_cnt);
  elsif v_type = 'cost_reconciliation' then
    v_res_kind := coalesce(nullif(v_prop->>'resolution', ''), 'resolved');
    if v_res_kind not in ('resolved','written_off') then
      raise exception 'proposal.resolution must be resolved or written_off.' using errcode = '22023';
    end if;
    begin v_cost := (v_prop->>'unit_cost')::numeric; exception when others then
      raise exception 'proposal.unit_cost must be a number.' using errcode = '22023'; end;
    if v_res_kind = 'resolved' and (v_cost is null or v_cost < 0) then
      raise exception 'A resolution needs proposal.unit_cost of zero or more, with evidence.' using errcode = '22023';
    end if;
    if v_res_kind = 'written_off' then v_cost := null; end if;
    if v_res_kind = 'resolved' and jsonb_array_length(coalesce(p_payload->'evidence', '[]'::jsonb)) = 0
       and nullif(btrim(p_payload->>'reason'), '') is null then
      raise exception 'Give evidence or a reason for the cost.' using errcode = '22023';
    end if;
    v_prop := jsonb_build_object('resolution', v_res_kind, 'unit_cost', v_cost);
    update public.inventory_cost_reconciliations set proposed_resolution = v_res_kind, proposed_unit_cost = v_cost,
      proposed_by = auth.uid(), proposed_at = now(),
      evidence = evidence || coalesce(p_payload->'evidence', '[]'::jsonb), updated_at = now()
     where id = v_id;
    e := public._inv_approval_entity(v_type, v_id);
  else
    v_prop := '{}'::jsonb;
  end if;
  -- route: the governed approval_policies engine when the company has inventory policies
  if to_regprocedure('approval_private.resolve(uuid,text,text,text,text,uuid,uuid,text)') is not null then
    execute 'select approval_private.resolve($1, $2, $3, $4, $5, $6, null, null)'
      into v_route using (e->>'org')::uuid, 'inventory_' || v_type, e->>'country', e->>'site', public.get_my_role(), auth.uid();
  end if;
  if v_route is not null and v_route->>'mode' = 'enforced' then
    if v_route->>'status' <> 'matched' then
      raise exception 'No single approval route matches this % (%). Ask an administrator to publish an inventory approval policy.',
        v_type, v_route->>'status' using errcode = '22023';
    end if;
    v_stages := v_route->'policy'->'stages'; v_src := 'policy';
    v_pol := (v_route->'policy'->>'id')::uuid; v_ver := (v_route->'policy'->>'version')::int;
  else
    v_stages := jsonb_build_array(jsonb_build_object('name', 'Elevated approver', 'default', true,
      'require_signature', false, 'distinct_reviewer', true));
  end if;
  insert into public.inventory_approval_requests(organisation_id, country, site, entity_type, entity_id, entity_ref,
    proposal, snapshot, reason, route_source, policy_id, policy_version, stages, requested_by)
  values ((e->>'org')::uuid, e->>'country', e->>'site', v_type, v_id, e->>'ref', v_prop, e->'snapshot',
    nullif(btrim(p_payload->>'reason'), ''), v_src, v_pol, v_ver, v_stages, auth.uid())
  returning * into v_req;
  if v_type = 'cost_reconciliation' then
    update public.inventory_cost_reconciliations set approval_request_id = v_req.id where id = v_id;
  end if;
  return public._inv_req_end('inv_request_approval', p_payload, jsonb_build_object('id', v_req.id, 'status', v_req.status,
    'route_source', v_src, 'stages', jsonb_array_length(v_stages)));
exception when unique_violation then
  raise exception 'An approval request is already open or approved for this record.' using errcode = '23505';
end $fn$;

create or replace function public.inv_approval_decide(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_approval_requests%rowtype; v_res jsonb; v_reason text; s jsonb;
  v_dec text := lower(btrim(coalesce(p_payload->>'decision', ''))); v_last boolean;
begin
  v_res := public._inv_req_begin('inv_approval_decide', p_payload);
  if v_res is not null then return v_res; end if;
  if v_dec in ('approve', 'approved') then v_dec := 'approved';
  elsif v_dec in ('reject', 'rejected') then v_dec := 'rejected';
  else raise exception 'decision must be approve or reject.' using errcode = '22023'; end if;
  select * into r from public.inventory_approval_requests
   where id = nullif(p_payload->>'request_id', '')::uuid and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Approval request not found.' using errcode = 'P0002'; end if;
  v_reason := public._inv_approval_block_reason(r.id);
  if v_reason is not null then
    raise exception 'You cannot decide this approval: %.', v_reason using errcode = '42501';
  end if;
  s := r.stages -> r.current_stage;
  if v_dec = 'rejected' and nullif(btrim(p_payload->>'note'), '') is null then
    raise exception 'A rejection needs a note.' using errcode = '22023';
  end if;
  if v_dec = 'approved' and r.route_source = 'policy' and coalesce((s->>'require_signature')::boolean, true)
     and nullif(btrim(p_payload->>'signature'), '') is null then
    raise exception 'This approval stage requires a signature.' using errcode = '22023';
  end if;
  insert into public.inventory_approval_decisions(organisation_id, request_id, stage_index, stage_name, decision, actor_id,
    note, signature)
  values (r.organisation_id, r.id, r.current_stage, coalesce(s->>'name', 'Stage ' || (r.current_stage + 1)), v_dec, auth.uid(),
    nullif(btrim(p_payload->>'note'), ''), nullif(btrim(p_payload->>'signature'), ''));
  v_last := r.current_stage + 1 >= jsonb_array_length(r.stages);
  update public.inventory_approval_requests set
    current_stage = case when v_dec = 'approved' and not v_last then current_stage + 1 else current_stage end,
    status = case when v_dec = 'rejected' then 'rejected' when v_last then 'approved' else 'pending' end,
    decided_by = case when v_dec = 'rejected' or v_last then auth.uid() end,
    decided_at = case when v_dec = 'rejected' or v_last then now() end,
    updated_at = now()
   where id = r.id returning * into r;
  return public._inv_req_end('inv_approval_decide', p_payload, jsonb_build_object('id', r.id, 'status', r.status,
    'current_stage', r.current_stage, 'entity_type', r.entity_type, 'entity_id', r.entity_id));
end $fn$;

-- The posting step: an APPROVED request for this entity whose proposal and snapshot
-- still hold; the poster must not be in the conflict set either. Marks it consumed.
create or replace function public._inv_approval_consume(p_type text, p_id uuid, p_proposal jsonb default '{}'::jsonb)
returns public.inventory_approval_requests language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r public.inventory_approval_requests%rowtype; e jsonb;
begin
  select * into r from public.inventory_approval_requests
   where entity_type = p_type and entity_id = p_id and status = 'approved' for update;
  if not found then
    raise exception 'An approved % approval is required before this can be posted (inv_request_approval, inv_approval_decide).',
      replace(p_type, '_', ' ') using errcode = '42501';
  end if;
  if not (r.proposal @> coalesce(p_proposal, '{}'::jsonb)) then
    raise exception 'What is being posted differs from what was approved; request a new approval.' using errcode = '42501';
  end if;
  e := public._inv_approval_entity(p_type, p_id);
  if p_type = 'stock_adjustment' and (e->'snapshot'->>'qty_change')::numeric is distinct from (r.snapshot->>'qty_change')::numeric then
    raise exception 'The adjustment changed after approval; request a new approval.' using errcode = '42501';
  end if;
  if exists (select 1 from public.inventory_approval_decisions d where d.request_id = r.id and d.decision = 'approved'
               and (e->'conflicts' ? d.actor_id::text or d.actor_id = r.requested_by)) then
    raise exception 'Segregation of duties: an approver of this request is also its creator, preparer or counter.'
      using errcode = '42501';
  end if;
  update public.inventory_approval_requests set status = 'consumed', consumed_by = auth.uid(), consumed_at = now(),
    updated_at = now() where id = r.id returning * into r;
  return r;
end $fn$;

-- ---------------------------------------------------------------------------
-- 4. Database gates
-- ---------------------------------------------------------------------------
create or replace function public.inv_gate_adjustment_post()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'posted' and old.status is distinct from 'posted' then
    if new.approved_by is not distinct from new.proposed_by then
      raise exception 'Segregation of duties: the proposer cannot post the adjustment.' using errcode = '42501';
    end if;
    perform public._inv_approval_consume('stock_adjustment', new.id);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_inv_gate_adjustment_post on public.inventory_adjustments;
create trigger trg_inv_gate_adjustment_post before update on public.inventory_adjustments
  for each row execute function public.inv_gate_adjustment_post();

create or replace function public.inv_gate_opening_approve()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    perform public._inv_approval_consume('opening_balance_batch', new.id);
  end if;
  return new;
end $fn$;
drop trigger if exists trg_inv_gate_opening_approve on public.opening_balance_batches;
create trigger trg_inv_gate_opening_approve before update on public.opening_balance_batches
  for each row execute function public.inv_gate_opening_approve();
alter table public.opening_balance_batches drop constraint if exists opening_balance_batches_sod_chk;
alter table public.opening_balance_batches add constraint opening_balance_batches_sod_chk
  check (status <> 'approved' or approved_by is distinct from prepared_by);

create or replace function public.inv_gate_recount_assign()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.recount_counter_id is not null and new.recount_counter_id is distinct from old.recount_counter_id then
    if new.recount_counter_id = new.counter_id or new.recount_counter_id = new.created_by
       or exists (select 1 from public.inventory_count_lines where audit_id = new.id and counter_id = new.recount_counter_id) then
      raise exception 'A recount must be done by a different person who has not counted this audit.' using errcode = '42501';
    end if;
    perform public._inv_approval_consume('recount_assignment', new.id,
      jsonb_build_object('counter_id', new.recount_counter_id));
  end if;
  return new;
end $fn$;
drop trigger if exists trg_inv_gate_recount_assign on public.inventory_audits;
create trigger trg_inv_gate_recount_assign before update on public.inventory_audits
  for each row execute function public.inv_gate_recount_assign();
alter table public.inventory_audits drop constraint if exists inventory_audits_recount_sod_chk;
alter table public.inventory_audits add constraint inventory_audits_recount_sod_chk
  check (recount_counter_id is null or recount_counter_id is distinct from counter_id);

-- ---------------------------------------------------------------------------
-- 5. Cost reconciliation resolution (the ONLY way unknown cost becomes known)
-- ---------------------------------------------------------------------------
create or replace function public.inv_cost_reconcile(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_res jsonb; c public.inventory_cost_reconciliations%rowtype; a public.inventory_approval_requests%rowtype;
  s public.stock_records%rowtype; v_cost numeric; v_kind text; v_apply numeric := 0; v_post jsonb; v_mov uuid;
begin
  v_res := public._inv_req_begin('inv_cost_reconcile', p_payload);
  if v_res is not null then return v_res; end if;
  if not public.inv_can('financial_post') then
    raise exception 'Stock permission "financial_post" is required.' using errcode = '42501';
  end if;
  select * into c from public.inventory_cost_reconciliations
   where id = nullif(p_payload->>'reconciliation_id', '')::uuid and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Cost reconciliation not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(c.country, c.site) then
    raise exception 'This record is outside your country or site scope.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This reconciliation is already %.', c.status using errcode = '22023'; end if;
  if c.created_by = auth.uid() then
    raise exception 'Segregation of duties: the person whose movement raised this cannot resolve it.' using errcode = '42501';
  end if;
  a := public._inv_approval_consume('cost_reconciliation', c.id,
    jsonb_strip_nulls(jsonb_build_object('resolution', nullif(p_payload->>'resolution', ''),
      'unit_cost', case when p_payload ? 'unit_cost' then p_payload->'unit_cost' end)));
  v_kind := a.proposal->>'resolution';
  v_cost := (a.proposal->>'unit_cost')::numeric;
  if v_kind = 'resolved' and not c.consumed and c.stock_id is not null then
    select * into s from public.stock_records where id = c.stock_id for update;
    v_apply := least(c.unvalued_qty, coalesce(s.unvalued_qty, 0));
    if v_apply > 0 then
      v_post := public._inv_post(jsonb_build_object('idempotency_key', 'costrec:' || c.id::text, 'stock_id', c.stock_id,
        'movement_type', 'cost_assignment', 'qty_change', 0, 'qty', v_apply, 'unit_cost', v_cost,
        'reason', 'Approved cost reconciliation', 'source_doc_type', 'cost_reconciliation', 'source_doc_id', c.id::text,
        'approval_ref', a.id::text), false);
      v_mov := (v_post->>'movement_id')::uuid;
    end if;
  end if;
  update public.inventory_cost_reconciliations set
    status = case when v_kind = 'written_off' then 'written_off' else 'resolved' end,
    resolution_source = 'reconciliation', resolved_unit_cost = v_cost,
    resolved_value = case when v_kind = 'resolved' then round(unvalued_qty * v_cost, 2) end,
    applied_qty = v_apply, not_applied_qty = case when v_kind = 'resolved' and not consumed then unvalued_qty - v_apply else 0 end,
    resolution_movement_id = v_mov, approval_request_id = a.id, resolved_by = auth.uid(), resolved_at = now(),
    evidence = evidence || coalesce(p_payload->'evidence', '[]'::jsonb),
    notes = concat_ws(E'\n', notes, nullif(btrim(p_payload->>'note'), '')), updated_at = now()
   where id = c.id returning * into c;
  return public._inv_req_end('inv_cost_reconcile', p_payload, jsonb_build_object('id', c.id, 'status', c.status,
    'resolved_value', c.resolved_value, 'applied_qty', c.applied_qty, 'not_applied_qty', c.not_applied_qty,
    'movement_id', v_mov, 'posting', 'none'));
end $fn$;

-- ---------------------------------------------------------------------------
-- 6. Read surface
-- ---------------------------------------------------------------------------
create or replace view public.v_inv_pending_approvals with (security_invoker = on) as
select r.id, r.organisation_id, r.country, r.site, r.entity_type, r.entity_id, r.entity_ref, r.proposal, r.reason,
       r.route_source, r.policy_id, r.policy_version, r.stages, r.current_stage,
       r.stages -> r.current_stage ->> 'name' as stage_name, jsonb_array_length(r.stages) as stage_count,
       r.status, r.requested_by, r.requested_at,
       public._inv_approval_block_reason(r.id) is null as can_decide,
       public._inv_approval_block_reason(r.id) as blocked_reason
  from public.inventory_approval_requests r
 where r.status = 'pending';
revoke all on public.v_inv_pending_approvals from anon;
grant select on public.v_inv_pending_approvals to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
revoke all on function public._inv_approval_entity(text, uuid), public._inv_approval_cap(text),
  public._inv_approval_consume(text, uuid, jsonb), public.inv_approval_append_only(),
  public.inv_gate_adjustment_post(), public.inv_gate_opening_approve(), public.inv_gate_recount_assign()
  from public, anon, authenticated;
revoke all on function public._inv_approval_block_reason(uuid) from public, anon;
grant execute on function public._inv_approval_block_reason(uuid) to authenticated;
revoke all on function public.inv_request_approval(jsonb), public.inv_approval_decide(jsonb), public.inv_cost_reconcile(jsonb)
  from public, anon;
grant execute on function public.inv_request_approval(jsonb), public.inv_approval_decide(jsonb), public.inv_cost_reconcile(jsonb)
  to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
