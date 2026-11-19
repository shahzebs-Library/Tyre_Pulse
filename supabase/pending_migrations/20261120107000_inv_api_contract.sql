-- =============================================================================
-- 20261120107000_inv_api_contract.sql
-- STATUS: AUTHORED, NOT APPLIED. Inventory client API contract. Requires 20261120100000..106000.
--         Rollback: 20261120107000_inv_api_contract_ROLLBACK.sql
--
-- ONE CLIENT SHAPE (decided by the DB lane, 2026-11-20; web and Flutter align to it):
--   * Every inv_* WRITE takes exactly one argument p_payload jsonb, and the payload
--     carries a mandatory idempotency_key. A retried call with the same key and the
--     same payload returns the stored result + replayed:true; the same key with a
--     different payload is refused (23505). inv_count_submit is the one exception:
--     its lines are idempotent per client_uuid, so its outer key is optional.
--     (Web shape kept. Flutter's inv_count_submit(p_audit_id, p_device_id, p_lines)
--     becomes inv_count_submit(p_payload {audit_id, device_id, lines}); its line
--     fields and its {accepted, duplicates, rejected} answer are kept.)
--   * Reads that take an id use p_audit_id (inv_audit_counter_view). The answer
--     carries Flutter's {audit, locations, items, submitted} AND web's `lines`
--     (= items) so both clients read it unchanged.
--   * Web list screens read the v_inv_* views below, which expose exactly the
--     column names src/lib/api/inventory.js selects (item_code, location_code,
--     serial_no, category, proposed_qty ...). They are security_invoker, so org,
--     country, site and BLIND-COUNT policies of the base tables still apply, and
--     money columns are NULL without stock:view_value.
--   * Discrepancy root-cause categories = the web's 12 (src/lib/inventory/auditView.js),
--     set in 20261120102000.
--
-- Implementation: the positional functions authored in 100000..106000 are renamed
-- to _inv_* (revoked from clients) and wrapped. Nothing else changes behaviour.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Rename positional implementations out of the client surface
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in select * from (values
    ('inv_post_movement(jsonb)'), ('inv_reverse_movement(uuid,text,text)'), ('inv_exception_resolve(uuid,text,text)'),
    ('inv_master_review_submit(jsonb)'), ('inv_master_review_decide(uuid,text,text)'), ('inv_location_upsert(jsonb)'),
    ('inv_opening_batch_create(text,text,text,text)'), ('inv_opening_batch_add_line(uuid,jsonb)'),
    ('inv_opening_batch_seed_legacy(uuid)'), ('inv_opening_line_map(uuid,jsonb)'), ('inv_opening_batch_submit(uuid)'),
    ('inv_opening_batch_decide(uuid,text,text)'),
    ('inv_audit_create(jsonb)'), ('inv_audit_schedule(uuid,timestamptz,uuid)'), ('inv_audit_start(uuid)'),
    ('inv_count_submit(uuid,text,jsonb)'), ('inv_audit_complete_counting(uuid)'), ('inv_audit_reconcile(uuid)'),
    ('inv_recount_assign(uuid,uuid,uuid[])'), ('inv_discrepancy_update(uuid,jsonb)'), ('inv_adjustment_approve(uuid,text,text)'),
    ('inv_audit_close(uuid,text)'), ('inv_audit_cancel(uuid,text)'),
    ('inv_transfer_dispatch(jsonb)'), ('inv_transfer_receive(jsonb)'), ('inv_transfer_return_remaining(jsonb)'),
    ('inv_reserve(jsonb)'), ('inv_release(uuid,numeric,text)'), ('inv_issue(jsonb)'), ('inv_po_add_line(uuid,jsonb)'),
    ('inv_receive_goods(jsonb)'), ('inv_supplier_invoice_create(jsonb)'), ('inv_supplier_invoice_match(uuid)'),
    ('inv_supplier_agreement_upsert(jsonb)'),
    ('inv_tyre_item_sync(text)'), ('inv_tyre_store_holding(jsonb)'), ('inv_tyre_disposition_record(text,text,text,text)'),
    ('inv_tyre_conflict_decide(uuid,text,text)'),
    ('inv_compat_propose(jsonb)'), ('inv_compat_decide(text,uuid,text,text)')
  ) v(sig) loop
    execute format('alter function public.%s rename to %s', r.sig, '_' || split_part(r.sig, '(', 1));
    execute format('revoke all on function public.%s from public, anon, authenticated', '_' || r.sig);
  end loop;
  alter function public.inv_audit_counter_view(uuid) rename to _inv_counter_view_core;
  revoke all on function public._inv_counter_view_core(uuid) from public, anon, authenticated;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Generic idempotency store for client writes
-- ---------------------------------------------------------------------------
create table if not exists public.inventory_rpc_requests (
  organisation_id uuid not null references public.organisations(id),
  idempotency_key text not null check (length(idempotency_key) between 1 and 200),
  fn text not null,
  payload_hash text not null,
  result jsonb,
  actor_id uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  primary key (organisation_id, idempotency_key)
);
select public._inv_secure_table('inventory_rpc_requests', false, false);
drop policy if exists inventory_rpc_requests_read on public.inventory_rpc_requests;
create policy inventory_rpc_requests_read on public.inventory_rpc_requests for select to authenticated
  using (actor_id = auth.uid());

create or replace function public._inv_req_begin(p_fn text, p_payload jsonb, p_optional boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), ''); v_org uuid := public.app_current_org();
  v public.inventory_rpc_requests%rowtype;
begin
  if not public.is_approved_and_unlocked() or v_org is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'p_payload must be a JSON object.' using errcode = '22023';
  end if;
  if v_key is null then
    if p_optional then return null; end if;
    raise exception 'idempotency_key is required in p_payload.' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':rpc:' || v_key, 0));
  select * into v from public.inventory_rpc_requests where organisation_id = v_org and idempotency_key = v_key;
  if found then
    if v.fn <> p_fn or v.payload_hash <> md5(p_payload::text) then
      raise exception 'This idempotency_key was already used for a different request.' using errcode = '23505';
    end if;
    return coalesce(v.result, 'null'::jsonb) || jsonb_build_object('replayed', true);
  end if;
  return null;
end $fn$;

create or replace function public._inv_req_end(p_fn text, p_payload jsonb, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_res jsonb := case when jsonb_typeof(p_result) = 'object' then p_result else jsonb_build_object('id', p_result) end;
begin
  if v_key is not null then
    insert into public.inventory_rpc_requests(organisation_id, idempotency_key, fn, payload_hash, result)
    values (public.app_current_org(), v_key, p_fn, md5(p_payload::text), v_res);
  end if;
  return v_res;
end $fn$;
revoke all on function public._inv_req_begin(text, jsonb, boolean), public._inv_req_end(text, jsonb, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Schema additions the clients rely on
-- ---------------------------------------------------------------------------
alter table public.inventory_discrepancies add column if not exists proposed_action text;
alter table public.opening_balance_batches add column if not exists source_filename text;
alter table public.opening_balance_batches drop constraint if exists opening_balance_batches_source_check;
alter table public.opening_balance_batches add constraint opening_balance_batches_source_check
  check (source in ('legacy_stock_records','import','manual','excel','csv','erp'));
alter table public.opening_balance_lines
  add column if not exists serial_no text,
  add column if not exists uom text,
  add column if not exists item_code_raw text,
  add column if not exists location_code_raw text,
  add column if not exists issues jsonb not null default '[]'::jsonb;

-- ---------------------------------------------------------------------------
-- 4. Client wrappers: inv_<name>(p_payload jsonb)
-- ---------------------------------------------------------------------------
create or replace function public.inv_post_movement(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  -- the ledger itself is keyed on idempotency_key (stock_movements / stock_exceptions)
  return public._inv_post_movement(p_payload);
end $fn$;

create or replace function public.inv_reverse_movement(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if nullif(p_payload->>'idempotency_key', '') is null then raise exception 'idempotency_key is required in p_payload.' using errcode = '22023'; end if;
  return public._inv_reverse_movement((p_payload->>'movement_id')::uuid, p_payload->>'reason', p_payload->>'idempotency_key');
end $fn$;

create or replace function public.inv_exception_resolve(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_exception_resolve', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_exception_resolve', p_payload, public._inv_exception_resolve(
    (p_payload->>'exception_id')::uuid, p_payload->>'status', coalesce(p_payload->>'notes', p_payload->>'note')));
end $fn$;

create or replace function public.inv_location_upsert(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_location_upsert', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_location_upsert', p_payload,
    to_jsonb(public._inv_location_upsert(p_payload - 'idempotency_key')));
end $fn$;

create or replace function public.inv_master_review_submit(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_master_review_submit', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_master_review_submit', p_payload, to_jsonb(public._inv_master_review_submit(p_payload)));
end $fn$;

create or replace function public.inv_master_review_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_master_review_decide', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_master_review_decide', p_payload, public._inv_master_review_decide(
    (p_payload->>'review_id')::uuid, p_payload->>'decision', p_payload->>'note'));
end $fn$;

-- Opening balances. lines[] may name item_code / location_code (resolved here,
-- unresolved -> needs_review with the raw codes kept) or item_id / location_id.
create or replace function public.inv_opening_batch_create(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_id uuid; l jsonb; v_line uuid; v_item uuid; v_loc uuid; v_org uuid := public.app_current_org();
  v_country text := coalesce(nullif(p_payload->>'country', ''), (select country[1] from public.profiles where id = auth.uid()));
  v_site text := upper(btrim(nullif(p_payload->>'site', ''))); v_seeded int := 0; v_n int := 0;
begin
  r := public._inv_req_begin('inv_opening_batch_create', p_payload); if r is not null then return r; end if;
  v_id := public._inv_opening_batch_create(v_country, v_site,
    coalesce(nullif(p_payload->>'reference', ''), 'OB-' || to_char(now(), 'YYYYMMDD') || '-' || upper(left(md5(p_payload->>'idempotency_key'), 6))),
    coalesce(nullif(p_payload->>'source', ''), 'import'));
  update public.opening_balance_batches set source_filename = p_payload->>'source_filename' where id = v_id;
  if coalesce(p_payload->>'source', '') = 'legacy_stock_records' then
    v_seeded := public._inv_opening_batch_seed_legacy(v_id);
  end if;
  for l in select value from jsonb_array_elements(coalesce(p_payload->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    v_item := coalesce(nullif(l->>'item_id', '')::uuid, (select m.id from public.material_master m where m.organisation_id = v_org
      and lower(coalesce(m.country, '')) = lower(coalesce(v_country, '')) and upper(m.item_code) = upper(btrim(l->>'item_code')) limit 1));
    v_loc := coalesce(nullif(l->>'location_id', '')::uuid, (select x.id from public.inventory_locations x where x.organisation_id = v_org
      and x.site = coalesce(upper(btrim(nullif(l->>'site', ''))), v_site) and x.code = upper(btrim(l->>'location_code')) limit 1));
    v_line := public._inv_opening_batch_add_line(v_id, jsonb_strip_nulls(jsonb_build_object('item_id', v_item, 'location_id', v_loc,
      'qty', l->'qty', 'unit_cost', l->'unit_cost', 'currency', l->>'currency', 'condition', l->>'condition',
      'ownership', l->>'ownership', 'source_ref', coalesce(l->>'source_ref', 'line ' || v_n),
      'source_description', coalesce(l->>'description', l->>'source_description'), 'notes', l->>'notes')));
    update public.opening_balance_lines set serial_no = nullif(l->>'serial_no', ''), uom = nullif(l->>'uom', ''),
      item_code_raw = l->>'item_code', location_code_raw = l->>'location_code',
      issues = coalesce(l->'issues', '[]'::jsonb),
      mapping_status = case when v_item is null or v_loc is null then 'needs_review' else mapping_status end
    where id = v_line;
  end loop;
  return public._inv_req_end('inv_opening_batch_create', p_payload,
    jsonb_build_object('batch_id', v_id, 'lines', v_n, 'seeded_legacy_lines', v_seeded));
end $fn$;

create or replace function public.inv_opening_line_map(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_opening_line_map', p_payload); if r is not null then return r; end if;
  perform public._inv_opening_line_map((p_payload->>'line_id')::uuid, p_payload - 'idempotency_key' - 'line_id');
  return public._inv_req_end('inv_opening_line_map', p_payload, jsonb_build_object('line_id', p_payload->>'line_id'));
end $fn$;

create or replace function public.inv_opening_batch_submit(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_opening_batch_submit', p_payload); if r is not null then return r; end if;
  perform public._inv_opening_batch_submit((p_payload->>'batch_id')::uuid);
  return public._inv_req_end('inv_opening_batch_submit', p_payload, jsonb_build_object('batch_id', p_payload->>'batch_id', 'status', 'submitted'));
end $fn$;

create or replace function public.inv_opening_batch_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_opening_batch_decide', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_opening_batch_decide', p_payload, public._inv_opening_batch_decide(
    (p_payload->>'batch_id')::uuid, p_payload->>'decision', p_payload->>'note'));
end $fn$;
-- web name for the same decision
create or replace function public.inv_opening_batch_approve(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public.inv_opening_batch_decide(p_payload) $$;

-- Audits
create or replace function public.inv_audit_create(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_create', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_audit_create', p_payload, to_jsonb(public._inv_audit_create(p_payload - 'idempotency_key')));
end $fn$;

create or replace function public.inv_audit_schedule(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_schedule', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_audit_schedule', p_payload, public._inv_audit_schedule((p_payload->>'audit_id')::uuid,
    nullif(p_payload->>'due_at', '')::timestamptz, nullif(p_payload->>'counter_id', '')::uuid));
end $fn$;

create or replace function public.inv_audit_start(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_start', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_audit_start', p_payload, public._inv_audit_start((p_payload->>'audit_id')::uuid));
end $fn$;

-- Lines are idempotent per client_uuid, so the outer key is optional here.
create or replace function public.inv_count_submit(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_count_submit', p_payload, true); if r is not null then return r; end if;
  return public._inv_req_end('inv_count_submit', p_payload, public._inv_count_submit((p_payload->>'audit_id')::uuid,
    coalesce(p_payload->>'device_id', p_payload->'lines'->0->>'device_id'), p_payload->'lines'));
end $fn$;

create or replace function public.inv_audit_complete_counting(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_complete_counting', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_audit_complete_counting', p_payload, public._inv_audit_complete_counting((p_payload->>'audit_id')::uuid));
end $fn$;

create or replace function public.inv_audit_reconcile(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_reconcile', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_audit_reconcile', p_payload, public._inv_audit_reconcile((p_payload->>'audit_id')::uuid));
end $fn$;

create or replace function public.inv_recount_assign(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_ids uuid[];
begin
  r := public._inv_req_begin('inv_recount_assign', p_payload); if r is not null then return r; end if;
  -- discrepancy_ids (Flutter / DB) or the web's line_keys 'location_id|item_id|serial'
  select coalesce(array_agg(distinct d.id), '{}') into v_ids
    from public.inventory_discrepancies d
   where d.audit_id = (p_payload->>'audit_id')::uuid and d.organisation_id = public.app_current_org()
     and (d.id::text in (select jsonb_array_elements_text(coalesce(p_payload->'discrepancy_ids', '[]'::jsonb)))
          or coalesce(d.location_id::text, '') || '|' || coalesce(d.item_id::text, '') || '|' || coalesce(d.serial, '')
             in (select jsonb_array_elements_text(coalesce(p_payload->'line_keys', '[]'::jsonb))));
  return public._inv_req_end('inv_recount_assign', p_payload, public._inv_recount_assign((p_payload->>'audit_id')::uuid,
    coalesce(nullif(p_payload->>'recount_counter_id', ''), p_payload->>'counter_id')::uuid, v_ids));
end $fn$;

create or replace function public.inv_discrepancy_update(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v jsonb;
begin
  r := public._inv_req_begin('inv_discrepancy_update', p_payload); if r is not null then return r; end if;
  v := jsonb_strip_nulls(jsonb_build_object('status', p_payload->>'status',
    'root_cause_category', coalesce(p_payload->>'category', p_payload->>'root_cause_category'),
    'investigation_notes', p_payload->>'investigation_notes', 'evidence', p_payload->'evidence',
    'proposed_correction_qty', coalesce(p_payload->'proposed_qty', p_payload->'proposed_correction_qty')));
  r := public._inv_discrepancy_update((p_payload->>'discrepancy_id')::uuid, v);
  if p_payload ? 'proposed_action' then
    update public.inventory_discrepancies set proposed_action = p_payload->>'proposed_action'
     where id = (p_payload->>'discrepancy_id')::uuid;
  end if;
  return public._inv_req_end('inv_discrepancy_update', p_payload, r);
end $fn$;

-- decision approve | reject | hold. 'recount' is a separate action (inv_recount_assign).
create or replace function public.inv_adjustment_approve(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb; v_adj uuid := nullif(p_payload->>'adjustment_id', '')::uuid; v_dec text := lower(coalesce(p_payload->>'decision', ''));
begin
  r := public._inv_req_begin('inv_adjustment_approve', p_payload); if r is not null then return r; end if;
  if v_adj is null then
    select id into v_adj from public.inventory_adjustments
     where discrepancy_id = (p_payload->>'discrepancy_id')::uuid and organisation_id = public.app_current_org();
  end if;
  if v_adj is null then raise exception 'No proposed adjustment for this discrepancy.' using errcode = 'P0002'; end if;
  if v_dec = 'recount' then
    raise exception 'Assign a recount with inv_recount_assign.' using errcode = '22023';
  elsif v_dec = 'hold' then
    if not public.is_approved_and_unlocked() or not public.inv_can('adjustment_approve') then
      raise exception 'Stock permission "adjustment_approve" is required.' using errcode = '42501';
    end if;
    update public.inventory_adjustments set decision_note = concat_ws(E'\n', decision_note, 'HOLD: ' || coalesce(p_payload->>'note', ''))
     where id = v_adj and status = 'proposed' and organisation_id = public.app_current_org();
    r := jsonb_build_object('status', 'proposed', 'held', true);
  else
    r := public._inv_adjustment_approve(v_adj, v_dec, p_payload->>'note');
  end if;
  return public._inv_req_end('inv_adjustment_approve', p_payload, r);
end $fn$;

-- close, or cancel with {cancel:true, reason} (web shape)
create or replace function public.inv_audit_close(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_audit_close', p_payload); if r is not null then return r; end if;
  if coalesce((p_payload->>'cancel')::boolean, false) then
    r := public._inv_audit_cancel((p_payload->>'audit_id')::uuid, p_payload->>'reason');
  else
    r := public._inv_audit_close((p_payload->>'audit_id')::uuid, coalesce(p_payload->>'note', p_payload->>'reason'));
  end if;
  return public._inv_req_end('inv_audit_close', p_payload, r);
end $fn$;

create or replace function public.inv_audit_cancel(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$
  select public.inv_audit_close(p_payload || jsonb_build_object('cancel', true))
$$;

-- Counter view: keep Flutter's keys and add web's `lines`.
create or replace function public.inv_audit_counter_view(p_audit_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v jsonb;
begin
  v := public._inv_counter_view_core(p_audit_id);
  if p_audit_id is not null then v := v || jsonb_build_object('lines', v->'items'); end if;
  return v;
end $fn$;

-- Transfers / stock / procurement (implementations already take a payload)
create or replace function public.inv_transfer_dispatch(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_transfer_dispatch(p_payload) $$;
create or replace function public.inv_transfer_receive(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_transfer_receive(p_payload) $$;
create or replace function public.inv_transfer_return_remaining(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_transfer_return_remaining(p_payload) $$;
create or replace function public.inv_reserve(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_reserve(p_payload) $$;
create or replace function public.inv_issue(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_issue(p_payload) $$;
create or replace function public.inv_receive_goods(p_payload jsonb) returns jsonb
language sql security definer set search_path = public, pg_temp as $$ select public._inv_receive_goods(p_payload) $$;

create or replace function public.inv_release(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  if nullif(p_payload->>'idempotency_key', '') is null then raise exception 'idempotency_key is required in p_payload.' using errcode = '22023'; end if;
  return public._inv_release((p_payload->>'reservation_id')::uuid, nullif(p_payload->>'qty', '')::numeric, p_payload->>'idempotency_key');
end $fn$;

create or replace function public.inv_po_add_line(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_po_add_line', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_po_add_line', p_payload,
    to_jsonb(public._inv_po_add_line((p_payload->>'po_id')::uuid, p_payload - 'idempotency_key' - 'po_id')));
end $fn$;

create or replace function public.inv_supplier_invoice_create(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_supplier_invoice_create', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_supplier_invoice_create', p_payload, to_jsonb(public._inv_supplier_invoice_create(p_payload)));
end $fn$;

create or replace function public.inv_supplier_invoice_match(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_supplier_invoice_match', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_supplier_invoice_match', p_payload, public._inv_supplier_invoice_match((p_payload->>'invoice_id')::uuid));
end $fn$;

create or replace function public.inv_supplier_agreement_upsert(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_supplier_agreement_upsert', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_supplier_agreement_upsert', p_payload, to_jsonb(public._inv_supplier_agreement_upsert(p_payload)));
end $fn$;

-- Tyres
create or replace function public.inv_tyre_item_sync(p_payload jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
begin
  -- a derivation is naturally repeatable; no idempotency key needed
  return public._inv_tyre_item_sync(nullif(coalesce(p_payload, '{}'::jsonb)->>'country', ''));
end $fn$;

create or replace function public.inv_tyre_store_holding(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_tyre_store_holding', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_tyre_store_holding', p_payload, to_jsonb(public._inv_tyre_store_holding(p_payload || jsonb_build_object('serial', coalesce(p_payload->>'serial', p_payload->>'serial_no')))));
end $fn$;

create or replace function public.inv_tyre_disposition_record(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_tyre_disposition_record', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_tyre_disposition_record', p_payload, to_jsonb(public._inv_tyre_disposition_record(
    coalesce(p_payload->>'serial_no', p_payload->>'serial'), p_payload->>'country', p_payload->>'state', p_payload->>'reason')));
end $fn$;

create or replace function public.inv_tyre_conflict_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_tyre_conflict_decide', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_tyre_conflict_decide', p_payload, public._inv_tyre_conflict_decide(
    (p_payload->>'conflict_id')::uuid, p_payload->>'status', coalesce(p_payload->>'note', p_payload->>'resolution_note')));
end $fn$;

-- Compatibility
create or replace function public.inv_compat_propose(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_compat_propose', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_compat_propose', p_payload, to_jsonb(public._inv_compat_propose(p_payload)));
end $fn$;

create or replace function public.inv_compat_decide(p_payload jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $fn$
declare r jsonb;
begin
  r := public._inv_req_begin('inv_compat_decide', p_payload); if r is not null then return r; end if;
  return public._inv_req_end('inv_compat_decide', p_payload, public._inv_compat_decide(
    p_payload->>'kind', (p_payload->>'id')::uuid, p_payload->>'decision', p_payload->>'note'));
end $fn$;

-- ---------------------------------------------------------------------------
-- 5. Read views with the web's column names (security_invoker: RLS + blind policies apply)
-- ---------------------------------------------------------------------------
create or replace view public.v_inv_balances with (security_invoker = on) as
select s.id, s.item_id, m.item_code, s.description, s.site, s.country, s.location_id, l.code as location_code, s.condition,
  s.ownership, s.owner_supplier_id, s.qty_on_hand, s.qty_reserved,
  case when (select public.inv_can('view_value')) then s.avg_unit_cost end as avg_unit_cost, s.currency,
  m.reorder_point, m.min_qty, m.max_qty, coalesce(s.uom, m.base_uom, m.uom) as uom, s.version, s.updated_at,
  s.valued_qty, s.unvalued_qty,
  case when s.qty_on_hand = 0 then 'empty' when s.unvalued_qty = 0 then 'valued' when s.valued_qty = 0 then 'unvalued'
       else 'partially_valued' end as valuation_status,
  s.organisation_id
from public.stock_records s
left join public.material_master m on m.id = s.item_id
left join public.inventory_locations l on l.id = s.location_id;

create or replace view public.v_inv_movements with (security_invoker = on) as
select mv.id, mv.movement_seq, mv.movement_type, mv.item_id, m.item_code, mv.site, mv.country, mv.location_id,
  l.code as location_code, mv.qty_before, mv.qty_change, mv.qty_after,
  case when (select public.inv_can('view_value')) then mv.unit_cost end as unit_cost,
  case when (select public.inv_can('view_value')) then mv.value_change end as value_change,
  mv.currency, mv.ownership, mv.source_doc_type, mv.source_doc_id, mv.reverses_movement_id, mv.reason, mv.reference_no,
  mv.actor_id, mv.created_by, mv.approval_ref, mv.posted_at, mv.effective_at, mv.created_at,
  mv.unvalued_qty_change, mv.valuation_status, mv.stock_id, mv.organisation_id
from public.stock_movements mv
left join public.material_master m on m.id = mv.item_id
left join public.inventory_locations l on l.id = mv.location_id;

create or replace view public.v_inv_discrepancies with (security_invoker = on) as
select d.id, d.audit_id, a.ref as audit_ref, d.item_id, m.item_code, coalesce(m.item_name, s.description) as description,
  d.location_id, l.code as location_code, d.serial as serial_no, d.root_cause_category as category, d.variance_type,
  d.expected_qty, d.counted_qty, d.variance_qty,
  case when (select public.inv_can('view_value')) then d.value_impact end as value_impact, d.currency,
  d.investigator_id, d.investigation_notes, d.evidence, d.proposed_correction_qty as proposed_qty, d.proposed_action,
  d.status, adj.approved_by, adj.approved_at, d.created_at, d.country, d.site, d.round, d.organisation_id
from public.inventory_discrepancies d
join public.inventory_audits a on a.id = d.audit_id
left join public.material_master m on m.id = d.item_id
left join public.stock_records s on s.id = d.stock_id
left join public.inventory_locations l on l.id = d.location_id
left join public.inventory_adjustments adj on adj.discrepancy_id = d.id;

create or replace view public.v_inv_adjustments with (security_invoker = on) as
select j.id, j.discrepancy_id, j.audit_id, m.item_code, l.code as location_code, j.qty_change,
  case when (select public.inv_can('view_value')) then j.value_impact end as value_change, j.currency, j.status,
  a.counter_id as counted_by, j.proposed_by as created_by, j.approved_by, j.approved_at, j.movement_id,
  j.proposed_at as created_at, j.organisation_id
from public.inventory_adjustments j
join public.inventory_audits a on a.id = j.audit_id
left join public.material_master m on m.id = j.item_id
left join public.inventory_locations l on l.id = j.location_id;

create or replace view public.v_inv_opening_batches with (security_invoker = on) as
select b.id, b.reference as ref, b.source, b.source_filename, b.site, b.country, b.status,
  (select count(*) from public.opening_balance_lines x where x.batch_id = b.id) as line_count,
  (select count(*) from public.opening_balance_lines x where x.batch_id = b.id and x.missing_cost) as missing_cost_count,
  b.prepared_by as created_by, case when b.submitted_at is not null then b.prepared_by end as submitted_by,
  b.approved_by, b.approved_at, b.created_at, b.organisation_id
from public.opening_balance_batches b;

create or replace view public.v_inv_opening_lines with (security_invoker = on) as
select x.id, x.batch_id, x.line_no, coalesce(m.item_code, x.item_code_raw) as item_code,
  coalesce(x.source_description, m.item_name) as description, coalesce(l.code, x.location_code_raw) as location_code,
  coalesce(l.site, b.site) as site, x.qty, coalesce(x.uom, m.base_uom, m.uom) as uom,
  case when (select public.inv_can('view_value')) then x.unit_cost end as unit_cost, x.currency, x.condition, x.serial_no,
  x.mapping_status, x.missing_cost, x.issues, x.history_certainty, x.legacy_drift, x.target_stock_id, x.organisation_id
from public.opening_balance_lines x
join public.opening_balance_batches b on b.id = x.batch_id
left join public.material_master m on m.id = x.item_id
left join public.inventory_locations l on l.id = x.location_id;

create or replace view public.v_inv_master_reviews with (security_invoker = on) as
select r.id, r.item_id, m.item_code, r.proposed as proposed_change, r.change_type, r.target_item_id, r.reason, r.status,
  r.proposed_by as requested_by, r.reviewer_id, r.review_note, r.proposed_at as created_at, r.organisation_id
from public.material_master_reviews r left join public.material_master m on m.id = r.item_id;

create or replace view public.v_inv_tyre_items with (security_invoker = on) as
select t.id, t.serial as serial_no, t.custody_state, t.basis, t.site, t.country, t.location_id, l.code as location_code,
  t.asset_no, t.position, case when (select public.inv_can('view_value')) then t.purchase_cost end as purchase_cost,
  t.currency, t.brand, t.size, t.last_derived_at as updated_at, t.organisation_id
from public.tyre_items t left join public.inventory_locations l on l.id = t.location_id;

create or replace view public.v_inv_custody_conflicts with (security_invoker = on) as
select c.id, t.id as tyre_item_id, c.serial as serial_no, c.country, c.conflict_type, c.status, c.evidence, c.detected_at,
  c.detected_by, c.resolved_by, c.resolved_at, c.resolution_note, c.detected_at as created_at, c.organisation_id
from public.tyre_custody_conflicts c
left join public.tyre_items t on t.organisation_id = c.organisation_id and t.country = c.country and t.serial = c.serial;

create or replace view public.v_inv_supplier_agreements with (security_invoker = on) as
select a.id, a.supplier_id, s.supplier_name, a.agreement_type, a.agreement_no, a.min_qty, a.max_qty, a.lead_time_days,
  a.credit_terms_days as credit_terms, a.return_terms, a.expires_on as expires_at, a.status, a.created_at, a.country,
  a.organisation_id
from public.supplier_agreements a left join public.suppliers s on s.id = a.supplier_id;

create or replace view public.v_inv_po_lines with (security_invoker = on) as
select pl.id, pl.po_id as purchase_order_id, po.po_number, m.item_code, coalesce(pl.description, m.item_name) as description,
  pl.qty_ordered as ordered_qty, pl.qty_received as received_qty, pl.qty_accepted as accepted_qty,
  case when (select public.inv_can('view_value')) then pl.unit_price end as unit_price, pl.currency, pl.status,
  po.created_at, po.country, po.site, pl.organisation_id
from public.purchase_order_lines pl
join public.purchase_orders po on po.id = pl.po_id
left join public.material_master m on m.id = pl.item_id;

create or replace view public.v_inv_grn_lines with (security_invoker = on) as
select gl.id, gl.grn_id as goods_receipt_id, g.grn_no as grn_number, po.po_number, m.item_code, m.item_name as description,
  gl.qty_received as received_qty, gl.qty_accepted as accepted_qty, gl.qty_rejected as rejected_qty,
  case when (select public.inv_can('view_value')) then gl.unit_cost end as unit_cost, gl.currency, g.created_at,
  g.country, g.site, gl.organisation_id
from public.goods_receipt_lines gl
join public.goods_receipts g on g.id = gl.grn_id
left join public.purchase_orders po on po.id = g.po_id
left join public.material_master m on m.id = gl.item_id;

do $$ declare v text; begin
  foreach v in array array['v_inv_balances','v_inv_movements','v_inv_discrepancies','v_inv_adjustments',
    'v_inv_opening_batches','v_inv_opening_lines','v_inv_master_reviews','v_inv_tyre_items','v_inv_custody_conflicts',
    'v_inv_supplier_agreements','v_inv_po_lines','v_inv_grn_lines'] loop
    execute format('revoke all on public.%I from anon', v);
    execute format('grant select on public.%I to authenticated', v);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Grants on the client surface
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['inv_post_movement','inv_reverse_movement','inv_exception_resolve','inv_location_upsert',
    'inv_master_review_submit','inv_master_review_decide','inv_opening_batch_create','inv_opening_line_map',
    'inv_opening_batch_submit','inv_opening_batch_decide','inv_opening_batch_approve','inv_audit_create',
    'inv_audit_schedule','inv_audit_start','inv_count_submit','inv_audit_complete_counting','inv_audit_reconcile',
    'inv_recount_assign','inv_discrepancy_update','inv_adjustment_approve','inv_audit_close','inv_audit_cancel',
    'inv_transfer_dispatch','inv_transfer_receive','inv_transfer_return_remaining','inv_reserve','inv_issue',
    'inv_receive_goods','inv_release','inv_po_add_line','inv_supplier_invoice_create','inv_supplier_invoice_match',
    'inv_supplier_agreement_upsert','inv_tyre_item_sync','inv_tyre_store_holding','inv_tyre_disposition_record',
    'inv_tyre_conflict_decide','inv_compat_propose','inv_compat_decide'] loop
    execute format('revoke all on function public.%I(jsonb) from public, anon', f);
    execute format('grant execute on function public.%I(jsonb) to authenticated', f);
  end loop;
end $$;
revoke all on function public.inv_audit_counter_view(uuid) from public, anon;
grant execute on function public.inv_audit_counter_view(uuid) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
