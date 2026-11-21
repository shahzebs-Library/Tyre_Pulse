# 03 Serialized Tyre Inventory and Fleet Integration (Phase 1 audit, read-only)

Agent 3, branch `claude/inventory-upgrade-7rxp2t`. Live project `jhssdmeruxtrlqnwfksc`, measured 2026-11-19
with SELECT/catalog queries only. Nothing was written to the database or the code.

## 1. Headline

- A tyre is a **serialized object only once it is on a vehicle**. Before fitment it exists as money
  (`parts_consumption` tyre lines, no serial) and, separately, as an anonymous **quantity by size**
  (`stock_records`, 42 tyre rows, 344 units, no serial). There is no hop that turns "a tyre in the store"
  into "this serial fitted to this wheel".
- After removal the tyre has **no home**: 3,630 strong serials are `Removed`, not scrapped and never refitted.
  They are neither in stock, nor in the pool (`tyre_pool` = 0 rows), nor disposed (`tyre_disposals` = 0).
  Whether they are reusable casings, retread candidates or scrap nobody marked is unknown.
- Fleet-side integrity is good: **0 strong serials active on two assets, 0 double-active wheels**.
- One real defect: **7 serials are scrap-marked AND still Active**; 6 of them were re-created as Active by a
  load AFTER the scrap mark. Nothing stops an upload from resurrecting a scrapped tyre.

## 2. Live measurements

| Measure | Value | Note |
|---|---|---|
| tyre_records rows | 11,274 | Active 4,289 / Removed 5,943 / Scrapped 1,042; no other status |
| Strong serials (distinct) | 8,632 | `tyre_serial_is_strong` |
| Rows with weak/blank serial | 1,842 | cannot be tracked as an item |
| Strong serial active on 2 assets | **0** | V-series cleanup held |
| Double-active wheels (org,country,asset,position) | **0** | guard + reconcile held |
| Scrap-marked serial with an Active, unremoved row | **7** | 6 created after the mark |
| Rows with no price (null/0) | 6,379 (57%) | UAE/Egypt mostly; grid is the cost source |
| Serials with >1 fitment row (refits/moves) | 720 | normal lifecycle |
| Serials priced on >1 row | 45 | one-price trigger is INSERT-only; historic |
| Refit rows carrying a price when an earlier row is priced | 30 | candidates for "reused tyre counted as purchase" in CPK |
| Removed, not scrapped, not refitted (strong) | 3,630 | the missing "reusable / casing" state |
| tyre_status_marks | 907, all `scrap` | `returned` / `written_off` never used; 897 have no reason |
| tyre_pool | 0 | module built, never used |
| tyre_disposals | 0 | disposal step never used |
| tyre_service_events / tyre_rotations | 0 / 0 | repair/rotation not recorded as events |
| retread_jobs / retread_claims / warranty_claims | 0 / 0 / 0 | |
| goods_receipts / purchase_orders | 0 / 0 | no receiving at all |
| stock_records (tyre-like) | 42 of 43 rows, 344 units | quantity per site+size, no serial |
| stock_movements | 78 | stocktake 39, Initial 8, adjustments 31; **no issue-to-fitment link** |
| parts_consumption tyre lines | 14,010 | the authoritative tyre spend, no serial column |
| Inspection tyre entries | 30,726 | key `serial_number` present on 29,767 but **filled on only 48**; 8 match the active tyre |
| tyre_records rows with no asset | 0 | so the tyrePool "no asset = pool" rule matches nothing |

## 3. How a tyre moves today (hop by hop)

| # | Hop | Table / key | Code | Guards | State |
|---|---|---|---|---|---|
| 1 | Purchase | `parts_consumption` (item_code, job card, value; no serial) | `src/lib/partsExpense.js`, `classificationBrain.js`, `governedCost.js`, `api/costSummary.js` | `classify_parts_consumption`, V491 country guard, V603 building guard, re-upload hash | Works. Cost lives here, not on the tyre. |
| 2 | Receiving | `goods_receipts`, `purchase_orders` (0 rows) | `src/pages/GoodsReceipt.jsx` (+ procurement) | none in use | **Missing in practice.** |
| 3 | Warehouse stock | `stock_records` (site + description/tyre_size, qty) + `stock_movements` | `src/lib/api/stock.js`, `stockQuickEntry.js`, `StockManagement.jsx`, Flutter `features/stock_count` | `post_stock_movement`, `set_stock_count`, `trg_stock_status_derive` | Quantity only. Fitting a tyre does **not** decrement stock. |
| 4 | Fitment | `tyre_records` (serial_no, asset_no, tyre_position, issue_date, km/hrs) | `src/lib/api/tyreRecords.js`, `erpIntake.js`, `tyreReplacement.js`, `tyrePositionService.js`, Flutter `features/tyre_exchange/data/tyre_replacement_repository.dart`, `features/tyres` | `trg_guard_tyre_active_fitment` (**skipped when auth.uid() is null**, i.e. staging loads), `trg_zz_one_price_per_tyre` (INSERT only), `_tyre_close_replaced` / `tyre_import_reconcile`, `tyre_serial_is_strong`, `trg_apply_tyre_learned_facts`, normalisers | Strong and well guarded for app writes. |
| 5 | Inspection | `inspections.tyre_conditions` jsonb keyed by position | `src/pages/Inspections.jsx`, `inspectionTyreFlags.js`, `tyreCompleteness.js`, `api/tyrePassportInspections.js`, Flutter `features/inspections` | `trg_complete_inspection_plans`, signer RPCs | Reads condition/pressure/tread by POSITION. Serial field exists but is almost never filled (48 / 30,726). |
| 6 | Removal | same `tyre_records` row: removal_date, km_at_removal, status `Removed` | `tyreReplacement.js`, `tyreChangeTracking.js`, `tyre_replacement_log` (56) | `tyre_records_master_process_tg`, reversed-date/km fixes | Works; the row then has no next state. |
| 7 | Reusable / pool | `tyre_pool` (0) | `src/lib/tyrePool.js` (`isPoolTyre`), `api/tyrePool.js`, `TyrePool.jsx` | none | **Unused.** Pool rule keys on "no asset", which no row satisfies. |
| 8 | Refit | new `tyre_records` row, same serial, later issue_date | `TyreExchange.jsx`, `tyreExchangeView.js`, `tyreLifetime.js` (`withOnePricePerTyre`, `fitmentCpk`) | one-price trigger clears repeat price on INSERT | Works; 720 serials show it. |
| 9 | Repair / retread | `tyre_service_events`, `retread_jobs`, `retread_claims` (all 0) | `tyreServiceEvents.js`, `RetreadManagement.jsx`, `RetreadClaims.jsx`, `api/retreadJobs.js` | none in use | Built, unused. Repair lines in the grid are excluded from price (`tyrePriceRules.js`). |
| 10 | Warranty | `warranty_claims` (0) + `warranty_claim_events` | `WarrantyTracker.jsx`, `components/warranty/ClaimProcedure.jsx`, `api/warranty.js` | `warranty_claim_guard` | Built, unused. Warranty never repriced (V401). |
| 11 | Scrap | `tyre_status_marks` (serial, mark_type='scrap', prior_status) + status `Scrapped` | `api/tyreExchange.js` (`scrapTyreBySerial`...), `components/tyre/ScrappedRegister.jsx`, `SerialTracker.jsx`, `mobile/lib/tyreScrap.ts` | `scrap_tyre_by_serial` / `unscrap_tyre_by_serial` (DEFINER, V382-V384, V550/V573 scoping), `tyre_scrap_allowed`, `tyre_unscrap_allowed` (admin), audit to `audit_log_v2` | Works; 907 marks. Reason blank on 897. |
| 12 | Disposal | `tyre_disposals` (tyre_record_id key, 0 rows) | `api/tyreScrap.js`, `TyreScrapManagement.jsx`, `tyreScrapView.js`, `tyreLifecycleEvents.js` | approval-gated (`EntityApprovalPanel tyre_scrap`) | **Unused.** Register shows "Not started" per scrapped tyre. |

Reading surfaces over the whole chain: `TyrePassport.jsx` + `tyrePassport.js` / `tyrePassportView.js`,
`TyreLifecycle.jsx` + `tyreLifecycleView.js` / `tyreLifecycleEvents.js`, `SerialTracker.jsx`,
`TyreRecords.jsx`, `tyreRunningLife.js` (`get_tyre_running_life`).

## 4. Where the physical truth can contradict itself

1. **Warehouse AND fitted at once.** Always possible today: stock is a size count, fitment is a serial row,
   and nothing links them. A tyre fitted from the store leaves the `stock_records` quantity untouched unless
   someone also posts an issue movement (no movement type "issue" has ever been posted). Stock (344) and the
   fitted fleet (4,289 active) are two unreconciled truths.
2. **Scrapped AND active.** 7 live serials. Cause: scrap is a mark plus a status stamp on existing rows; a later
   ERP/staging load inserts a fresh Active row for the same serial (the active-fitment guard is skipped when
   `auth.uid()` is null, and no trigger consults `tyre_status_marks` on INSERT).
3. **Removed but in limbo.** 3,630 removed serials with no disposition, so they can be neither counted as
   reusable stock nor written off.
4. **Reusable tyre counted as a new purchase.** Two paths: (a) a removed tyre refitted is a new `tyre_records`
   row; the one-price trigger clears a repeat price only on INSERT and only when evidence exists, and 30 refit
   rows still carry a price beside an earlier priced row (45 serials priced twice overall); (b) if a reused
   casing were also counted back into `stock_records` and then "issued", any consumption KPI reading stock
   issues would count it as new demand. Today (b) is latent because stock issues are not linked to fitments.
5. **Weak serials** (1,842 rows: placeholders, DOT codes, sizes) can never be tracked as unique items; they
   would collide in any serial-keyed ledger.

## 5. Capability classification

| Capability | Class | Why |
|---|---|---|
| Fitment history in `tyre_records` + guards (active-fitment, one-price, serial strength, reconcile, replacement log) | RETAIN | Measured clean (0 / 0); the cost and life rules (`tyreKm.js`, `fitmentCpk`, grid as tyre cost source) depend on it. |
| Scrap register + RPCs + admin-only undo + audit trail | RETAIN | Working, in daily use. |
| Scrap enforcement on new rows | REPAIR | 7 scrapped-and-active serials; add an insert-time check against `tyre_status_marks` (hold, not silently insert). |
| `stock_records` for tyres | UPGRADE | Keep as the quantity view for non-serialized and size-level planning, but derive tyre on-hand from the item ledger instead of a hand count. |
| Receiving (`goods_receipts`/`purchase_orders`) | ADD (activate) | 0 rows; serial capture must start here or at first stock-in. |
| Reusable / casing state | ADD | No state exists for the 3,630 removed tyres. |
| `tyre_pool` + `tyrePool.js` | CONSOLIDATE | Duplicate of the "reusable" state; its "no asset" rule matches 0 rows. Fold into the item ledger as a location type, keep the page as a view. |
| `tyre_disposals` | CONSOLIDATE | Keep the table as the disposal detail of the ledger's final event; today unused. |
| `tyre_status_marks` `returned` / `written_off` | CONSOLIDATE | Never used; the ledger's state replaces them. Keep `scrap` marks as history. |
| `tyre_service_events`, `retread_jobs`, `warranty_claims` | RETAIN (wire in) | Built and unused; they become ledger events, not parallel trackers. |
| Inspection `serial_number` capture | UPGRADE | Field exists on 29,767 entries but filled on 48; prefill from the active fitment and make it a confirm/mismatch tap. |
| `stock_movements` tyre issue linked to fitment | ADD | Missing link between store and wheel. |

## 6. Proposed integration (no rewrite of tyre history, no change to costing)

Principle: `tyre_records` stays the **fitment ledger** (one row per stint on a wheel) and the grid stays the
**cost source**. Add a thin **item layer** that knows where each serial is between stints.

1. **`tyre_items`** (one row per strong serial per org+country): serial, brand, size, first_seen, current
   `state` (in_stock, fitted, removed_reusable, at_repair, at_retread, warranty_hold, scrapped, disposed,
   unknown), current `location` (site/store or asset+position), `last_event_at`. Unique on
   `(organisation_id, country, upper(btrim(serial)))`, strong serials only; weak serials stay out and are
   reported as a data-quality backlog.
2. **`tyre_item_events`** (append-only): receive, stock_in, issue_to_fitment, fit, remove, return_to_store,
   send_repair, send_retread, warranty_open/close, scrap, dispose, verify. Each event stores a reference
   (`tyre_record_id`, `stock_movement_id`, `tyre_status_mark_id`, `inspection_id`, `goods_receipt_id`) and
   carries **no money**. Cost stays in `parts_consumption` and `tyre_records.cost_per_tyre`; nothing here
   feeds CPK, so `fitmentCpk`, `withOnePricePerTyre` and the V401/V426 price rules are untouched.
3. **Backfill by derivation, not by editing history**: one pass reads `tyre_records` + `tyre_status_marks`
   and writes `fit`/`remove`/`scrap` events; state = Active row -> fitted, latest row Removed + scrap mark ->
   scrapped, latest row Removed without mark -> `unknown` (honest; NOT "reusable", that is a human call).
   `tyre_records` rows are only read. Snapshot + undo per the migration-safety skill; Jan 2025 boundary
   respected (pre-2025 removed tyres can default to an archived state).
4. **Forward wiring through existing write paths** (AFTER triggers, never BEFORE, so the fitment guards keep
   authority): INSERT on `tyre_records` -> `fit` (and closes any `in_stock` state, emitting an
   `issue_to_fitment` that decrements the size count via `post_stock_movement`); removal update -> `remove`
   with state `removed_unclassified` awaiting a disposition (reuse / repair / retread / scrap); scrap RPC ->
   `scrap`. Add the missing guard: an INSERT of an Active row for a scrapped item is held for review
   (same pattern as `replacement_needs_review`), never silently accepted.
5. **Reusable refit is not a purchase**: a fit whose item already has an earlier `fit` event is flagged
   `refit=true`; consumption and demand KPIs count only first fits, and the existing one-price trigger keeps
   handling price. This also gives a clean list for the 30 refit rows that still carry a second price.
6. **Stock reconciliation**: tyre on-hand per site+size = count of items in `in_stock` / `removed_reusable`
   at that location. `stock_records` keeps its quantity for non-serialized lines and becomes a cross-check
   (variance report) for tyres rather than a second truth.

## 7. Physical fleet verification reusing tyre inspections

- Inspections already visit every wheel (30,726 position entries) and carry a `serial_number` key. Prefill it
  from the active fitment (asset + position) so the inspector only confirms or corrects; a confirm writes a
  `verify` event (inspection_id, position, matched=true), a mismatch writes `verify` with matched=false and
  raises an exception for review. No new screen, no second inspection.
- Coverage KPI: share of active items verified in the last N days (from `verify` events), shown on the
  existing Daily Coverage / Data Trust surfaces rather than a new page.
- Store side: the existing `stock_count` (Flutter) and `set_stock_count` flow becomes a serial scan for tyre
  rows, producing `verify` events at the store location.
- Today's baseline is honest and low: 48 serials ever captured in inspections, 8 matching the active tyre on
  that asset; the other 40 are evidence for the mismatch backlog.

## 8. Risks and constraints for Phase 2

- `guard_tyre_active_fitment` is bypassed for null-uid writers; the ledger trigger must not rely on it.
- `tyre_records_master_process_tg` nulls km 0 on any UPDATE (V590 lesson); event triggers must be AFTER and
  must not update `tyre_records`.
- Serial case/whitespace splits exist (V-series item 12: 43 tyres); key the item on `upper(btrim(serial))`.
- Every new table needs org + country RLS and `select anum_integration.apply_reader_policies();` at the end.
- Do not add a second scrap or pool surface; extend `ScrappedRegister`, `TyrePool.jsx`, `TyrePassport.jsx`.
