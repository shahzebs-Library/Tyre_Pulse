# Inventory Control & Audit - approved requirements and build contract

Owner approval 2026-11-19: architecture in `00_GAP_ANALYSIS_AND_ARCHITECTURE.md` approved, extended by the
requirements below. WP1-WP8 approved as internal packages, built on ONE release branch
`claude/inventory-upgrade-7rxp2t`, delivered as ONE consolidated release package. No production migration,
deployment, paid service or destructive operation is authorised by this approval. OEM #565 and commercial
#567 stay independent.

## Owner corrections to the proposal (binding)
1. **No negative physical stock, no admin override.** Shortages, backorders, pending receipts, reservations
   and reconciliation exceptions are separate quantities/records, never a negative on-hand.
2. **Opening balances need formal approval.** The 43 existing stock rows are NOT assumed correct. Opening
   balance = an import/reconcile batch with provenance, mapping, missing-cost flags and independent approval.
   No manufactured historical movements; uncertain history marked explicitly.
3. **Do not auto-merge duplicate-looking materials.** Controlled master-data review workflow.
4. **Tyres:** one authoritative custody state per physical tyre. The 7 scrapped-yet-active tyres are
   investigated and presented with evidence for authorised reconciliation, never auto-corrected.
   Stock holding period is not tyre running life. CPK/cost/m3/expense/tyre-lifecycle maths unchanged.
5. **Simulation honesty:** hypothetical scenarios never shown as actual savings; missing compatibility =
   "No validated compatibility data".
6. **Financial postings stay in the ERP.** Inventory never creates accounting liabilities or postings.
   Inventory value never counted again in `parts_consumption` readers.

## Priorities
- P0 ledger integrity + security (WP1, part of WP2)
- P1 counting, audits, discrepancies, tyre reconciliation (WP3, WP5, WP6)
- P2 procurement, receiving/issue, valuation, supplier/consignment (WP4)
- P3 KPIs, forecasting, ABC/FSN/VED, investment and brand-change simulation, reports, advisory AI (WP7)
- WP8 QA/security across all.

## Module structure (one hub, `src/pages/StockManagement.jsx` -> Inventory Control Center)
Sections: Overview, Stock register, Locations, Movements, Physical audits, Discrepancies, Procurement,
Receiving & issue, Tyre inventory, Valuation, Supplier stock, Planning & simulation, Identification,
Reports, Controls. Grouped as tabs/sub-routes inside one module, no new parallel nav entries.

## Shared data contract (names are fixed; the DB lane owns the SQL, other lanes code against these)
Migrations: `supabase/pending_migrations/2026112010xxxx_inv_*.sql` (+ `_ROLLBACK.sql`), applied to NOTHING
but local staging / PGlite. RLS on every table: RESTRICTIVE `organisation_id = app_current_org()`, country
and site SELECT scoping, writes only through SECURITY DEFINER RPCs (search_path pinned, anon revoked).

Tables (extend existing where listed):
- `material_master` (+ stocked, base_uom, serial_tracked, lot_tracked, criticality, status
  active|inactive|obsolete, min_qty, max_qty, reorder_point, safety_stock, lead_time_days, barcode,
  manufacturer, category/subcategory kept). `material_aliases` (item_id, alias_type oem|alternative|
  superseded|barcode|erp_legacy, value, source, approved_by, effective_from/to).
  `material_master_reviews` (proposed change, status, reviewer).
- `inventory_locations` (id, org, country, site, parent_id, location_type warehouse|zone|rack|shelf|bin|
  in_transit|quarantine|damaged|scrap|warranty|repairable|supplier_custody|vehicle_custody|consignment,
  code unique per (org, site), label_code `TP:LOC:<id>`, responsible_user_id, active).
- `stock_records` = THE balance (+ item_id, location_id, condition, ownership owned|consignment|supplier,
  owner_supplier_id, qty_on_hand numeric CHECK >= 0, qty_reserved numeric CHECK >= 0 and <= qty_on_hand,
  avg_unit_cost, currency, version). Unique (org, item_id, location_id, condition, ownership, owner_supplier_id).
- `stock_movements` = append-only ledger (+ country, item_id, location_id, movement_seq bigserial, posted_at,
  effective_at, unit_cost, value_change, currency, ownership, source_doc_type, source_doc_id,
  idempotency_key unique per org, reverses_movement_id, reason, actor_id, approval_ref). No UPDATE/DELETE.
- `stock_exceptions` (shortage|backorder|pending_receipt|reconciliation, item, location, qty, status).
- `stock_transfers` + `stock_transfer_lines` (dispatched|in_transit|partially_received|completed|cancelled).
- `opening_balance_batches` + `opening_balance_lines` (source, mapping status, missing_cost, approval).
- `inventory_audits` (ref, type full|partial|cycle|category|high_value|surprise|bin|tyre_serial|
  vehicle_tyre, scope jsonb, status draft|scheduled|assigned|in_progress|counting_completed|reconciliation|
  recount|investigation|approval|adjustment_posted|closed|cancelled|rejected, counter/reviewer/approver ids,
  due_at, instructions, snapshot_at, cutoff_seq).
  `inventory_audit_snapshot_lines` (expected qty/serials/cost - NEVER readable by the counter until submitted).
  `inventory_count_lines` (audit, location, item or serial, counted_qty, confirmed_zero, condition, photos,
  remarks, counter, counted_at, device_id, client_uuid unique, round 1|2|3, unexpected bool).
  `inventory_discrepancies` (category per owner list, qty variance, value impact, investigator,
  evidence, proposed correction, status, approval).
- `inventory_adjustments` (from discrepancies, approver != counter enforced in RPC, posts movements).
- `purchase_order_lines`, `goods_receipt_lines` (ordered/received/accepted/rejected qty), `supplier_invoices`
  (+ lines, three-way match status; no accounting posting).
- `supplier_agreements` (consignment|vmi|framework, min/max, lead time, credit terms, expiry, return terms).
- `tyre_items` (one row per strong serial: custody_state new_stock|reserved|in_transit|fitted|
  removed_pending|reusable|under_repair|warranty|quarantine|scrapped|returned_supplier|unknown,
  location_id, asset_no, position, purchase_cost, currency) + `tyre_item_events` (append-only, no money
  edits to tyre_records). `tyre_custody_conflicts` (the 7 + any new).
- `oem_part_references` (oem part no -> item_id, approval, evidence, effective dates) and
  `equipment_fitments` (item_id -> make/model/asset class, engineering approval, source).

RPCs (all `inv_*`, SECURITY DEFINER, idempotency key mandatory on writes):
`inv_post_movement(payload)` the ONLY balance writer; `inv_reverse_movement`; `inv_transfer_dispatch`,
`inv_transfer_receive`; `inv_reserve`, `inv_release`; `inv_receive_goods`; `inv_issue`;
`inv_audit_create/schedule/start` (takes snapshot + cutoff_seq), `inv_count_submit` (blind),
`inv_audit_counter_view` (no expected qty), `inv_audit_reconcile`, `inv_recount_assign`,
`inv_discrepancy_update`, `inv_adjustment_approve` (refuses counter/creator), `inv_audit_close`;
`inv_opening_batch_*`; `inv_tyre_item_sync` (derive from tyre_records, read-only on them).
Legacy writers `post_stock_movement`, `save_stock_entry`, `transfer_stock_entry`, `set_stock_count`,
`reserve_work_order_stock` become thin wrappers over `inv_post_movement` (kept for old clients) or refuse
with a clear message; direct table writes revoked.

Capabilities (via existing `app_user_can` / module_permissions, module key `stock`): view, view_value,
receive, issue, transfer, count, audit_create, recount, discrepancy_review, adjustment_approve,
financial_post, scrap_approve, export, audit_history. Roles: Store Keeper, Inventory Controller,
Inventory Auditor, Procurement Officer, Tyre/PMV Engineer, Finance Officer/Manager, Site Manager, Admin.

## Lanes and file ownership (no lane edits another lane's files)
| Lane | Owns |
|---|---|
| DB | `supabase/pending_migrations/*inv_*`, `supabase/tests/inventory_*.test.mjs`, `docs/inventory/10_*` |
| WEB | `src/pages/StockManagement.jsx` + new `src/components/inventory/**`, `src/lib/inventory/**`, `src/lib/api/inventory*.js`, `src/test/inventory*.test.*`, nav/route edits for the hub only |
| FLUTTER | `tyre_pulse_flutter/lib/features/stock_count/**`, new `lib/features/inventory/**`, role mapping, l10n keys; reserved files only as a delivered patch |
| TYRE+FIN | `src/lib/inventory/valuation*`, `simulation*`, `kpi*` engines + tests, `docs/inventory/2*` |
| QA | `supabase/tests/inventory_security*.test.mjs`, `docs/inventory/9*` |
