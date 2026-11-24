# Warehouse assets and finance: proposed database changes (NOT APPLIED)

Audited read-only on the live database (project jhssdmeruxtrlqnwfksc), 2026-11-24. Nothing below has been applied.
The screens built in this lane (ToolCustodyPanel, RepairablesPanel, StockWarrantyScrapPanel, FinanceReconcilePanel)
already work without these changes: each says "not tracked yet" where a change is still needed, and none guesses.

## What exists (measured)

| Area | Object | Rows | Finding |
|---|---|---:|---|
| Tool registry | `equipment` (page `/equipment`, Admin only) | 0 | Status `available / in_use / maintenance / retired`. No holder, no due-back date. `equipment_fitments` 0. |
| Item issued to a person | `material_issues.issued_to` (+ MRT returns) | 0 | Has a holder, but no due-back date and nothing issued yet. |
| Serial-tracked items | `material_master.serial_tracked` | 189 | Candidates for per-unit custody. 114 stock lines read like tools (spanner, jack, torque, gun...). |
| Repair states | `stock_records.condition` CHECK: repairable, damaged, quarantine, scrap | 0 rows in these | All 5,583 stock lines are `new` (5,568) or `unspecified` (15). |
| Repair locations | `inventory_locations.location_type` CHECK: supplier_custody, repairable, warranty, quarantine, damaged, scrap, vehicle_custody | 0 of 221 | No location of any repair type exists yet. |
| Vehicle repair requests | `repair_requests` | 0 | Vehicle faults (RFR), not parts. Not reused for repairable parts. |
| Warranty | `warranty_claims` (+ events, trigger guard) | 0 | Tyre-shaped columns but generic `custom_data`; stock claims are tagged `custom_data.source = 'inventory'`. |
| Scrap (stock) | `stock_movements` type `scrap` | 0 | `inv_post_movement('scrap')` posts directly with `scrap_approve`: no approval request. |
| Scrap (tyres) | `tyre_status_marks` scrap | 954 | Unchanged; tyres keep Scrap Management. |
| Adjustment approval | `inventory_adjustments` | 0 | `audit_id` and `discrepancy_id` are NOT NULL, so a standalone scrap cannot use it. |
| Stock value | `v_inv_valuation` | 5,583 | KSA only. 129,371.55 on hand; **129,278.55 unvalued**, 93 valued. 36 lines (302 qty) have no currency. |
| ERP issues | `v_inv_erp_reconciliation` (last 12 months) | 21,557 | KSA SAR 6,283,117.34 / 32,001 lines, UAE AED 4,737,014.70 / 20,963, Egypt EGP 28,746,032.03 / 7,896. Every row `erp_only` (no in-app issues). |
| Receipts | `stock_movements` receipt | 6 | KSA SAR 972.40, 50 units, 0 unvalued. |
| Cost reconciliations | `inventory_cost_reconciliations` | 5,566 | All `open`. |

## 1. Tool custody log

```sql
create table public.equipment_custody (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  equipment_id    uuid not null references public.equipment(id) on delete restrict,
  holder_user_id  uuid references public.profiles(id),
  holder_name     text not null check (length(btrim(holder_name)) between 1 and 200),
  issued_at       timestamptz not null default now(),
  due_back_at     timestamptz,
  returned_at     timestamptz,
  condition_out   text,
  condition_in    text,
  issued_by       uuid not null default auth.uid(),
  returned_by     uuid,
  notes           text check (notes is null or length(notes) <= 2000),
  idempotency_key text unique,
  created_at      timestamptz not null default now(),
  constraint equipment_custody_due_chk check (due_back_at is null or due_back_at >= issued_at),
  constraint equipment_custody_return_chk check (returned_at is null or returned_at >= issued_at)
);
-- One open custody per tool.
create unique index equipment_custody_one_open on public.equipment_custody (equipment_id) where returned_at is null;
create index equipment_custody_org_site on public.equipment_custody (organisation_id, country, site, issued_at desc);

alter table public.equipment_custody enable row level security;
create policy equipment_custody_org on public.equipment_custody as restrictive for all
  using (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()))
  with check (organisation_id = (select public.app_current_org()) or (select public.is_super_admin()));
create policy equipment_custody_country on public.equipment_custody as restrictive for select
  using (country is null or (select public.is_super_admin()) or (select public.app_sees_all_countries())
         or lower(btrim(country)) = any (coalesce((select public.app_country_scope()), '{}')));
create policy equipment_custody_read on public.equipment_custody for select using ((select public.app_is_active()) is true);
-- No insert/update policy: writes go through the two functions below only.
revoke all on public.equipment_custody from anon;

create or replace function public.equipment_issue(p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_eq public.equipment; v_id uuid;
begin
  if not public.inv_can('issue') then raise exception 'Stock permission "issue" is required.' using errcode = '42501'; end if;
  select * into v_eq from public.equipment where id = (p_payload->>'equipment_id')::uuid
    and organisation_id = public.app_current_org() for update;
  if not found then raise exception 'Choose a registered tool.' using errcode = '22023'; end if;
  if v_eq.status = 'retired' then raise exception 'A retired tool cannot be issued.' using errcode = '22023'; end if;
  if nullif(btrim(p_payload->>'holder_name'), '') is null then raise exception 'Say who is taking the tool.' using errcode = '22023'; end if;
  insert into public.equipment_custody (organisation_id, country, site, equipment_id, holder_user_id, holder_name,
    due_back_at, condition_out, notes, idempotency_key)
  values (v_eq.organisation_id, v_eq.country, v_eq.site, v_eq.id, nullif(p_payload->>'holder_user_id','')::uuid,
    btrim(p_payload->>'holder_name'), nullif(p_payload->>'due_back_at','')::timestamptz,
    nullif(p_payload->>'condition_out',''), nullif(p_payload->>'notes',''), nullif(p_payload->>'idempotency_key',''))
  on conflict (idempotency_key) do nothing
  returning id into v_id;
  update public.equipment set status = 'in_use', updated_at = now() where id = v_eq.id;
  return jsonb_build_object('status', 'ok', 'id', v_id);
exception when unique_violation then
  raise exception 'This tool is already out with someone. Record its return first.' using errcode = 'PT409';
end $$;

create or replace function public.equipment_return(p_payload jsonb) returns jsonb
  language plpgsql security definer set search_path = public, pg_temp as $$
declare v_c public.equipment_custody;
begin
  if not public.inv_can('issue') then raise exception 'Stock permission "issue" is required.' using errcode = '42501'; end if;
  update public.equipment_custody set returned_at = now(), returned_by = auth.uid(),
         condition_in = nullif(p_payload->>'condition_in','')
   where id = (p_payload->>'custody_id')::uuid and organisation_id = public.app_current_org() and returned_at is null
   returning * into v_c;
  if not found then raise exception 'This custody is already closed.' using errcode = 'PT409'; end if;
  update public.equipment set status = case when lower(coalesce(v_c.condition_in,'')) in ('damaged','faulty') then 'maintenance' else 'available' end,
         updated_at = now() where id = v_c.equipment_id;
  return jsonb_build_object('status', 'ok', 'id', v_c.id);
end $$;

revoke all on function public.equipment_issue(jsonb), public.equipment_return(jsonb) from public, anon;
grant execute on function public.equipment_issue(jsonb), public.equipment_return(jsonb) to authenticated;
```

The panel already reads `equipment_custody` (columns above) and shows open / overdue / no-due-date rows. Only the
issue and return buttons need adding once this is applied.

## 2. Repairable parts: no table needed

Repair state is read from stock condition and location type (existing CHECKs). The work is configuration, not code:
create, per site, a `repairable`, `quarantine`, `scrap` location and one `supplier_custody` location per repair vendor.
Optional later: `stock_repair_orders` (vendor, RMA reference, sent/expected/returned dates, quoted cost) keyed on the
transfer id, if the owner wants a vendor turnaround report. Not proposed now.

## 3. Scrap request for non-tyre stock (approval required)

Today the only governed route is audit -> discrepancy -> adjustment -> approval, because `inventory_adjustments`
requires an audit and a discrepancy. A direct `inv_post_movement('scrap')` exists but skips approval; the screens do
not call it.

```sql
create table public.inventory_scrap_requests (
  id              uuid primary key default gen_random_uuid(),
  organisation_id uuid not null default public.app_current_org(),
  country         text,
  site            text,
  stock_id        uuid not null references public.stock_records(id),
  qty             numeric not null check (qty > 0),
  reason          text not null check (length(btrim(reason)) between 5 and 1000),
  status          text not null default 'proposed' check (status in ('proposed','approved','rejected','posted','cancelled')),
  proposed_by     uuid not null default auth.uid(),
  proposed_at     timestamptz not null default now(),
  approval_request_id uuid,
  movement_id     uuid references public.stock_movements(id),
  posted_by       uuid,
  posted_at       timestamptz,
  idempotency_key text unique,
  constraint inventory_scrap_requests_sod check (posted_by is null or posted_by <> proposed_by)
);
alter table public.inventory_scrap_requests enable row level security;
-- same org (restrictive), country (restrictive select) and app_is_active read policies as equipment_custody; no direct writes.

alter table public.inventory_approval_requests drop constraint inventory_approval_requests_entity_type_check;
alter table public.inventory_approval_requests add constraint inventory_approval_requests_entity_type_check
  check (entity_type = any (array['stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation',
                                  'tyre_conflict_correction','stock_scrap']));
alter table public.inventory_approval_limits drop constraint inventory_approval_limits_entity_type_check;
alter table public.inventory_approval_limits add constraint inventory_approval_limits_entity_type_check
  check (entity_type = any (array['stock_adjustment','recount_assignment','opening_balance_batch','cost_reconciliation',
                                  'tyre_conflict_correction','stock_scrap']));
```

Functions (to write against the live bodies, not retyped from here):
- `inv_scrap_request(p_payload)`: checks qty <= available on hand, inserts the request, then calls
  `inv_request_approval` with `entity_type = 'stock_scrap'`, proposal `{qty}`.
- `inv_approver_roles('stock_scrap')`: same roles as `stock_adjustment`.
- `inv_request_approval`: add the `stock_scrap` branch to its entity lookup (read the live body first; extend by an
  anchored replace that aborts unless it matches once).
- `inv_scrap_post(p_payload)`: consumes the approval with `_inv_approval_consume('stock_scrap', id, proposal)`,
  refuses when the poster is the proposer, then posts `_inv_post` type `scrap` with `approval_ref` = the request id and
  the reason. The value leaves stock at its existing average cost; unvalued units leave as unvalued (never priced at 0).

The panel's `scrapProposal()` (src/lib/inventory/warehouseAssets.js) already validates the request it would send.

## 4. Financial reconciliation

No new object is required: the panel reads `v_inv_valuation`, `v_inv_erp_reconciliation` and receipt movements.
Two view points to review (not changed here):

1. `v_inv_erp_reconciliation` writes `coalesce(p.line_cost, 0)` for ERP lines. `line_cost` is never null today
   (0 nulls in the last 12 months; 124 KSA lines carry 0 cost), so no figure is wrong now, but a null cost would
   enter as zero. Proposed: carry `erp_unvalued_lines = count(*) filter (where p.line_cost is null)` and stop
   coalescing to 0.
2. Optional performance view for the site-month grain (the panel aggregates up to 20,000 item rows in the browser):

```sql
create or replace view public.v_inv_finance_site_month with (security_invoker = on) as
select organisation_id, country, site, month, currency,
       sum(erp_qty) erp_qty, sum(erp_value) erp_value, sum(erp_lines) erp_lines,
       sum(inventory_qty) inventory_qty, sum(inventory_value) inventory_value,
       sum(inventory_unvalued_qty) inventory_unvalued_qty, sum(inventory_movements) inventory_movements
  from public.v_inv_erp_reconciliation
 group by organisation_id, country, site, month, currency;
grant select on public.v_inv_finance_site_month to authenticated;
```
