-- 20261126180000_inv_store_keeper_phone_receipts.sql
-- STATUS: AUTHORED, NOT APPLIED. Apply only on the owner's yes.
--
-- PURPOSE
--   Owner decision (2026-11-26): a Store Keeper may record goods received on the phone.
--   Today only someone holding the stock "receive" capability can post a GRN
--   (_inv_receive_goods), and a bare receipt through inv_post_movement / post_stock_movement
--   is org-admin only (WP5 D3). This migration adds a second, narrower path, it does NOT
--   loosen either of those:
--
--   * inv_store_receipt_submit(p_payload): an approved Store Keeper (or anyone holding
--     "receive") RECORDS a delivery against ONE open purchase-order line. Nothing moves
--     in stock yet. Rules, all checked here, never by the phone:
--       - the PO is this company's and Approved / Ordered / Partial Delivery (WP4 rule 6);
--         the line is open and carries a Material Master item;
--       - the receiving location is this company's, active, at the PO site;
--       - the site must be named in the person's OWN site list. The "ALL" / "*" sentinel
--         does not count: a Store Keeper never records for every site;
--       - the country must be in the person's country scope;
--       - accepted quantity (received - rejected) cannot exceed what is still open on the
--         line: ordered - accepted - every other pending phone receipt on that line;
--       - no price, cost or currency can be sent (the PO line price is used on approval);
--       - a rejection needs a reason; the delivery note photo, when given, must sit under
--         exactly <company id>/store_receipts/<client_uuid>.jpg in the tyre-photos bucket (so the
--         existing storage_company_folder_wall applies), and must already exist in storage,
--         uploaded by the caller;
--       - idempotent on client_uuid (a retry after a timeout stores nothing twice; a key
--         belongs to the person who first used it).
--   * inv_store_receipt_decide(p_payload): a DIFFERENT person holding "receive", in scope
--     for the site, approves (posts the GRN through the existing _inv_receive_goods engine,
--     idempotency key store-receipt:<id>, PO line price) or rejects with a reason. The person
--     who recorded the receipt can never decide it (also a table CHECK).
--   * inv_store_receipt_open_lines(p_payload): the open PO lines and receiving locations the
--     caller may receive for (explicit sites only). No prices are returned.
--   * inv_store_receipt_cancel(p_payload): the recorder withdraws their own pending receipt.
--
--   inv_store_receipt_requests: one row per recorded delivery. RLS on; RESTRICTIVE org
--   isolation; readable by the recorder, and by "receive" holders in scope; no direct client
--   write (only the SECURITY DEFINER functions above write it).
--
-- LIVE PRE-FLIGHT (read only, 2026-11-26): purchase_order_lines 0 rows, goods_receipts 1,
--   inventory_locations 221; 9 Store Keepers, 7 of them on sites {ALL}. Those 7 must be given
--   named sites in Console -> Users before they can record a receipt (by design).
--
-- VERIFY (after apply)
--   select to_regclass('public.inv_store_receipt_requests') is not null;                       -- true
--   select relrowsecurity from pg_class where relname = 'inv_store_receipt_requests';           -- true
--   select has_function_privilege('anon', 'public.inv_store_receipt_submit(jsonb)', 'EXECUTE'); -- false
--   select has_function_privilege('authenticated', 'public.inv_store_receipt_submit(jsonb)', 'EXECUTE'); -- true
--   select has_function_privilege('authenticated', 'public._inv_store_site_ok(text,text)', 'EXECUTE');    -- false
--   select has_table_privilege('authenticated', 'public.inv_store_receipt_requests', 'INSERT');        -- false
--
-- ROLLBACK
--   begin;
--   drop function if exists public.inv_store_receipt_submit(jsonb), public.inv_store_receipt_decide(jsonb),
--     public.inv_store_receipt_open_lines(jsonb), public.inv_store_receipt_cancel(jsonb),
--     public._inv_store_site_ok(text, text), public._inv_store_receiver(), public._inv_store_line_open(uuid, uuid),
--     public.inv_store_receipt_can_read(text, text, uuid), public.inv_store_receipt_photo_can_read(text, uuid);
--   drop policy if exists store_receipt_photos_read on storage.objects;
--   drop table if exists public.inv_store_receipt_requests;   -- only while it holds no decided rows you need
--   commit;

begin;

create table if not exists public.inv_store_receipt_requests (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id),
  client_uuid uuid not null,
  country text not null,
  site text not null,
  po_id uuid not null references public.purchase_orders(id),
  po_line_id uuid not null references public.purchase_order_lines(id),
  item_id uuid not null references public.material_master(id),
  location_id uuid not null references public.inventory_locations(id),
  qty_received numeric not null check (qty_received > 0 and qty_received <= 100000),
  qty_rejected numeric not null default 0 check (qty_rejected >= 0),
  rejection_reason text check (rejection_reason is null or length(rejection_reason) <= 500),
  delivery_note_no text check (delivery_note_no is null or length(delivery_note_no) <= 120),
  delivery_note_path text check (delivery_note_path is null
    or delivery_note_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/store_receipts/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'),
  notes text check (notes is null or length(notes) <= 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  submitted_by uuid not null,
  submitted_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text check (decision_note is null or length(decision_note) <= 500),
  grn_id uuid references public.goods_receipts(id),
  check (qty_rejected <= qty_received),
  check (decided_by is null or decided_by <> submitted_by),
  check ((status = 'approved') = (grn_id is not null)),
  unique (organisation_id, client_uuid)
);
create index if not exists inv_store_receipt_requests_line_idx
  on public.inv_store_receipt_requests (po_line_id) where status = 'pending';
create index if not exists inv_store_receipt_requests_org_status_idx
  on public.inv_store_receipt_requests (organisation_id, status, submitted_at desc);
comment on table public.inv_store_receipt_requests is
  'Goods received recorded on the phone by a Store Keeper against one open PO line. Stock moves only when a different person with "receive" approves (inv_store_receipt_decide -> _inv_receive_goods).';

alter table public.inv_store_receipt_requests enable row level security;
drop policy if exists inv_store_receipt_requests_org_isolation on public.inv_store_receipt_requests;
create policy inv_store_receipt_requests_org_isolation on public.inv_store_receipt_requests
  as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org()))
  with check (organisation_id = (select public.app_current_org()));

-- The site an explicit Store Keeper scope names. "ALL" / "*" never qualifies.
create or replace function public._inv_store_site_ok(p_country text, p_site text)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_site is not null and btrim(p_site) <> '' and upper(btrim(p_site)) not in ('ALL', '*')
     and p_country is not null and btrim(p_country) <> ''
     and coalesce(public.app_write_country_ok(p_country), false)
     and upper(btrim(p_site)) = any (coalesce(public.app_site_scope(), '{}'::text[]))
$fn$;

-- Who may record a phone receipt: an approved, unlocked Store Keeper, or a "receive" holder.
create or replace function public._inv_store_receiver()
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_approved_and_unlocked()
     and public.app_current_org() is not null
     and (exists (select 1 from public.profiles p where p.id = auth.uid()
                   and lower(btrim(coalesce(p.role, ''))) in ('store keeper', 'store_keeper'))
          or coalesce(public.inv_can('receive'), false))
$fn$;

-- Quantity still open on a PO line: ordered - accepted - other pending phone receipts.
create or replace function public._inv_store_line_open(p_line uuid, p_except uuid default null)
returns numeric language sql stable security definer set search_path = public as $fn$
  select l.qty_ordered - l.qty_accepted
         - coalesce((select sum(r.qty_received - r.qty_rejected) from public.inv_store_receipt_requests r
                      where r.po_line_id = l.id and r.status = 'pending'
                        and (p_except is null or r.id <> p_except)), 0)
    from public.purchase_order_lines l where l.id = p_line
$fn$;

-- Row visibility for the caller (evaluated as the caller inside the read policy; answers only
-- true/false about the caller's own rights, exposes no row data).
create or replace function public.inv_store_receipt_can_read(p_country text, p_site text, p_submitted_by uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select public.is_approved_and_unlocked()
     and (p_submitted_by = auth.uid()
          or (coalesce(public.inv_can('receive'), false) and coalesce(public._inv_scope_ok(p_country, p_site), false)))
$fn$;
revoke all on function public.inv_store_receipt_can_read(text, text, uuid) from public;
revoke all on function public.inv_store_receipt_can_read(text, text, uuid) from anon;
grant execute on function public.inv_store_receipt_can_read(text, text, uuid) to authenticated, service_role;

drop policy if exists inv_store_receipt_requests_read on public.inv_store_receipt_requests;
create policy inv_store_receipt_requests_read on public.inv_store_receipt_requests
  for select to authenticated
  using (public.inv_store_receipt_can_read(country, site, submitted_by));

revoke all on public.inv_store_receipt_requests from public, anon;
revoke insert, update, delete, truncate on public.inv_store_receipt_requests from authenticated;
grant select on public.inv_store_receipt_requests to authenticated;

create or replace function public.inv_store_receipt_submit(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_org uuid := public.app_current_org();
  v_cu uuid;
  v_req public.inv_store_receipt_requests%rowtype;
  v_pl public.purchase_order_lines%rowtype;
  v_po public.purchase_orders%rowtype;
  v_loc public.inventory_locations%rowtype;
  v_country text; v_qty numeric; v_rej numeric; v_open numeric; v_path text; v_reason text;
begin
  if not public._inv_store_receiver() then
    raise exception 'Only an approved store keeper can record goods received.' using errcode = '42501';
  end if;
  begin
    v_cu := nullif(btrim(p_payload->>'client_uuid'), '')::uuid;
  exception when invalid_text_representation then
    raise exception 'A valid client_uuid is required.' using errcode = '22023';
  end;
  if v_cu is null then raise exception 'A valid client_uuid is required.' using errcode = '22023'; end if;
  if nullif(p_payload->>'unit_cost', '') is not null or nullif(p_payload->>'unit_price', '') is not null
     or nullif(p_payload->>'price', '') is not null or nullif(p_payload->>'currency', '') is not null
     or nullif(p_payload->>'cost', '') is not null then
    raise exception 'The price comes from the purchase order. A store keeper cannot set a price or cost.' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_org::text || ':store-receipt:' || v_cu::text, 0));
  select * into v_req from public.inv_store_receipt_requests where organisation_id = v_org and client_uuid = v_cu;
  if found then
    if v_req.submitted_by <> auth.uid() then
      raise exception 'This receipt key was already used by someone else.' using errcode = '42501';
    end if;
    return jsonb_build_object('id', v_req.id, 'status', v_req.status, 'replayed', true);
  end if;

  begin
    select * into v_pl from public.purchase_order_lines
     where id = nullif(p_payload->>'po_line_id', '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'Purchase order line not found.' using errcode = 'P0002';
  end;
  if v_pl.id is null then raise exception 'Purchase order line not found.' using errcode = 'P0002'; end if;
  select * into v_po from public.purchase_orders where id = v_pl.po_id and organisation_id = v_org;
  if v_po.id is null then raise exception 'Purchase order not found.' using errcode = 'P0002'; end if;
  if v_po.status not in ('Approved', 'Ordered', 'Partial Delivery') then
    raise exception 'Goods can only be received against an approved or ordered purchase order.' using errcode = '22023';
  end if;
  if v_pl.status in ('received', 'closed', 'cancelled') then
    raise exception 'This purchase order line is already closed.' using errcode = '22023';
  end if;
  if v_pl.item_id is null then
    raise exception 'This purchase order line has no Material Master item. Ask the buyer to link it.' using errcode = '22023';
  end if;

  begin
    select * into v_loc from public.inventory_locations
     where id = coalesce(nullif(p_payload->>'location_id', '')::uuid, v_pl.location_id)
       and organisation_id = v_org and active;
  exception when invalid_text_representation then
    raise exception 'Choose a receiving location.' using errcode = '22023';
  end;
  if v_loc.id is null then raise exception 'Choose a receiving location.' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(v_po.site, '')), '') is not null and upper(btrim(v_po.site)) <> upper(btrim(v_loc.site)) then
    raise exception 'The receiving location must be at the purchase order site.' using errcode = '22023';
  end if;
  v_country := coalesce(nullif(btrim(coalesce(v_po.country, '')), ''), v_loc.country);
  if lower(btrim(v_country)) <> lower(btrim(v_loc.country)) then
    raise exception 'The receiving location is in a different country from the purchase order.' using errcode = '22023';
  end if;
  if not public._inv_store_site_ok(v_country, v_loc.site) then
    raise exception 'You can record a receipt only for a site assigned to you by name.' using errcode = '42501';
  end if;

  begin
    v_qty := nullif(p_payload->>'qty_received', '')::numeric;
    v_rej := coalesce(nullif(p_payload->>'qty_rejected', '')::numeric, 0);
  exception when invalid_text_representation then
    raise exception 'Enter the quantity as a number.' using errcode = '22023';
  end;
  if v_qty is null or v_qty <= 0 then raise exception 'Enter a received quantity above zero.' using errcode = '22023'; end if;
  if v_qty > 100000 then raise exception 'That quantity is too large.' using errcode = '22023'; end if;
  if v_rej < 0 or v_rej > v_qty then
    raise exception 'Rejected quantity cannot be negative or more than the quantity received.' using errcode = '22023';
  end if;
  v_reason := nullif(btrim(coalesce(p_payload->>'rejection_reason', '')), '');
  if v_rej > 0 and v_reason is null then
    raise exception 'Say why goods were rejected.' using errcode = '22023';
  end if;
  v_open := public._inv_store_line_open(v_pl.id);
  if v_qty - v_rej > v_open then
    raise exception 'Only % is still open on this purchase order line.', trim_scale(greatest(v_open, 0)) using errcode = '22023';
  end if;
  v_path := nullif(btrim(coalesce(p_payload->>'delivery_note_path', '')), '');
  -- Exact path, no pattern matching (a LIKE would treat _ and % in the text as wildcards).
  if v_path is not null and v_path <> v_org::text || '/store_receipts/' || v_cu::text || '.jpg' then
    raise exception 'The delivery note photo must be stored as <your company>/store_receipts/<receipt id>.jpg.' using errcode = '22023';
  end if;
  if v_path is not null and not exists (select 1 from storage.objects o
       where o.bucket_id = 'tyre-photos' and o.name = v_path and o.owner = auth.uid()) then
    raise exception 'The delivery note photo was not found. Upload it again, or send without it.' using errcode = '22023';
  end if;

  insert into public.inv_store_receipt_requests(organisation_id, client_uuid, country, site, po_id, po_line_id, item_id,
    location_id, qty_received, qty_rejected, rejection_reason, delivery_note_no, delivery_note_path, notes, submitted_by)
  values (v_org, v_cu, v_country, upper(btrim(v_loc.site)), v_po.id, v_pl.id, v_pl.item_id, v_loc.id, v_qty, v_rej,
    v_reason, nullif(btrim(coalesce(p_payload->>'delivery_note_no', '')), ''), v_path,
    nullif(btrim(coalesce(p_payload->>'notes', '')), ''), auth.uid())
  returning * into v_req;
  return jsonb_build_object('id', v_req.id, 'status', v_req.status, 'replayed', false,
    'open_after', trim_scale(v_open - (v_qty - v_rej)));
end $fn$;

create or replace function public.inv_store_receipt_decide(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare
  v_org uuid := public.app_current_org();
  v_req public.inv_store_receipt_requests%rowtype;
  v_po public.purchase_orders%rowtype;
  v_decision text := lower(btrim(coalesce(p_payload->>'decision', '')));
  v_note text := nullif(btrim(coalesce(p_payload->>'note', '')), '');
  v_res jsonb;
begin
  if not public.is_approved_and_unlocked() or v_org is null or not coalesce(public.inv_can('receive'), false) then
    raise exception 'Stock permission "receive" is required to decide a receipt.' using errcode = '42501';
  end if;
  if v_decision not in ('approve', 'reject') then
    raise exception 'Choose approve or reject.' using errcode = '22023';
  end if;
  begin
    select * into v_req from public.inv_store_receipt_requests
     where id = nullif(p_payload->>'request_id', '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end;
  if v_req.id is null then raise exception 'Receipt not found.' using errcode = 'P0002'; end if;
  if v_req.submitted_by = auth.uid() then
    raise exception 'You cannot approve or reject a receipt you recorded.' using errcode = '42501';
  end if;
  if v_req.status <> 'pending' then
    if (v_req.status = 'approved' and v_decision = 'approve') or (v_req.status = 'rejected' and v_decision = 'reject') then
      return jsonb_build_object('id', v_req.id, 'status', v_req.status, 'grn_id', v_req.grn_id, 'replayed', true);
    end if;
    raise exception 'This receipt was already %.', v_req.status using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_req.country, v_req.site) then
    raise exception 'This receipt is outside your country or site scope.' using errcode = '42501';
  end if;

  if v_decision = 'reject' then
    if v_note is null or length(v_note) < 3 then
      raise exception 'Say why the receipt is rejected.' using errcode = '22023';
    end if;
    update public.inv_store_receipt_requests set status = 'rejected', decided_by = auth.uid(), decided_at = now(),
      decision_note = left(v_note, 500) where id = v_req.id;
    return jsonb_build_object('id', v_req.id, 'status', 'rejected', 'replayed', false);
  end if;

  select * into v_po from public.purchase_orders where id = v_req.po_id and organisation_id = v_org;
  -- One posting engine: _inv_receive_goods re-checks PO status, line, item, ordered quantity and
  -- location site, and takes the price from the PO line (no unit_cost is sent).
  v_res := public._inv_receive_goods(jsonb_build_object(
    'idempotency_key', 'store-receipt:' || v_req.id::text,
    'country', v_req.country, 'site', v_req.site, 'po_id', v_req.po_id, 'po_ref', v_po.po_number,
    'supplier_id', v_po.supplier_id, 'supplier', coalesce(v_po.supplier_name, v_po.vendor_name),
    'lines', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'po_line_id', v_req.po_line_id, 'item_id', v_req.item_id, 'location_id', v_req.location_id,
      'qty_received', v_req.qty_received, 'qty_rejected', v_req.qty_rejected,
      'rejection_reason', v_req.rejection_reason)))));
  update public.goods_receipts set received_by_id = v_req.submitted_by,
      delivery_note_no = coalesce(v_req.delivery_note_no, delivery_note_no),
      notes = coalesce(notes, 'Recorded on the phone by the store keeper; approved by a second person.')
   where id = (v_res->>'grn_id')::uuid and organisation_id = v_org;
  update public.inv_store_receipt_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
    decision_note = v_note, grn_id = (v_res->>'grn_id')::uuid where id = v_req.id;
  return jsonb_build_object('id', v_req.id, 'status', 'approved', 'grn_id', v_res->>'grn_id',
    'grn_no', v_res->>'grn_no', 'replayed', false);
end $fn$;

create or replace function public.inv_store_receipt_cancel(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_req public.inv_store_receipt_requests%rowtype;
begin
  if not public.is_approved_and_unlocked() or v_org is null then
    raise exception 'Not authorised.' using errcode = '42501';
  end if;
  begin
    select * into v_req from public.inv_store_receipt_requests
     where id = nullif(p_payload->>'request_id', '')::uuid and organisation_id = v_org for update;
  exception when invalid_text_representation then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end;
  if v_req.id is null or v_req.submitted_by <> auth.uid() then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;
  if v_req.status = 'cancelled' then return jsonb_build_object('id', v_req.id, 'status', 'cancelled', 'replayed', true); end if;
  if v_req.status <> 'pending' then
    raise exception 'This receipt was already %.', v_req.status using errcode = '22023';
  end if;
  update public.inv_store_receipt_requests set status = 'cancelled', decided_at = now() where id = v_req.id;
  return jsonb_build_object('id', v_req.id, 'status', 'cancelled', 'replayed', false);
end $fn$;

-- Open lines + locations the caller may receive for. Explicit sites only; no prices.
create or replace function public.inv_store_receipt_open_lines(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $fn$
declare v_org uuid := public.app_current_org(); v_search text := nullif(btrim(coalesce(p_payload->>'search', '')), '');
begin
  if not public._inv_store_receiver() then
    raise exception 'Only an approved store keeper can record goods received.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'lines', coalesce((select jsonb_agg(x order by x->>'po_number', (x->>'line_no')::int) from (
      select jsonb_build_object('po_line_id', l.id, 'po_id', po.id, 'po_number', po.po_number,
        'supplier', coalesce(po.supplier_name, po.vendor_name), 'po_status', po.status,
        'site', upper(btrim(po.site)), 'country', po.country, 'line_no', l.line_no,
        'item_id', l.item_id, 'item_code', m.item_code, 'item_name', coalesce(m.item_name, l.description),
        'uom', m.uom, 'qty_ordered', trim_scale(l.qty_ordered), 'qty_accepted', trim_scale(l.qty_accepted),
        'qty_open', trim_scale(greatest(public._inv_store_line_open(l.id), 0)), 'location_id', l.location_id) x
      from public.purchase_order_lines l
      join public.purchase_orders po on po.id = l.po_id and po.organisation_id = v_org
      left join public.material_master m on m.id = l.item_id
      where l.organisation_id = v_org and l.item_id is not null
        and l.status not in ('received', 'closed', 'cancelled')
        and po.status in ('Approved', 'Ordered', 'Partial Delivery')
        and public._inv_store_site_ok(po.country, po.site)
        and public._inv_store_line_open(l.id) > 0
        and (v_search is null or po.po_number ilike '%' || v_search || '%' or m.item_code ilike '%' || v_search || '%'
             or coalesce(m.item_name, l.description) ilike '%' || v_search || '%')
      limit 200) s), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(jsonb_build_object('id', il.id, 'code', il.code, 'name', il.name,
        'site', upper(btrim(il.site)), 'country', il.country, 'location_type', il.location_type) order by il.site, il.code)
      from public.inventory_locations il
      where il.organisation_id = v_org and il.active
        and il.location_type in ('warehouse', 'zone', 'rack', 'shelf', 'bin', 'consignment')
        and public._inv_store_site_ok(il.country, il.site)), '[]'::jsonb),
    'mine', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'status', r.status, 'po_number', po.po_number,
        'item_code', m.item_code, 'item_name', m.item_name, 'qty_received', trim_scale(r.qty_received),
        'qty_rejected', trim_scale(r.qty_rejected), 'site', r.site, 'submitted_at', r.submitted_at,
        'decided_at', r.decided_at, 'decision_note', r.decision_note) order by r.submitted_at desc)
      from (select * from public.inv_store_receipt_requests
             where organisation_id = v_org and submitted_by = auth.uid()
             order by submitted_at desc limit 30) r
      join public.purchase_orders po on po.id = r.po_id
      left join public.material_master m on m.id = r.item_id), '[]'::jsonb));
end $fn$;

-- Delivery-note photos: the company folder wall (storage_company_folder_wall) already keeps them
-- inside the company. Within it, only the uploader and "receive" holders who may see the receipt
-- read them (RESTRICTIVE, only for <company>/store_receipts/ in tyre-photos).
create or replace function public.inv_store_receipt_photo_can_read(p_name text, p_owner uuid)
returns boolean language sql stable security definer set search_path = public as $fn$
  select p_owner = auth.uid()
      or exists (select 1 from public.inv_store_receipt_requests r
                  where r.delivery_note_path = p_name and r.organisation_id = public.app_current_org()
                    and public.inv_store_receipt_can_read(r.country, r.site, r.submitted_by))
$fn$;
revoke all on function public.inv_store_receipt_photo_can_read(text, uuid) from public;
revoke all on function public.inv_store_receipt_photo_can_read(text, uuid) from anon;
grant execute on function public.inv_store_receipt_photo_can_read(text, uuid) to authenticated, service_role;

do $st$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects not present; delivery-note photo policy skipped';
    return;
  end if;
  execute 'drop policy if exists store_receipt_photos_read on storage.objects';
  execute $p$create policy store_receipt_photos_read on storage.objects as restrictive for select to authenticated
    using (bucket_id <> 'tyre-photos' or split_part(name, '/', 2) <> 'store_receipts'
           or public.inv_store_receipt_photo_can_read(name, owner))$p$;
end $st$;

-- Grants: PUBLIC first, then anon by name (Supabase grants EXECUTE to anon at create time).
revoke all on function public._inv_store_site_ok(text, text), public._inv_store_receiver(),
  public._inv_store_line_open(uuid, uuid) from public;
revoke all on function public._inv_store_site_ok(text, text), public._inv_store_receiver(),
  public._inv_store_line_open(uuid, uuid) from anon, authenticated;
revoke all on function public.inv_store_receipt_submit(jsonb), public.inv_store_receipt_decide(jsonb),
  public.inv_store_receipt_cancel(jsonb), public.inv_store_receipt_open_lines(jsonb) from public;
revoke all on function public.inv_store_receipt_submit(jsonb), public.inv_store_receipt_decide(jsonb),
  public.inv_store_receipt_cancel(jsonb), public.inv_store_receipt_open_lines(jsonb) from anon;
grant execute on function public.inv_store_receipt_submit(jsonb), public.inv_store_receipt_decide(jsonb),
  public.inv_store_receipt_cancel(jsonb), public.inv_store_receipt_open_lines(jsonb) to authenticated, service_role;

commit;
