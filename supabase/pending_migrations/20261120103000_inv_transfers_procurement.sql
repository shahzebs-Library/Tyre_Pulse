-- =============================================================================
-- 20261120103000_inv_transfers_procurement.sql
-- STATUS: AUTHORED, NOT APPLIED. Inventory WP4 (P2). Requires 20261120100000..102000.
--         Rollback: 20261120103000_inv_transfers_procurement_ROLLBACK.sql
--
-- WHAT
--   * stock_transfers + stock_transfer_lines: dispatch moves goods (and their
--     carried cost, unvalued units stay unvalued) into an in_transit location of
--     the destination site; receive may be partial; the remainder can be returned
--     to the source. Same company and same country only (no FX).
--   * stock_reservations + inv_reserve / inv_release / inv_issue: reservations
--     hold qty_reserved on the balance (never on hand); an issue may consume a
--     reservation. An issue NEVER writes parts_consumption (the ERP cost ledger).
--   * purchase_order_lines, goods_receipt_lines, inv_receive_goods: GRN posts
--     receipt / consignment_receipt movements for accepted quantity only; over
--     receipt against a PO line is refused.
--   * supplier_invoices (+ lines) with a three-way match status (PO price, GRN
--     accepted quantity, invoice). NO accounting posting, NO liability record
--     (owner correction 6) - financial postings stay in the ERP.
--   * supplier_agreements (consignment|vmi|framework) and
--     consignment_consumptions: an informational record of consignment stock
--     consumed, for supplier invoice matching only.
-- =============================================================================
begin;

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
create table if not exists public.stock_transfers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  ref text not null,
  country text not null,
  site text, to_site text,
  from_location_id uuid not null references public.inventory_locations(id),
  to_location_id uuid not null references public.inventory_locations(id),
  transit_location_id uuid not null references public.inventory_locations(id),
  status text not null default 'in_transit' check (status in ('dispatched','in_transit','partially_received','completed','cancelled')),
  idempotency_key text not null,
  notes text,
  dispatched_by uuid not null default auth.uid(), dispatched_at timestamptz not null default now(),
  completed_at timestamptz, cancelled_at timestamptz, cancel_reason text,
  unique (organisation_id, idempotency_key),
  unique (organisation_id, ref)
);
select public._inv_secure_table('stock_transfers', true, true);

create table if not exists public.stock_transfer_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  transfer_id uuid not null references public.stock_transfers(id),
  line_no integer not null,
  item_id uuid not null references public.material_master(id),
  from_stock_id uuid not null references public.stock_records(id),
  transit_stock_id uuid references public.stock_records(id),
  condition text not null, ownership text not null, owner_supplier_id uuid,
  qty_dispatched numeric not null check (qty_dispatched > 0),
  qty_received numeric not null default 0 check (qty_received >= 0),
  qty_returned numeric not null default 0 check (qty_returned >= 0),
  carried_value numeric, carried_unvalued_qty numeric not null default 0, currency text,
  check (qty_received + qty_returned <= qty_dispatched),
  unique (transfer_id, line_no)
);
select public._inv_secure_table('stock_transfer_lines', false, false);

create or replace function public._inv_transit_location(p_org uuid, p_country text, p_site text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare v uuid;
begin
  select id into v from public.inventory_locations
   where organisation_id = p_org and site = upper(btrim(p_site)) and code = 'IN-TRANSIT';
  if v is null then
    insert into public.inventory_locations(organisation_id, country, site, location_type, code, name)
    values (p_org, p_country, upper(btrim(p_site)), 'in_transit', 'IN-TRANSIT', 'In transit to ' || upper(btrim(p_site)))
    on conflict do nothing;
    select id into v from public.inventory_locations
     where organisation_id = p_org and site = upper(btrim(p_site)) and code = 'IN-TRANSIT';
  end if;
  return v;
end $fn$;

-- Argument shapes agreed with the Flutter lane (tyre_pulse_flutter/docs/inventory_reserved_patch.md):
-- p_payload {idempotency_key, from_location_id, to_location_id, remarks,
--            lines:[{stock_id | scanned_code 'TP:STK:<stock id>', qty}]}
create or replace function public.inv_transfer_dispatch(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p jsonb := p_payload; v_sid uuid; v_code text;
  v_org uuid := public.app_current_org(); v_key text := nullif(btrim(p->>'idempotency_key'), '');
  v_t public.stock_transfers%rowtype; v_from public.inventory_locations%rowtype; v_to public.inventory_locations%rowtype;
  v_transit uuid; l jsonb; v_rec public.stock_records%rowtype; v_out jsonb; v_in jsonb; v_n int := 0;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':trf:' || v_key, 0));
  select * into v_t from public.stock_transfers where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('transfer_id', v_t.id, 'status', v_t.status, 'replayed', true); end if;
  select * into v_from from public.inventory_locations where id = (p->>'from_location_id')::uuid and organisation_id = v_org;
  select * into v_to from public.inventory_locations where id = (p->>'to_location_id')::uuid and organisation_id = v_org;
  if v_from.id is null or v_to.id is null or v_from.id = v_to.id then
    raise exception 'Choose two different locations in your company.' using errcode = '22023';
  end if;
  if lower(v_from.country) <> lower(v_to.country) then
    raise exception 'Transfers between countries are refused (no currency conversion in inventory).' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_from.country, v_from.site) then
    raise exception 'The source location is outside your scope.' using errcode = '42501';
  end if;
  if jsonb_typeof(p->'lines') <> 'array' or jsonb_array_length(p->'lines') = 0 then
    raise exception 'A transfer needs lines.' using errcode = '22023';
  end if;
  v_transit := public._inv_transit_location(v_org, v_to.country, v_to.site);
  insert into public.stock_transfers(organisation_id, ref, country, site, to_site, from_location_id, to_location_id,
    transit_location_id, idempotency_key, notes)
  values (v_org, 'TRF-' || to_char(now(), 'YYYYMMDD') || '-' || upper(left(md5(v_org::text || v_key), 8)), v_from.country,
    v_from.site, v_to.site, v_from.id, v_to.id, v_transit, v_key, coalesce(p->>'remarks', p->>'notes'))
  returning * into v_t;
  for l in select value from jsonb_array_elements(p->'lines') order by coalesce(value->>'stock_id', value->>'scanned_code') loop
    v_n := v_n + 1;
    v_code := upper(btrim(coalesce(l->>'scanned_code', '')));
    begin
      v_sid := coalesce(nullif(l->>'stock_id', '')::uuid, case when v_code like 'TP:STK:%' then substr(v_code, 8)::uuid end);
    exception when others then
      raise exception 'Line %: unreadable stock label.', v_n using errcode = '22023';
    end;
    select * into v_rec from public.stock_records where id = v_sid;
    if v_rec.id is null or v_rec.organisation_id <> v_org or v_rec.location_id is distinct from v_from.id or v_rec.item_id is null then
      raise exception 'Line %: the balance must be a mapped item at the source location.', v_n using errcode = '22023';
    end if;
    v_out := public._inv_post(jsonb_build_object('idempotency_key', 'trf:' || v_key || ':' || v_n || ':out', 'stock_id', v_rec.id,
      'movement_type', 'transfer_out', 'qty_change', -(l->>'qty')::numeric, 'reason', 'Dispatch ' || v_t.ref,
      'source_doc_type', 'stock_transfer', 'source_doc_id', v_t.id::text), false);
    if v_out->>'status' = 'refused_shortage' then
      raise exception 'Line %: insufficient available stock to dispatch.', v_n using errcode = '23514';
    end if;
    v_in := public._inv_post(jsonb_build_object('idempotency_key', 'trf:' || v_key || ':' || v_n || ':transit', 'item_id', v_rec.item_id,
      'location_id', v_transit, 'condition', v_rec.condition, 'ownership', v_rec.ownership, 'owner_supplier_id', v_rec.owner_supplier_id,
      'movement_type', 'transfer_in', 'qty_change', (l->>'qty')::numeric, 'currency', v_out->>'currency', 'unit_cost', v_out->'unit_cost',
      'carried_value', -coalesce((v_out->>'value_change')::numeric, 0),
      'carried_unvalued_qty', -coalesce((v_out->>'unvalued_qty_change')::numeric, 0),
      'carried_from_stock_id', v_rec.id,
      'reason', 'In transit ' || v_t.ref, 'source_doc_type', 'stock_transfer', 'source_doc_id', v_t.id::text), false);
    insert into public.stock_transfer_lines(organisation_id, transfer_id, line_no, item_id, from_stock_id, transit_stock_id,
      condition, ownership, owner_supplier_id, qty_dispatched, carried_value, carried_unvalued_qty, currency)
    values (v_org, v_t.id, v_n, v_rec.item_id, v_rec.id, (v_in->>'stock_id')::uuid, v_rec.condition, v_rec.ownership,
      v_rec.owner_supplier_id, (l->>'qty')::numeric, -(v_out->>'value_change')::numeric,
      -coalesce((v_out->>'unvalued_qty_change')::numeric, 0), v_out->>'currency');
  end loop;
  return jsonb_build_object('transfer_id', v_t.id, 'ref', v_t.ref, 'status', v_t.status, 'lines', v_n);
end $fn$;

-- p_mode 'receive' (into the destination) or 'return' (back to the source).
-- Lines: {line_id, received_qty | qty, condition, remarks}. Condition 'good'
-- keeps the dispatched condition; damaged / repairable / quarantine / scrap land
-- as that condition at the destination.
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

create or replace function public.inv_transfer_receive(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p jsonb := p_payload;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('transfer') or public.inv_can('receive')) then
    raise exception 'Stock permission "transfer" or "receive" is required.' using errcode = '42501';
  end if;
  return public._inv_transfer_move(p, 'receive');
end $fn$;

create or replace function public.inv_transfer_return_remaining(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare p jsonb := p_payload;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  if nullif(btrim(p->>'reason'), '') is null then raise exception 'Give a reason.' using errcode = '22023'; end if;
  return public._inv_transfer_move(p, 'return');
end $fn$;

-- ---------------------------------------------------------------------------
-- Reservations and issue
-- ---------------------------------------------------------------------------
create table if not exists public.stock_reservations (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text, site text,
  stock_id uuid not null references public.stock_records(id),
  qty numeric not null check (qty > 0),
  qty_released numeric not null default 0, qty_consumed numeric not null default 0,
  source_doc_type text, source_doc_id text,
  status text not null default 'active' check (status in ('active','released','consumed')),
  idempotency_key text not null,
  created_by uuid not null default auth.uid(), created_at timestamptz not null default now(),
  check (qty_released + qty_consumed <= qty),
  unique (organisation_id, idempotency_key)
);
select public._inv_secure_table('stock_reservations', true, true);

create table if not exists public.consignment_consumptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  country text, site text,
  supplier_id uuid not null references public.suppliers(id),
  item_id uuid references public.material_master(id),
  stock_id uuid not null references public.stock_records(id),
  movement_id uuid not null references public.stock_movements(id),
  qty numeric not null check (qty > 0),
  agreed_unit_price numeric, agreed_value numeric, currency text,
  agreement_id uuid,
  invoice_id uuid,
  note text not null default 'For supplier invoice matching only - not an accounting posting.',
  created_at timestamptz not null default now()
);
select public._inv_secure_table('consignment_consumptions', true, true);

create or replace function public.inv_reserve(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_org uuid := public.app_current_org();
  v_r public.stock_reservations%rowtype; v_rec public.stock_records%rowtype; v_post jsonb;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':res:' || v_key, 0));
  select * into v_r from public.stock_reservations where organisation_id = v_org and idempotency_key = v_key;
  if found then return to_jsonb(v_r) || jsonb_build_object('replayed', true); end if;
  select * into v_rec from public.stock_records where id = (p->>'stock_id')::uuid;
  if v_rec.id is null or v_rec.organisation_id <> v_org then raise exception 'Stock not found.' using errcode = 'P0002'; end if;
  v_post := public._inv_post(jsonb_build_object('idempotency_key', 'res:' || v_key, 'stock_id', v_rec.id, 'movement_type', 'reserve',
    'qty_change', 0, 'reserved_change', (p->>'qty')::numeric, 'source_doc_type', p->>'source_doc_type',
    'source_doc_id', p->>'source_doc_id'), false);
  if v_post->>'status' = 'refused_shortage' then
    return jsonb_build_object('status', 'refused_shortage', 'exception_id', v_post->'exception_id');
  end if;
  insert into public.stock_reservations(organisation_id, country, site, stock_id, qty, source_doc_type, source_doc_id, idempotency_key)
  values (v_org, v_rec.country, v_rec.site, v_rec.id, (p->>'qty')::numeric, p->>'source_doc_type', p->>'source_doc_id', v_key)
  returning * into v_r;
  return to_jsonb(v_r);
end $fn$;

create or replace function public.inv_release(p_reservation uuid, p_qty numeric, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_r public.stock_reservations%rowtype; v_left numeric; v_post jsonb;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  select * into v_r from public.stock_reservations where id = p_reservation and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Reservation not found.' using errcode = 'P0002'; end if;
  v_left := v_r.qty - v_r.qty_released - v_r.qty_consumed;
  if coalesce(p_qty, v_left) <= 0 or coalesce(p_qty, v_left) > v_left then
    raise exception 'Release quantity must be between 0 and %.', v_left using errcode = '22023';
  end if;
  v_post := public._inv_post(jsonb_build_object('idempotency_key', 'rel:' || p_idempotency_key, 'stock_id', v_r.stock_id,
    'movement_type', 'release', 'qty_change', 0, 'reserved_change', -coalesce(p_qty, v_left),
    'source_doc_type', 'stock_reservation', 'source_doc_id', v_r.id::text), false);
  if coalesce(v_post->>'replayed', 'false') <> 'true' then
    update public.stock_reservations set qty_released = qty_released + coalesce(p_qty, v_left),
      status = case when qty_released + coalesce(p_qty, v_left) + qty_consumed >= qty then 'released' else status end
    where id = v_r.id returning * into v_r;
  end if;
  return to_jsonb(v_r);
end $fn$;

create or replace function public.inv_issue(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_org uuid := public.app_current_org();
  v_r public.stock_reservations%rowtype; v_rec public.stock_records%rowtype; v_qty numeric := (p->>'qty')::numeric;
  v_consume numeric := 0; v_post jsonb; v_ag record;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null or v_qty is null or v_qty <= 0 then
    raise exception 'An idempotency_key and a positive qty are required.' using errcode = '22023';
  end if;
  if nullif(p->>'reservation_id', '') is not null then
    select * into v_r from public.stock_reservations where id = (p->>'reservation_id')::uuid and organisation_id = v_org for update;
    if not found or v_r.stock_id <> (p->>'stock_id')::uuid then raise exception 'Reservation does not match this stock.' using errcode = '22023'; end if;
    v_consume := least(v_qty, v_r.qty - v_r.qty_released - v_r.qty_consumed);
  end if;
  v_post := public._inv_post(jsonb_build_object('idempotency_key', 'iss:' || v_key, 'stock_id', p->>'stock_id',
    'movement_type', 'issue', 'qty_change', -v_qty, 'reserved_change', -v_consume, 'reason', p->>'reason',
    'reference_no', p->>'reference_no', 'source_doc_type', coalesce(p->>'source_doc_type', 'issue'),
    'source_doc_id', p->>'source_doc_id'), false);
  if v_post->>'status' = 'refused_shortage' or coalesce(v_post->>'replayed', 'false') = 'true' then
    return v_post;
  end if;
  if v_consume > 0 then
    update public.stock_reservations set qty_consumed = qty_consumed + v_consume,
      status = case when qty_released + qty_consumed + v_consume >= qty then 'consumed' else status end where id = v_r.id;
  end if;
  select * into v_rec from public.stock_records where id = (p->>'stock_id')::uuid;
  if v_rec.ownership = 'consignment' then
    select a.id, (a.agreed_prices ->> v_rec.item_id::text)::numeric as price, a.currency into v_ag
      from public.supplier_agreements a
     where a.organisation_id = v_org and a.supplier_id = v_rec.owner_supplier_id and a.agreement_type = 'consignment'
       and a.status = 'active' and (a.expires_on is null or a.expires_on >= current_date)
     order by a.starts_on desc nulls last limit 1;
    insert into public.consignment_consumptions(organisation_id, country, site, supplier_id, item_id, stock_id, movement_id, qty,
      agreed_unit_price, agreed_value, currency, agreement_id)
    values (v_org, v_rec.country, v_rec.site, v_rec.owner_supplier_id, v_rec.item_id, v_rec.id, (v_post->>'movement_id')::uuid,
      v_qty, v_ag.price, round(v_qty * v_ag.price, 2), coalesce(v_ag.currency, v_rec.currency), v_ag.id);
  end if;
  return v_post;
end $fn$;

-- ---------------------------------------------------------------------------
-- Procurement documents
-- ---------------------------------------------------------------------------
alter table public.purchase_orders
  add column if not exists supplier_id uuid references public.suppliers(id),
  add column if not exists currency text;
alter table public.goods_receipts
  add column if not exists supplier_id uuid references public.suppliers(id),
  add column if not exists po_id uuid references public.purchase_orders(id),
  add column if not exists idempotency_key text,
  add column if not exists received_by_id uuid;
create unique index if not exists goods_receipts_org_idempotency_uq on public.goods_receipts (organisation_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.supplier_agreements (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  supplier_id uuid not null references public.suppliers(id),
  agreement_type text not null check (agreement_type in ('consignment','vmi','framework')),
  agreement_no text not null,
  min_qty numeric, max_qty numeric, lead_time_days integer, credit_terms_days integer,
  agreed_prices jsonb not null default '{}'::jsonb,
  currency text,
  starts_on date, expires_on date, return_terms text,
  status text not null default 'active' check (status in ('draft','active','expired','terminated')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (organisation_id, agreement_no),
  check (expires_on is null or starts_on is null or expires_on >= starts_on)
);
select public._inv_secure_table('supplier_agreements', true, false);
alter table public.consignment_consumptions add constraint consignment_consumptions_agreement_fk
  foreign key (agreement_id) references public.supplier_agreements(id);

create table if not exists public.purchase_order_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  po_id uuid not null references public.purchase_orders(id),
  line_no integer not null,
  item_id uuid references public.material_master(id),
  description text,
  location_id uuid references public.inventory_locations(id),
  qty_ordered numeric not null check (qty_ordered > 0),
  unit_price numeric check (unit_price is null or unit_price >= 0),
  currency text,
  qty_received numeric not null default 0, qty_accepted numeric not null default 0, qty_rejected numeric not null default 0,
  status text not null default 'open' check (status in ('open','partial','received','closed','cancelled')),
  check (qty_accepted + qty_rejected = qty_received),
  unique (po_id, line_no)
);
select public._inv_secure_table('purchase_order_lines', false, false);

create table if not exists public.goods_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  grn_id uuid not null references public.goods_receipts(id),
  line_no integer not null,
  po_line_id uuid references public.purchase_order_lines(id),
  item_id uuid not null references public.material_master(id),
  location_id uuid not null references public.inventory_locations(id),
  qty_received numeric not null check (qty_received > 0),
  qty_accepted numeric not null check (qty_accepted >= 0),
  qty_rejected numeric not null default 0 check (qty_rejected >= 0),
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  currency text, condition text not null default 'new', ownership text not null default 'owned', owner_supplier_id uuid,
  rejection_reason text,
  movement_id uuid references public.stock_movements(id),
  check (qty_accepted + qty_rejected = qty_received),
  unique (grn_id, line_no)
);
select public._inv_secure_table('goods_receipt_lines', false, false);

create or replace function public.inv_po_add_line(p_po uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_po public.purchase_orders%rowtype; v_id uuid;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('procure') then
    raise exception 'Stock permission "procure" is required.' using errcode = '42501';
  end if;
  select * into v_po from public.purchase_orders where id = p_po and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Purchase order not found.' using errcode = 'P0002'; end if;
  if v_po.status not in ('Draft','Submitted') then raise exception 'Lines can be added to a draft or submitted PO only.' using errcode = '22023'; end if;
  if nullif(p->>'item_id', '') is not null and not exists (select 1 from public.material_master where id = (p->>'item_id')::uuid
       and organisation_id = v_po.organisation_id) then
    raise exception 'Item not found in your company.' using errcode = '42501';
  end if;
  insert into public.purchase_order_lines(organisation_id, po_id, line_no, item_id, description, location_id, qty_ordered, unit_price, currency)
  values (v_po.organisation_id, v_po.id, coalesce((select max(line_no) from public.purchase_order_lines where po_id = v_po.id), 0) + 1,
    nullif(p->>'item_id', '')::uuid, p->>'description', nullif(p->>'location_id', '')::uuid, (p->>'qty_ordered')::numeric,
    nullif(p->>'unit_price', '')::numeric, coalesce(nullif(p->>'currency', ''), v_po.currency, public.currency_for_country(v_po.country)))
  returning id into v_id;
  return v_id;
end $fn$;

create or replace function public.inv_receive_goods(p jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_key text := nullif(btrim(p->>'idempotency_key'), '');
  v_grn public.goods_receipts%rowtype; l jsonb; v_pl public.purchase_order_lines%rowtype; v_n int := 0;
  v_post jsonb; v_line_id uuid; v_own text; v_loc public.inventory_locations%rowtype; v_rejected numeric;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('receive') then
    raise exception 'Stock permission "receive" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':grn:' || v_key, 0));
  select * into v_grn from public.goods_receipts where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('grn_id', v_grn.id, 'status', v_grn.status, 'replayed', true); end if;
  if not public._inv_scope_ok(p->>'country', p->>'site') then
    raise exception 'Choose a permitted country and site.' using errcode = '42501';
  end if;
  insert into public.goods_receipts(organisation_id, country, site, grn_no, po_ref, po_id, supplier, supplier_id, status,
    created_by, received_by_id, idempotency_key, received_date)
  values (v_org, p->>'country', upper(btrim(p->>'site')), coalesce(p->>'grn_no', 'GRN-' || upper(left(md5(v_org::text || v_key), 8))),
    p->>'po_ref', nullif(p->>'po_id', '')::uuid, p->>'supplier', nullif(p->>'supplier_id', '')::uuid, 'received',
    auth.uid(), auth.uid(), v_key, current_date)
  returning * into v_grn;
  for l in select value from jsonb_array_elements(p->'lines') loop
    v_n := v_n + 1;
    v_rejected := coalesce(nullif(l->>'qty_rejected', '')::numeric, 0);
    select * into v_loc from public.inventory_locations where id = (l->>'location_id')::uuid and organisation_id = v_org;
    if v_loc.id is null or v_loc.site <> v_grn.site then
      raise exception 'Line %: receiving location must be at the GRN site.', v_n using errcode = '22023';
    end if;
    if nullif(l->>'po_line_id', '') is not null then
      select * into v_pl from public.purchase_order_lines where id = (l->>'po_line_id')::uuid and organisation_id = v_org for update;
      if not found or v_pl.po_id is distinct from v_grn.po_id then raise exception 'Line %: PO line not on this PO.', v_n using errcode = '22023'; end if;
      if v_pl.item_id is distinct from (l->>'item_id')::uuid then raise exception 'Line %: item differs from the PO line.', v_n using errcode = '22023'; end if;
      if v_pl.qty_accepted + (l->>'qty_received')::numeric - v_rejected > v_pl.qty_ordered then
        raise exception 'Line %: receipt exceeds the ordered quantity.', v_n using errcode = '22023';
      end if;
    end if;
    v_own := lower(coalesce(nullif(l->>'ownership', ''), 'owned'));
    if v_own = 'consignment' and not exists (select 1 from public.supplier_agreements a where a.organisation_id = v_org
         and a.supplier_id = nullif(l->>'owner_supplier_id', '')::uuid and a.agreement_type = 'consignment' and a.status = 'active') then
      raise exception 'Line %: consignment stock needs an active consignment agreement with the owning supplier.', v_n using errcode = '22023';
    end if;
    insert into public.goods_receipt_lines(organisation_id, grn_id, line_no, po_line_id, item_id, location_id, qty_received,
      qty_accepted, qty_rejected, unit_cost, currency, condition, ownership, owner_supplier_id, rejection_reason)
    values (v_org, v_grn.id, v_n, nullif(l->>'po_line_id', '')::uuid, (l->>'item_id')::uuid, v_loc.id,
      (l->>'qty_received')::numeric, (l->>'qty_received')::numeric - v_rejected, v_rejected,
      coalesce(nullif(l->>'unit_cost', '')::numeric, v_pl.unit_price), coalesce(nullif(l->>'currency', ''), v_pl.currency),
      lower(coalesce(nullif(l->>'condition', ''), 'new')), v_own, nullif(l->>'owner_supplier_id', '')::uuid, l->>'rejection_reason')
    returning id into v_line_id;
    if (l->>'qty_received')::numeric - v_rejected > 0 then
      v_post := public._inv_post(jsonb_strip_nulls(jsonb_build_object('idempotency_key', 'grn:' || v_key || ':' || v_n,
        'item_id', l->>'item_id', 'location_id', v_loc.id, 'condition', lower(coalesce(nullif(l->>'condition', ''), 'new')),
        'ownership', v_own, 'owner_supplier_id', nullif(l->>'owner_supplier_id', ''),
        'movement_type', case when v_own = 'consignment' then 'consignment_receipt' else 'receipt' end,
        'qty_change', (l->>'qty_received')::numeric - v_rejected,
        'unit_cost', coalesce(nullif(l->>'unit_cost', '')::numeric, v_pl.unit_price),
        'currency', coalesce(nullif(l->>'currency', ''), v_pl.currency),
        'reference_no', v_grn.grn_no, 'source_doc_type', 'goods_receipt', 'source_doc_id', v_grn.id::text)), false);
      update public.goods_receipt_lines set movement_id = (v_post->>'movement_id')::uuid where id = v_line_id;
    end if;
    if v_pl.id is not null then
      update public.purchase_order_lines set qty_received = qty_received + (l->>'qty_received')::numeric,
        qty_accepted = qty_accepted + (l->>'qty_received')::numeric - v_rejected, qty_rejected = qty_rejected + v_rejected,
        status = case when qty_accepted + (l->>'qty_received')::numeric - v_rejected >= qty_ordered then 'received' else 'partial' end
      where id = v_pl.id;
    end if;
    v_pl := null;
  end loop;
  if v_grn.po_id is not null then
    update public.purchase_orders po set status = case
      when not exists (select 1 from public.purchase_order_lines x where x.po_id = po.id and x.status not in ('received','closed','cancelled'))
        then 'Delivered' else 'Partial Delivery' end, updated_at = now()
     where id = v_grn.po_id;
  end if;
  return jsonb_build_object('grn_id', v_grn.id, 'grn_no', v_grn.grn_no, 'lines', v_n);
end $fn$;

-- ---------------------------------------------------------------------------
-- Supplier invoices: three-way match status only. No accounting posting.
-- ---------------------------------------------------------------------------
create table if not exists public.supplier_invoices (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org() references public.organisations(id),
  country text not null,
  supplier_id uuid not null references public.suppliers(id),
  invoice_no text not null,
  invoice_date date, currency text not null,
  po_id uuid references public.purchase_orders(id),
  total_amount numeric,
  match_status text not null default 'pending' check (match_status in ('pending','matched','qty_mismatch','price_mismatch',
    'qty_and_price_mismatch','unmatched')),
  match_details jsonb not null default '[]'::jsonb,
  price_tolerance_pct numeric not null default 0 check (price_tolerance_pct >= 0),
  status text not null default 'received' check (status in ('received','matched','disputed','accepted','rejected')),
  created_by uuid default auth.uid(), created_at timestamptz not null default now(),
  unique (organisation_id, supplier_id, invoice_no)
);
comment on table public.supplier_invoices is 'Inventory-side three-way match only. Never an accounting posting or liability; financial postings stay in the ERP.';
select public._inv_secure_table('supplier_invoices', true, false);

create table if not exists public.supplier_invoice_lines (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  invoice_id uuid not null references public.supplier_invoices(id),
  line_no integer not null,
  po_line_id uuid references public.purchase_order_lines(id),
  item_id uuid references public.material_master(id),
  qty numeric not null check (qty > 0),
  unit_price numeric not null check (unit_price >= 0),
  amount numeric generated always as (round(qty * unit_price, 2)) stored,
  match_status text,
  unique (invoice_id, line_no)
);
select public._inv_secure_table('supplier_invoice_lines', false, false);

create or replace function public.inv_supplier_invoice_create(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid; l jsonb; v_n int := 0; v_org uuid := public.app_current_org();
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('procure') or public.inv_can('financial_post')) then
    raise exception 'Stock permission "procure" or "financial_post" is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers where id = (p->>'supplier_id')::uuid and organisation_id = v_org) then
    raise exception 'Supplier not found in your company.' using errcode = '42501';
  end if;
  insert into public.supplier_invoices(organisation_id, country, supplier_id, invoice_no, invoice_date, currency, po_id,
    total_amount, price_tolerance_pct)
  values (v_org, p->>'country', (p->>'supplier_id')::uuid, btrim(p->>'invoice_no'), nullif(p->>'invoice_date', '')::date,
    upper(p->>'currency'), nullif(p->>'po_id', '')::uuid, nullif(p->>'total_amount', '')::numeric,
    coalesce(nullif(p->>'price_tolerance_pct', '')::numeric, 0))
  returning id into v_id;
  for l in select value from jsonb_array_elements(coalesce(p->'lines', '[]'::jsonb)) loop
    v_n := v_n + 1;
    insert into public.supplier_invoice_lines(organisation_id, invoice_id, line_no, po_line_id, item_id, qty, unit_price)
    values (v_org, v_id, v_n, nullif(l->>'po_line_id', '')::uuid, nullif(l->>'item_id', '')::uuid,
      (l->>'qty')::numeric, (l->>'unit_price')::numeric);
  end loop;
  return v_id;
end $fn$;

create or replace function public.inv_supplier_invoice_match(p_invoice uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v public.supplier_invoices%rowtype; l record; v_details jsonb := '[]'; v_q boolean := false; v_p boolean := false;
  v_u boolean := false; v_ls text;
begin
  if not public.is_approved_and_unlocked() or not (public.inv_can('procure') or public.inv_can('financial_post')) then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  select * into v from public.supplier_invoices where id = p_invoice and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Invoice not found.' using errcode = 'P0002'; end if;
  for l in
    select il.id, il.line_no, il.qty, il.unit_price, pl.id as pl_id, pl.unit_price as po_price, pl.currency as po_cur,
           coalesce((select sum(g.qty_accepted) from public.goods_receipt_lines g where g.po_line_id = pl.id), 0) as grn_qty,
           coalesce((select sum(x.qty) from public.supplier_invoice_lines x join public.supplier_invoices xi on xi.id = x.invoice_id
                      where x.po_line_id = pl.id and xi.id <> v.id and xi.status <> 'rejected'), 0) as invoiced_before
      from public.supplier_invoice_lines il left join public.purchase_order_lines pl on pl.id = il.po_line_id
     where il.invoice_id = v.id order by il.line_no
  loop
    if l.pl_id is null then
      v_ls := 'unmatched'; v_u := true;
    else
      v_ls := 'matched';
      if l.po_cur is not null and upper(l.po_cur) <> v.currency then v_ls := 'price_mismatch'; v_p := true;
      elsif l.po_price is null or abs(l.unit_price - l.po_price) > l.po_price * v.price_tolerance_pct / 100 then
        v_ls := 'price_mismatch'; v_p := true;
      end if;
      if l.qty + l.invoiced_before > l.grn_qty then
        v_ls := case when v_ls = 'price_mismatch' then 'qty_and_price_mismatch' else 'qty_mismatch' end; v_q := true;
      end if;
    end if;
    update public.supplier_invoice_lines set match_status = v_ls where id = l.id;
    v_details := v_details || jsonb_build_array(jsonb_build_object('line_no', l.line_no, 'status', v_ls,
      'invoice_qty', l.qty, 'received_accepted_qty', l.grn_qty, 'previously_invoiced_qty', l.invoiced_before,
      'invoice_price', l.unit_price, 'po_price', l.po_price));
  end loop;
  update public.supplier_invoices set match_details = v_details, match_status = case
      when jsonb_array_length(v_details) = 0 or v_u then 'unmatched'
      when v_q and v_p then 'qty_and_price_mismatch' when v_q then 'qty_mismatch' when v_p then 'price_mismatch'
      else 'matched' end,
    status = case when not (v_q or v_p or v_u) and jsonb_array_length(v_details) > 0 then 'matched' else 'disputed' end
  where id = v.id returning * into v;
  return jsonb_build_object('invoice_id', v.id, 'match_status', v.match_status, 'lines', v_details, 'posting', 'none');
end $fn$;

create or replace function public.inv_supplier_agreement_upsert(p jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_id uuid := nullif(p->>'id', '')::uuid; v_org uuid := public.app_current_org();
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('procure') then
    raise exception 'Stock permission "procure" is required.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.suppliers where id = (p->>'supplier_id')::uuid and organisation_id = v_org) then
    raise exception 'Supplier not found in your company.' using errcode = '42501';
  end if;
  if v_id is null then
    insert into public.supplier_agreements(organisation_id, country, supplier_id, agreement_type, agreement_no, min_qty, max_qty,
      lead_time_days, credit_terms_days, agreed_prices, currency, starts_on, expires_on, return_terms, status)
    values (v_org, p->>'country', (p->>'supplier_id')::uuid, p->>'agreement_type', p->>'agreement_no',
      nullif(p->>'min_qty', '')::numeric, nullif(p->>'max_qty', '')::numeric, nullif(p->>'lead_time_days', '')::int,
      nullif(p->>'credit_terms_days', '')::int, coalesce(p->'agreed_prices', '{}'::jsonb), upper(p->>'currency'),
      nullif(p->>'starts_on', '')::date, nullif(p->>'expires_on', '')::date, p->>'return_terms', coalesce(p->>'status', 'active'))
    returning id into v_id;
  else
    update public.supplier_agreements set min_qty = nullif(p->>'min_qty', '')::numeric, max_qty = nullif(p->>'max_qty', '')::numeric,
      lead_time_days = nullif(p->>'lead_time_days', '')::int, credit_terms_days = nullif(p->>'credit_terms_days', '')::int,
      agreed_prices = coalesce(p->'agreed_prices', agreed_prices), expires_on = nullif(p->>'expires_on', '')::date,
      return_terms = coalesce(p->>'return_terms', return_terms), status = coalesce(p->>'status', status), updated_at = now()
    where id = v_id and organisation_id = v_org;
    if not found then raise exception 'Agreement not found.' using errcode = 'P0002'; end if;
  end if;
  return v_id;
end $fn$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
revoke all on function public._inv_transit_location(uuid, text, text), public._inv_transfer_move(jsonb, text)
  from public, anon, authenticated;
revoke all on function public.inv_transfer_dispatch(jsonb), public.inv_transfer_receive(jsonb),
  public.inv_transfer_return_remaining(jsonb), public.inv_reserve(jsonb), public.inv_release(uuid, numeric, text),
  public.inv_issue(jsonb), public.inv_po_add_line(uuid, jsonb), public.inv_receive_goods(jsonb),
  public.inv_supplier_invoice_create(jsonb), public.inv_supplier_invoice_match(uuid),
  public.inv_supplier_agreement_upsert(jsonb) from public, anon;
grant execute on function public.inv_transfer_dispatch(jsonb), public.inv_transfer_receive(jsonb),
  public.inv_transfer_return_remaining(jsonb), public.inv_reserve(jsonb), public.inv_release(uuid, numeric, text),
  public.inv_issue(jsonb), public.inv_po_add_line(uuid, jsonb), public.inv_receive_goods(jsonb),
  public.inv_supplier_invoice_create(jsonb), public.inv_supplier_invoice_match(uuid),
  public.inv_supplier_agreement_upsert(jsonb) to authenticated;

do $$ begin
  if to_regprocedure('anum_integration.apply_reader_policies()') is not null then
    perform anum_integration.apply_reader_policies();
  end if;
end $$;

commit;
