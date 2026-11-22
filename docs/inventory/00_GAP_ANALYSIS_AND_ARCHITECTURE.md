# Inventory Upgrade - Phase 1 consolidated gap analysis and Phase 2 architecture proposal

Branch `claude/inventory-upgrade-7rxp2t`. Source audits (read-only, measured 2026-11-19):
`01_web_surfaces_audit.md`, `02_database_audit.md`, `03_tyre_serial_integration.md`,
`04_finance_procurement_audit.md`, `05_mobile_identification_audit.md`, `06_research_reporting_ai_alerts.md`.
Nothing was changed in code or production. This file is the shared contract for the build agents once approved.

## 1. What exists today (one paragraph each)

- **Stock register:** `stock_records` (43 rows, all KSA) is the only live balance. Page `src/pages/StockManagement.jsx`. Writes go through `save_stock_entry`, `transfer_stock_entry`, `post_stock_movement`, `set_stock_count`.
- **Movement log:** `stock_movements` (78 rows). Quantity only, no cost, no country, editable by any active user.
- **Item master:** `material_master` (22,162 reviewed/derived codes, per country) is real; `materials` and `parts_catalog` are empty duplicates.
- **Money:** `parts_consumption` (~219k ERP expense lines) is the authoritative cost source. It must stay separate from any stock value.
- **Procurement:** requisitions, purchase orders, goods receipts, suppliers, parts requests, material issues are built screens over **empty tables**.
- **Tyres:** fully serialised in `tyre_records` / `tyre_status_marks`, but never linked to stock. A tyre can be in stock counts and fitted at once.
- **Mobile:** Flutter Stock Count = non-blind overwrite, online only, Store Keeper cannot open it. Scanner finds vehicles/serials only.
- **Missing entirely:** locations below site, count sessions, snapshots, discrepancies, approvals for adjustments, valuation, consignment, ABC/FSN/VED, supplier invoices, OEM-to-fleet compatibility.

## 2. Classification (top items, exact paths in the source audits)

| Class | Items |
|---|---|
| RETAIN | Tenant isolation on every table; `save_stock_entry` / `transfer_stock_entry` locking + idempotency; `parts_consumption` cost ledger; tyre fitment history and guards; scrap register; due-alert, approval, AI, report infrastructure |
| REPAIR (P1) | `stock_movements` editable/deletable by any user (critical); direct `stock_qty` edits without a movement; `post_stock_movement` / `set_stock_count` not idempotent; legacy `stock` table still used by `reserve_work_order_stock`; write gates for goods_receipts/materials/requisitions/suppliers/purchase_orders only in the UI; `po_number` unique across all companies; Store Keeper denied on Flutter; 7 tyres scrapped yet active; 1000-row unpaged reads |
| UPGRADE | `stock_records` (item_id, location_id, reserved qty, numeric qty, cost); `stock_movements` into an immutable valued ledger; `material_master` into the single item master; Flutter stock count into blind sessions; QR labels to cover items and bins; inspections pre-fill wheel serial |
| ADD | Location hierarchy; count sessions + snapshot + cutoff reconciliation; discrepancies/investigations; approved adjustments with segregation of duties; WAC valuation (tyres = specific); consignment ownership; PO/GRN lines; supplier invoices; OEM cross-reference + fitment; tyre item state ledger; Inventory Control Centre; KPI + alert catalogue |
| CONSOLIDATE | 3 item masters -> `material_master`; 3 stock balances -> `stock_records`; 2 PO services -> one; 3 request flows -> one; `set_stock_count` replaced by count sessions; tyre pool + disposals + unused marks -> tyre item states |

## 3. Architecture decisions proposed (need your approval)

1. **One balance, one ledger, one write path.** `stock_records` = balance per item, location, condition, ownership. `stock_movements` = append-only (no UPDATE/DELETE, reversals via `reverses_movement_id`). One SECURITY DEFINER posting function, built from `save_stock_entry`'s existing guards, used by every writer. Table CHECK `qty_on_hand >= 0` except an approved, audited override.
2. **Two money ledgers, never posting into each other.** Stock value lives only in `stock_movements`; `parts_consumption` stays the cost source for every existing report, CPK and cost/m3. They are tied by a read-only reconciliation view. A CI scan blocks cost readers from reading stock value. This prevents the double-posting that caused the 8,248 duplicate rows.
3. **Valuation:** perpetual weighted average per company, country, store, item, in that country's currency. Serialised tyres keep their own purchase price (specific identification). No FIFO layers, no standard costing (overkill for this operation). Unpriced stock shows "unvalued", never 0.
4. **Locations:** new `inventory_locations` (site -> warehouse -> zone -> bin, plus in_transit, quarantine, scrap, supplier, vehicle custody types), each with a QR label.
5. **Physical audits:** live counting with cutoff reconciliation (no company-wide freeze; optional scope freeze). Blind by default, enforced in the RPC/RLS (counter role cannot read expected qty until submitted). Two tolerances: recount by a different person, then value-based approval per country. Serialised tyres zero tolerance. Approval through the existing `approval_policies` engine; the counter can never approve their own adjustment.
6. **Tyres:** new `tyre_items` (one row per strong serial: state, location, owner) + append-only `tyre_item_events`, derived from `tyre_records` by reading, never editing tyre history or costing rules. A tyre leaves stock when fitted. Removed tyres with no decision = "unknown", not "reusable". Fleet verification reuses inspections (pre-filled serial, confirm/correct).
7. **Consignment:** ownership + owning supplier on the balance; consignment excluded from owned value; a liability record on issue; cost still enters the books only through the ERP grid.
8. **Compatibility:** only from a validated OEM cross-reference + manual-to-fleet fitment table with engineering approval. No description matching. Today there are 0 validated links, so the brand-change simulation will show "no validated data" until those are entered.
9. **Reuse, no new parallel systems:** Command Center kit, `exportUtils` + `loadAutoTable`, `approval_policies`, `due_alert_rules`, `workflow_notifications`, `ai_proposals` + existing agents, `metric_registry`, `audit_log_v2`.
10. **Navigation:** `StockManagement.jsx` becomes the Inventory hub with the 12 sections as tabs/sub-routes; existing pages fold in, no duplicate nav entries.

## 4. Proposed work packages (each one coherent PR, staging-tested, no production change without approval)

| WP | Scope | Depends |
|---|---|---|
| WP1 Ledger integrity | Append-only movements, single posting function, idempotency everywhere, numeric qty, server write gates, retire legacy `stock` from reservations, PO number per company, paging fixes | - |
| WP2 Master + locations | `material_master` as item master (link `stock_records.item_id`), `inventory_locations` + labels, freeze `materials`/`parts_catalog` read-only | WP1 |
| WP3 Physical audits | Count sessions, snapshot, blind counting, recount, cutoff reconciliation, discrepancies, approvals, adjustment posting, audit reports | WP1, WP2 |
| WP4 Valuation + procurement | WAC in ledger, PO/GRN lines posting receipts, issue posting, stock check before purchase, reconciliation view vs grid, consignment | WP1, WP2 |
| WP5 Tyre items | `tyre_items` + events derived read-only, scrap guard on insert, fitment leaves stock, inspection serial pre-fill | WP1 |
| WP6 Flutter | Store Keeper role, blind count screens, location/item scan, paged list, encrypted cache; offline sync command needs a human for reserved files | WP3 |
| WP7 Control Centre + KPIs + alerts + AI | Dashboard, 17 KPIs in metric_registry, 10 alert rules, advisory AI via existing agents, all reports | WP3, WP4 |
| WP8 QA + security | RLS cross-company tests, concurrency, offline duplicate sync, reconciliation, performance, readiness verdicts | all |

## 5. Decisions needed from you before build

1. Approve decisions 1-10 above (especially: WAC for stock, specific price for tyres, live count with cutoff not freeze, two separate ledgers).
2. Approve the work-package order WP1 -> WP8.
3. Staging: the local staging cluster can run the migrations; confirm no paid Supabase branch is wanted.
4. Flutter reserved files: a human must make the offline count sync change (named in 05 audit).
5. Data owners: who enters the OEM cross-reference and engineering approvals (needed for compatibility and brand-change simulation).

## 6. Readiness verdicts today

- **Current company:** NOT READY for audited inventory control. Ledger is editable, no valuation, no counts with approval, tyres double-countable.
- **New commercial customers:** NOT READY. Same gaps plus empty procurement/locations; tenant isolation itself is sound.
