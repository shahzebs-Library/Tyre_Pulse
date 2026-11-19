# 01 - Web inventory surfaces audit (Phase 1, read-only)

Branch `claude/inventory-upgrade-7rxp2t`, 2026-11-19. No code changed. Live row counts and policies read
from project `jhssdmeruxtrlqnwfksc` with `count(*)` / `pg_policies` (not `n_live_tup`, which reported 0 for
`material_master` while it holds 22,162).

## 1. Live data reality (drives every decision below)

| Table | Rows | Note |
|---|---|---|
| `stock_records` | 43 | Stock register. Cols: site, description, stock_qty, min_level, critical_level, stock_status, reorder_qty, unit_cost, currency, brand, tyre_size, last_counted_at, custom_data, country, region. **No item code, no location/bin, no UoM.** |
| `stock_movements` | 78 | Ledger. Cols: stock_id, site, movement_type, qty_before/change/after, reason, reference_no, created_by. **No country column, no approval fields.** |
| `material_master` | 22,162 | Per-country item master (V367), the only populated item master |
| `parts_consumption` | 219,356 | ERP issue lines = the real expense/consumption history |
| `store_site_map` | 21 | Store code -> site |
| `sites` | 70 | Site register (region lives here) |
| `oem_parts_manuals` / `oem_parts_entries` | 4 / 1,652 | OEM PDF catalogue |
| `tyre_status_marks` | 907 | Scrap/returned/written-off marks |
| `stock`, `materials`, `parts_catalog`, `parts_requests`, `requisitions`, `purchase_orders`, `goods_receipts`, `material_issues`, `tyre_pool`, `suppliers`, `supplier_contracts`, `supplier_ratings` | **0 each** | Complete UIs over empty tables |

No table exists for warehouses, locations/bins, count sessions, audits, discrepancies or adjustment approvals
(`information_schema` search for warehouse|location|bin|count|stocktake|inventor|discrep|adjust returned none
relevant). Physical count today = `set_stock_count` RPC (V214, `MIGRATIONS_V214_STOCK_COUNT_RPC.sql`) used
only by mobile (`mobile/lib/stock.ts:59`) and Flutter (`supabase_tables.dart:374`), writing
`stock_records.last_counted_at`. The web has **no count screen**.

## 2. Navigation, routes, guards

- Nav group `Inventory & Procurement` - `src/components/Layout.jsx:284-298`: Stock, Stock Replenishment, Parts
  Catalog, Materials, Goods Receipt, Material Issue (MIS) [parent Stock]; Procurement, Requisitions, Supplier
  Management, Vendor Intelligence, Supplier Marketplace, Contracts [parent Purchasing].
- Inventory-adjacent items elsewhere: Tyre Exchange `Layout.jsx:165`, Tyre Pool `:177`, Scrap `:178`,
  Parts Requests `:208` (Workshop > Parts & Tools), Expenses & CPK `:319`.
- `NAV_MODULE_KEY` (`src/lib/navAccess.js`): `/stock`->`stock` (:44), `/store-material-issue`->
  `store_material_issue` (:59), `/procurement`->`stock` (:79), `/suppliers`->`stock` (:80). All others fall
  back to the route slug.
- Module catalogue has one inventory key, `stock` (`src/lib/moduleCatalog.js:50`). Mobile mirror: `stock`
  (count, manager+inspector) and `stockManage` (admin) - `src/lib/mobileModules.js:61,70`.

| Route | Guard (`src/App.jsx`) | Nav gate | Mismatch |
|---|---|---|---|
| `/stock` | ModuleRoute `stock` (:680) | none (all roles) | - |
| `/stock-replenishment` | RoleRoute A/M/D (:725) | roles A/M/D | - |
| `/parts-catalog`, `/parts-catalog/oem-preview` | RoleRoute A/M/D (:833-834) | roles A/M/D | - |
| `/materials` | RoleRoute Admin (:888) | adminOnly | - |
| `/goods-receipt`, `/requisitions` | RoleRoute A/M/D (:851-852) | roles A/M/D | - |
| `/store-material-issue` | RoleRoute A/M/D + moduleKey (:853) | roles A/M/D | - |
| `/procurement`, `/suppliers`, `/suppliers/:id` | ModuleRoute `stock` (:769-770, :928) | adminOnly | **route wider than nav**: anyone with `stock` can open by URL |
| `/parts-requests`, `/tyre-pool` | RoleRoute A/M/D (:713, :815) | A/M/D | - |
| `/tyre-exchange` | RoleRoute Admin (:723) | adminOnly | - |
| `/marketplace` | RoleRoute Admin (:894) | adminOnly | - |
| Material Master | console `/console/operations?tab=material-master` (:1028 redirect) | super-admin | lives outside the main app |

## 3. Page-by-page

Legend: L/E/Er = loading / empty / error+Retry present. All pages route errors through `toUserMessage`
(0 raw `err.message` renders found).

| Page (lines) | What it does | Reads / writes | Guard | L/E/Er | Export | Class | Reason |
|---|---|---|---|---|---|---|---|
| `StockManagement.jsx` (1,444) | Stock register; tabs stock / movements / by-site / transfer / timeline (:612-613); adjustments via `post_stock_movement`; quick entry (`StockQuickEntry.jsx`); inter-site transfer (`transfer_stock_entry`); approval-workflow locks for return + transfer | `stock_records` (paged, `stock.js:62`), `stock_movements`, `tyre_records` (timeline), RPCs `post_stock_movement`, `save_stock_entry`, `transfer_stock_entry`, `stock_item_suggestions`; `sites` | ModuleRoute stock | Y/Y/Y | Excel, PDF | **UPGRADE** | The real register + ledger; becomes the hub (Overview, Register, Movements, Count). Missing item code, location, UoM, count sessions |
| `components/stock/StockMovementsPanel.jsx` | Movement ledger by date window | `listMovementsInRange` (`stock.js:176`, paged) | via page | Y/Y/Y | - | UPGRADE | Ledger view exists; needs type/approval/variance columns |
| `StockReplenishment.jsx` (898) | Reorder suggestions from velocity, raise PO | `purchaseOrders.listReplenishmentStock/TyreRecords`, `createPurchaseOrder` | A/M/D | Y/Y/Y | Excel | **RETAIN -> CONSOLIDATE** | Correct engine (`stockReplenishmentAnalytics.js`); belongs under Stock Planning |
| `StoreMaterialIssue.jsx` (1,550) | MIS slips: issue/return against job card, history, analytics | `material_issues`, `material_issue_lines` (0 rows), `parts_consumption`, `work_orders`, RPC `get_material_issue_summary`; `material_master` picker | A/M/D + moduleKey | Y/Y/Y | Excel, PDF | **UPGRADE** | Is the "Material Movements: issue/return" surface; uses governed currency (`MIXED_CURRENCY`, :54) |
| `Materials.jsx` (515) | CRUD register over `materials` | `materials` (0 rows, `limit 500`) | Admin | Y/Y/Y | Excel, PDF | **CONSOLIDATE** | Third item master beside `material_master` (22,162) and `parts_catalog` (0). Fold into one Item Master |
| `PartsCatalog.jsx` (789) | Parts CRUD + analytics | `parts_catalog` (0 rows, `limit 1000`) | A/M/D | Y/Y/Y | Excel, PDF | **CONSOLIDATE** | Duplicate item master; keep only as a view over the governed master |
| `OemPartsCatalogPreview.jsx` (579) | Upload/extract OEM PDF parts, search, raise parts request | `oem_parts_manuals/entries`, `vehicle_fleet`, `parts_requests` | A/M/D | Y/-/- | none | RETAIN | Distinct (OEM reference); no empty/retry state; `oemPartsCatalog.js` has `.limit(1000)` = at the cap |
| `PartsRequests.jsx` (696) | Workshop parts requests per job (requested->approved->issued->fulfilled) | `parts_requests` (paged, max 5000), `parts_catalog` (`limit 2000` = capped at 1000), `work_orders` (`limit 500`) | A/M/D | Y/Y/Y | Excel, PDF | **UPGRADE** | Demand side of issue; should reserve/issue stock, today never touches `stock_records` |
| `Requisitions.jsx` (564) | Purchase requisition CRUD | `requisitions` (0 rows, `limit 500`) | A/M/D | Y/Y/Y | Excel, PDF | **CONSOLIDATE** | Overlaps Parts Requests + Procurement; one request->PR->PO flow |
| `Procurement.jsx` (1,276) | Purchase orders, budget, analytics | `procurement.js`: `purchase_orders` **unpaged `select('*')`** (`procurement.js:28`), RPC `generate_po_number`, `settings` | ModuleRoute stock | Y/Y/Y | (CSV via `safeJsonToSheet`) | **REPAIR + CONSOLIDATE** | Second PO service duplicating `purchaseOrders.js` (same table, same RPC); unbounded read; route/nav mismatch |
| `GoodsReceipt.jsx` (524) | GRN CRUD | `goods_receipts` (0 rows, `limit 500`) | A/M/D | Y/Y/Y | Excel, PDF | **UPGRADE** | Receipt never posts a `receipt` movement into `stock_records` |
| `TyrePool.jsx` (711) | Hot-spare tyre pool (add/deploy/return) + analytics | `tyre_pool` (0 rows), `tyre_records`, `vehicle_fleet` | A/M/D | Y/Y/Y | Excel, PDF | RETAIN | Tyre-specific; link as a stock category, do not merge |
| `TyreExchange.jsx` (1,379) | Typed tyre exchange register, scrap marks | `tyre_records`, `tyre_status_marks`, `stock_movements` (`limit 500`, `tyreExchange.js:39`, unscoped), scrap RPCs, `tyre_service_events` | Admin | Y/Y/Y | Excel, PDF | RETAIN | Tyre lifecycle, not inventory; its movement read is capped |
| `SupplierManagement.jsx` (1,489) / `SupplierDetail.jsx` | Supplier scorecard, contracts, ratings | `tyre_records` (paged), `supplier_ratings`, `supplier_contracts`, `warranty_claims`, `purchase_orders` (unpaged, `supplierManagementApi.js:31-64`) | ModuleRoute stock | Y/Y/Y | Excel, PDF | **UPGRADE** | Becomes Supplier Inventory; `totalSpend` sums across rows (:620) - verify currency scope under All |
| `SupplierMarketplace.jsx` | Marketplace | `marketplace` tables | Admin | - | Excel, PDF | RETAIN | Out of scope |
| `ExpenseReport.jsx` (1,796) | Expenses & CPK incl. store->site map | `parts_consumption` RPCs, `store_site_map` (`storeSiteExpense.js`) | ANALYTICS_ROLES | Y/Y/Y | Excel, PDF | RETAIN | Consumption value source for inventory analytics; do not duplicate |
| Console Material Master | 22,162-code item master, review, reclassify | `material_master`, RPCs | super-admin | - | - | **UPGRADE** | The governed master; needs a main-app read surface for stores |

Pure engines already present (reuse, do not rebuild): `stockLedger.js` (`classifyMovement`, includes
`stocktake/count`), `stockManagementAnalytics.js`, `stockReplenishmentAnalytics.js`, `stockQuickEntry.js`,
`storeMaterialIssueAnalytics.js`, `materialIssue.js`, `materialMaster.js`, `partsRequests*.js`,
`procurementAnalytics.js`, `supplier*Analytics.js`, `analytics/supplierScorecard.js`, `tyrePool*.js`,
`workforceStockReadiness.js`. Tests exist for each (`src/test/stock*`, `material*`, `parts*`,
`procurement*`, `supplier*`, `tyrePool*`, `tyreExchange*`, `stockTransferReturnWorkflow.test.jsx`,
`stockIssuanceWorkflow.test.jsx`, `goodsReceiptWorkflow.test.jsx`).

## 4. Findings

**Duplicates**
- Three item masters: `material_master` (22,162, console), `materials` (0, `/materials`), `parts_catalog`
  (0, `/parts-catalog`); plus `stock_records.description` free text with no item key.
- Two PO services on `purchase_orders`: `src/lib/api/procurement.js` and `src/lib/api/purchaseOrders.js`
  (both call `generate_po_number`).
- Three request flows: `parts_requests`, `requisitions`, `purchase_orders`, none linked by FK.
- Legacy empty `stock` table beside `stock_records` (0 rows) - dead.

**Unbounded / capped reads (1,000-row cap)**
- `procurement.listPurchaseOrders` - no range, no limit (`procurement.js:28`).
- `supplierManagementApi.js:31,40,53,64` - `supplier_ratings`, `supplier_contracts`, `warranty_claims`,
  `purchase_orders` unpaged.
- `partsRequests.listPartCatalog` `.limit(2000)` (:142) - effectively 1,000.
- `tyreExchange.js:39` movements `.limit(500)`, no country scope.
- `oemPartsCatalog.js` `.limit(1000)`.
- `materials`, `requisitions`, `goods_receipts` `limit 500`; `stock.listStock` default `limit 100` (`stock.js:26`).
- Harmless today (tables empty) but will truncate silently once used.

**Security - frontend-only gates (RLS checked)**
- `stock_movements` has a PERMISSIVE **ALL** policy `auth.role() = 'authenticated'`, so any active user in
  the org/site can INSERT and UPDATE ledger rows; the ledger is **not append-only**, despite the Manager/Admin
  INSERT policy beside it.
- `goods_receipts`, `materials`, `requisitions`: INSERT/UPDATE permissive on `auth.uid() IS NOT NULL`; the
  A/M/D route guard is UI only.
- `purchase_orders` INSERT permissive on `created_by = auth.uid() OR created_by IS NULL` - any user.
- `stock_records` writes are correctly role + `app_user_can('stock', ...)` gated.
- `/procurement`, `/suppliers` open to any `stock`-module role by URL while nav says adminOnly.

**Data model gaps**
- `stock_movements` has no `country`; `listMovementsInRange` relies on the page to narrow by country.
- No location/bin, UoM, item code, lot/serial, batch, valuation method, reserved/committed qty.
- No count session / snapshot / variance / approval objects; only `last_counted_at`.
- Goods receipt and parts issue do not post to the stock ledger (no stock effect).

**Currency**
- `Materials`, `PartsCatalog`, `Requisitions`, `Procurement` format every row in `activeCurrency` (org
  default under All) without a mixed-currency guard - mislabels AED/EGP rows on the All view.
  `StoreMaterialIssue` (governedCost) and `TyrePool` ("Pick a country: mixed currencies") are correct models.

## 5. Target nav -> existing surface mapping (no parallel pages)

| Target | Map to | Action |
|---|---|---|
| Overview | `StockManagement` (new first tab) + `stockManagementAnalytics.js` | UPGRADE |
| Stock Register | `StockManagement` "stock" + "by-site" tabs over `stock_records` keyed to `material_master` | UPGRADE (add item code, location, UoM) |
| Warehouses & Locations | `sites` + `store_site_map` (exist); **ADD** a location/bin table under sites; surface in StockManagement settings tab | ADD (data) / UPGRADE (UI) |
| Material Movements | `StockMovementsPanel` + `StoreMaterialIssue` (issue/return) + transfer tab + `GoodsReceipt` (receipt) | CONSOLIDATE; make GRN + MIS post ledger movements |
| Physical Stock Count | **ADD** tab in StockManagement over `set_stock_count` (V214) extended to count sessions | ADD |
| Inventory Audits | **ADD** tab (audit plan + count sessions + sign-off); reuse approval engine (`approval_policies`) | ADD |
| Discrepancies & Investigations | **ADD** tab fed by count variance; reuse `corrective_actions` for investigation follow-up | ADD |
| Adjustments & Approvals | existing `post_stock_movement` adjustment + workflow locks in StockManagement; route through `/approvals` | UPGRADE |
| Supplier Inventory | `SupplierManagement` / `SupplierDetail` | UPGRADE (add supplier stock/lead time) |
| Stock Planning | `StockReplenishment` + `PartsRequests` demand + `Requisitions`/`Procurement` | CONSOLIDATE into one plan -> request -> PO flow; one PO service |
| Reports & Analytics | `ExpenseReport` (value), `stockManagementAnalytics`, `storeMaterialIssueAnalytics` | RETAIN, add inventory accuracy KPIs |
| Inventory Settings | Item master = `material_master` (expose read in main app; retire `materials`/`parts_catalog` as separate masters), thresholds, locations | CONSOLIDATE |

## 6. Recommended repair order (before new features)
1. Lock `stock_movements` to append-only (drop the ALL authenticated policy; DEFINER RPC writes only).
2. Server-side role gates on `goods_receipts`, `requisitions`, `materials`, `purchase_orders` writes.
3. One PO service; page all supplier/PO reads; align `/procurement` + `/suppliers` route guards with nav.
4. Mixed-currency guard on Materials / PartsCatalog / Requisitions / Procurement under All.
5. Decide the single item master (`material_master`) before adding locations or counts.
