-- =============================================================================
-- 20261122110000_inv_transfer_return_remaining_fix_ROLLBACK.sql
-- Restores the exact live bodies of public._inv_transfer_move(jsonb,text) and
-- public._inv_transfer_return_remaining(jsonb) as read from production on
-- 2026-11-21 (pg_get_functiondef). CREATE OR REPLACE keeps the grants.
-- Rows written to inventory_rpc_requests by the fixed function are harmless and kept.
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

CREATE OR REPLACE FUNCTION public._inv_transfer_return_remaining(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare p jsonb := p_payload;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'reason'), '') is null then raise exception 'Give a reason.' using errcode = '22023'; end if;
  return public._inv_transfer_move(p, 'return');
end $function$;
