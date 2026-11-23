# WP5: issue, return and transfer: database changes proposed (NOT applied)

Measured on the live database (project jhssdmeruxtrlqnwfksc), read-only, 2026-11-23.
Nothing below has been run. Each item states the evidence, then the exact SQL.
Apply only on the owner's yes, inside a transaction, with the verify step.

---

## 1. Site-scoped people cannot dispatch to, or return from, another site

**Evidence.** `_inv_transfer_dispatch` posts two legs: `transfer_out` from the source balance and `transfer_in`
into an `IN-TRANSIT` location that `_inv_transit_location(org, to.country, to.site)` creates **at the destination
site**. Every leg goes through `_inv_post`, which always runs
`if not public._inv_scope_ok(v_rec.country, v_rec.site) then raise 'This stock is outside your country or site scope.'`
(regardless of `p_check_cap`). So a Store Keeper scoped to `DEMO YARD, DEMO PLANT` (two such live profiles) who
dispatches to `NHC` is refused on the in-transit leg; the whole transaction rolls back, nothing posts. The same
person cannot return a transfer to their own site either: `_inv_transfer_move(…, 'return')` posts `transfer_out`
from the in-transit balance at the destination site. Only `receive` is explicitly scope-checked against the
destination, which is correct.

The client now warns before dispatching (`crossSiteOutOfScope` in `src/lib/inventory/stockFlowRules.js`); the
server stays the authority.

**Proposed fix.** Let the two internal transit legs through the scope check, and nothing else. The caller's scope
is still enforced on the side they act on: dispatch already checks the source location
(`_inv_scope_ok(v_from.country, v_from.site)`), receive checks the destination. Return needs a source check added.

```sql
begin;

-- 1a. _inv_post: skip the scope check only for a leg on an IN-TRANSIT location posted by a transfer RPC.
--     Anchored replace on the live body; aborts unless the anchor occurs exactly once.
do $$
declare v_def text; v_old text; v_new text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_post(jsonb,boolean)'::regprocedure);
  v_old := 'if not public._inv_scope_ok(v_rec.country, v_rec.site) then';
  v_new := 'if not public._inv_scope_ok(v_rec.country, v_rec.site)'
        || ' and not (coalesce(current_setting(''inv.transfer_leg'', true), '''') = ''on'''
        || ' and exists (select 1 from public.inventory_locations tl where tl.id = v_rec.location_id and tl.code = ''IN-TRANSIT'')) then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'anchor found % times in _inv_post, expected 1', v_n; end if;
  execute replace(v_def, v_old, v_new);
end $$;

-- 1b. _inv_transfer_dispatch: set the flag around the in-transit leg only.
do $$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_transfer_dispatch(jsonb)'::regprocedure);
  v_old := '    v_in := public._inv_post(jsonb_build_object(''idempotency_key'', ''trf:'' || v_key || '':'' || v_n || '':transit''';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'dispatch anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, '    perform set_config(''inv.transfer_leg'', ''on'', true);' || chr(10) || v_old);
  v_old := '    insert into public.stock_transfer_lines(';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'dispatch line anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, '    perform set_config(''inv.transfer_leg'', '''', true);' || chr(10) || v_old);
  execute v_def;
end $$;

-- 1c. _inv_transfer_move: return must be checked against the SOURCE; flag the transit leg.
do $$
declare v_def text; v_old text; v_n int;
begin
  v_def := pg_get_functiondef('public._inv_transfer_move(jsonb,text)'::regprocedure);
  v_old := '  if p_mode = ''receive'' and not public._inv_scope_ok(v_t.country, v_t.to_site) then';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'move scope anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old,
    '  if p_mode = ''return'' and not public._inv_scope_ok(v_t.country, v_t.site) then' || chr(10)
    || '    raise exception ''The source is outside your scope.'' using errcode = ''42501'';' || chr(10)
    || '  end if;' || chr(10) || v_old);
  v_old := '    v_out := public._inv_post(jsonb_build_object(''idempotency_key'', ''trf:'' || v_key || '':'' || ln.id || '':out''';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'move out anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, '    perform set_config(''inv.transfer_leg'', ''on'', true);' || chr(10) || v_old);
  v_old := '    v_in := public._inv_post(jsonb_build_object(''idempotency_key'', ''trf:'' || v_key || '':'' || ln.id || '':in''';
  v_n := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_n <> 1 then raise exception 'move in anchor found % times', v_n; end if;
  v_def := replace(v_def, v_old, '    perform set_config(''inv.transfer_leg'', '''', true);' || chr(10) || v_old);
  execute v_def;
end $$;

commit;
```

**Verify (rolled back).** Impersonate `d3c61ee2-…` (Store Keeper, `DEMO YARD, DEMO PLANT`): dispatch DEMO YARD to
another site posts both legs; receiving at that other site is refused (`The destination is outside your scope.`);
returning it posts both legs; a direct `inv_post_movement` on any IN-TRANSIT balance is still refused (flag unset).
Also check `_inv_transfer_return_remaining`'s reservation-release loop: its `_inv_post` 'release' call on the transit
balance needs the same flag (wrap it with `set_config('inv.transfer_leg','on',true)` / `''`).

Rollback: re-run `create or replace` from the three bodies saved with `pg_get_functiondef` before applying.

---

## 2. An in-app material issue slip never moves stock

**Evidence.** `material_issues` / `material_issue_lines` carry only the mint-number, doc-type and site triggers.
No trigger and no RPC posts a slip line to `stock_movements`; lines carry `item_code`, not a balance. Saving an MIS
does not take stock off the shelf and an MRT does not put it back. The page now says so in one sentence and points to
Stock > Receiving (Issue stock / Return to stock), which post through `inv_issue` / `inv_post_movement`.

Also: the write policy is `app_is_elevated() OR app_user_can('stock','edit')`. Store Keeper has `issue`, `transfer`,
`receive` but **not** `edit` (tested by impersonation), so the people who issue parts cannot raise the slip.

**Proposed fix.** Give each slip line an optional balance and its posting, and one RPC that posts a slip's lines
atomically through the existing `_inv_issue` / `_inv_post`.

```sql
begin;

alter table public.material_issue_lines
  add column if not exists stock_id uuid references public.stock_records(id),
  add column if not exists movement_id uuid references public.stock_movements(id);

create or replace function public.inv_issue_slip(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_org uuid := public.app_current_org(); v_key text := nullif(btrim(p_payload->>'idempotency_key'), '');
  v_h public.material_issues%rowtype; ln public.material_issue_lines%rowtype; v_post jsonb; v_n int := 0;
begin
  if not public.is_approved_and_unlocked() or not public.inv_can('issue') then
    raise exception 'Stock permission "issue" is required.' using errcode = '42501';
  end if;
  if v_key is null then raise exception 'An idempotency_key is required.' using errcode = '22023'; end if;
  select * into v_h from public.material_issues where id = (p_payload->>'issue_id')::uuid and organisation_id = v_org for update;
  if not found then raise exception 'Slip not found.' using errcode = 'P0002'; end if;
  if v_h.status <> 'issued' then raise exception 'Only an issued slip posts stock (this one is %).', v_h.status using errcode = '22023'; end if;
  for ln in select * from public.material_issue_lines where issue_id = v_h.id and stock_id is not null and movement_id is null
            order by line_no for update loop
    v_n := v_n + 1;
    if v_h.doc_type = 'MIS' then
      v_post := public._inv_issue(jsonb_build_object('idempotency_key', v_key || ':' || ln.id, 'stock_id', ln.stock_id,
        'qty', ln.qty, 'reference_no', v_h.issue_number, 'source_doc_type', 'material_issue', 'source_doc_id', v_h.id::text,
        'reason', coalesce(v_h.work_order_no, v_h.notes)));
    else
      v_post := public._inv_post(jsonb_build_object('idempotency_key', 'mrt:' || v_key || ':' || ln.id, 'stock_id', ln.stock_id,
        'movement_type', 'issue_return', 'qty_change', ln.qty, 'reference_no', v_h.issue_number,
        'source_doc_type', 'material_issue', 'source_doc_id', v_h.id::text, 'reason', coalesce(v_h.work_order_no, v_h.notes)), true);
    end if;
    if v_post->>'status' = 'refused_shortage' then
      raise exception 'Line %: not enough stock to issue.', ln.line_no using errcode = '23514';
    end if;
    update public.material_issue_lines set movement_id = (v_post->>'movement_id')::uuid where id = ln.id;
  end loop;
  return jsonb_build_object('issue_id', v_h.id, 'posted_lines', v_n);
end $$;

revoke all on function public.inv_issue_slip(jsonb) from public, anon;
grant execute on function public.inv_issue_slip(jsonb) to authenticated, service_role;

-- Let the people who issue stock raise the slip (country/site write policies stay as they are).
drop policy if exists material_issues_write on public.material_issues;
create policy material_issues_write on public.material_issues for all to public
  using (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'))
  with check (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'));
drop policy if exists material_issue_lines_write on public.material_issue_lines;
create policy material_issue_lines_write on public.material_issue_lines for all to public
  using (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'))
  with check (app_is_elevated() or app_user_can('stock','edit') or app_user_can('stock','issue'));

commit;
```

Then the client (`createMaterialIssue`) adds a balance picker per line and calls `inv_issue_slip` after saving.
Not done in code yet because the column and RPC do not exist.

---

## 3. Asset on an issue

`stock_movements` has no asset column. The issue form now records the job card as the source document
(`source_doc_type = 'job_card'`, `source_doc_id = <number>`), so the asset is reachable through `work_orders`
(`work_order_no` -> `asset_no`). No column is proposed; a read-only view is enough:

```sql
create or replace view public.v_inv_issue_job_link with (security_invoker = on) as
select m.id as movement_id, m.movement_type, m.qty_change, m.site, m.country, m.posted_at,
       m.source_doc_id as work_order_no, w.asset_no, w.id as work_order_id
  from public.stock_movements m
  left join lateral (select w.id, w.asset_no from public.work_orders w
                      where w.work_order_no = m.source_doc_id and w.organisation_id = m.organisation_id limit 1) w on true
 where m.source_doc_type = 'job_card';
grant select on public.v_inv_issue_job_link to authenticated;
```

---

## 4. Lower priority

- `work_order_stock_reservations`: read policy is org-only (no country/site). It has no country/site column; scope it
  through `work_orders` if it ever holds rows (0 rows today; `stock_reservations` is correctly scoped).
- `stock_movements` has no permissive INSERT policy and an append-only guard, so a direct client insert is refused.
  `src/pages/StockManagement.jsx` (owned by another agent, around line 383) still calls `stock.insertStockMovement`
  for its "Initial" / manual-edit audit row; it is refused on every run and the error is swallowed (`catch {}`), so no
  ledger row is written. Its `insertStockRecord` with a non-zero `stock_qty` is also refused by `inv_balance_guard`
  ("Stock quantity can only be set by a posted movement"). Both should go through `inv_post_movement`. No DB change:
  refusing them is correct.
