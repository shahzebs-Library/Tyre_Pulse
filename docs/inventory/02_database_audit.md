# Inventory Upgrade - Phase 1, Agent 2: Database Audit (read-only)

- Project: `jhssdmeruxtrlqnwfksc`. Measured 2026-11-19 via SELECT/catalog queries only. Nothing written to the database.
- Row counts are exact `count(*)` unless marked `est`. An empty table is recorded as empty, not as unnecessary.

## 1. Headline answers

| Question | Answer (evidence) |
|---|---|
| One authoritative stock balance? | **No - three.** (1) `stock_records.stock_qty` (43 rows, live, used by every RPC); (2) `stock.quantity` (0 rows, legacy, but the ONLY table `reserve_work_order_stock` deducts from); (3) `parts_catalog.on_hand_qty` / `materials.quantity_on_hand` (0 rows each, free-edit columns). A fourth "balance" is derived: `current_stock_balance()` + `v_stock_balance_reconcile` = `sum(stock_movements.qty_change)`. |
| Immutable movement ledger? | **No.** `stock_movements` has no immutability trigger; permissive `stock_movements_authenticated` (FOR ALL, `auth.role()='authenticated'`, WITH CHECK defaults to USING) lets **any active user in the org/site INSERT and UPDATE** movement rows directly, bypassing the RPCs and leaving `stock_records` untouched. DELETE is gated only by `app_can_admin_delete()`. FK `stock_movements.stock_id -> stock_records ON DELETE CASCADE` erases a record's whole ledger when the record is deleted. |
| Corrections = reversals or in-place edits? | Mixed. RPCs post a new movement (`adjustment_up/down`, `stocktake`) - good. But `stock_records.stock_qty` is directly UPDATE-able by Manager/Admin or any `stock:edit` grant (`stock_records_update` / `_cap_update`), so an in-place edit with no movement is possible. No reversal movement type exists (no `reverses_movement_id`). |
| Negative stock prevention? | RPC-level only. `post_stock_movement` refuses `after < 0` except elevated `adjustment_down` (which may then go negative); `transfer_stock_entry` checks `p_qty > a.stock_qty`; reservation checks `stock.quantity`. **No table CHECK** (`stock_qty >= 0`) and none on `stock_movements.qty_after`. Live: 0 negative rows. |
| Concurrency? | Good in the RPCs: `SELECT ... FOR UPDATE` on the record; `transfer_stock_entry` locks both rows in id order; `save_stock_entry` takes `pg_advisory_xact_lock(org+country+site)` and checks `expected_qty` + `expected_updated_at` (PT409 optimistic concurrency). Direct table writes bypass all of it. |
| Idempotency? | Partial. `save_stock_entry` + `transfer_stock_entry` use `stock_entry_requests` (request id + payload md5, replay returns stored result; 4 rows). `reserve_work_order_stock` uses `(organisation_id, idempotency_key)` unique. **`post_stock_movement` and `set_stock_count` have no idempotency key** - a retried call posts twice. `material_issues.client_uuid` is unique (global, not per org). |
| Valuation method? | **None.** `stock_records.unit_cost`/`currency` set on 7/43 rows; no cost on `stock_movements`; no FIFO/average layers. Financial value of consumption lives only in `parts_consumption` (ERP ledger, 219,356 rows) which is not linked to stock quantities. |
| Serial/batch support? | Not in the stock tables. Tyres are tracked individually in `tyre_records` / `tyre_status_marks` (907 KSA scrap marks) / `tyre_pool` (0 rows, serial-keyed). `stock_records` holds tyres as anonymous counts (28 rows kind=tyre, unit PCS). No batch/lot/expiry anywhere. |
| Location hierarchy depth? | **One level: `site` free text** (normalised by `trg_normalize_site`). `sites.site_type` allows `warehouse` but all 70 sites are `other`. Bin exists only as free text in `custom_data->stock_item->bin` (part of the identity key). `store_site_map` (21 rows) maps ERP store codes to sites. No warehouse/zone/bin table. |
| Snapshot/count support? | Counts: yes as single-item writes (`set_stock_count`, `save_stock_entry` mode=count -> `stocktake` movement, `last_counted_at`; 35/43 counted, 39 stocktake movements). **No count session/sheet, no freeze snapshot, no variance approval, no period-close balance snapshot.** |
| Cross-company isolation? | Every audited table has a RESTRICTIVE policy `organisation_id = (select app_current_org()) OR is_super_admin()` **except**: `country_currency` (global reference, by design), `material_issue_counters` (deny-all, DEFINER-only - fine), and `work_order_stock_reservation_lines` (no org column; read gated through parent EXISTS). `stock_movements` has **no country column** so country isolation is absent on the ledger (org + site only). `anon` holds no table grants on any audited table; no audited function is anon-executable except IMMUTABLE text helpers (`stock_movement_direction`, `parts_is_*`, `currency_for_country`, `_erp_country_from_prefix`, `jsonb_key_count`) which read no data. |

## 2. Live data shape

| Table | Rows (by country) | Notes |
|---|---|---|
| stock_records | KSA 42, NULL 1 | 6 distinct sites. 15 rows lack `custom_data.stock_item.key` (legacy, not protected by the unique identity index). 1 duplicate description group. 7 rows hold qty with no opening movement (drift 43 units in `v_stock_balance_reconcile`). |
| stock_movements | 78 (no country col) | stocktake 39, adjustment_down 20, adjustment_up 11, Initial 8. 0 orphans, 0 arithmetic errors, 0 site mismatches. |
| stock_entry_requests | KSA 4 | idempotency store for quick entry + transfer. |
| stock | 0 | legacy; target of WO reservation RPCs. |
| work_order_stock_reservations / _lines | 0 / 0 | |
| material_issues / _lines | 0 / 0 | MIS/MRT documents; do not post stock. |
| material_issue_number_config | 2 per country | counters 0. |
| material_master | KSA 9,443 / UAE 9,321 / Egypt 3,398 | item master keyed (org, country, item_code). |
| materials | 0 | competing item master (oil/filter/consumables). |
| parts_catalog | 0 | competing item master (`unique(org, part_no)`, no country in key). |
| parts_requests | 0 | FK -> parts_catalog, work_orders. |
| requisitions / purchase_orders / goods_receipts | 0 / 0 / 0 | P2P chain present but unused; GRN does not post stock. |
| suppliers / supplier_contracts / supplier_ratings | 0 / 0 / 0 | |
| tyre_pool | 0 | serial-level hot-spare pool. |
| tyre_status_marks | KSA scrap 907 | |
| sites | KSA 48 / UAE 18 / Egypt 4 | all `site_type='other'`. |
| store_site_map | KSA 19 / UAE 1 / Egypt 1 | |
| currency_rates | 0 | V380, enter/approve guard; nothing approved, so no conversion possible. |
| oem_parts_manuals / entries | KSA 4 / 1,652 | parts reference, FTS. |
| parts_consumption | KSA 118,785 / UAE 60,020 / Egypt 40,551 | ERP financial expense ledger; not a stock ledger. |
| accident_parts_requests | 0 | |

## 3. Per-object findings

Classification key: RETAIN (keep as is) / UPGRADE (extend) / REPAIR (defect to fix) / ADD (missing) / CONSOLIDATE (merge into a canonical object).

### stock_records - **UPGRADE + REPAIR** - risk HIGH
- Columns: id, organisation_id NOT NULL (FK organisations), country, region, site NOT NULL, description, brand, tyre_size, stock_qty **integer**, min_level, critical_level, reorder_qty, stock_status, management_action, unit_cost (CHECK >=0), currency, custom_data (stock_item identity/unit/condition/bin/source), last_counted_at, updated_by, updated_at.
- Indexes: org, country, site, updated_by; UNIQUE partial `stock_item_location_identity (org, country, upper(btrim(site)), custom_data->stock_item->>key)` where key not null.
- Triggers: `trg_normalize_site`, `trg_stamp_import_default_org`, `trg_stock_status_derive` (BEFORE INS/UPD), `trg_audit_row`.
- RLS: restrictive org (ALL), country_write (ALL), site_write (ALL), country/site select, active_user_read, anum reader; permissive insert Manager/Admin or `stock:create`, update Manager/Admin or `stock:edit`, delete Admin or `stock:delete` + `admin_only_delete_guard`.
- Defects: (a) qty is integer while units KG/L are allowed by `save_stock_entry`; (b) no `stock_qty >= 0` CHECK; (c) direct UPDATE of `stock_qty` bypasses the ledger; (d) identity lives in jsonb, 15 legacy rows have no key; (e) no item FK to `material_master`; (f) 1 row with NULL country; (g) no `version` column (uses `updated_at` as version).
- Recommendation: keep as THE balance table (per item x location). Add `item_id` FK to the canonical item master, `location_id`, `qty_on_hand numeric`, `qty_reserved numeric`, `uom`, `avg_unit_cost`, `version int`; CHECK `qty_on_hand >= 0`; revoke direct UPDATE of quantity columns (column-level grant or guard trigger allowing writes only from the posting function). Backfill the 7 drift rows with an `opening` movement.

### stock_movements - **REPAIR + UPGRADE** - risk CRITICAL
- Columns: id, stock_id (FK -> stock_records ON DELETE CASCADE), site NOT NULL, description, movement_type (CHECK of 15 mixed-case tokens), qty_before/qty_change/qty_after int NOT NULL, reason, reference_no, created_by (FK profiles), created_at, organisation_id (nullable, FK).
- Indexes: created_at (x2, duplicate), created_by, org, site, stock_id.
- Triggers: normalize_site, audit_row, `trg_ev_stock_movement` (domain event).
- RLS: see section 1 - `stock_movements_authenticated` FOR ALL permissive is the hole; restrictive org/site/active present; no country.
- Recommendation: make it the immutable ledger: drop `stock_movements_authenticated`; revoke INSERT/UPDATE/DELETE from `authenticated` (writes only via SECURITY DEFINER posting fn); BEFORE UPDATE/DELETE trigger that raises; change FK to `ON DELETE RESTRICT`; add `country`, `item_id`, `location_id`, `unit_cost`, `value_change`, `currency`, `source_doc_type`, `source_doc_id`, `idempotency_key` (unique per org), `reverses_movement_id`, `posted_at`; normalise `movement_type` to lowercase tokens; NOT NULL `organisation_id`; drop duplicate created_at index.

### stock (legacy) - **CONSOLIDATE** - risk HIGH
- 0 rows; columns brand/size/category/quantity/unit_cost/site/country. Policies: restrictive org + country, permissive write Admin/Manager, select true.
- `private.reserve_work_order_stock_internal` / `release_..._internal` (DEFINER, `search_path=""`, authenticated-executable via public SQL wrappers) lock and **decrement `stock.quantity` directly** - a reservation consumes on-hand of a table no screen fills, with no movement row.
- Recommendation: repoint reservations to `stock_records` (increment `qty_reserved`, not `qty_on_hand`; FK lines to stock_records), then retire `stock` (read-only, comment, no drop until callers are gone).

### work_order_stock_reservations / _lines - **REPAIR** - risk MEDIUM
- Good shape (idempotency unique, one-active partial unique, ordered locking, quantity CHECK). Wrong target table (see above); lines FK -> `stock`. Reservation should not reduce on-hand.

### stock_entry_requests - **RETAIN + UPGRADE** - risk LOW
- Proper idempotency store (request id + payload hash + stored result). Generalise as the idempotency store for every posting RPC (`post_stock_movement`, `set_stock_count`, issues, receipts).

### Functions
| Function | Definer / search_path / grants | Verdict |
|---|---|---|
| `post_stock_movement(uuid,text,numeric,text,text)` | DEFINER, `public`, auth yes / anon no | REPAIR: FOR UPDATE + negative guard + audit are good; add idempotency key, country derivation, cost; elevated `adjustment_down` may still drive negative - require reason + approval instead. |
| `set_stock_count(uuid,numeric,text)` | DEFINER, `public`, auth / no anon | UPGRADE: becomes a line of a count session; no idempotency; `floor()` loses decimals. |
| `save_stock_entry(...)` | DEFINER, `public, pg_temp`, auth / no anon | RETAIN (strongest writer: perms, scope, advisory lock, optimistic version, idempotency, workflow lock PT423). Extend for issues/returns. |
| `transfer_stock_entry(...)` | DEFINER, `public, pg_temp`, auth / no anon | RETAIN; same-country only, two-legged with shared reference. Add in-transit state later. |
| `stock_entry_resolve`, `stock_item_suggestions`, `stock_item_kind` | DEFINER (kind IMMUTABLE), auth | RETAIN. `stock_entry_resolve` not client-executable (good). |
| `current_stock_balance(uuid)` | DEFINER, auth | REPAIR: treats `organisation_id IS NULL` movements as visible to all orgs. Becomes a consistency check only. |
| `stock_status_derive` trigger | INVOKER | RETAIN. |
| `stock_movement_direction(text)` | IMMUTABLE, anon-executable | RETAIN (pure, no data). |
| `reserve/release_work_order_stock` | INVOKER wrapper -> private DEFINER `search_path=""` | REPAIR (target table). |
| `next_material_issue_no`, `material_issue_mint_number` | DEFINER, not client-executable | RETAIN; pattern for all document numbering. |
| `get_material_issue_summary` | DEFINER, auth | RETAIN. |
| `fx_rate_for`, `fx_convert` (not client-exec), `fx_coverage` (auth) | DEFINER | RETAIN; needs approved rates to be useful. |
| `set_store_site_map` | DEFINER, auth | RETAIN. |
| `scrap/unscrap_tyre_by_serial` | DEFINER, auth | RETAIN (tyre serial domain). |

### material_issues / material_issue_lines / counters / number_config - **UPGRADE** - risk MEDIUM
- Well built document header/lines: per-org-country-doc_type numbering, unique `(org,country,issue_number)`, lines CHECK qty>0, unit_cost>=0, cascade doc_type, org restrictive on header and lines (lines via parent).
- Gap: posting an issue does **not** create a stock movement; lines carry `item_code` text with no FK. `client_uuid` unique index is global, not per org.
- Recommendation: on status -> `issued`, post one `issue` (MIS) / `return` (MRT) movement per line through the canonical posting fn in the same transaction; add `stock_record_id`/`item_id` on lines; reversal by `cancelled` posts the opposite movement.

### material_master - **RETAIN as canonical item master + UPGRADE** - risk LOW
- 22,162 rows, unique `(org, country, item_code)`, category CHECK, flags kept in sync by trigger, classification feedback trigger, restrictive org + country.
- Add stock-control attributes (stocked flag, uom, min/max/reorder defaults, serial_tracked, lot_tracked, valuation method) rather than a new item table.

### materials, parts_catalog - **CONSOLIDATE** into material_master - risk MEDIUM
- Both empty; both carry their own `quantity_on_hand` / `on_hand_qty` (balance #3) and `reorder` fields. `materials` writes open to any authenticated user (`auth.uid() IS NOT NULL`). `parts_catalog` unique key has no country (same code in two countries collides - the V367 lesson). Keep tables (FK from `parts_requests.part_id`), stop writing quantities to them, map to material_master.

### parts_requests - **UPGRADE** - risk LOW
- Status flow CHECK, FK to work_orders + parts_catalog, insert by requester, manage by elevated, org/country/site restrictive, notify trigger. Fulfilment should post an `issue` movement and point at `material_master`.

### requisitions / purchase_orders / goods_receipts - **UPGRADE + REPAIR** - risk MEDIUM
- All empty. `purchase_orders.po_number` is **globally unique** (cross-tenant collision on a multi-company platform) - should be `(organisation_id, po_number)`. PO lines in `items jsonb` (no line table). `requisitions` and `goods_receipts` writes open to any authenticated user (restrictive org/country/site still apply). GRN has no FK to PO and does not post stock; `qty_received` has no CHECK; no `receipt` movement.
- Recommendation: add `purchase_order_lines` and `goods_receipt_lines` (FK to PO line + item), post `receipt` movements with unit cost on GRN approve; per-org PO uniqueness; elevated/`procurement:*` write gates.

### suppliers / supplier_contracts / supplier_ratings - **RETAIN + REPAIR** - risk LOW
- Empty. Writes open to any authenticated user. No unique `(org, supplier_code)`. Ratings keyed by brand, not supplier. Add supplier FK from PO/GRN.

### tyre_pool, tyre_status_marks - **RETAIN** (serial domain) - risk LOW
- `tyre_status_marks` unique `(org, serial, mark_type)` plus a deliberate bridge index `(serial, mark_type)` (scheduled for removal before a second company records marks - see PROJECT_MEMORY). Tyres stay serial-tracked here; the stock layer should treat new tyres in store as counts and link to serials only on fitment.

### sites, store_site_map - **UPGRADE** - risk LOW
- `sites` unique `(org, lower country, lower name)`, site_type CHECK includes `warehouse`, normalisation trigger. Extend into a location hierarchy (see target model) rather than a new site table.

### currency_rates, country_currency - **RETAIN** - risk LOW
- Approval guard trigger, partial unique on approved rate per day. Empty: valuation in a base currency is impossible until rates are entered and approved.

### parts_consumption (+ views `parts_consumption_authoritative`, `_monthly_authoritative`) - **RETAIN, do not merge** - risk LOW
- The ERP financial expense ledger (cost truth for CPK/expenses). 7 triggers incl. classifier, country guard, reupload dedupe. It is not a quantity ledger and must not become one; link it to stock only by `issue_number`/`item_code` for reconciliation.

### oem_parts_manuals / entries - **RETAIN** - reference data for part lookup (FTS `search_vector`).

### v_stock_balance_reconcile - **RETAIN** (security_invoker) - currently reports 7 drift rows / 43 units.

## 4. Proposed target data model (extends existing tables)

```
material_master (canonical item, EXISTING)            + stocked bool, base_uom, serial_tracked bool, lot_tracked bool,
                                                        default_min, default_max, reorder_qty, valuation_method ('avg')
inventory_locations (ADD)                              id, organisation_id, country, site_id -> sites, parent_id -> self,
                                                        location_type ('store','zone','bin','in_transit','quarantine'), code, active
                                                        unique (organisation_id, site_id, code)
stock_records (balance, EXISTING)                      + item_id -> material_master, location_id -> inventory_locations,
                                                        qty_on_hand numeric CHECK >= 0, qty_reserved numeric CHECK >= 0,
                                                        uom, avg_unit_cost, currency, version int
                                                        unique (organisation_id, item_id, location_id, condition)
stock_movements (immutable ledger, EXISTING)           + country, item_id, location_id, unit_cost, value_change, currency,
                                                        source_doc_type, source_doc_id, idempotency_key,
                                                        reverses_movement_id -> self, posted_at
                                                        unique (organisation_id, idempotency_key); no UPDATE/DELETE
stock_entry_requests (EXISTING)                        reused as the generic idempotency store
stock_reservations (REPAIR existing WO reservations)   lines -> stock_records; adjust qty_reserved only
stock_count_sessions / stock_count_lines (ADD)         session: org, country, location, status (open/frozen/submitted/approved),
                                                        snapshot_at; line: stock_record_id, system_qty, counted_qty,
                                                        variance, approved_by -> posts 'stocktake' movements on approval
stock_balance_snapshots (ADD)                          org, stock_record_id, as_of_date, qty, value - period close / ageing
material_issues + lines (EXISTING)                     + line.stock_record_id; posting creates issue/return movements
purchase_orders (EXISTING) + purchase_order_lines (ADD), goods_receipts (EXISTING) + goods_receipt_lines (ADD)
                                                        receipt movements with unit_cost on GRN approval
suppliers (EXISTING)                                   + unique (organisation_id, supplier_code); FK from PO/GRN
parts_catalog, materials, stock (EXISTING)             frozen read-only, mapped to material_master / stock_records
parts_consumption (EXISTING)                           unchanged; reconciliation link only
```

Single write path: one SECURITY DEFINER posting function (built from `save_stock_entry`'s guards) that locks the balance row, checks version/idempotency/scope/permission, inserts the movement and updates the balance in one transaction. Every other writer (count, transfer, issue, receipt, reservation) calls it.
