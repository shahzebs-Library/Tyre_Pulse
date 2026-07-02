# TyrePulse - Legacy → Canonical Data Mapping

> **Status:** Step 0 design. Defines how every legacy/overlapping table maps to the canonical multi-tenant model owned by the Go API (`docs/TARGET_ARCHITECTURE.md`).
>
> **Golden rule:** **No destructive change before validation.** Each legacy table is migrated, reconciled, then set **read-only** and retained until the new module is proven in production. Only then is it deprecated.

---

## 0. Canonical Hierarchy

```
Organisation → Country → Project → Site → Asset
                                          ├── Tyre
                                          ├── Inspection (run + tyre checks)
                                          ├── WorkOrder
                                          ├── Accident (+ parts/remarks)
                                          ├── Cost / Budget
                                          └── StockMovement
```

Every canonical row carries a tenant path (`org_id`, `country_id`, `project_id`, `site_id`) so RBAC + scope are enforced server-side instead of via geographic text columns.

---

## 1. Standard Migration Method (applies to every mapping below)

1. **Snapshot** legacy table row counts and checksums.
2. **Transform** into canonical shape (typed columns, FK resolution, tenant path back-fill).
3. **Dedupe** on the documented natural key; survivors win by most-recent `updated_at`, losers logged.
4. **Dry-run** into a staging schema.
5. **Reconciliation report**: `old_count`, `new_count`, `failures`, `duplicates_collapsed`, `unmapped`.
6. **Cutover**: route web + mobile through the Go API; freeze legacy direct writes.
7. **Read-only hold**: legacy table set read-only (revoke INSERT/UPDATE/DELETE), retained ≥ 1 validation cycle.
8. **Rollback**: re-point clients to legacy (still intact); investigate; no data loss because legacy was never mutated.

Reconciliation passes only when: `new_count == old_count − duplicates_collapsed − intentional_drops` **and** `failures == 0` **and** `unmapped == 0`.

---

## 2. Assets / Fleet

**Sources:** `vehicle_fleet` (canonical, `MASTER_MIGRATION.sql`), `fleet_master` (legacy, `MIGRATIONS_SAFE.sql`)
**Targets:** `assets`, `asset_configurations`

| Aspect | Detail |
|---|---|
| Source columns | Registration/fleet number, make, model, year, axle/wheel config, odometer, site, country, status, timestamps. |
| Target | `assets` (identity + lifecycle), `asset_configurations` (axle layout, tyre positions, fitment rules). |
| Transform | Map registration → `assets.registration_no`; split static axle/position config into `asset_configurations`; resolve `site`/`country` text → `site_id`/`country_id`/`org_id` via `sites` lookup; normalise status enum. |
| Dedupe key | Normalised `registration_no` (uppercase, stripped). On collision keep `vehicle_fleet` (canonical) over `fleet_master`. |
| Reconciliation | `old = count(vehicle_fleet) + count(fleet_master)`; `new = count(assets)`; report collapsed duplicates and any unresolved site/country. |
| Rollback | Keep both legacy tables read-only until asset module validated. |

---

## 3. Stock / Inventory

**Sources:** `stock_records` (canonical), `stock_movements` (append-only audit), `stock` (legacy)
**Targets:** `items`, `inventory_movements`, `inventory_balances`

| Aspect | Detail |
|---|---|
| Source columns | SKU/part code, description, category, unit, quantity-on-hand, location/site, supplier; movement rows: type (in/out/adjust), qty, ref, timestamp. |
| Target | `items` (catalogue master), `inventory_movements` (immutable ledger, from `stock_movements` + derived deltas from `stock`/`stock_records`), `inventory_balances` (materialised on-hand per item/site). |
| Transform | Catalogue fields → `items` (dedup by SKU); `stock_movements` map 1:1 → `inventory_movements`; legacy `stock`/`stock_records` quantities converted to opening-balance movements; rebuild `inventory_balances` as a fold over the ledger. |
| Dedupe key | `items`: normalised SKU + site scope. Movements: `(source_table, source_id)` to guarantee idempotent replay. |
| Reconciliation | Per item/site: `sum(inventory_movements) == legacy on-hand`. Report items where ledger ≠ legacy balance (data-quality flags). |
| Rollback | `stock`, `stock_records`, `stock_movements` read-only; balances recomputable, so rollback is re-point only. |

---

## 4. Audit Logs (4 → 1)

**Sources:** `audit_log` (v1), `audit_log_v2` (enriched: org_id, old/new, ip), `inspection_audit_log`, `accident_audit_log`
**Target:** `audit_events` (single immutable, append-only)

| Aspect | Detail |
|---|---|
| Source columns | actor, action, entity type/id, timestamp; v2 adds `org_id`, `old_values`, `new_values`, `ip`; domain logs add inspection/accident-specific context. |
| Target | `audit_events(id, occurred_at, actor_id, org_id, entity_type, entity_id, action, old_values jsonb, new_values jsonb, ip, source, request_id)`. |
| Transform | `audit_log_v2` maps richest → set `source='audit_log_v2'`. `audit_log` v1: back-fill nulls (`org_id` resolved from actor where possible). Domain logs: `entity_type` = `inspection`/`accident`, payload into `old/new_values`. |
| Dedupe key | `(source, source_id)`; events are inherently append-only so no semantic dedupe. |
| Reconciliation | `new_count == sum(old_counts)`; verify no row drops; spot-check old/new value fidelity on v2 rows. |
| Rollback | All four legacy logs read-only and retained permanently for forensics (audit immutability - Security Register **R-09**). |

---

## 5. Inspections (JSONB → structured)

**Source:** `inspections` (tyre data in **JSONB `tyre_conditions`**, GIN-indexed)
**Targets:** `inspection_runs`, `inspection_tyre_checks` (**+ retained raw JSON snapshot**)

| Aspect | Detail |
|---|---|
| Source columns | Header (asset, inspector, site, odometer, timestamp, status) + `tyre_conditions` JSONB array (per-position tread depth, pressure, condition flags, photo refs). |
| Target | `inspection_runs` (one row per inspection header) + `inspection_tyre_checks` (one row per tyre position, typed columns). **`inspection_runs.raw_snapshot jsonb` preserves the original `tyre_conditions` verbatim.** |
| Transform | Header → `inspection_runs` with resolved tenant path. Explode `tyre_conditions[]` → one `inspection_tyre_checks` per position; cast tread depth (mm), pressure (psi/bar), wear flags to typed columns; map `tp-storage://` photo refs into a checks/attachments relation. Keep raw JSON for replay/audit. |
| Dedupe key | `inspections.id` → `inspection_runs.legacy_id` (1:1). Tyre checks keyed `(run_id, axle, position)`. |
| Reconciliation | `count(inspection_runs) == count(inspections)`; `sum(tyre_checks)` matches total JSON array elements; flag malformed/empty `tyre_conditions` as data-quality exceptions (not failures). |
| Rollback | `inspections` read-only; raw snapshot guarantees lossless reconstruction. |

---

## 6. Accidents (already structured)

**Sources:** `accidents`, `accident_parts`, `accident_remarks` (+ `accident_audit_log`)
**Targets:** `accidents`, `accident_parts`, `accident_remarks` (re-homed under tenant hierarchy)

| Aspect | Detail |
|---|---|
| Source columns | Accident header (asset, date, location, severity, status) + structured children parts/remarks; photos as private `tp-storage://` refs. |
| Target | Same relational shape, re-parented to `site_id`/`asset_id`/`org_id`; photo refs unchanged (already private). |
| Transform | Resolve tenant path; carry children FKs; preserve photo `storageRef`s (no public-URL conversion). |
| Dedupe key | `accidents.id` (1:1); children keyed by existing FK + ordinal. |
| Reconciliation | Header + child counts match source exactly; verify every photo ref resolves via signed URL. |
| Rollback | Legacy accident tables read-only; `accident_audit_log` folded into unified `audit_events` (§4). |

---

## 7. Cross-Cutting Transform Rules

- **Tenant back-fill:** resolve geographic `site`/`country[]` text → `site_id`/`country_id`/`org_id`. Rows whose site/country cannot be resolved go to an `unmapped` bucket and **block cutover** until corrected.
- **Storage refs:** never convert `tp-storage://` → public URL during migration. Signed-URL resolution stays server-side.
- **Idempotency:** every movement/event carries `(source_table, source_id)` so dry-runs and re-runs are safe.
- **Data-quality flags** (not failures): duplicate serials, invalid pressure/tread, inconsistent odometer, unrealistic tyre-life - surfaced in the reconciliation report for engineering review.

---

## 8. Reconciliation Report Template

| Field | Description |
|---|---|
| `module` | Asset / Inventory / Audit / Inspection / Accident |
| `old_count` | Sum of legacy source rows |
| `new_count` | Canonical rows created |
| `duplicates_collapsed` | Rows merged by dedupe key |
| `failures` | Rows that errored (must be 0 to pass) |
| `unmapped` | Rows with unresolved tenant scope (must be 0 to pass) |
| `data_quality_flags` | Advisory anomalies (do not block) |
| `checksum_match` | Balance/count invariants verified (Y/N) |

A module cutover is authorised only on a passing report (`failures == 0`, `unmapped == 0`, invariants hold), with the legacy tables held read-only.
