# Data Model Consolidation Plan

**Status:** Phase 0 - planning only. No schema is altered by this document.
**Track:** Hardening of the existing Vite + React 19 / Expo SDK 54 / Supabase Postgres stack. No migration to any new backend.
**Non-negotiable:** Backward-compatible only. No table is dropped or renamed without a migration, reconciliation report, backup, read-only window, and rollback. Existing screens keep working throughout.

---

## 1. Why this plan exists

The database holds **46 tables** spread across **48 fragmented root SQL files** (`MIGRATIONS_V1.sql` ... `MIGRATIONS_V41_RLS_POLICY_CLEANUP.sql`, plus `MASTER_MIGRATION.sql` and `MIGRATIONS_SAFE.sql`). Several business domains have **two competing masters**, and audit history is split across **four** tables. The platform cannot claim a single source of truth until these are consolidated under controlled, reversible steps.

This plan names the **canonical** source per domain and defines the **backward-compatible path** to reach it without data loss or screen breakage.

### Duplicated / fragmented domains at a glance

| Domain | Canonical (keep) | Legacy (deprecate last) | Consolidation mechanism |
|---|---|---|---|
| Fleet / Asset master | `vehicle_fleet` | `fleet_master` | Compatibility view + sync + reconciliation |
| Inventory / Stock | `stock_records` + `stock_movements` | `stock` | Movement ledger + compatibility view |
| Audit history | new `audit_events` (unified) | `audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log` | Backfill into unified format, dual-write, retire writers |
| Tyre lifecycle | `tyres` + serial-level event ledger | scattered JSON / change rows | Transactional RPC workflow |
| Inspections | `inspections.tyre_conditions` (JSONB snapshot) **plus** structured child rows | JSON-only reporting | Add structured rows; keep snapshot |

---

## 2. Shared backward-compatible cutover pattern

Every consolidation below follows the **same five-stage pattern**. Do not skip a stage.

| Stage | Action | Exit condition |
|---|---|---|
| **1. Compatibility view** | Create a view exposing the canonical table under the legacy table's name/shape (after renaming the legacy physical table to `*_legacy`), so existing reads keep working. | All existing queries resolve against the view with identical columns. |
| **2. Sync scripts** | Backfill canonical from legacy; for the transition, dual-write or trigger-sync legacy ↔ canonical so both stay consistent. | Both stores converge on every write. |
| **3. Reconciliation report** | Generate a report: rows in `old`, rows in `new`, **failures** (present in one only), **duplicates** (same business key twice). Stored as a query/materialised report, re-runnable. | Failures and dupes are explained or resolved; sign-off recorded. |
| **4. Read-only window** | Freeze writes to the legacy table (revoke write grants / RLS deny), serve reads from the canonical via the view, monitor. | One full operational cycle with zero divergence and no app errors. |
| **5. Deprecate last** | Only after the read-only window passes: retire legacy writers, mark `*_legacy` deprecated, retain for the rollback window, then archive. | Backup retained; rollback rehearsed; CHANGELOG entry written. |

**Rollback at any stage:** re-point the compatibility view at the legacy physical table and re-enable legacy writes. Because the legacy table is never dropped during cutover, rollback is a metadata change, not a data restore.

---

## 3. Fleet / Asset master

### 3.1 Decision

| | |
|---|---|
| **Canonical** | `vehicle_fleet` |
| **Legacy** | `fleet_master` (rename to `fleet_master_legacy` at Stage 1; never dropped during cutover) |
| **Scope model** | Geographic only - `site` (text) + `country` (text[]) on `profiles`, enforced by RLS via `app_role()` / `app_is_active()` / `app_is_elevated()`. The `organisations` table **exists but holds 0 rows and is not in RLS**; org scoping is **forward-compatible** (column reserved, populated later), not active today. |

### 3.2 Canonical asset field set

The canonical master asset record (on/projected onto `vehicle_fleet`) must carry:

| Field | Notes |
|---|---|
| `org_id` | Reserved FK to `organisations`; nullable until org scoping activates. Do **not** remove. |
| `country` | Aligns with `profiles.country[]` scoping. |
| `project` | Operational grouping. |
| `site` | Aligns with `profiles.site` scoping; primary RLS dimension today. |
| `asset_no` | Business key (unique within org/site). |
| `fleet_no` | Operational fleet number. |
| `vehicle_type` | Truck, trailer, loader, etc. |
| `make` / `model` / `year` | |
| `plate` / `chassis` | Identity for compliance and accidents. |
| `status` | active / workshop / standby / disposed. |
| `meter` | Current odometer or hour-meter. |
| `tyre_size` | Default fitment size. |
| `tyre_count` | Expected position count. |
| `axle_config` | e.g. 6x4, axle/position map. |
| `pressure_standard` | Target pressure per position class (steer/drive/trailer). |
| `inspection_frequency` | Drives inspection schedules / compliance KPI. |

Fields not yet present become **additive, nullable** columns on `vehicle_fleet` via migration - never a rename of existing columns.

### 3.3 Path

1. Compatibility view `fleet_master` → selects from `vehicle_fleet` with the legacy column shape.
2. Backfill any `fleet_master`-only records into `vehicle_fleet` keyed on `asset_no` (fall back to `plate`/`chassis`).
3. Reconciliation report: `vehicle_fleet` count vs `fleet_master_legacy` count; assets in legacy-only; duplicate `asset_no`/`plate`.
4. Read-only window on legacy; all writes go to `vehicle_fleet`.
5. Deprecate `fleet_master_legacy` after sign-off.

---

## 4. Inventory / Stock - movement-ledger model

### 4.1 Decision

| | |
|---|---|
| **Canonical** | `stock_records` (balances) + `stock_movements` (event ledger) |
| **Legacy** | `stock` (rename to `stock_legacy`; compatibility view keeps `stock` screens working) |
| **Principle** | Manual stock totals must **never** be the primary source. Current balance is **derived** from the immutable movement ledger. |

### 4.2 Canonical formula

```
current_available =
    opening_balance
  + receipts
  + returns
  + transfer_in
  - issues
  - transfer_out
  - scrap
  ± approved_adjustments
```

Every term is a typed row in `stock_movements` (`movement_type`, `qty`, `item`, `site`, `ref_entity`, `actor`, `approved_by`, `created_at`). `stock_records.current_available` is a **maintained projection** (trigger or scheduled snapshot) of the ledger, not a hand-editable field. Adjustments require an approval reference; no free-text total overwrite.

### 4.3 Keep-screens-working strategy

- Existing `StockManagement.jsx`, `StockReplenishment.jsx`, and mobile `stock.tsx` continue to read `stock_records` for balances - unchanged contract.
- The legacy `stock` table is exposed as a **compatibility view** over `stock_records` so any direct legacy reads resolve.
- Writes that today mutate totals are converted to **ledger inserts** behind the data-service layer; the projection updates the balance. Screens see the same numbers, now provably derived.
- Reconciliation report compares legacy `stock` quantities against the ledger-derived balance per item/site; any delta is recorded as a one-time **opening_balance** movement so the ledger reproduces the legacy figure exactly.

---

## 5. Audit history - one unified event format

### 5.1 Decision

| | |
|---|---|
| **Canonical** | new `audit_events` table |
| **Legacy** | `audit_log`, `audit_log_v2`, `inspection_audit_log`, `accident_audit_log` - backfilled, then writers retired |

### 5.2 Unified audit event format

| Field | Description |
|---|---|
| `org_id` | Organisation (nullable until org scoping activates). |
| `user_id` | Actor (`auth.uid()`). |
| `action` | create / update / delete / approve / close / sync, etc. |
| `module` | assets, tyres, inspections, work_orders, stock, accidents, uploads, reports, users. |
| `entity_type` | Logical entity name. |
| `entity_id` | Affected row id. |
| `prev_value` | JSONB snapshot before change. |
| `new_value` | JSONB snapshot after change. |
| `ip_device` | IP / device metadata when available. |
| `created_at` | Timestamp (server). |
| `source` | web / mobile / edge-function / rpc / erp-sync. |

### 5.3 Path

1. Create `audit_events` with the format above and module-scoped RLS (read gated by `app_role()` / `app_is_elevated()`; insert-only for actors).
2. Backfill the four legacy audit tables into `audit_events`, mapping each into the unified columns; tag `source` per origin.
3. Dual-write: keep legacy audit writes during transition while also writing `audit_events`.
4. Reconciliation report: counts per legacy table vs backfilled rows; flag unmapped rows.
5. Retire legacy writers; legacy audit tables become read-only history, retained for the rollback window. No business action may proceed without an `audit_events` row.

---

## 6. Tyre lifecycle - serial-level identity + transactional change workflow

### 6.1 Serial-level identity

Each physical tyre is identified by a **permanent serial**, carrying: brand, pattern, size, manufacturing date, supplier, purchase cost, warranty details, current status, current asset + wheel position, fitment date/KM, removal date/KM, removal reason, inspection measurements, repairs, retread record, damage record, warranty claim, scrap record, and a full lifecycle timeline (the serial-level event ledger).

### 6.2 Transactional tyre-change workflow

A tyre change is **one controlled transaction**, not several independent frontend writes that can half-complete. Implement as a single Postgres **RPC** (`SECURITY DEFINER`, RLS-aware) executed atomically:

```
BEGIN
  1. Remove tyre from asset position
  2. Record final KM + removal reason
  3. Insert tyre event (serial-level ledger)
  4. Update tyre status
  5. Fit replacement tyre to the position
  6. Update vehicle tyre layout
  7. Insert stock movement (issue of replacement / receipt of removed) when applicable
  8. Write audit_events row
COMMIT  -- all-or-nothing
```

Mobile (`tyre-change.tsx`) and web (`TyreExchange.jsx`, `TyreLifecycle.jsx`) call this RPC instead of issuing multiple table writes. Offline, the mobile client enqueues a single typed `SubmitTyreChange` command with an idempotency key; the RPC is idempotent on replay.

### 6.3 Recently-added supporting tables

`warranty_claims`, `recalls`, `tyre_specifications`, `tyre_rotations`, `inspection_schedules`, `supplier_ratings`, `supplier_contracts` already exist (real, RLS-protected) and are wired into the lifecycle (warranty claim, recall, spec, rotation, schedule, supplier scorecard) - no new duplicates are created for these.

---

## 7. Inspections - structured rows alongside the JSONB snapshot

### 7.1 Decision

`inspections.tyre_conditions` (JSONB) is **kept** as the immutable capture snapshot. Reporting, filtering, warranty, CPK, and failure analysis require **structured child rows** derived from each inspection. This mirrors the **accidents** domain, which already uses structured children (`accident_parts`, `accident_remarks`).

### 7.2 Approach

- Add structured child rows (one per inspected tyre position) capturing: asset id, site/project/org scope, inspector, datetime, odometer/hour meter, template version, overall result, position, pressure, tread depth, damage condition, severity, photo reference, required action, supervisor review, reinspection due date.
- Populate from `tyre_conditions` on write (and backfill historical inspections from existing JSON).
- The JSON snapshot remains the source of capture truth; structured rows are the **reporting projection** kept in sync. No JSON is discarded.
- Critical findings auto-propose corrective actions, using standard failure categories (low/high pressure, puncture, sidewall damage, tread separation, exposed cord, irregular wear, missing valve cap, rim issue, incorrect fitment, site-condition damage, operator misuse, unknown-pending-investigation).

---

## 8. SQL file consolidation (housekeeping)

The 48 fragmented root SQL files are **not deleted** in this plan. Going forward, new schema changes land as ordered, idempotent migrations referenced in `docs/CHANGELOG_ENGINEERING.md`. `MASTER_MIGRATION.sql` / `MIGRATIONS_SAFE.sql` remain the consolidated baseline; `MIGRATIONS_V1..V41` are historical and retained for rollback/audit.

---

## 9. Guardrails

- No destructive change without: migration script + reconciliation report + backup + read-only window + rollback rehearsal.
- Legacy tables are renamed (`*_legacy`) and shadowed by compatibility views, never dropped during cutover.
- `organisations` column references are reserved (nullable), never removed, ready for org-scope activation.
- Every consolidation step records a `docs/CHANGELOG_ENGINEERING.md` entry and produces a re-runnable reconciliation report.
