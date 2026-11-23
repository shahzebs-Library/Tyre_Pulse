# WP4 procurement chain: database changes proposed (NOT applied)

Measured read-only on project `jhssdmeruxtrlqnwfksc`, 2026-11-23. Nothing below has been run. Each item says why the
web fix alone cannot close it. Apply only with the owner's OK, through a migration file, and verify as a real user.

## 1. `requisitions.item_id` (link a request to the Material Master)

Today a requisition holds the item as free text only. The web form now offers a Material Master picker, but it can
only copy the code and name into `item`; the Raise PO step asks for the item again. Storing the id removes that step
and lets reports join requisitions to stock and consumption.

```sql
alter table public.requisitions
  add column if not exists item_id uuid references public.material_master(id);
create index if not exists requisitions_item_id_idx on public.requisitions(item_id);
comment on column public.requisitions.item_id is 'Material Master item requested; item stays the display text.';
```

## 2. Stop self-approval of requisitions

`requisitions_cap_update` lets anyone with `inv_can('procure')` approve, including the person who raised the request.
The web hides nothing here because the approver may legitimately also be a requester. A server guard is the only real
boundary.

```sql
create or replace function public.guard_requisition_self_approval()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('approved', 'rejected') and old.status is distinct from new.status
     and new.created_by = auth.uid() and not public.is_super_admin() then
    raise exception 'You cannot approve or reject your own requisition.' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger trg_guard_requisition_self_approval
  before update of status on public.requisitions
  for each row execute function public.guard_requisition_self_approval();
```

## 3. Stamp the approver server side

`stamp_requisition_decision` sets `decided_at` but not `approved_by`; the web now sends the approver's name, which a
client can forge. Add an id column filled from `auth.uid()`.

```sql
alter table public.requisitions add column if not exists approved_by_id uuid references auth.users(id);
create or replace function public.stamp_requisition_decision()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('approved','rejected') then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      new.decided_at := now();
      new.approved_by_id := auth.uid();
    end if;
  elsif new.status in ('draft','submitted') then
    new.decided_at := null;
    new.approved_by_id := null;
  end if;
  return new;
end $$;
```

## 4. Requisitions are not country scoped on write for "All"

New requisitions now get the active country from the web, but a row with `country` null is visible in every country
and has no currency. Requisitions have no currency column at all, so the value is always read in the country's
currency. Optional hardening:

```sql
alter table public.requisitions add column if not exists currency text;
update public.requisitions r set currency = public.currency_for_country(r.country)
 where r.currency is null and r.country is not null;
```

## 5. Status changes on purchase orders bypass the receipt engine

`purchase_orders_cap_update` lets anyone with `procure` set `Delivered` / `Partial Delivery` by hand while
`purchase_order_lines` still show quantity outstanding. The web no longer offers those statuses when the PO has lines,
but the database accepts them. Guard:

```sql
create or replace function public.guard_po_delivery_status()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.status in ('Delivered','Partial Delivery') and old.status is distinct from new.status
     and exists (select 1 from public.purchase_order_lines l where l.po_id = new.id)
     and current_setting('app.inv_receiving', true) is distinct from 'on' then
    raise exception 'Delivery status is set by goods receipts for a PO with lines.' using errcode = '22023';
  end if;
  return new;
end $$;
-- _inv_receive_goods must then run `perform set_config('app.inv_receiving','on', true);`
-- before its final purchase_orders update.
```

## 6. `_inv_receive_goods` does not check the PO status

A receipt can be posted against a Draft or Cancelled PO. The web only lists Approved / Ordered / Partial Delivery POs,
but the RPC accepts any. Add, after the "Purchase order not found" check:

```sql
if nullif(p->>'po_id','') is not null and not exists (select 1 from public.purchase_orders po
     where po.id = (p->>'po_id')::uuid and po.status in ('Approved','Ordered','Partial Delivery')) then
  raise exception 'Goods can only be received against an approved or ordered PO.' using errcode = '22023';
end if;
```

## 7. `generate_po_number` is not SECURITY DEFINER

It works today because `authenticated` holds USAGE/UPDATE on `po_seq`. If that grant is ever tightened, PO creation
breaks with a raw permission error. Optional:

```sql
alter function public.generate_po_number() security definer;
revoke execute on function public.generate_po_number() from public, anon;
grant execute on function public.generate_po_number() to authenticated;
```

## 8. `purchase_orders.po_select_authenticated` is `using (true)`

Restrictive org / country / site policies still bound it, so this is not a leak today, but it is the only permissive
SELECT in the chain that does not check `app_is_active()`. Align with the siblings:

```sql
alter policy po_select_authenticated on public.purchase_orders using ((select app_is_active()) is true);
```
