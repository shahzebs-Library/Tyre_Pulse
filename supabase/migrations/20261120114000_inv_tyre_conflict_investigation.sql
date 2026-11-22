-- =============================================================================
-- 20261120114000_inv_tyre_conflict_investigation.sql
-- STATUS: APPLIED to production 2026-11-20 (ledger 20261120114000, owner order; applied text = sha256 19713c8bcdf9550b at commit aefb9ee0 before this STATUS edit; see docs/inventory/96_PRODUCTION_RELEASE_RECORD.md). Requires 20261120100000..113000.
-- Rollback: 20261120114000_inv_tyre_conflict_investigation_ROLLBACK.sql
--
-- Owner decision 2 (2026-11-20): a scrapped-but-active tyre conflict is an
-- INVESTIGATION, never an automatic correction.
--   * open -> investigating (assigned to a Tyre / PMV Engineering user)
--          -> proposed (the investigator proposes a correction with evidence)
--          -> approved | rejected (independent PMV Manager approval through the
--             inventory approval engine; the approver can never be the
--             investigator or the proposer - keyed on user id)
--          -> closed (the approved decision is recorded; consumes the approval)
--     rejected -> investigating | proposed (re-work).
--   * tyre_custody_conflicts.status stays 'open' until the case is closed
--     (then 'resolved'), so the sync never opens a duplicate while a case runs and
--     every conflict is resolved individually.
--   * The correction is a DECISION only. No function or trigger in this file
--     writes tyre_records or tyre_status_marks; the tyre team applies an approved
--     correction separately in tyre records.
--   * The direct decide path (inv_tyre_conflict_decide) refuses a
--     scrapped_but_active conflict, and any conflict with a running case.
-- In-place patches of functions created earlier in this release use the same
-- guards as 112000: md5 fingerprint (chr(13) stripped, PGlite output of the
-- creating file), then the anchor exactly once, else the file aborts. Originals in
-- _bak.inv_114000_snapshot; the rollback executes them verbatim.
-- =============================================================================
begin;

create schema if not exists _bak;
create table if not exists _bak.inv_114000_snapshot (
  obj text primary key,
  def text not null,
  captured_at timestamptz not null default now()
);
revoke all on _bak.inv_114000_snapshot from public;

do $$ begin
  if to_regprocedure('public._inv_approval_extra_block(uuid)') is null then
    raise exception '114000: apply 20261120113000 first.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Entity type in the policy engine and in the request table
-- ---------------------------------------------------------------------------
do $$ begin
  if to_regclass('public.approval_policies') is not null then
    alter table public.approval_policies drop constraint if exists approval_policies_entity_type_check;
    alter table public.approval_policies add constraint approval_policies_entity_type_check check (entity_type = any (array[
      'inspection','checklist','work_order','tyre_change',
      'inventory_stock_adjustment','inventory_recount_assignment','inventory_opening_balance_batch',
      'inventory_cost_reconciliation','inventory_tyre_conflict_correction']));
  end if;
end $$;
alter table public.inventory_approval_requests drop constraint if exists inventory_approval_requests_entity_type_check;
alter table public.inventory_approval_requests add constraint inventory_approval_requests_entity_type_check
  check (entity_type in ('stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation',
    'tyre_conflict_correction'));

-- ---------------------------------------------------------------------------
-- 2. Investigation fields
-- ---------------------------------------------------------------------------
alter table public.tyre_custody_conflicts
  add column if not exists investigation_status text not null default 'open',
  add column if not exists investigator_id uuid,
  add column if not exists assigned_by uuid,
  add column if not exists assigned_at timestamptz,
  add column if not exists investigation_notes jsonb not null default '[]'::jsonb,
  add column if not exists proposed_correction jsonb,
  add column if not exists proposed_by uuid,
  add column if not exists proposed_at timestamptz,
  add column if not exists approval_request_id uuid,
  add column if not exists decided_correction jsonb,
  add column if not exists closed_by uuid,
  add column if not exists closed_at timestamptz;
alter table public.tyre_custody_conflicts drop constraint if exists tyre_custody_conflicts_investigation_status_check;
alter table public.tyre_custody_conflicts add constraint tyre_custody_conflicts_investigation_status_check
  check (investigation_status in ('open','investigating','proposed','approved','rejected','closed'));
-- A closed case is resolved; a running case keeps the conflict open.
alter table public.tyre_custody_conflicts drop constraint if exists tyre_custody_conflicts_case_status_chk;
alter table public.tyre_custody_conflicts add constraint tyre_custody_conflicts_case_status_chk
  check ((investigation_status <> 'closed' or (status = 'resolved' and closed_at is not null))
     and (investigation_status in ('open','closed') or status = 'open'));

-- Who may investigate: the Tyre / PMV Engineering roles (live: Tire Planning Engineer).
create or replace function public.inv_tyre_investigator_roles()
returns text[] language sql immutable set search_path = public as $$
  select array['Tire Planning Engineer','Tyre Engineer','Tyre/PMV Engineer','PMV Engineer']
$$;
revoke all on function public.inv_tyre_investigator_roles() from public, anon;
grant execute on function public.inv_tyre_investigator_roles() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Approval engine knows the new entity (fingerprinted in-place patches)
-- ---------------------------------------------------------------------------
do $$
declare v_def text; v_n int; r record;
begin
  for r in select * from (values
    ('public._inv_approval_entity(text,uuid)', '183d8b9d5067b12ced8d547f2a815639',
     E'      ''snapshot'', jsonb_build_object(''unvalued_qty'', r.unvalued_qty, ''consumed'', r.consumed, ''stock_id'', r.stock_id,\n        ''kind'', r.kind, ''holder_stock_id'', r.holder_stock_id));\n  end if;',
     E'      ''snapshot'', jsonb_build_object(''unvalued_qty'', r.unvalued_qty, ''consumed'', r.consumed, ''stock_id'', r.stock_id,\n        ''kind'', r.kind, ''holder_stock_id'', r.holder_stock_id));\n  elsif p_type = ''tyre_conflict_correction'' then\n    return (select jsonb_build_object(''org'', c.organisation_id, ''country'', nullif(c.country, ''''), ''site'', null, ''ref'', c.serial,\n      ''state'', c.investigation_status, ''state_ok'', c.investigation_status = ''proposed'' and c.status = ''open'',\n      ''conflicts'', to_jsonb(array_remove(array[c.investigator_id, c.proposed_by], null)),\n      ''snapshot'', jsonb_build_object(''conflict_id'', c.id, ''correction'', c.proposed_correction))\n      from public.tyre_custody_conflicts c where c.id = p_id);\n  end if;'),
    ('public._inv_approval_cap(text)', '19fab58987a44e9d2ed9bbfd1b80fdca',
     $a$when 'cost_reconciliation' then 'financial_post' end$a$,
     $b$when 'cost_reconciliation' then 'financial_post' when 'tyre_conflict_correction' then 'scrap_approve' end$b$),
    ('public._inv_tyre_conflict_decide(uuid,text,text)', '290fad636292b47960197658f0976a17',
     $a$  if p_status not in ('resolved','dismissed') or nullif(btrim(p_note), '') is null then$a$,
     $b$  if exists (select 1 from public.tyre_custody_conflicts x where x.id = p_conflict
               and (x.conflict_type = 'scrapped_but_active' or x.investigation_status <> 'open')) then
    raise exception 'This conflict is decided through its investigation (assign, investigate, propose, PMV Manager approval, close).'
      using errcode = '42501';
  end if;
  if p_status not in ('resolved','dismissed') or nullif(btrim(p_note), '') is null then$b$)
  ) v(sig, md5, anchor, repl) loop
    v_def := pg_get_functiondef(to_regprocedure(r.sig));
    if position('tyre_conflict_correction' in v_def) > 0 or position('investigation (assign' in v_def) > 0 then
      raise notice '114000: % already patched; left as is.', r.sig;
      continue;
    end if;
    if md5(replace(v_def, chr(13), '')) <> r.md5 then
      raise exception '114000: % differs from the reviewed definition (md5 % expected %); refusing to patch.',
        r.sig, md5(replace(v_def, chr(13), '')), r.md5;
    end if;
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then
      raise exception '114000: anchor found % times in %; refusing to patch.', v_n, r.sig;
    end if;
    insert into _bak.inv_114000_snapshot(obj, def) values (r.sig, v_def) on conflict (obj) do nothing;
    execute replace(v_def, r.anchor, r.repl);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Lifecycle RPCs (one p_payload, idempotency_key inside)
-- ---------------------------------------------------------------------------
-- Loads the caller's conflict with a row lock; refuses another company or scope.
create or replace function public._inv_tyre_case(p_id uuid)
returns public.tyre_custody_conflicts language plpgsql security definer set search_path = public, pg_temp as $fn$
declare c public.tyre_custody_conflicts%rowtype;
begin
  if not public.is_approved_and_unlocked() then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into c from public.tyre_custody_conflicts
   where id = p_id and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Conflict not found.' using errcode = 'P0002'; end if;
  if not public._inv_scope_ok(nullif(c.country, ''), null) then
    raise exception 'This conflict is outside your country scope.' using errcode = '42501';
  end if;
  if c.status <> 'open' then raise exception 'This conflict is already closed.' using errcode = '22023'; end if;
  return c;
end $fn$;
revoke all on function public._inv_tyre_case(uuid) from public, anon, authenticated;

create or replace function public._inv_tyre_case_event(c public.tyre_custody_conflicts, p_type text, p_evidence jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_item uuid;
begin
  select id into v_item from public.tyre_items where organisation_id = c.organisation_id and country = c.country and serial = c.serial;
  if v_item is not null then
    insert into public.tyre_item_events(organisation_id, tyre_item_id, event_type, evidence)
    values (c.organisation_id, v_item, p_type, p_evidence || jsonb_build_object('conflict_id', c.id, 'type', c.conflict_type));
  end if;
end $fn$;
revoke all on function public._inv_tyre_case_event(public.tyre_custody_conflicts, text, jsonb) from public, anon, authenticated;

-- Assign (or reassign) the investigator. Admin, Manager, Director or PMV Manager.
create or replace function public.inv_tyre_conflict_assign(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v jsonb; c public.tyre_custody_conflicts%rowtype; v_inv uuid; p public.profiles%rowtype;
begin
  v := public._inv_req_begin('inv_tyre_conflict_assign', p_payload);
  if v is not null then return v; end if;
  c := public._inv_tyre_case(nullif(p_payload->>'conflict_id', '')::uuid);
  if not (public.app_is_elevated() or public.get_my_role() = 'PMV Manager') then
    raise exception 'Only an Admin, Manager, Director or PMV Manager assigns a tyre investigation.' using errcode = '42501';
  end if;
  if c.investigation_status not in ('open','investigating','rejected') then
    raise exception 'A case in state % cannot be reassigned.', c.investigation_status using errcode = '22023';
  end if;
  begin v_inv := (p_payload->>'investigator_id')::uuid; exception when others then v_inv := null; end;
  select * into p from public.profiles where id = v_inv;
  if not found or coalesce(p.org_id, p.organisation_id) is distinct from c.organisation_id
     or p.approved is not true or coalesce(p.locked, false) then
    raise exception 'The investigator must be an active user of this company.' using errcode = '22023';
  end if;
  if not (p.role = any (public.inv_tyre_investigator_roles())) then
    raise exception 'The investigator must hold a Tyre / PMV Engineering role.' using errcode = '22023';
  end if;
  if nullif(c.country, '') is not null and not (coalesce(p.is_super_admin, false)
     or exists (select 1 from unnest(coalesce(p.country, '{}'::text[])) x where lower(btrim(x)) in ('all', lower(c.country)))) then
    raise exception 'The investigator does not cover %.', c.country using errcode = '22023';
  end if;
  update public.tyre_custody_conflicts set investigation_status = 'investigating', investigator_id = v_inv,
    assigned_by = auth.uid(), assigned_at = now(),
    investigation_notes = investigation_notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(),
      'kind', 'assigned', 'note', nullif(btrim(p_payload->>'note'), '')))
   where id = c.id returning * into c;
  return public._inv_req_end('inv_tyre_conflict_assign', p_payload,
    jsonb_build_object('id', c.id, 'investigation_status', c.investigation_status));
end $fn$;

-- The investigator records findings and evidence.
create or replace function public.inv_tyre_conflict_investigate(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v jsonb; c public.tyre_custody_conflicts%rowtype;
begin
  v := public._inv_req_begin('inv_tyre_conflict_investigate', p_payload);
  if v is not null then return v; end if;
  c := public._inv_tyre_case(nullif(p_payload->>'conflict_id', '')::uuid);
  if c.investigator_id is distinct from auth.uid() then
    raise exception 'Only the assigned investigator records findings.' using errcode = '42501';
  end if;
  if c.investigation_status not in ('investigating','rejected') then
    raise exception 'Findings are recorded while the case is investigating (now %).', c.investigation_status using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->>'note'), '') is null then
    raise exception 'Write what was checked and found.' using errcode = '22023';
  end if;
  update public.tyre_custody_conflicts set investigation_status = 'investigating',
    investigation_notes = investigation_notes || jsonb_build_array(jsonb_build_object('at', now(), 'by', auth.uid(),
      'kind', 'finding', 'note', btrim(p_payload->>'note'), 'evidence', coalesce(p_payload->'evidence', '[]'::jsonb)))
   where id = c.id returning * into c;
  return public._inv_req_end('inv_tyre_conflict_investigate', p_payload,
    jsonb_build_object('id', c.id, 'investigation_status', c.investigation_status));
end $fn$;

-- The investigator proposes a correction; this opens the approval request.
create or replace function public.inv_tyre_conflict_propose(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v jsonb; c public.tyre_custody_conflicts%rowtype; v_corr jsonb; v_act text; v_route jsonb; v_stages jsonb;
  v_src text := 'default'; v_pol uuid; v_ver int; v_req uuid;
begin
  v := public._inv_req_begin('inv_tyre_conflict_propose', p_payload);
  if v is not null then return v; end if;
  c := public._inv_tyre_case(nullif(p_payload->>'conflict_id', '')::uuid);
  if c.investigator_id is distinct from auth.uid() then
    raise exception 'Only the assigned investigator proposes the correction.' using errcode = '42501';
  end if;
  if c.investigation_status not in ('investigating','rejected') then
    raise exception 'A correction is proposed after investigating (now %).', c.investigation_status using errcode = '22023';
  end if;
  if jsonb_array_length(c.investigation_notes) = 0
     or not exists (select 1 from jsonb_array_elements(c.investigation_notes) n where n->>'kind' = 'finding') then
    raise exception 'Record at least one finding before proposing a correction.' using errcode = '22023';
  end if;
  v_act := lower(btrim(coalesce(p_payload->'correction'->>'action', '')));
  if v_act not in ('clear_scrap_mark','close_active_fitment','correct_serial','no_change','other') then
    raise exception 'correction.action must be clear_scrap_mark, close_active_fitment, correct_serial, no_change or other.'
      using errcode = '22023';
  end if;
  if nullif(btrim(p_payload->'correction'->>'detail'), '') is null then
    raise exception 'Describe the correction for the tyre team (correction.detail).' using errcode = '22023';
  end if;
  v_corr := jsonb_build_object('action', v_act, 'detail', btrim(p_payload->'correction'->>'detail'),
    'tyre_record_id', nullif(p_payload->'correction'->>'tyre_record_id', ''));
  if v_corr->>'tyre_record_id' is not null and not exists (select 1 from public.tyre_records t
       where t.id = (v_corr->>'tyre_record_id')::uuid and t.organisation_id = c.organisation_id
         and public.inv_canon_serial(t.serial_no) is not distinct from c.serial) then
    -- the record may have lost the serial in an earlier fix: accept a record of the same company
    if not exists (select 1 from public.tyre_records t where t.id = (v_corr->>'tyre_record_id')::uuid
                    and t.organisation_id = c.organisation_id) then
      raise exception 'correction.tyre_record_id is not a tyre record of this company.' using errcode = '22023';
    end if;
  end if;
  update public.tyre_custody_conflicts set investigation_status = 'proposed', proposed_correction = v_corr,
    proposed_by = auth.uid(), proposed_at = now()
   where id = c.id returning * into c;
  if to_regprocedure('approval_private.resolve(uuid,text,text,text,text,uuid,uuid,text)') is not null then
    execute 'select approval_private.resolve($1, $2, $3, $4, $5, $6, null, null)'
      into v_route using c.organisation_id, 'inventory_tyre_conflict_correction', nullif(c.country, ''), null::text,
        public.get_my_role(), auth.uid();
  end if;
  if v_route is not null and v_route->>'mode' = 'enforced' then
    if v_route->>'status' <> 'matched' then
      raise exception 'No single approval route matches this tyre correction (%).', v_route->>'status' using errcode = '22023';
    end if;
    v_stages := v_route->'policy'->'stages'; v_src := 'policy';
    v_pol := (v_route->'policy'->>'id')::uuid; v_ver := (v_route->'policy'->>'version')::int;
  else
    v_stages := jsonb_build_array(jsonb_build_object('name', 'PMV Manager approval', 'approver_role', 'PMV Manager',
      'default', true, 'require_signature', false, 'distinct_reviewer', true));
  end if;
  insert into public.inventory_approval_requests(organisation_id, country, site, entity_type, entity_id, entity_ref,
    proposal, snapshot, reason, route_source, policy_id, policy_version, stages, requested_by)
  values (c.organisation_id, nullif(c.country, ''), null, 'tyre_conflict_correction', c.id, c.serial,
    jsonb_build_object('correction', v_corr), jsonb_build_object('conflict_id', c.id, 'correction', v_corr),
    nullif(btrim(p_payload->>'reason'), ''), v_src, v_pol, v_ver, v_stages, auth.uid())
  returning id into v_req;
  update public.tyre_custody_conflicts set approval_request_id = v_req where id = c.id;
  return public._inv_req_end('inv_tyre_conflict_propose', p_payload,
    jsonb_build_object('id', c.id, 'investigation_status', 'proposed', 'approval_request_id', v_req));
exception when unique_violation then
  raise exception 'An approval request is already open for this conflict.' using errcode = '23505';
end $fn$;

-- Close after approval: the approved decision is recorded; nothing in tyre records changes.
create or replace function public.inv_tyre_conflict_close(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v jsonb; c public.tyre_custody_conflicts%rowtype; r public.inventory_approval_requests%rowtype;
begin
  v := public._inv_req_begin('inv_tyre_conflict_close', p_payload);
  if v is not null then return v; end if;
  c := public._inv_tyre_case(nullif(p_payload->>'conflict_id', '')::uuid);
  if not (public.app_is_elevated() or public.get_my_role() = 'PMV Manager') then
    raise exception 'Only an Admin, Manager, Director or PMV Manager closes a tyre investigation.' using errcode = '42501';
  end if;
  if c.investigation_status <> 'approved' then
    raise exception 'Only an approved correction closes the case (now %).', c.investigation_status using errcode = '22023';
  end if;
  r := public._inv_approval_consume('tyre_conflict_correction', c.id, jsonb_build_object('correction', c.proposed_correction));
  update public.tyre_custody_conflicts set investigation_status = 'closed', status = 'resolved',
    decided_correction = c.proposed_correction, closed_by = auth.uid(), closed_at = now(),
    resolved_by = auth.uid(), resolved_at = now(),
    resolution_note = coalesce(nullif(btrim(p_payload->>'note'), ''), 'Approved correction: ' || (c.proposed_correction->>'action'))
   where id = c.id returning * into c;
  perform public._inv_tyre_case_event(c, 'conflict_resolved',
    jsonb_build_object('decision', c.decided_correction, 'approval_request_id', r.id, 'note', c.resolution_note));
  return public._inv_req_end('inv_tyre_conflict_close', p_payload, jsonb_build_object('id', c.id,
    'investigation_status', 'closed', 'decision', c.decided_correction,
    'note', 'Decision recorded. The tyre team applies the correction in tyre records; inventory changes no tyre record.'));
end $fn$;

revoke all on function public.inv_tyre_conflict_assign(jsonb), public.inv_tyre_conflict_investigate(jsonb),
  public.inv_tyre_conflict_propose(jsonb), public.inv_tyre_conflict_close(jsonb) from public, anon;
grant execute on function public.inv_tyre_conflict_assign(jsonb), public.inv_tyre_conflict_investigate(jsonb),
  public.inv_tyre_conflict_propose(jsonb), public.inv_tyre_conflict_close(jsonb) to authenticated;

-- The approval outcome moves the case (decide happens in inv_approval_decide).
create or replace function public.inv_tyre_case_follow_approval()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if new.entity_type = 'tyre_conflict_correction' and new.status is distinct from old.status
     and new.status in ('approved','rejected') then
    update public.tyre_custody_conflicts set investigation_status = new.status
     where id = new.entity_id and approval_request_id = new.id and investigation_status = 'proposed';
  end if;
  return new;
end $fn$;
revoke all on function public.inv_tyre_case_follow_approval() from public, anon, authenticated;
drop trigger if exists trg_inv_tyre_case_follow_approval on public.inventory_approval_requests;
create trigger trg_inv_tyre_case_follow_approval after update of status on public.inventory_approval_requests
  for each row execute function public.inv_tyre_case_follow_approval();

-- Read model for the web / phone: one row per case, investigator and approver as ROLES.
create or replace view public.v_inv_tyre_conflict_cases with (security_invoker = on) as
select c.id, c.organisation_id, c.country, c.serial, c.conflict_type, c.status, c.investigation_status, c.detected_at,
       c.evidence, c.investigator_id, c.assigned_at, c.investigation_notes, c.proposed_correction, c.proposed_at,
       c.approval_request_id, a.status as approval_status, a.decided_at as approval_decided_at,
       c.decided_correction, c.closed_at,
       (c.investigator_id = auth.uid()) as i_am_investigator
  from public.tyre_custody_conflicts c
  left join public.inventory_approval_requests a on a.id = c.approval_request_id;
revoke all on public.v_inv_tyre_conflict_cases from anon;
grant select on public.v_inv_tyre_conflict_cases to authenticated;

commit;
