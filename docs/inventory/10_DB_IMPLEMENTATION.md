# 10 - Inventory database implementation (DB lane)

Status: **AUTHORED, NOT APPLIED.** Nothing in this document has touched production.
Production (project `jhssdmeruxtrlqnwfksc`) was only read, with catalog SELECTs, to copy
live signatures, defaults, ACLs and to confirm that every column these migrations add is
absent today. All behaviour below is proven in PGlite against a live-shaped platform
(`supabase/tests/inventory_harness.test.mjs`).

Binding contract: `07_APPROVED_REQUIREMENTS_AND_BUILD_CONTRACT.md`. Engine mirrors:
`20_VALUATION_RULES.md` (src/lib/inventory/valuation.js) and
`24_TYRE_CUSTODY_ENGINE.md` (src/lib/inventory/tyreCustody.js).

## 1. Files and apply order

Apply in this order, each one its own transaction (all live in `supabase/pending_migrations/`):

| # | File | What it does |
|---|---|---|
| 1 | `20261120100000_inv_p0_ledger_integrity.sql` | Rollback snapshot; `stock_records` = the one balance; append-only valued `stock_movements`; `stock_exceptions`; `_inv_post` (the only balance writer); legacy writers become wrappers; write gates on goods_receipts / requisitions / suppliers / purchase_orders / materials; `po_number` unique per company |
| 2 | `20261120101000_inv_item_master_locations.sql` | material_master stocking fields, aliases, governed master reviews, `inventory_locations` (`TP:LOC:` labels), opening-balance batches (preparer != approver) |
| 3 | `20261120102000_inv_physical_audits.sql` | Audits, snapshot by `movement_seq`, blind enforcement (RLS + RPC), count lines, cutoff reconciliation, recount, discrepancies (12 web categories), adjustments posted through the ledger |
| 4 | `20261120103000_inv_transfers_procurement.sql` | Transfers via an IN-TRANSIT location (partial receive / return), reservations, issue, PO and GRN lines, supplier invoices with three-way match (no accounting postings), supplier agreements, consignment |
| 5 | `20261120104000_inv_valuation.sql` | `v_inventory_valuation`, `inv_valuation_summary` (per currency; owned value NULL while unvalued stock exists) |
| 6 | `20261120105000_inv_tyre_items.sql` | `tyre_items`, `tyre_item_events`, `tyre_custody_conflicts`, store holdings, dispositions; derivation from tyre_records/tyre_status_marks; scrap guard that flags, never blocks |
| 7 | `20261120106000_inv_oem_fitments.sql` | `oem_part_references`, `equipment_fitments`, engineering approval, `v_validated_compatibility` |
| 8 | `20261120107000_inv_api_contract.sql` | The client contract: one `p_payload jsonb` per write, idempotency store, web-named read views |

Every new table ends with `anum_integration.apply_reader_policies()` guarded by
`to_regprocedure(...) is not null`. Every SECURITY DEFINER function pins `search_path`;
anon has no execute or table grant on anything inventory.

**Before applying on production:** take the Supabase backup, apply on staging
(`/var/lib/postgresql/tp-staging`, port 54329) first, and keep each file in its own
apply (the 2026-11-15 rollout hit "out of shared memory" with large combined batches).
P0 needs `stock_movements.organisation_id` to be non-null on every legacy row to set
NOT NULL; if not, it leaves it nullable with a NOTICE.

## 2. Rollback

Every file has a `_ROLLBACK.sql`. Run them in REVERSE order (107000 first, 100000 last).

* P0 copies every object it replaces into `_bak.inv_p0_snapshot` at apply time, from the
  catalog (`pg_get_functiondef`, `pg_policies`, `pg_get_constraintdef`, `pg_get_viewdef`,
  function ACLs, client table grants, `organisation_id` nullability). The P0 rollback
  executes those captured definitions; nothing is retyped by hand.
* Restored by P0 rollback: `post_stock_movement`, `set_stock_count`, `save_stock_entry`,
  `transfer_stock_entry`, `private.reserve/release_work_order_stock_internal` (bodies and
  ACLs), every policy on the eight touched tables, the `stock_movements -> stock_records`
  FK **with ON DELETE CASCADE**, the global `purchase_orders_po_number_key`, the
  reservation-lines FK back to `stock`, `v_stock_balance_reconcile`, client grants.
* Data safety: each rollback REFUSES when its records exist (audits, transfers, opening
  batches, locations, tyre decisions, compatibility, or any movement posted through the
  new ledger) unless the operator sets `set local inv.rollback_discard = 'on'` after
  exporting. Ledger ROWS are never deleted by rollback; only the new columns go.
* Deliberately not reverted: `stock_movements.qty_*` stay `numeric` (narrowing back to
  integer could fail on a fractional count; numeric is a superset for every reader).
  A constraint that legacy rows no longer satisfy comes back `NOT VALID` with a NOTICE;
  a unique key with cross-company duplicates is left off with a NOTICE.
* Proven: `inventory_rollback.test.mjs` applies all eight, rolls all eight back and
  compares a catalog fingerprint (function bodies + ACLs, every policy, every
  constraint, columns of the touched tables, grants, relations, triggers, indexes) with
  the pre-migration database: **identical**. It also proves apply -> rollback -> apply
  is clean and that the refusals fire.

## 3. Client contract (decision, and who changes)

**One shape. The web shape wins.**

* Every `inv_*` WRITE takes exactly one argument `p_payload jsonb` with
  `idempotency_key` inside. Same key + same payload -> the stored result plus
  `replayed: true`. Same key + different payload or different function -> `23505`.
  Missing key -> `22023`. Store: `inventory_rpc_requests` (org + key PK, read only by
  the actor). The ledger itself is additionally keyed on `stock_movements.idempotency_key`.
* Exception: `inv_count_submit` lines are idempotent per `client_uuid`, so its outer key
  is optional (offline queues replay lines, not calls).
* A write that creates one thing answers `{ "id": "<uuid>" }`.
* Reads that take an id use `p_audit_id` (`inv_audit_counter_view`). Its answer carries
  Flutter's `{audit, locations, items, submitted}` and web's `lines` (= `items`). No
  expected quantity, serial expectation or cost is ever in it (tested).
* The positional implementations are renamed `_inv_*` and are not executable by
  `authenticated` or `anon` (tested by catalog scan).

**Flutter lane must change one call** (`inventory_audit_repository.dart` and
`tyre_pulse_flutter/docs/inventory_reserved_patch.md` row `inv_count_submit`):
`inv_count_submit(p_audit_id, p_device_id, p_lines)` becomes
`inv_count_submit(p_payload: {audit_id, device_id, lines})`. Line fields and the
`{accepted, duplicates, rejected}` answer are unchanged. Counter view, transfer dispatch
and transfer receive already match. Count photos stay in the private bucket
`tyre-photos` under `inventory_count/...`; the server stores the refs in
`inventory_count_lines.photos` and does not read the bucket.

**Web lane must change its list reads** (`src/lib/api/inventory.js`): the columns it
selects (item_code, location_code, serial_no, category, proposed_qty, ...) are not base
table columns. Read these views instead (exact web column names, `security_invoker`,
money NULL without `stock:view_value`, blind-count and org/country/site policies of the
base tables still apply):

| Web reads today | Read instead |
|---|---|
| `stock_records` (BALANCE_COLS) | `v_inv_balances` (+ valued_qty, unvalued_qty, valuation_status) |
| `stock_movements` (MOVEMENT_COLS) | `v_inv_movements` |
| `inventory_discrepancies` | `v_inv_discrepancies` |
| `inventory_adjustments` | `v_inv_adjustments` |
| `opening_balance_batches` / `_lines` | `v_inv_opening_batches` / `v_inv_opening_lines` |
| `material_master_reviews` | `v_inv_master_reviews` |
| `tyre_items` / `tyre_custody_conflicts` | `v_inv_tyre_items` / `v_inv_custody_conflicts` |
| supplier agreements / PO / GRN lines | `v_inv_supplier_agreements`, `v_inv_po_lines`, `v_inv_grn_lines` |

`inventory_audits` and `inventory_locations` already match AUDIT_COLS / LOCATION_COLS.
Other web assumptions confirmed as built: `inv_location_upsert(p_payload)`,
`inv_audit_close` with `{cancel:true, reason}`, `inv_opening_batch_approve`,
`inv_recount_assign` with the web `line_keys` (`location_id|item_id|serial`) or
`discrepancy_ids`, discrepancy `category` / `proposed_qty` / `proposed_action`.
One difference: `inv_adjustment_approve` accepts `approve | reject | hold`; `recount` is
refused with a message pointing to `inv_recount_assign` (a recount needs a named
counter, which the approval call does not carry).

## 4. RPC reference (client surface; all take `p_payload jsonb` unless stated)

Ledger: `inv_post_movement {idempotency_key, stock_id | item_id+location_id, movement_type,
qty_change, unit_cost?, currency?, condition?, ownership?, reason, source_doc_type?,
source_doc_id?}` -> `{status:'posted', movement_id, stock_id, ...}` or
`{status:'refused_shortage', exception_id}`; `inv_reverse_movement {movement_id, reason}`;
`inv_exception_resolve {exception_id, status, notes}`.
Master / locations: `inv_location_upsert`, `inv_master_review_submit`,
`inv_master_review_decide {review_id, decision, note}`.
Opening: `inv_opening_batch_create {source, source_filename, site, country, lines[]}`
(item_code / location_code resolved; unresolved lines -> needs_review with raw codes
kept; `source:'legacy_stock_records'` seeds from legacy balances),
`inv_opening_line_map {line_id, ...}`, `inv_opening_batch_submit {batch_id}`,
`inv_opening_batch_decide` = `inv_opening_batch_approve {batch_id, decision, note}`.
Audits: `inv_audit_create`, `inv_audit_schedule {audit_id, due_at?, counter_id?}`,
`inv_audit_start`, `inv_audit_counter_view(p_audit_id uuid default null)`,
`inv_count_submit`, `inv_audit_complete_counting`, `inv_audit_reconcile`,
`inv_recount_assign`, `inv_discrepancy_update`, `inv_adjustment_approve`,
`inv_audit_close`, `inv_audit_cancel`.
Stock flows: `inv_transfer_dispatch`, `inv_transfer_receive`,
`inv_transfer_return_remaining`, `inv_reserve`, `inv_release {reservation_id, qty?}`,
`inv_issue`, `inv_po_add_line {po_id, ...}`, `inv_receive_goods`,
`inv_supplier_invoice_create`, `inv_supplier_invoice_match {invoice_id}` (answers
`posting:'none'`), `inv_supplier_agreement_upsert`.
Valuation: `inv_valuation_summary(p_country text default null)` (read).
Tyres: `inv_tyre_item_sync {country?}` (no key needed; a derivation is repeatable),
`inv_tyre_store_holding`, `inv_tyre_disposition_record {serial_no, country, state, reason}`,
`inv_tyre_conflict_decide {conflict_id, status, note}`.
Compatibility: `inv_compat_propose {kind:'oem'|'fitment', ..., source, evidence[]}`,
`inv_compat_decide {kind, id, decision, note}`.
Legacy wrappers keep their live signatures and ACLs: `post_stock_movement`,
`set_stock_count`, `save_stock_entry`, `transfer_stock_entry`,
`reserve/release_work_order_stock`.

## 5. Rules as built

* No negative stock, no override. A shortage posts nothing and writes a
  `stock_exceptions` row (`refused_shortage`); legacy wrappers raise 23514.
* WAC mirrors valuation.js: `valued_qty / valued_value / unvalued_qty` buckets; unpriced
  units are never valued at 0 and leave FIRST on issue; value-only movements
  (landed_cost, supplier_credit, cost_assignment) change value, not quantity; a reversal
  is the exact negation; a residual or negative value becomes a recorded variance.
  Currencies never mix in one balance or one total.
* Consignment stock is excluded from owned value and shown at the agreed price.
* Tyres are valued at their own purchase cost (the first priced fitment row or the store
  holding), never an average. `parts_consumption` is never read or written by any
  inventory object.
* Blind count: `inv_blind_hides_balance` drives restrictive SELECT policies on
  stock_records, stock_movements, stock_exceptions, opening_balance_lines and tyre_items;
  `_inv_audit_can_see_expected` gates snapshot lines, discrepancies, adjustments and count
  lines; `_inv_post` and the legacy writers refuse the counter on in-scope balances.
  The leak test scans EVERY selectable relation (tables and the new views) as the
  counter and the recount counter: zero hits.
* Segregation: counter != reviewer / approver (CHECK + RPC); recount by a different
  person who has not counted (max 3 rounds); adjustment approver != creator, counters or
  proposer; opening-balance approver != preparer; master-review and compatibility
  approver != proposer.
* Cutoff: expected = snapshot + movements with `movement_seq > cutoff_seq` and
  `posted_at <= counted_at`; late offline lines are accepted only when
  `counted_at <= counting_completed_at`.
* Tyre custody: derived, read-only (the test hashes tyre_records before and after:
  identical). Conflicts (scrapped_but_active, fitted_and_in_stock, serial_on_two_assets)
  carry evidence and are closed only by a person with a reason; nothing is auto-corrected.
  The scrap guard on tyre_records flags and never blocks, and swallows its own errors.

## 6. Test results (PGlite, synthetic data)

`node --test --test-concurrency=1 supabase/tests/inventory_*.test.mjs`
**45 passing, 0 failing, ~55 s** (node:test count, subtests included).

| File | Covers |
|---|---|
| `inventory_harness.test.mjs` | all eight migrations apply over the live-shaped platform |
| `inventory_ledger.test.mjs` | WAC maths, unvalued-first, negative refused -> exception, idempotent retries / key reuse, reversal (once, exact), immutable ledger (UPDATE/DELETE/TRUNCATE), direct writes refused, cross-company isolation, country/site scope, legacy wrappers incl. reservations on stock_records |
| `inventory_audits.test.mjs` | blind enforcement via every endpoint, cutoff reconciliation (real numbers: expected 4, counted 3, value -20), late offline counts, recount by another person (web line_keys form), approver != counter, adjustment posted through the ledger, close rules |
| `inventory_flows.test.mjs` | partial transfer + return, reservations, consignment value, value-only movements, GRN + three-way match, opening balances, master review |
| `inventory_tyres.test.mjs` | custody derivation and conflicts with evidence, read-only proof, dispositions, scrap guard flags without blocking, OEM/fitment approval by someone else |
| `inventory_api.test.mjs` | payload contract, replay / reuse / missing key, internals closed to clients, views mask money and respect blind count, counter view `lines` |
| `inventory_rollback.test.mjs` | exact catalog restore, refusals, apply -> rollback -> apply |

**Not proven:** true concurrency. PGlite is a single connection, so two simultaneous
posts cannot race there. The design relies on `select ... for update` of the balance row,
a version bump, and `pg_advisory_xact_lock(org + idempotency_key)`; run the concurrent
post / double-submit check on the staging cluster before production.

## 7. Decisions and open items for the owner

* **Capability extensions** beyond the contract list: `stock:procure` (suppliers, POs,
  PO lines, agreements) and `stock:engineering_approve` (compatibility). Admin/Manager/
  Director pass through `app_is_elevated()` where the contract says so; others need the
  capability granted in Access Control.
* **Variance types** (`shortage, excess, unexpected_item, not_counted, missing_serial,
  unexpected_serial, condition_mismatch`) are provisional and separate from the 12 root
  causes.
* Deferred, not built: reconciliation view of inventory value against the ERP expense
  grid; integration with `approval_policies` (approvals here are built-in role/capability
  checks); accounting postings from the three-way match (it records a match only).
* `materials` is frozen read-only and `stock` (legacy, empty) is retired from writes;
  `material_master` is the one item master and `stock_records` the one balance.
