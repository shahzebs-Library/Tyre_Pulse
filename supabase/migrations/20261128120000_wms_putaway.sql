-- 20261128120000_wms_putaway
--
-- One-call put-away: move free stock from one location to another storage
-- location of the SAME site, as ONE ledger move (transfer_out + transfer_in in
-- one transaction). Replaces the web detour of dispatch to IN-TRANSIT + receive
-- (four movements and a TRF- document for a move inside one store).
--
-- Built against the LIVE bodies (read with pg_get_functiondef, 2026-11-28):
--   * _inv_post(jsonb, boolean, boolean): a transfer_in carrying 'carried_value'
--     takes value from carried_value, unvalued qty from carried_unvalued_qty and
--     undecided qty from carried_pending_qty; it is not tied to a stock_transfer
--     document. The out leg returns value_change (<= 0), unvalued_qty_change
--     (<= 0) and pending_out_change (>= 0); the in leg is fed their negations,
--     exactly like _inv_transfer_dispatch. _inv_cost_rec_track moves the open
--     cost reconciliations with the units (carried_from_stock_id) and keys on no
--     document type.
--   * _inv_post refuses (refused_shortage) when qty > on hand - reserved, so a
--     reservation is respected; it refuses a blind-audit counter (42501) and a
--     balance outside the caller's country/site scope (42501), on BOTH legs.
--   * _inv_req_begin / _inv_req_end give request-level idempotency; a key reused
--     with a different payload is reported as a conflict (PT409 here).
--   * Store Keeper holds stock 'transfer' (inv_can('transfer') = true, checked
--     live as a real Store Keeper). Nothing is widened.
--
-- Targets: only storage location types (warehouse, zone, rack, shelf, bin,
-- receiving, workshop_store); never in_transit, quarantine, damaged, scrap,
-- warranty, repairable, custody, consignment, inspection, service van or bulk
-- tank. A target with a restriction set, an inactive target, or a target whose
-- capacity_qty would be exceeded is refused. Capacity is compared only when the
-- capacity unit equals the item unit; otherwise the move is refused (no guess).
--
-- Rolled-back proof on jhssdmeruxtrlqnwfksc, 2026-11-28 (DO block ending in
-- RAISE EXCEPTION, nothing persisted) -- see the results block at the end.

begin;

create or replace function public.inv_putaway(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  p jsonb := p_payload;
  v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(coalesce(p_payload->>'idempotency_key', '')), '');
  v_cached jsonb;
  v_rec public.stock_records%rowtype;
  v_from public.inventory_locations%rowtype;
  v_to public.inventory_locations%rowtype;
  v_qty numeric;
  v_uom text;
  v_held numeric;
  v_note text;
  v_out jsonb;
  v_in jsonb;
  v_res jsonb;
begin
  if not public.is_approved_and_unlocked() or v_org is null or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  begin
    v_cached := public._inv_req_begin('inv_putaway', p);
  exception when unique_violation then
    raise exception 'This put-away key was already used for a different move.' using errcode = 'PT409';
  end;
  if v_cached is not null then return v_cached; end if;

  begin
    v_qty := (p->>'qty')::numeric;
  exception when others then
    raise exception 'Quantity must be a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then
    raise exception 'Give a quantity above zero.' using errcode = '22023';
  end if;
  v_note := left(nullif(btrim(coalesce(p->>'note', '')), ''), 300);

  -- Lock the source balance first (the posting locks it again; same order every time).
  begin
    select * into v_rec from public.stock_records
     where id = nullif(p->>'stock_id', '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'stock_id must be a stock line id.' using errcode = '22023';
  end;
  if v_rec.id is null or v_rec.item_id is null or v_rec.location_id is null then
    raise exception 'Choose a stock line that has an item and a location.' using errcode = '22023';
  end if;
  select * into v_from from public.inventory_locations where id = v_rec.location_id and organisation_id = v_org;

  begin
    select * into v_to from public.inventory_locations
     where id = nullif(p->>'to_location_id', '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'to_location_id must be a location id.' using errcode = '22023';
  end;
  if v_to.id is null then
    raise exception 'Choose a location of your company.' using errcode = '22023';
  end if;
  if v_to.id = v_rec.location_id then
    raise exception 'The stock is already at that location.' using errcode = '22023';
  end if;
  if not v_to.active then
    raise exception 'That location is inactive.' using errcode = '22023';
  end if;
  if lower(btrim(coalesce(v_to.country, ''))) is distinct from lower(btrim(coalesce(v_rec.country, '')))
     or upper(btrim(coalesce(v_to.site, ''))) is distinct from upper(btrim(coalesce(v_rec.site, ''))) then
    raise exception 'Put-away stays inside one site. Use a transfer to move stock to another site.' using errcode = '22023';
  end if;
  if v_to.location_type not in ('warehouse', 'zone', 'rack', 'shelf', 'bin', 'receiving', 'workshop_store') then
    raise exception 'Put stock away into a storage location, not a % location.', replace(v_to.location_type, '_', ' ')
      using errcode = '22023';
  end if;
  if v_to.restriction is not null then
    raise exception 'That location is restricted (%). Use a location with no restriction.', replace(v_to.restriction, '_', ' ')
      using errcode = '22023';
  end if;
  if v_to.capacity_qty is not null then
    select upper(btrim(uom)) into v_uom from public.material_master where id = v_rec.item_id;
    if v_uom is distinct from upper(btrim(v_to.capacity_uom)) then
      raise exception 'That location''s capacity is measured in %, this item in %; the fit cannot be checked.',
        v_to.capacity_uom, coalesce(v_uom, 'no unit') using errcode = '22023';
    end if;
    select coalesce(sum(qty_on_hand), 0) into v_held from public.stock_records
     where organisation_id = v_org and location_id = v_to.id;
    if v_held + v_qty > v_to.capacity_qty then
      raise exception 'That location holds % of % %; % more does not fit.', v_held, v_to.capacity_qty, v_to.capacity_uom, v_qty
        using errcode = '23514';
    end if;
  end if;

  v_out := public._inv_post(jsonb_build_object(
    'idempotency_key', 'put:' || v_key || ':out', 'stock_id', v_rec.id,
    'movement_type', 'transfer_out', 'qty_change', -v_qty,
    'reason', coalesce(v_note, 'Put-away to ' || v_to.code),
    'reference_no', 'PUT-' || upper(left(md5(v_org::text || v_key), 8)),
    'source_doc_type', 'putaway', 'source_doc_id', v_key,
    'source_receipt_movement_id', p->>'source_receipt_movement_id'), false, false);

  if v_out->>'status' = 'refused_shortage' then
    v_res := jsonb_build_object('status', 'refused_shortage', 'stock_id', v_rec.id,
      'qty_available', v_out->'qty_available', 'qty_requested', v_out->'qty_requested',
      'exception_id', v_out->'exception_id');
    return public._inv_req_end('inv_putaway', p, v_res);
  end if;

  v_in := public._inv_post(jsonb_build_object(
    'idempotency_key', 'put:' || v_key || ':in', 'item_id', v_rec.item_id,
    'location_id', v_to.id, 'condition', v_rec.condition, 'ownership', v_rec.ownership,
    'owner_supplier_id', v_rec.owner_supplier_id,
    'movement_type', 'transfer_in', 'qty_change', v_qty,
    'currency', v_out->>'currency', 'unit_cost', v_out->'unit_cost',
    'carried_value', -coalesce((v_out->>'value_change')::numeric, 0),
    'carried_unvalued_qty', -coalesce((v_out->>'unvalued_qty_change')::numeric, 0),
    'carried_pending_qty', coalesce((v_out->>'pending_out_change')::numeric, 0),
    'carried_movement_id', v_out->>'movement_id', 'carried_from_stock_id', v_rec.id,
    'reason', coalesce(v_note, 'Put-away from ' || coalesce(v_from.code, '?')),
    'reference_no', 'PUT-' || upper(left(md5(v_org::text || v_key), 8)),
    'source_doc_type', 'putaway', 'source_doc_id', v_key), false, false);

  if v_in->>'status' is distinct from 'posted' then
    -- cannot happen for an inbound leg; never leave the out leg alone
    raise exception 'The put-away could not be placed into %.', v_to.code using errcode = 'P0001';
  end if;

  v_res := jsonb_build_object('status', 'posted',
    'reference_no', 'PUT-' || upper(left(md5(v_org::text || v_key), 8)),
    'from_stock_id', v_rec.id, 'to_stock_id', v_in->>'stock_id',
    'from_location_id', v_rec.location_id, 'to_location_id', v_to.id,
    'qty', v_qty, 'currency', v_out->>'currency',
    'out_movement_id', v_out->>'movement_id', 'in_movement_id', v_in->>'movement_id',
    'value_moved', -coalesce((v_out->>'value_change')::numeric, 0),
    'unvalued_qty_moved', -coalesce((v_out->>'unvalued_qty_change')::numeric, 0),
    'pending_qty_moved', coalesce((v_out->>'pending_out_change')::numeric, 0));
  return public._inv_req_end('inv_putaway', p, v_res);
end
$$;

comment on function public.inv_putaway(jsonb) is
  'Same-site put-away as one ledger move (transfer_out + transfer_in), storage targets only. 20261128120000.';

revoke all on function public.inv_putaway(jsonb) from public;
revoke all on function public.inv_putaway(jsonb) from anon;
grant execute on function public.inv_putaway(jsonb) to authenticated, service_role;

commit;

-- Rollback: drop function public.inv_putaway(jsonb);

-- ── Rolled-back proof, 2026-11-28 (live DB, one DO block ending in RAISE; afterwards
--    inv_putaway absent, 0 test locations, 0 test request rows, movements unchanged at 5,876)
-- 1 valued line, demo Store Keeper scoped to DEMO YARD only: posted, 2 movements
--   (transfer_out, transfer_in), source 10 -> 8, bin 2 at value 90.00; legs sum value 0.00,
--   unvalued 0, qty 0; item value 900.00 -> 900.00, unvalued 0 -> 0.
-- 2 same key, same payload: replayed = true, 0 new movements.
-- 3 same key, other qty: PT409 "This put-away key was already used for a different move."
-- 4 unvalued line, Store Keeper (KSA, NHC): posted, 3 unvalued moved, legs value null,
--   unvalued sum 0; item unvalued 14 -> 14; the open cost reconciliation moved to the bin (1).
-- 5 bin at another site: 22023.   6 scrap-type location: 22023.   7 restricted bin: 22023.
-- 8 inactive bin: 22023.   9 capacity in EA vs an item with no unit: 22023 (fit not guessed).
--   NOT proven live: the over-capacity arithmetic branch (no item with a unit had a bin to test).
-- 10 qty 9999 > free 11: refused_shortage.
-- 11 the Store Keeper is the counter of an open blind audit at the site: 42501.
-- 12 Driver: 42501.
