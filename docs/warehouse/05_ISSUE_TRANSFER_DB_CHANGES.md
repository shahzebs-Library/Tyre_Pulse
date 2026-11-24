# WP5: issue, return and transfer: database changes proposed (NOT applied)

Measured on the live database (project jhssdmeruxtrlqnwfksc), read-only, 2026-11-23.
Nothing below is applied. The SQL lives in the migration file named in section 0.
Apply only on the owner's yes, inside a transaction, with the verify step.

---

## 0. Status

All of sections 1, 2 and 2b are written as ONE reviewed migration:
`supabase/migrations/20261124091000_wms_wp5_transfer_scope_issue_slip.sql`. **Not applied** (the owner has not
approved it). It was proven on the live database on 2026-11-24 inside transactions forced to roll back (a `DO`
block that ends with `raise exception`, plus a trailing `select 1/0`); afterwards none of its objects existed and
every balance was unchanged. The file header carries the verify query and the undo SQL. The client already
detects the posting function and keeps today's "document only" behaviour until it exists.

---

## 1. Site-scoped people cannot dispatch to, or return from, another site

**Evidence.** `_inv_transfer_dispatch` posts `transfer_out` from the source and `transfer_in` into an
`IN-TRANSIT` location that `_inv_transit_location` creates **at the destination site**. Every leg goes through
`_inv_post`, which always checks `_inv_scope_ok(country, site)`. Measured before the change: Demo Store Keeper B
(sites DEMO YARD, DEMO PLANT) dispatching to another site -> `42501 This stock is outside your country or site scope.`
Return-to-source had no source-scope check at all.

**Design (no session flag).** The first proposal (a `inv.transfer_leg` setting checked inside `_inv_post`) was
replaced. A client cannot run `set_config` through PostgREST today, but a security boundary should not depend on
that. The exemption is now a function **argument**:

- `_inv_post(p, p_check_cap, p_transit_leg)` holds the ledger body (built from the live body by anchored
  replacement). `p_transit_leg` skips the scope check only when the balance / location is an `IN-TRANSIT`
  location (`code = 'IN-TRANSIT'`, `location_type = 'in_transit'`) of the caller's organisation, and only for
  `transfer_in`, `transfer_out` and `release`.
- `_inv_post(p, p_check_cap)` is a wrapper passing `false`, so the ~20 existing callers keep the full check.
- Both forms are SECURITY DEFINER and **not executable by anon or authenticated**. Only the transfer functions pass
  `true`, and they pick the balance themselves (transit location, transfer line), never from the payload.
- Dispatch: only the in-transit leg is exempt; the caller must still be in scope for the SOURCE.
- Receive: unchanged; the receiver must be in scope for the DESTINATION.
- Return: new check, the caller must be in scope for the SOURCE (in `_inv_transfer_move` and, before anything
  posts, in `_inv_transfer_return_remaining`); only the out-of-transit leg and the reservation release on the
  transit balance are exempt.

## 2. A material issue slip now moves stock (`inv_issue_slip`)

- `material_issue_lines.stock_id` (chosen by the user) and `movement_id` (written only by the server: excluded from
  the column grants of `authenticated`, insert and update).
- `inv_issue_slip({ issue_id })`: posts every unposted line of an **issued** slip in one transaction. MIS through
  `_inv_issue`, MRT as `issue_return` through `_inv_post` with the `issue` capability. Checks, server-side: approved
  user, `stock:issue`, slip in the caller's org, slip country/site in the caller's scope, each line's stock in the
  same org, country and site as the slip, line code = stock item code. Identity comes from `auth.uid()`; nothing
  from the client except the slip id.
- **Idempotent**: a line with a movement is skipped; the header row lock serialises two concurrent posts. The keys
  `slip:` / `iss:slip:` are reserved (refused from `inv_issue` / `inv_post_movement`).
- **No negative stock**: a shortage raises `23514 Line N: not enough stock (A available, B asked).` and the whole
  slip rolls back (nothing posts, the line keeps no movement).
- Source document: the job card when the slip names one (`source_doc_type = 'job_card'`, same as Stock > Issue),
  else `material_issue` / slip id. An MRT must name the job card.
- Posted lines and slips are frozen by triggers: no edit of qty / stock / code, no delete, no cancel, no change of
  type, site, job card or number.
- The write policies also admit `app_user_can('stock','issue')`, so Store Keepers (issue, no edit) can raise a
  slip. The RESTRICTIVE org / country / site write policies are unchanged.

## 2b. Defects from the live acceptance test (folded into the same migration)

| Ref | Defect (measured) | Fix |
|---|---|---|
| D3 | `inv_post_movement` accepted a bare `receipt` (+7, no GRN/PO/supplier) from a Store Keeper | `receipt` / `consignment_receipt` refused unless `app_is_org_admin()`; goods arrive through `inv_receive_goods` |
| D3+ | `post_stock_movement` (legacy, every approved user) checked **no capability**: a Reporter issued 1 and received +9 | receipt as D3; every other type needs `_inv_cap_for(type)`, except `adjustment_up/down` (phone count screens; owner decision) |
| D4 | `issue_return` unbounded (+50 against 3 issued); `return` type the same | a return must name its source document; bounded per stock line by issued minus already returned (reversals excluded) |
| D4 value | a return without cost took the current average | value = issued cost when every matching issue was fully valued, else **unvalued**; the client's `unit_cost` is ignored (docs/inventory/20, valuation.js and `returnIssuedStock` now agree) |
| D6 | retry of a reservation-backed issue -> "key already used for a different posting" | `_inv_issue` answers from the ledger first; a different stock or qty on the same key is still refused |
| D7 | slip lines accepted any code and qty | a line needs a material-master code of the slip's org and country, or a stock line (its code is stamped in); qty > 0 |

## Proof (rolled back, 2026-11-24)

Users: Demo Store Keeper B `d3c61ee2…` (DEMO YARD, DEMO PLANT), Demo Store Keeper A `31362945…` narrowed inside the
transaction to `DEMO OTHER`, owner super admin `d2d43a5f…`, Store Keeper MD JAHID `69faeb71…` (KSA, all sites),
Reporter `33e40d9c…`. A test location `DEMO-OTH-WH` at site `DEMO OTHER` was created inside the transaction.

| Case | Result |
|---|---|
| B dispatches 2 DEMO YARD -> DEMO OTHER | allowed; source 17 -> 15, transit 2 at DEMO OTHER |
| B `set_config('inv.transfer_leg'/'inv.posting'/'inv.owner_override','on')` then `inv_post_movement` transfer_out / issue on that transit balance | refused 42501 scope |
| B calls `_inv_post(p,false,true)`, `_inv_transfer_move`, `_inv_issue_slip` directly | refused 42501 permission denied |
| B receives at DEMO OTHER | refused 42501 destination |
| B ordinary in-scope issue (2-argument path) | allowed (regression check) |
| A (DEMO OTHER only): return to source / dispatch from DEMO YARD / receive 1 | refused / refused / allowed |
| B returns the remaining 1 | allowed; source 16, transit 0, transfer completed |
| B raises an MIS slip (issue, no edit) and posts 3 | allowed; stock 10 -> 7 |
| Same slip posted again | posted 0, already 1, stock 7 |
| B inserts a line with `movement_id`, or rewrites it | refused 42501 (column grant) |
| B edits / deletes a posted line, cancels / deletes the slip | refused 42501 (triggers) |
| Shortage: MIS 50 on 7 | refused 23514, stock 7 |
| MIS 3 on a job card, MRT 2 on it | stock 7 -> 4 -> 6; return valued at the issued cost (90.00 = 2 x 45) |
| MRT 5 with 1 still out / MRT without job card | refused 23514 / 22023 |
| Line stock at another site than the slip; slip at an out-of-scope site | refused 22023 / 42501 |
| D3 bare receipt (both RPCs) as B; owner receipt | refused 42501; owner allowed |
| D4 return 50 vs 3; return 2 with `unit_cost 999`; 2 more; no document; `return` type on a never-issued card | refused; allowed at 45.00 each; refused; refused; refused |
| D6 retry of a reservation issue; same key other qty | replayed, qty unchanged; refused 23505 |
| D7 unknown code qty 99999; qty 0; description only; code differs from stock line; stock line with blank code | refused; refused; refused; refused; allowed, code stamped |
| Reporter posts a slip / issues via `post_stock_movement` | refused 42501 |
| Owner and MD JAHID post MIS at AMAALA | allowed (5 -> 3 -> 2) |

Afterwards: `_inv_post(jsonb,boolean,boolean)` and `inv_issue_slip` absent, backup table absent, no test location,
Keeper A's sites unchanged, balances unchanged. Only the slip-number sequence advanced (sequences do not roll back).

## Open (owner decisions)

- `post_stock_movement` `adjustment_up` / `adjustment_down` still need no capability (the Expo and Flutter count
  screens use them): any approved user in scope can adjust a balance.
- Stock quick entry (`save_stock_entry`, "New delivery") still posts a receipt without a GRN (needs stock edit or
  create and a reference).
- A return goes back to the stock line it was issued from; returning to another condition / location is refused.
- After applying, `crossSiteOutOfScope(..., { transitExempt: true })` stops the client warning on dispatch.

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
