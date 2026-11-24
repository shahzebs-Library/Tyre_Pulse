# Floor workflow (put-away, picking, workshop handover): database changes proposed (NOT applied)

Measured on the live database (project jhssdmeruxtrlqnwfksc), read-only, 2026-11-24.
Nothing below has been run. The web screens (PutawayPanel, PickingPanel, HandoverPanel) work today
without any of it; each item says what it would improve. Apply only on the owner's yes, inside a
transaction, with the verify step.

---

## 0. What exists today (audit)

| Step | Existing objects | Used by the new screens |
|---|---|---|
| Receive | `inv_receive_goods` posts a `receipt` to the location chosen per line | (receiving stays in Goods receipt / Stock movements) |
| Put-away | **No put-away RPC.** `inv_transfer_dispatch` + `inv_transfer_receive` move stock between any two locations of one country (two legs via the site's `IN-TRANSIT` location). `inv_post_movement` has no in-site relocation type. | Put-away = same-site transfer (dispatch, then receive in full) |
| Locations | `inventory_locations` 221 rows: warehouse 25, zone 3, rack 6, shelf 26, bin 160, in_transit 1. **All 5,539 located stock lines sit at warehouse level; 0 in a bin.** 43 stock lines have no location and cannot be moved until they get one. | Sources = warehouse/zone/rack; targets = bin/shelf of the same site |
| Reservation | `stock_reservations` (0 rows) written by `inv_reserve`; `inv_issue` consumes it. `work_order_stock_reservations` + `_lines` (0 rows) exist with **no writer** anywhere (no RPC, no client). | Pick list = active `stock_reservations` with `source_doc_type='job_card'`; work-order holds shown, not pickable |
| Issue | `inv_issue` records `source_doc_type/id`, `reference_no`, `reason`, `actor_id`. No "received by" field. | Confirm pick = `inv_issue` with the reservation, job card as source document, receiver written into `reason` |
| Handover | `handover_reports` = vehicle/driver handover. `shift_handovers` = shift. `tech_activity_events` = technician events (CHECK has `request_parts`, no "parts received"). `parts_requests` = request status only (`issued_at`, no receiver). `material_issues` (0 rows) = slip that does not move stock. **Nothing records a parts handover.** | Handover = read issue/return movements of the job card + receiver parsed from the issue note |

Known limits of the zero-migration version:

- A put-away is two posts (`transfer_out`/`transfer_in` to IN-TRANSIT, then out of transit into the bin), so the
  ledger shows four movements and a `TRF-` reference for a move inside one store. If step 2 fails the stock waits
  in IN-TRANSIT; the screen offers "Finish put-away" and the transfer also shows in Movements > Transfers.
- The receiver is free text inside the issue note, not a person id, and nobody confirms receipt.
- An issue made outside Picking (Stock movements > Issue) carries no receiver.

## 1. `inv_putaway`: one atomic in-site move (recommended)

Moves free stock from one location to another of the SAME site in one transaction, two ledger legs
(`transfer_out` from the source balance, `transfer_in` into the target balance), no in-transit leg.
Reuses `_inv_post`, so scope, capability, shortage and valuation carry over unchanged.

```sql
begin;

create or replace function public.inv_putaway(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), '');
  v_rec public.stock_records%rowtype; v_to public.inventory_locations%rowtype;
  v_qty numeric := (p->>'qty')::numeric; v_out jsonb; v_in jsonb;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('transfer') then
    raise exception 'Stock permission "transfer" is required.' using errcode = '42501';
  end if;
  if v_key is null or v_qty is null or v_qty <= 0 then
    raise exception 'An idempotency_key and a positive qty are required.' using errcode = '22023';
  end if;
  select * into v_rec from public.stock_records where id = (p->>'stock_id')::uuid and organisation_id = v_org;
  select * into v_to from public.inventory_locations where id = (p->>'to_location_id')::uuid and organisation_id = v_org and active;
  if v_rec.id is null or v_rec.item_id is null or v_rec.location_id is null then
    raise exception 'The balance must be a mapped item with a location.' using errcode = '22023';
  end if;
  if v_to.id is null or v_to.id = v_rec.location_id then
    raise exception 'Choose a different active location.' using errcode = '22023';
  end if;
  if lower(v_to.country) <> lower(v_rec.country) or lower(v_to.site) <> lower(v_rec.site) then
    raise exception 'Put-away stays inside one site. Use a transfer for another site.' using errcode = '22023';
  end if;
  if v_to.location_type in ('in_transit') then
    raise exception 'Choose a storage location, not in-transit.' using errcode = '22023';
  end if;
  v_out := public._inv_post(jsonb_build_object('idempotency_key', 'put:' || v_key || ':out', 'stock_id', v_rec.id,
    'movement_type', 'transfer_out', 'qty_change', -v_qty, 'reason', coalesce(p->>'note', 'Put-away'),
    'source_doc_type', 'putaway', 'source_doc_id', v_key,
    'source_receipt_movement_id', p->>'source_receipt_movement_id'), false);
  if v_out->>'status' = 'refused_shortage' then return v_out; end if;
  if coalesce(v_out->>'replayed', 'false') = 'true' then
    return jsonb_build_object('status', 'posted', 'replayed', true, 'out_movement_id', v_out->>'movement_id');
  end if;
  v_in := public._inv_post(jsonb_build_object('idempotency_key', 'put:' || v_key || ':in', 'item_id', v_rec.item_id,
    'location_id', v_to.id, 'condition', v_rec.condition, 'ownership', v_rec.ownership, 'owner_supplier_id', v_rec.owner_supplier_id,
    'movement_type', 'transfer_in', 'qty_change', v_qty, 'currency', v_out->>'currency', 'unit_cost', v_out->'unit_cost',
    'carried_value', -coalesce((v_out->>'value_change')::numeric, 0),
    'carried_unvalued_qty', -coalesce((v_out->>'unvalued_qty_change')::numeric, 0),
    'carried_pending_qty', coalesce((v_out->>'pending_out_change')::numeric, 0), 'carried_movement_id', v_out->>'movement_id',
    'carried_from_stock_id', v_rec.id, 'reason', coalesce(p->>'note', 'Put-away'),
    'source_doc_type', 'putaway', 'source_doc_id', v_key), false);
  return jsonb_build_object('status', 'posted', 'from_stock_id', v_rec.id, 'to_stock_id', v_in->>'stock_id',
    'out_movement_id', v_out->>'movement_id', 'in_movement_id', v_in->>'movement_id');
end $$;

revoke all on function public.inv_putaway(jsonb) from public;
revoke all on function public.inv_putaway(jsonb) from anon;
grant execute on function public.inv_putaway(jsonb) to authenticated, service_role;
commit;
```

Verify (rolled back, as a real Store Keeper): put 2 of a warehouse balance into a bin of the same site ->
source -2, bin +2, ledger equals balance; same key again -> `replayed`; bin at another site -> refused;
qty above free -> `refused_shortage`; a Driver -> 42501.

Check before applying: that `_inv_post` accepts the `carried_*` keys outside a transfer (it does in
`_inv_transfer_dispatch`; confirm it does not require `source_doc_type = 'stock_transfer'`).

Client change after apply: `startPutaway` calls `inv_putaway` instead of dispatch + receive; the two-step
recovery path is removed.

Rollback: `drop function public.inv_putaway(jsonb);`

## 2. `stock_issue_handovers`: who received the parts

One row per issue movement handed to a person, with an optional acknowledgement by the receiver.

```sql
begin;

create table public.stock_issue_handovers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country text, site text,
  movement_id uuid not null references public.stock_movements(id),
  job_card_no text not null,
  work_order_id uuid references public.work_orders(id),
  given_by uuid not null default auth.uid(),
  given_at timestamptz not null default now(),
  received_by_user uuid references public.profiles(id),
  received_by_name text check (received_by_name is null or length(btrim(received_by_name)) between 1 and 120),
  acknowledged_at timestamptz,
  note text check (note is null or length(note) <= 400),
  idempotency_key text not null check (length(idempotency_key) between 1 and 160),
  unique (organisation_id, idempotency_key),
  unique (movement_id),
  check (received_by_user is not null or received_by_name is not null)
);
create index stock_issue_handovers_job_card_idx on public.stock_issue_handovers (organisation_id, job_card_no);

alter table public.stock_issue_handovers enable row level security;
create policy sih_org on public.stock_issue_handovers as restrictive for all to authenticated
  using (organisation_id = (select public.app_current_org())) with check (organisation_id = (select public.app_current_org()));
create policy sih_country on public.stock_issue_handovers as restrictive for select to authenticated
  using (country is null or (select public.is_super_admin()) or country = any (coalesce((select public.app_country_scope()), '{}'::text[])));
create policy sih_read on public.stock_issue_handovers for select to authenticated using ((select public.app_is_active()) is true);
-- No insert / update policy: written only by the two functions below.

create or replace function public.inv_issue_handover(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb := p_payload; v_org uuid := public.app_current_org();
  v_key text := nullif(btrim(p->>'idempotency_key'), ''); v_m public.stock_movements%rowtype; v_id uuid;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select id into v_id from public.stock_issue_handovers where organisation_id = v_org and idempotency_key = v_key;
  if found then return jsonb_build_object('id', v_id, 'replayed', true); end if;
  select * into v_m from public.stock_movements where id = (p->>'movement_id')::uuid and organisation_id = v_org;
  if v_m.id is null or v_m.movement_type <> 'issue' or v_m.source_doc_type <> 'job_card' then
    raise exception 'Choose an issue posted against a job card.' using errcode = '22023';
  end if;
  if not public._inv_scope_ok(v_m.country, v_m.site) then
    raise exception 'This issue is outside your country or site scope.' using errcode = '42501';
  end if;
  insert into public.stock_issue_handovers(organisation_id, country, site, movement_id, job_card_no, work_order_id,
    received_by_user, received_by_name, note, idempotency_key)
  values (v_org, v_m.country, v_m.site, v_m.id, v_m.source_doc_id,
    (select w.id from public.work_orders w where w.work_order_no = v_m.source_doc_id limit 1),
    nullif(p->>'received_by_user', '')::uuid, nullif(btrim(p->>'received_by_name'), ''), nullif(btrim(p->>'note'), ''), v_key)
  returning id into v_id;
  return jsonb_build_object('id', v_id);
end $$;

-- The receiver acknowledges in their own session (a technician on the phone).
create or replace function public.inv_issue_handover_ack(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.app_current_org(); v_n int;
begin
  update public.stock_issue_handovers set acknowledged_at = now()
   where id = (p_payload->>'handover_id')::uuid and organisation_id = v_org
     and received_by_user = auth.uid() and acknowledged_at is null;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'Only the named receiver can acknowledge, once.' using errcode = '42501'; end if;
  return jsonb_build_object('acknowledged', true);
end $$;

revoke all on function public.inv_issue_handover(jsonb), public.inv_issue_handover_ack(jsonb) from public;
revoke all on function public.inv_issue_handover(jsonb), public.inv_issue_handover_ack(jsonb) from anon;
grant execute on function public.inv_issue_handover(jsonb), public.inv_issue_handover_ack(jsonb) to authenticated, service_role;
commit;
```

Verify (rolled back): issue against a job card, then `inv_issue_handover` -> 1 row; same key -> replayed; a
second handover for the same movement -> unique violation refused; a `receipt` movement -> refused; ack by
another user -> 42501; ack by the receiver -> stamped once.

Client change after apply: Picking calls `inv_issue_handover` after each successful issue (with the receiver
picked from the people list, not free text); HandoverPanel reads `stock_issue_handovers` and falls back to the
issue note for older picks. Rollback: drop the two functions and the table (no other object references it).

## 3. Optional: put-away worklist after receipt

`inv_receive_goods` lets the receiver post straight into a bin, so no flag is strictly needed: anything at a
warehouse / zone / rack location is "to be put away". If the owner wants receiving bays, add a location type
`receiving` (widen `inventory_locations_location_type_check`, add it to `PUTAWAY_SOURCE_TYPES` in
`src/lib/inventory/floorWorkflow.js` and to `LOCATION_TYPES` + the locale). Not needed for the screens to work.

## 4. Optional: retire `work_order_stock_reservations`

It has no writer and 0 rows, and `inv_issue` cannot consume it. Either drop it (after confirming nothing
external writes it) or have `inv_reserve` mirror into it. Until then Picking lists its lines as information.
