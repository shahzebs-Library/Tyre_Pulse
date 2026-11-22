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
| 5 | `20261120104000_inv_valuation.sql` | Owner valuation rule 2026-11-20: `inventory_cost_reconciliations` (one open record per unvalued unit), real `_inv_cost_rec_track` hook, legacy unvalued balances seeded as `legacy` records, finance view `v_inv_valuation`, `v_inv_cost_reconciliations`, `v_inventory_valuation`, `inv_valuation_summary` (+ `valuation_complete`, `open_reconciliations`) |
| 6 | `20261120105000_inv_tyre_items.sql` | `tyre_items`, `tyre_item_events`, `tyre_custody_conflicts`, store holdings, dispositions; derivation from tyre_records/tyre_status_marks; scrap guard that flags, never blocks |
| 7 | `20261120106000_inv_oem_fitments.sql` | `oem_part_references`, `equipment_fitments`, engineering approval, `v_validated_compatibility` |
| 8 | `20261120107000_inv_api_contract.sql` | The client contract: one `p_payload jsonb` per write, idempotency store, web-named read views |
| 9 | `20261120108000_inv_approvals.sql` | Mandatory approvals through the EXISTING `approval_policies` engine (entity_type CHECK widened, `approval_private.resolve` routing), `inventory_approval_requests` + append-only `inventory_approval_decisions`, `inv_request_approval`, `inv_approval_decide`, `v_inv_pending_approvals`, DB gates on adjustment posting / opening approval / recount assignment, `inv_cost_reconcile`, separation-of-duties CHECKs |
| 10 | `20261120109000_inv_erp_reconciliation.sql` | Read-only `v_inv_erp_reconciliation` (inventory issues vs parts_consumption + material_issues not already in it) |
| 11 | `20261120110000_inv_metric_catalogue.sql` | Seeds the 25 KPIs of `src/lib/inventory/kpi.js` into `metric_registry` + `metric_versions` (status draft, lineage_domain NULL, insert-only) |
| 12 | `20261120111000_inv_report_schedules.sql` | `report_schedules.report_type` allows `inventory`; read-only digest view `v_inv_report_snapshot` |
| 13 | `20261120112000_inv_source_receipt.sql` | `inv_issue` / `inv_transfer_dispatch` forward `source_receipt_movement_id` (fingerprinted in-place patch); `v_inv_receipt_sources` |
| 14 | `20261120113000_inv_approval_roles.sql` | Inventory Controller + Finance Manager added to `custom_roles`; `inv_approver_roles`; live `approval_private.validate_policy` patched in place (fingerprint b76c1c97) for `inventory_%` stages; `inventory_approval_limits` + `inv_approval_limit_upsert`; `_inv_approval_extra_block` (Store Keeper refusal, role list, thresholds) called by `_inv_approval_block_reason` |
| 15 | `20261120114000_inv_tyre_conflict_investigation.sql` | Investigation fields on `tyre_custody_conflicts`; `inv_tyre_conflict_assign / _investigate / _propose / _close`; entity type `tyre_conflict_correction` in the approval engine (PMV Manager only); `v_inv_tyre_conflict_cases`; direct decide refused for scrapped_but_active |
| 16 | `20261120115000_inv_hardening.sql` | The four pure helpers revoked from PUBLIC / anon; `inv_lifecycle_guard` (status graph, terminal rows immutable, no DELETE) on cost reconciliations, approval requests and custody conflicts |

Every new table ends with `anum_integration.apply_reader_policies()` guarded by
`to_regprocedure(...) is not null`. Every SECURITY DEFINER function pins `search_path`;
anon has no execute or table grant on anything inventory.

**Before applying on production:** take the Supabase backup, apply on staging
(`/var/lib/postgresql/tp-staging`, port 54329) first, and keep each file in its own
apply (the 2026-11-15 rollout hit "out of shared memory" with large combined batches).
P0 needs `stock_movements.organisation_id` to be non-null on every legacy row to set
NOT NULL; if not, it leaves it nullable with a NOTICE.

## 2. Rollback

Every file has a `_ROLLBACK.sql`. Run them in REVERSE order (115000 first, 100000 last).

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
  units are never valued at 0, and on a balance holding both valued and unvalued units NO
  order is assumed (owner decision 2026-11-20, doc 20 section 3): an outbound movement posts
  only the certainly valued part at the average (`value_change`), the certainly unvalued part
  with an open cost reconciliation, and carries the rest as pending allocation (no value,
  one `issue_allocation` record) until an approved `inv_cost_reconcile` decides the split;
  value-only movements
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

## 6. Mandatory controls (108000-111000) - names the client lane codes against

### 6.1 Valuation rule and cost reconciliation (owner decision 2026-11-20)
* `stock_movements` gains `valued_qty`, `unvalued_qty` (magnitudes moved at known / unknown
  cost), `pending_out_change`, `pending_in_change` (signed change of the balance's undecided
  units) and `source_receipt_movement_id` (serial / lot-tracked specific identification); the
  posting answer carries `valued_qty_moved`, `unvalued_qty_moved`, `pending_allocation_qty`,
  `pending_out_change`, `pending_in_change`, `source_receipt_movement_id`, and the balance's
  `pending_allocation_out_qty` / `pending_allocation_in_qty`. New `valuation_status` value
  `pending_allocation`. New movement type `cost_allocation` (internal only; `inv_post_movement`
  refuses it like `cost_assignment`).
* `stock_records` gains `pending_allocation_out_qty` (units that left with an undecided split,
  still inside the buckets) and `pending_allocation_in_qty` (arrived by transfer, in neither
  bucket); CHECK `stock_records_value_buckets_chk`:
  `qty_on_hand + pending_out - pending_in = valued_qty + unvalued_qty`.
* Outbound rule (`_inv_post`): `maxv = least(on_hand, valued + pending_in)`,
  `maxu = least(on_hand, unvalued + pending_in)`; certainly valued `= greatest(0, q - maxu)` at
  the average; certainly unvalued `= greatest(0, q - maxv)`; the rest is ambiguous and posts no
  value. Serial / lot-tracked items on a mixed balance must name `source_receipt_movement_id`
  (actual receipt cost, never ambiguous) or are refused. While a balance has pending allocation,
  `cost_assignment` and an opening correction are refused.
* Table `inventory_cost_reconciliations` (org, country, site, item_id, location_id, stock_id,
  movement_id, origin_movement_id, kind `unpriced_inbound|consumed|transfer|reversal_return|legacy|issue_allocation`,
  consumed, unvalued_qty, currency, status `open|resolved|written_off|cancelled`,
  proposed_resolution / proposed_unit_cost / proposed_by, resolution_source
  `reconciliation|opening_batch|reversal`, resolved_unit_cost, resolved_value, applied_qty,
  not_applied_qty, resolution_movement_id, approval_request_id, resolved_by / resolved_at,
  evidence, created_by; for `issue_allocation`: `snapshot` (balance split before the movement),
  `holder_stock_id` (where transferred undecided units sit), `proposed_valued_qty`,
  `resolved_valued_qty`, `resolved_unvalued_qty`, `holder_resolution_movement_id`; its
  `unvalued_qty` holds the undecided quantity). CHECK `inventory_cost_reconciliations_sod_chk`: a reconciliation-sourced
  resolution needs `resolved_by <> created_by`. Blind-count restrictive policy included.
  `cancelled` is a fourth status beyond the brief (open|resolved|written_off): it is set only
  when a reversal or an approved opening correction removes the units.
* `inv_cost_reconcile(p_payload {reconciliation_id, idempotency_key, note?, evidence?,
  resolution?, unit_cost?, valued_qty?})` -> `{id, status, resolved_value, applied_qty, not_applied_qty,
  movement_id, posting:'none'}` (for an `issue_allocation`: `{id, status, kind,
  resolved_valued_qty, resolved_unvalued_qty, resolved_value, movement_id, holder_movement_id,
  posting:'none'}`). Needs `stock:financial_post`, an APPROVED `cost_reconciliation` request
  whose proposal matches, resolver != creator. For an issue allocation the proposal is
  `{valued_qty}` (0..undecided qty, evidence or reason required, never written off, must fit the
  buckets); posting = linked `cost_allocation` movement(s) (`source_doc_type issue_allocation`,
  `source_doc_id` = the decided movement), then the undecided-unvalued part becomes ordinary
  consumed / moved reconciliations.
  Direct `cost_assignment` through `inv_post_movement` is now refused (22023).
* Views: `v_inv_valuation` (stock_id, item_code, ownership, currency, qty_on_hand,
  valued_qty, unvalued_qty, valued_amount, avg_unit_cost, valuation_complete (false while
  unvalued OR pending), open_reconciliations, valuation_status (+ `pending_allocation`),
  pending_allocation_qty, pending_allocation_out_qty, pending_allocation_in_qty,
  open_allocations), `v_inv_cost_reconciliations` (+ allocation_qty, snapshot, holder_stock_id,
  proposed_valued_qty, resolved_valued_qty, resolved_unvalued_qty, resolution_movement_id,
  holder_resolution_movement_id; money masked
  without `stock:view_value`). `inv_valuation_summary` adds `valuation_complete` (top level and
  per currency) and `open_reconciliations`.

### 6.2 Approvals (the existing approval_policies engine)
* `approval_policies.entity_type` CHECK widened with `inventory_stock_adjustment`,
  `inventory_recount_assignment`, `inventory_opening_balance_batch`,
  `inventory_cost_reconciliation`; routing = `approval_private.resolve(...)` (live body).
  `decide_approval` / `approval_private.context` / `person_eligible` are NOT changed (they
  hard-code inspection, checklist, work_order and tyre_change and workshop roles; changing them
  would alter live approvals), so the stage decisions live in a thin adapter:
  `inventory_approval_requests` (one pending/approved per entity; CHECK decided_by <>
  requested_by) and append-only `inventory_approval_decisions`.
* **Known limit:** `approval_private.validate_policy` (Approval Policies editor) only accepts
  workshop / PMV / Admin roles as stage approvers for non-inspection types, so today an
  inventory policy authored in the editor can only name Admin or a named person of those roles.
  Widening that list is a change to a live shared function and needs owner approval.
* `inv_request_approval(p_payload {entity_type stock_adjustment|recount_assignment|
  opening_balance_batch|cost_reconciliation, entity_id, idempotency_key, proposal?, reason?,
  evidence?})` -> `{id, status, route_source policy|default, stages}`. Proposal:
  recount `{counter_id}`, cost reconciliation `{resolution, unit_cost}` (resolved needs
  evidence or a reason). Who may ask: adjustment `discrepancy_review` or elevated; recount
  `recount`; opening batch the preparer or elevated; cost `financial_post` or `view_value`.
* `inv_approval_decide(p_payload {request_id, decision approve|reject, note, signature?,
  idempotency_key})` -> `{id, status, current_stage, entity_type, entity_id}`. Reject needs a
  note; a policy stage with `require_signature` (default true) needs a signature.
* **Safe default** when no inventory policy is published for the type: one stage
  "Elevated approver" = Admin / Manager / Director (`app_is_elevated`) who is not the
  creator, preparer, counter or recounter. If policies exist but none (or two) match: refused.
* Eligibility (`_inv_approval_block_reason`, also exposed as `v_inv_pending_approvals.can_decide`
  / `blocked_reason`): active, same company, country + site scope, not the requester, not in the
  entity conflict set (adjustment: proposer, audit creator, counter, recounter, every counter of
  the audit; recount: audit creator, counter, recounter, counters, proposed recounter; opening:
  preparer; cost: creator, proposer), distinct reviewer per stage, stage person / role match,
  capability (`adjustment_approve`, `discrepancy_review`, `adjustment_approve`, `financial_post`)
  or elevated.
* Gates (triggers, every path): `inventory_adjustments` -> posted (also refuses
  approved_by = proposed_by), `opening_balance_batches` -> approved (+ CHECK
  `opening_balance_batches_sod_chk`), `inventory_audits.recount_counter_id` (+ CHECK
  `inventory_audits_recount_sod_chk`; recounter never the counter, creator or any earlier
  counter). Each consumes the approved request; an adjustment whose qty changed after approval,
  or a recount counter other than the approved one, is refused.

### 6.3 ERP reconciliation, catalogue, schedules
* `v_inv_erp_reconciliation` (security_invoker, read-only): organisation_id, country, site,
  month, item_code, currency, inventory_qty, inventory_value (masked), inventory_unvalued_qty,
  inventory_movements, erp_qty, erp_value, erp_lines, qty_difference, value_difference (masked),
  status `matched|qty_diff|value_diff|inventory_only|erp_only|unvalued`. ERP = parts_consumption
  + material_issues lines whose issue_number is not already in parts_consumption. Currency is part
  of the key. Matching is by item_code text.
* `metric_registry` / `metric_versions`: 25 rows each (`source_module 'Inventory Control Center'`,
  status draft, lineage_domain NULL, calc_ref `src/lib/inventory/kpi.js#<id>`), generated from
  `KPI_CATALOGUE`; the controls test fails on drift.
* `report_schedules.report_type` allows `inventory`; `v_inv_report_snapshot` per org / country /
  site / currency. The `send-scheduled-reports` edge branch for `inventory` is NOT built (edge
  deploy = separate owner approval); until then the generic fallback is emailed.

### 6.4 Apply order, verify, rollback (new files)
| File | Verify after apply | Rollback |
|---|---|---|
| 104000 (rewritten) | `select count(*) from inventory_cost_reconciliations where kind='legacy'` = number of balances with unvalued_qty > 0; `select prosrc from pg_proc where proname='_inv_cost_rec_track'` is not the stub | `_ROLLBACK` refuses while non-legacy or decided records exist (discard flag), restores the P0 stub |
| 108000 | `pg_get_constraintdef` of `approval_policies_entity_type_check` lists the 4 inventory types; `has_function_privilege('anon','inv_request_approval(jsonb)','execute')` = false | refuses while requests or inventory policies exist (discard flag), restores the live CHECK |
| 109000 | `select count(*) from v_inv_erp_reconciliation` runs; `select md5(...) from parts_consumption` unchanged | drops the view |
| 110000 | 25 rows `where source_module='Inventory Control Center'` in both tables | deletes exactly those 25 ids (only while still owned by that module) |
| 111000 | insert of an `inventory` schedule accepted (in a rolled-back txn) | refuses while an `inventory` schedule exists; restores the live CHECK |

Edited in place (all unapplied): 100000 (`_inv_post` with no assumed order + pending allocation,
`cost_allocation`, `inv_reverse_movement` reverses a decided allocation with its movement,
`valued_qty` / `unvalued_qty`
columns, `_inv_cost_rec_track` stub hook, `inv_post_movement` refuses `cost_assignment`,
`transfer_stock_entry` passes `carried_from_stock_id`), 103000 (transfer legs pass
`carried_from_stock_id`).

## 7. Test results

`node --test --test-concurrency=1 supabase/tests/inventory_*.test.mjs` (PGlite, synthetic data)
**69 tests, 68 pass, 0 fail, 1 skipped** (node:test top-level count; the skip is the
real-PostgreSQL concurrency file, which skips itself when the staging cluster is down; ~147 s).
Real PostgreSQL 16 (staging cluster, throwaway database, then dropped):
`inventory_concurrency.test.mjs` **2 tests, 2 pass** (re-run 2026-11-20 after the no-assumed-order change; skipped automatically when the cluster is down).

| File | Covers |
|---|---|
| `inventory_harness.test.mjs` | all twelve migrations apply over the live-shaped platform (approval engine resolver, parts_consumption, material_issues, metric catalogue, report_schedules copied from production) |
| `inventory_ledger.test.mjs` | WAC maths, mixed balance assumes no order (4 from 5 valued + 3 unpriced: 1 valued -10, 3 pending allocation), negative refused -> exception, idempotent retries / key reuse, reversal (once, exact), immutable ledger, direct writes refused, cross-company isolation, country/site scope, legacy wrappers |
| `inventory_audits.test.mjs` | blind enforcement via every endpoint, cutoff reconciliation (expected 4, counted 3, value -20), late offline counts, recount via approval by another person, adjustment approval + posting through the ledger, close rules |
| `inventory_flows.test.mjs` | transfer with no assumed order (11 of 10 valued + 2 unvalued: 9 valued = 36, 1 unvalued, 1 undecided travelling as pending allocation; partial receipt and return create chained allocations; all three decided in order, value 40 conserved, nothing pending after), reservations, consignment, value-only movements, cost assignment only via approved reconciliation, GRN + three-way match, opening balance via approval (legacy cost record: 1 cancelled, 3 resolved at 7 = 21), master review |
| `inventory_tyres.test.mjs` | custody derivation, conflicts with evidence, read-only proof, scrap guard, OEM approval |
| `inventory_api.test.mjs` | payload contract, replay, internals closed, masked views, counter view |
| `inventory_controls.test.mjs` | receipt -> availability -> reservation -> issue to WO; missing cost (5 at 10 + 3 unpriced, issue 7: 4 valued -40, 2 unvalued consumed, 1 undecided issue_allocation with no value), finance view (pending_allocation_qty, valuation_complete false), every SoD refusal, write-off; issue allocation decided with evidence -> linked cost_allocation -10, creator refused, write-off refused, DB sod_chk; reversal of an open allocation cancels it, of a decided one restores the balance exactly; reversal re-opens the record; policy route (2 stages, role + named person, signature, distinct reviewers, ambiguity refused); count -> discrepancy -> recount -> approval -> adjustment with every refusal (counter, recounter, proposer, requester, wrong recounter, DB CHECKs); opening preparer refused; single-connection lock ordering + double-submit; tyre fit/removal/transfer/scrap custody with tyre_records hash unchanged at each step; supplier vs company stock; company/country/site/role scoping; ERP statuses (matched, qty_diff, value_diff, inventory_only, erp_only incl. other currency, unvalued, no double count); 25 KPIs in sync; DEFINER search_path + no PUBLIC/anon execute; CPK/expense inputs hashed before and after |
| `inventory_rollback.test.mjs` | exact catalog restore across all twelve files, refusals (ledger, locations, approvals, cost reconciliations), apply -> rollback -> apply |
| `inventory_concurrency.test.mjs` | two real connections: B blocks on A's row lock (~1.1 s) and is refused as shortage, never negative; the same idempotency key from two connections posts once; ledger sum = balance |

## 8. Decisions and open items for the owner

* **Capability extensions** beyond the contract list: `stock:procure` and
  `stock:engineering_approve`. Admin/Manager/Director pass through `app_is_elevated()` where the
  contract says so; others need the capability in Access Control.
* **Variance types** stay provisional and separate from the 12 root causes.
* Approval policies for inventory: the editor's role list (see 6.2) needs widening before
  finance roles can be named in a published inventory policy.
* Not built: accounting postings from the three-way match (it records a match only); the
  `inventory` branch of `send-scheduled-reports`.
* `materials` is frozen read-only and `stock` (legacy, empty) is retired from writes;
  `material_master` is the one item master and `stock_records` the one balance.
