-- =============================================================================
-- 20261122110000_inv_transfer_return_remaining_fix.sql
-- STATUS: AUTHORED, NOT APPLIED. Lives in supabase/pending_migrations/ so no deploy
--         can apply it. Requires the applied inventory release 20261120100000..115000.
--         Rollback: 20261122110000_inv_transfer_return_remaining_fix_ROLLBACK.sql
--
-- DEFECT (live, read 2026-11-21 via pg_get_functiondef; live == repo bodies)
--   inv_transfer_return_remaining -> _inv_transfer_return_remaining -> _inv_transfer_move.
--   _inv_transfer_move loops over p->'lines' and THEN recomputes the transfer status.
--   With `lines` absent or [] the loop does nothing, so an in_transit transfer was
--   set to 'partially_received' (and cancel_reason overwritten) while no stock moved,
--   no ledger row was written and the transit balance stayed put. Same hole on
--   inv_transfer_receive with no lines.
--
-- FIX (owner rule: return everything correctly, or refuse without touching status)
--   1. _inv_transfer_return_remaining: `lines` absent / null / [] means "return every
--      remaining quantity" (the function is named return_remaining; no web or Flutter
--      caller sends lines today, inventory_flows test does). Each line with
--      qty_dispatched - qty_received - qty_returned > 0 is returned in full.
--      Nothing left -> 22023 refusal, status untouched. `lines` present but not an
--      array -> 22023 refusal.
--      Reservations held on the in-transit balance of a returned line are released
--      first, oldest first, only by the shortfall (transit balances are shared per
--      destination site, so other transfers' reservations are never touched beyond
--      what this return needs). Each release writes a 'release' ledger row and
--      updates stock_reservations (qty_released / status).
--      Replays: the request is now recorded in inventory_rpc_requests
--      (_inv_req_begin / _inv_req_end); the same key + same payload returns the stored
--      result with replayed=true and moves nothing; the same key + another payload is
--      refused 23505.
--   2. _inv_transfer_move: refuses (22023) a call without a non-empty `lines` array,
--      BEFORE any write. Defence in depth for inv_transfer_receive (web and Flutter
--      receive already require >= 1 line client-side).
--   Signatures, SECURITY DEFINER, search_path and grants unchanged (CREATE OR REPLACE
--   keeps the ACL: both helpers stay postgres + service_role only; the public
--   inv_transfer_return_remaining wrapper is not touched). No 40001 raised.
--
-- VERIFY (rolled back, after apply)
--   select has_function_privilege('authenticated','public._inv_transfer_return_remaining(jsonb)','EXECUTE'); -- f
--   select has_function_privilege('authenticated','public._inv_transfer_move(jsonb,text)','EXECUTE');      -- f
--   select has_function_privilege('authenticated','public.inv_transfer_return_remaining(jsonb)','EXECUTE'); -- t
--   select position('jsonb_array_length' in pg_get_functiondef('public._inv_transfer_move(jsonb,text)'::regprocedure)) > 0; -- t
--   Behaviour: supabase/tests/inventory_transfer_return_remaining.test.mjs (PGlite).
-- =============================================================================

create or replace function public._inv_transfer_move(p jsonb, p_mode text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_key text := nullif(btrim(p->>'idempotency_key'), '');
  v_t public.stock_transfers%rowtype; l jsonb; ln public.stock_transfer_lines%rowtype; v_qty numeric;
  v_dest uuid; v_out jsonb; v_in jsonb; v_left numeric;
begin
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select * into v_t from public.stock_transfers where id = (p->>'transfer_id')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Transfer not found.' using errcode = 'P0002'; end if;
  if v_t.status not in ('in_transit','dispatched','partially_received') then
    raise exception 'Transfer is %; nothing left in transit.', v_t.status using errcode = '22023';
  end if;
  if p_mode = 'receive' and not public._inv_scope_ok(v_t.country, v_t.to_site) then
    raise exception 'The destination is outside your scope.' using errcode = '42501';
  end if;
  -- 20261122110000: a move with no lines would fall through to the status update
  -- below and mark the transfer partly received / closed without moving any stock.
  if jsonb_typeof(p->'lines') is distinct from 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'Select at least one transfer line.' using errcode = '22023';
  end if;
  for l in select value from jsonb_array_elements(p->'lines') loop
    select * into ln from public.stock_transfer_lines where id = (l->>'line_id')::uuid and transfer_id = v_t.id for update;
    if not found then raise exception 'Transfer line not found.' using errcode = 'P0002'; end if;
    v_qty := coalesce(nullif(l->>'received_qty', ''), l->>'qty')::numeric;
    v_left := ln.qty_dispatched - ln.qty_received - ln.qty_returned;
    if v_qty is null or v_qty <= 0 or v_qty > v_left then
      raise exception 'Line %: quantity must be between 0 and the % still in transit.', ln.line_no, v_left using errcode = '22023';
    end if;
    v_dest := case when p_mode = 'receive' then v_t.to_location_id else v_t.from_location_id end;
    v_out := public._inv_post(jsonb_build_object('idempotency_key', 'trf:' || v_key || ':' || ln.id || ':out', 'stock_id', ln.transit_stock_id,
      'movement_type', 'transfer_out', 'qty_change', -v_qty, 'reason', p_mode || ' ' || v_t.ref,
      'source_doc_type', 'stock_transfer', 'source_doc_id', v_t.id::text), false);
    if v_out->>'status' = 'refused_shortage' then
      raise exception 'Line %: in-transit stock is not available.', ln.line_no using errcode = '23514';
    end if;
    v_in := public._inv_post(jsonb_build_object('idempotency_key', 'trf:' || v_key || ':' || ln.id || ':in', 'item_id', ln.item_id,
      'location_id', v_dest, 'condition', case when lower(coalesce(l->>'condition', '')) in ('', 'good') then ln.condition else lower(l->>'condition') end, 'ownership', ln.ownership,
      'owner_supplier_id', ln.owner_supplier_id, 'movement_type', 'transfer_in', 'qty_change', v_qty,
      'currency', v_out->>'currency', 'unit_cost', v_out->'unit_cost',
      'carried_value', -coalesce((v_out->>'value_change')::numeric, 0),
      'carried_unvalued_qty', -coalesce((v_out->>'unvalued_qty_change')::numeric, 0),
      'carried_pending_qty', coalesce((v_out->>'pending_out_change')::numeric, 0), 'carried_movement_id', v_out->>'movement_id',
      'carried_from_stock_id', ln.transit_stock_id,
      'reason', p_mode || ' ' || v_t.ref, 'source_doc_type', 'stock_transfer', 'source_doc_id', v_t.id::text), false);
    update public.stock_transfer_lines set
      qty_received = qty_received + case when p_mode = 'receive' then v_qty else 0 end,
      qty_returned = qty_returned + case when p_mode = 'return' then v_qty else 0 end
    where id = ln.id;
  end loop;
  update public.stock_transfers t set status = case
      when not exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id
                        and x.qty_received + x.qty_returned < x.qty_dispatched) then
        case when exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id and x.qty_received > 0)
             then 'completed' else 'cancelled' end
      else 'partially_received' end,
    completed_at = case when not exists (select 1 from public.stock_transfer_lines x where x.transfer_id = t.id
                        and x.qty_received + x.qty_returned < x.qty_dispatched) then now() end,
    cancel_reason = case when p_mode = 'return' then coalesce(p->>'reason', cancel_reason) else cancel_reason end
  where id = v_t.id returning * into v_t;
  return jsonb_build_object('transfer_id', v_t.id, 'status', v_t.status);
end $fn$;

create or replace function public._inv_transfer_return_remaining(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p jsonb := p_payload; v_org uuid := public.app_current_org(); v_key text;
  v_t public.stock_transfers%rowtype; v_lines jsonb; v_r jsonb; v_req jsonb;
  ln record; v_rec public.stock_records%rowtype; v_short numeric; v_res public.stock_reservations%rowtype;
  v_take numeric; v_released numeric := 0; v_qty numeric; v_total numeric := 0;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'reason'), '') is null then raise exception 'Give a reason.' using errcode = '22023'; end if;
  v_key := nullif(btrim(p->>'idempotency_key'), '');
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  v_req := public._inv_req_begin('inv_transfer_return_remaining', p);
  if v_req is not null then return v_req; end if;

  select * into v_t from public.stock_transfers where id = nullif(p->>'transfer_id', '')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Transfer not found.' using errcode = 'P0002'; end if;
  if v_t.status not in ('in_transit','dispatched','partially_received') then
    raise exception 'Transfer is %; nothing left in transit.', v_t.status using errcode = '22023';
  end if;

  if p->'lines' is null or jsonb_typeof(p->'lines') = 'null'
     or (jsonb_typeof(p->'lines') = 'array' and jsonb_array_length(p->'lines') = 0) then
    -- no line selected: return every remaining quantity
    select coalesce(jsonb_agg(jsonb_build_object('line_id', x.id,
             'qty', x.qty_dispatched - x.qty_received - x.qty_returned) order by x.line_no), '[]'::jsonb)
      into v_lines
      from public.stock_transfer_lines x
     where x.transfer_id = v_t.id and x.qty_dispatched - x.qty_received - x.qty_returned > 0;
    if jsonb_array_length(v_lines) = 0 then
      raise exception 'Nothing is left in transit to return on this transfer.' using errcode = '22023';
    end if;
  elsif jsonb_typeof(p->'lines') <> 'array' then
    raise exception 'lines must be an array of {line_id, qty}.' using errcode = '22023';
  else
    v_lines := p->'lines';
  end if;

  -- free the in-transit balance where a reservation would block the return
  for ln in
    select x.transit_stock_id, sum(coalesce(nullif(l->>'received_qty', ''), l->>'qty')::numeric) as qty
      from jsonb_array_elements(v_lines) l
      join public.stock_transfer_lines x on x.id = nullif(l->>'line_id', '')::uuid and x.transfer_id = v_t.id
     group by x.transit_stock_id
  loop
    select * into v_rec from public.stock_records where id = ln.transit_stock_id for update;
    if not found or ln.qty is null then continue; end if;
    v_short := ln.qty - (coalesce(v_rec.qty_on_hand, 0) - coalesce(v_rec.qty_reserved, 0));
    for v_res in select * from public.stock_reservations
                  where stock_id = ln.transit_stock_id and organisation_id = v_org and status = 'active'
                  order by created_at, id for update loop
      exit when v_short <= 0;
      v_take := least(v_short, v_res.qty - v_res.qty_released - v_res.qty_consumed);
      continue when v_take <= 0;
      perform public._inv_post(jsonb_build_object('idempotency_key', 'trf:' || v_key || ':' || v_res.id || ':rel',
        'stock_id', v_res.stock_id, 'movement_type', 'release', 'qty_change', 0, 'reserved_change', -v_take,
        'reason', 'return ' || v_t.ref, 'source_doc_type', 'stock_reservation', 'source_doc_id', v_res.id::text), false);
      update public.stock_reservations set qty_released = qty_released + v_take,
        status = case when qty_released + v_take + qty_consumed >= qty then 'released' else status end
      where id = v_res.id;
      v_short := v_short - v_take; v_released := v_released + v_take;
    end loop;
  end loop;

  select coalesce(sum(coalesce(nullif(l->>'received_qty', ''), l->>'qty')::numeric), 0) into v_total
    from jsonb_array_elements(v_lines) l;
  v_r := public._inv_transfer_move(p || jsonb_build_object('lines', v_lines), 'return')
         || jsonb_build_object('returned_lines', jsonb_array_length(v_lines), 'returned_qty', v_total,
                               'reservations_released_qty', v_released);
  return public._inv_req_end('inv_transfer_return_remaining', p, v_r);
end $fn$;
