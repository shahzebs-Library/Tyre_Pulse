# 04 - Finance, Valuation, Procurement, Supplier, OEM and Workshop Integration Audit

Phase 1, read-only. Agent 4. Branch `claude/inventory-upgrade-7rxp2t`. Measured live on Supabase
`jhssdmeruxtrlqnwfksc` on 2026-11-19 (read-only SELECTs only). Nothing applied, nothing committed.

## 1. Live inventory of the relevant tables (row counts measured, not estimated)

| Table | Rows | Reading |
|---|---|---|
| `parts_consumption` (expense grid) | ~218,776 | THE authoritative cost source. 3 currencies (SAR/AED/EGP), `unit_cost` null on 3 rows only, `filled_cost` (V517 estimates) on 1,068 |
| `material_master` | 22,162 (all `reviewed=true`) | Per (org, country, item_code) category + flags. Classification master, not an item/stock master (no min/max, no standard cost, no valuation field) |
| `stock_records` | 43 | Balance table. **No `item_code`** - keyed by free-text `description` + site. `unit_cost` on 7 of 43, one currency in use |
| `stock_movements` | 78 | Quantity ledger only (`qty_before/change/after`). **No cost columns.** Types in use: Initial, stocktake, adjustment_up/down only - no receipt, no issue yet |
| `stock_entry_requests` | 4 | Idempotency log for `save_stock_entry` |
| `material_issues` / `_lines` (V609) | 0 / 0 | Store issue/return slip with `unit_cost`, `line_cost`, `category`. **No trigger posts to stock or to parts_consumption** |
| `work_order_stock_reservations` (+lines) | 0 | Reservation by `stock_id` (exists, unused) |
| `purchase_orders` | 0 | `items` jsonb, `vendor_name`+`supplier_name` (duplicate), varchar columns, no currency column |
| `goods_receipts` | 0 | Single-item row (`item` text, `po_ref` text), has `unit_cost`, no currency, no FK to PO or stock |
| `requisitions` | 0 | Single-item, `est_cost`, `po_ref` text |
| `parts_requests` | 0 | V296, `part_id` -> `parts_catalog` (also 0 rows) |
| `accident_parts_requests` | 0 | Parallel request table for accident repairs |
| `suppliers`, `supplier_contracts`, `supplier_ratings` | 0 / 0 / 0 | Supplier master unused. Supplier names exist only as free text elsewhere |
| `parts_catalog`, `materials` | 0 / 0 | Two more empty item masters beside `material_master` |
| `invoices` | 0 | **Billing/SaaS subscription invoices**, NOT supplier invoices. No supplier-invoice table exists |
| `sany_invoices` (+lines) | 4 | SANY service-contract invoices (Cost/M3). Net basis per V525 |
| `currency_rates` | 0 (0 approved) | V380 FX infra; inert until an admin enters and approves |
| `country_currency` | 3 | KSA=SAR, UAE=AED, Egypt=EGP |
| `store_site_map` | 21 | Store code -> site |
| `oem_parts_manuals` / `oem_parts_entries` | 4 / 1,652 | All SANY (SY412C-8/ST, SY412C-8S(V)/ST2, SYM1310T1E, SYL956H5). `part_no_normalized` on all 1,652 |
| `pm_service_records` | 2 (both with `parts_used`) | PM parts as jsonb {name,qty,cost}, not linked to stock |
| `warranty_claims` | 0 | |
| `tyre_procurement_options` | 0 | V249 Value Advisor quotes |
| `asset_disposals` | 40 | Disposal register; downtime merged in from `asset_breakdowns` |

**Headline:** procurement, supplier and receipt modules are complete UIs over empty tables. The only
populated money source is the expense grid. The only populated stock source is 43 balances keyed by text.

## 2. Answers to the brief

### 2.1 Is there a stock valuation policy (WAC / FIFO / specific)?
**No.** There is no valuation method anywhere - not in SQL, not in JS. `stock_records.unit_cost` is a
single editable price field (7 of 43 rows) with no history, no layer, no recomputation on receipt.
`stock_movements` carries quantity only, so even a retrospective WAC cannot be derived from it.
`StockManagement.jsx` / `stockManagementAnalytics.js` display value as `qty x unit_cost` where present.

### 2.2 Is operational costing separated from accounting valuation?
**Only by accident.** Operational cost = expense grid (`parts_consumption.line_cost`, governed by
`src/lib/governedCost.js` + `src/lib/api/governedCost.js` + `costSummary.js`). Accounting valuation does
not exist, so there is nothing to collide with. The separation must become explicit before any
valuation is added (see section 4).

### 2.3 Does issuing parts create cost?
**No, and that is currently correct.** `material_issues` (V609) writes slips with `unit_cost`/`line_cost`
but no trigger posts them to `parts_consumption` or decrements `stock_records`. Cost arrives only via the
ERP expense grid import (`expenses_*` staging -> `process_expenses_country` -> `parts_consumption`,
idempotent on `import_uid`). `materialIssue.js` already reads the ERP's existing issue slips out of
`parts_consumption.issue_number` - i.e. the ERP is the system of record for issues today.

### 2.4 Double-posting risk between the grid and an inventory ledger
**HIGH if a naive "issue posts cost" is added.** The same physical issue already arrives through the ERP
grid (`issue_number`, `item_code`, `store_code`, `value_amount`). If an in-app issue also wrote to
`parts_consumption`, or if an inventory ledger's issue value were summed into any cost total, every part
would be costed twice - the exact class of the 8,248-row duplicate incident. Also: the grid
classifier `classify_parts_consumption` is BEFORE INSERT OR UPDATE and re-derives buckets on any write.

### 2.5 Can procurement check existing stock before buying?
**Partially, by text only.** `purchaseOrders.js` reads `stock_records` for the replenishment planner
(`stockReplenishmentAnalytics.js`), matched by brand/tyre_size/description. Requisitions, parts requests,
accident parts requests and goods receipts carry free-text `item` and cannot join to stock or to
`material_master.item_code`. No "on hand / on order / reserved" check exists at requisition time.

### 2.6 Can compatibility be derived from validated OEM data?
**Not yet.** OEM entries are SANY-only (4 manuals) while the fleet has 456 SANY-make assets. Measured:
**0 OEM `part_no_normalized` values equal a normalised ERP `item_code`** - the ERP uses its own codes
(e.g. `220064-O`). Manuals carry `model`/`model_code`/`chassis_from/to` but there is no
manual -> vehicle_fleet link and no ERP-code <-> OEM-part cross-reference. Compatibility must come from a
validated cross-reference table, never from description text matching (the classifier history shows
description regexes misfile; e.g. "Shell RIMula" read as rim). (A description-contains-OEM-number probe
over the KSA grid timed out at 60s and was not repeated; treat as unmeasured.)

### 2.7 Supplier-owned / consignment support
**None.** No ownership column on any stock table, no consignment location type, no supplier link on
`stock_records`, `suppliers` empty. `goods_receipts.supplier` is text.

## 3. Classification

| Item | Verdict | Path / reason |
|---|---|---|
| Expense grid as cost source | **RETAIN** | `parts_consumption`, `classify_parts_consumption`, `src/lib/partsExpense.js`, `src/lib/api/partsConsumption.js`. Never write inventory value into it |
| Governed cost readers | **RETAIN** | `src/lib/governedCost.js`, `src/lib/api/governedCost.js`, `src/lib/api/costSummary.js`. Extend for valuation as a separate CountryCostSet; never blend currency |
| material_master | **UPGRADE** | `src/lib/api/materialMaster.js`. Make it the single item master: add uom conversion, stockable flag, valuation method, standard/last cost, preferred supplier, min/max per site (or a child table). Keyed (org,country,item_code) - keep that |
| parts_catalog, materials | **CONSOLIDATE** into material_master | `src/lib/api/partsCatalog.js`, `materials.js`, `src/pages/PartsCatalog.jsx`, `Materials.jsx` - all 0 rows; three item masters is the anti-duplication rule broken |
| stock_records | **REPAIR** | Add `item_code` (FK-by-convention to material_master), keep description as label; 43 rows can be mapped by hand |
| stock_movements | **UPGRADE** | Add `unit_cost`, `currency`, `value_change`, `source_doc_type/id`, `item_code`. Make it the valuation ledger (section 4) |
| post_stock_movement / save_stock_entry / set_stock_count / transfer_stock_entry | **UPGRADE** | Carry cost on receipt movements; issues take current WAC |
| material_issues (V609) | **UPGRADE** | Link lines to stock (decrement via post_stock_movement) and to WO; never to parts_consumption. `src/lib/api/materialIssue.js`, `src/pages/StoreMaterialIssue.jsx` |
| work_order_stock_reservations | **RETAIN/UPGRADE** | Exists, 0 rows; key on stock_id. Feed "available = on hand - reserved" |
| requisitions, parts_requests, accident_parts_requests | **CONSOLIDATE** | Three request tables, all 0 rows, all free text. One request object with `item_code`, linked WO/accident, and a stock-availability check. `src/lib/api/requisitions.js`, `partsRequests.js`, `src/lib/partsRequests.js` |
| purchase_orders | **REPAIR** | items jsonb -> PO lines table; add currency; drop duplicate `vendor_name`/`supplier_name` (keep supplier_id); `src/lib/api/purchaseOrders.js`, `procurement.js`, `src/pages/Procurement.jsx` |
| goods_receipts | **REPAIR** | Line-level, FK to PO line, currency, qty_accepted; on accept -> post_stock_movement receipt with cost |
| Supplier invoices | **ADD** | No table exists (`invoices` = SaaS billing - do not reuse). Three-way match PO / GRN / invoice |
| suppliers + contracts + ratings | **RETAIN/UPGRADE** | `src/lib/api/supplierManagementApi.js`, `SupplierManagement.jsx`. Seed from distinct grid supplier/store data only when the grid carries it (it does not today: `supplier` column empty) |
| tyre_procurement_options / Value Advisor | **RETAIN** | `src/lib/tyreValueAdvisor.js`, uses kpiEngine CPK. Do not rebuild |
| currency_rates (V380) | **RETAIN** | Inert until rates entered + approved. Valuation must stay per-country currency; any consolidated total requires an approved rate and states its policy |
| OEM catalog | **UPGRADE + ADD** | `src/lib/api/oemPartsCatalog.js`, `src/lib/oemPartsExtractor.js`, `OemPartsCatalogPreview.jsx` (#565 pending). ADD `oem_manual_fitment` (manual -> model/model_code/chassis range -> vehicle_fleet match rule) and `item_oem_xref` (org,country,item_code,part_no_normalized, status proposed/validated, validated_by) |
| PM parts_used jsonb | **UPGRADE** | `pm_service_records.parts_used` {name,qty,cost} -> reference item_code + issue slip; keep jsonb for history |
| warranty_claims | **RETAIN** | 0 rows; add item_code/serial link and credit posting as a negative valuation adjustment only when a credit note exists |
| asset_disposals | **RETAIN** | `src/lib/api/assetDisposals.js`. Feeds fleet-replacement simulation (section 6) |
| SANY/SCO ledgers | **RETAIN** | Service-contract cost, never stock |

## 4. Valuation design that cannot double-post against parts_consumption

Principle: **two ledgers, two questions, never summed.**
- `parts_consumption` answers "what did maintenance cost" (operational, P&L, CPK, cost per m3). Unchanged.
- The stock valuation ledger answers "what is the stock on the shelf worth" (balance sheet). It is never
  read by `governedCost`, `costSummary`, `get_parts_expense_snapshot`, `get_cost_per_m3`, or any CPK RPC.

Design:
1. **Method: Weighted Average Cost (perpetual), per (org, country, site/store, item_code), in that
   country's currency.** Chosen over FIFO because receipts are sparse and line-level layers do not exist;
   WAC is reproducible from one ledger. Specific identification for serialised tyres only (one price per
   tyre rule already exists in `tyre_records`; reuse, do not re-derive).
2. `stock_movements` gains `item_code, unit_cost, currency, value_change, wac_after, source_doc_type,
   source_doc_id, valuation_status ('valued'|'unvalued')`. Receipt: `wac_after = (qty_before*wac_before +
   qty_in*unit_cost)/(qty_before+qty_in)`. Issue/scrap/transfer-out: valued at `wac_before`. Count
   adjustment: valued at current WAC, flagged as count variance (separate KPI, never "cost").
3. **Unpriced receipts are `unvalued`, never 0.** Stock value reports `null` + coverage % when any
   component is unvalued (same honesty rule as CPK coverage).
4. **Reconciliation, not posting:** a read-only view matches in-app issues to grid lines on
   `(country, issue_number, item_code, qty)` and reports `matched / issued-not-in-grid /
   in-grid-not-issued`. This is how the two ledgers are tied without either writing to the other.
5. Guard: a CI source scan (pattern of `rowCapGuard.test.js`) fails if any file under the cost readers
   references `stock_movements.value_change`, and a DB comment on the column states it is balance-sheet only.
6. Opening balance: valued from the median grid `unit_cost` of the same (country, item_code) over the last
   90 days, tagged `valuation_basis='grid_median_opening'`, reversible by batch (V517 pattern).

## 5. Consignment / supplier-owned stock model

- `stock_records.ownership` enum `owned | consignment | customer_owned`, plus `owner_supplier_id`
  (nullable, required when consignment). Uniqueness becomes (org, country, site, item_code, ownership,
  owner_supplier_id).
- Consignment stock: quantity tracked, **value excluded** from owned stock value (shown separately as
  "held on behalf of supplier", in the supplier's agreed price).
- Ownership transfers on issue: a consignment issue writes a `consumption_liability` record
  (supplier, item, qty, agreed price, issue slip) - the payable that a supplier invoice later settles.
  Cost still reaches P&L only via the ERP grid line; the liability record only supports invoice matching.
- Supplier contract (`supplier_contracts`) carries consignment terms: price, replenishment min/max,
  settlement cycle.

## 6. Fleet-replacement impact simulation - data needs

To answer "if we retire/replace these assets, what stock becomes dead or needs buying":
- Item -> compatible-asset mapping from **validated** `item_oem_xref` + `oem_manual_fitment` (not
  descriptions). Today: 0 validated links; SANY-only manuals.
- Per-asset 12-month consumption by item_code (exists: grid `asset_code` + `item_code`).
- Candidate list: `asset_disposals` (40) + `fleet_renewal_plans` + replacement model.
- On-hand + on-order + reserved by item (needs `stock_records.item_code`, PO lines, reservations).
- Output per item: share of last-12-month demand from retiring assets; projected dead-stock value
  (WAC x on-hand, own currency); demand for incoming model from its manual. Honest null when an item has
  no validated compatibility.

## 7. KPI definitions with honest null rules

All values per country in that country's currency; cross-country only with approved FX and the policy named.

| KPI | Formula | Null when |
|---|---|---|
| Inventory record accuracy | `count(lines where abs(counted - system) <= tolerance) / count(lines counted)` in a count cycle; tolerance 0 for serialised, per-item % otherwise | No count in the period, or denominator 0 |
| Gross shortage (value) | `sum(max(system - counted, 0) * WAC)` per count | Any counted line unvalued -> report value null + qty-only figure |
| Gross excess (value) | `sum(max(counted - system, 0) * WAC)` | Same |
| Net variance | excess - shortage | Same |
| Turnover | `issue value (WAC) over 12m / average stock value over 12m` (avg of month-end values) | Fewer than 3 month-end valuations, or average value 0, or issue value coverage < 80% |
| DIO | `365 / turnover` (or average stock value / daily issue value) | Turnover null or 0 |
| Dead stock | value of items with on-hand > 0 and no issue movement in 365 days (and no open reservation) | Item created < 365 days ago -> "too new", not dead; ledger history < 365 days -> KPI null with reason |
| Slow-moving | no issue in 180 days | Same rule at 180 |
| Stock-out rate | requests/reservations that could not be fulfilled from on-hand at request time / total requests | 0 requests |
| Fill rate | lines issued complete on first attempt / lines requested | 0 requests |

Rules: `Number(null)` is 0 - every numeric goes through a null-preserving `num()`; zero stock value is a
measurement only when every line is valued; never fall back to `stock_records.unit_cost` silently.

## 8. Risks flagged

1. The grid `supplier` column is empty, so supplier analytics cannot be seeded from history.
2. `stock_records` has 43 rows keyed by description; item_code backfill needs a human mapping pass.
3. `purchase_orders` uses varchar columns and both `vendor_name` and `supplier_name` - pick one.
4. `invoices` name collision with SaaS billing - new table must be `supplier_invoices`.
5. Three empty request tables and three empty item masters - consolidate before adding a fourth.
6. OEM coverage is SANY only; non-SANY fleet compatibility will read "not validated", never inferred.
