# Data Intake Center — Migration Plan (Phase 0)

> **Scope.** The phased rollout of the Multi-Country Data Intake Center per
> `Data correction.md` §23. The DB foundation (Phase 1) is **already on `main`**
> (`MIGRATIONS_V45_IMPORT_CENTER.sql` + `MIGRATIONS_V46_IMPORT_COMMIT.sql`). This
> plan sequences the adapter migration that follows, with a per-adapter contract
> (canonical map, natural key, validation, approval, commit, reconciliation,
> rollback). **Non-destructive:** `pending_uploads` and the legacy uploaders stay
> live until each module's replacement is in place and reconciled.
>
> Companion: `IMPORT_CENTER_MULTICOUNTRY_AUDIT.md`, `IMPORT_CENTER_DATA_MODEL.md`,
> `IMPORT_CENTER_COMMIT_FRAMEWORK.md`, `IMPORT_CENTER_SECURITY_PLAN.md`,
> `IMPORT_CENTER_TEST_CASES.md`.

---

## 1. Phase map

| Phase | Deliverable | Status |
|---|---|---|
| **0** | Phase-0 docs (audit, data model, security, migration, test cases) | **This PR** |
| **1** | Staging schema + commit framework | **DONE** — `import_files/batches/batch_sheets/rows/row_issues/mapping_profiles/mapping_rules/attachment_matches/custom_field_catalog/import_audit_events` (V45); `import_commit_batch/import_reverse_batch/import_reprocess_row/import_target_table` (V46); private `import-files` bucket |
| **1b** | Country-scope gate + role-based approval RPC + PWA cache exclusions + shared parse/map/validate engine (`src/lib/import/*`) | **Next** — closes the §6 gaps in the audit / §3–§6 of the security plan |
| **2** | Priority adapters: **Fleet → Tyre → Stock** | **DONE** — engine wired end-to-end for all 3 (parse→map→validate→in-batch+**live-table** dedup→commit); `import_existing_keys` RPC (V47) skips re-imports of existing live records; legacy uploaders (FleetMaster/StockManagement/UploadData) route into the engine via `?module=`; reconciliation report on history; 421 tests incl. Arabic-header/cross-country/dup-serial-as-event/negative-stock scenarios |
| **3** | Accidents + attachments (ZIP packages, private docs) | **DONE** — accident adapter (ACCIDENT_FIELDS EN+AR synonyms, financial-integrity validation, country+claim_no/police_report_no natural key), live-dedup branch (V48), ZIP evidence ingestion (`attachments.js` extract+match by claim/police/asset → private `import-files` bucket → `import_attachment_matches`), legacy `Accidents.jsx` routed into engine; 450 tests |
| **4** | Remaining: inspections, work orders, warranty, suppliers, drivers, gate pass, GPS/ERP, custom | Pending 3 |

Ordering rationale: Fleet first (simplest natural key, feeds asset references),
Tyre second (richest legacy uploader to preserve), Stock third (financial
approval + adjustment workflow). Accidents (Phase 3) needs the attachment/ZIP
pipeline. Phase 4 modules reuse the same adapter pattern with no new schema.

---

## 2. The adapter contract (every module implements this)

Each adapter is a small declarative module under `src/lib/import/adapters/<module>.js`
plus a `target` entry in `import_target_table()`. It defines:

1. **Canonical field map** — source synonyms (EN/AR) → canonical target columns.
2. **Natural key** — module-specific, **always org + country scoped**.
3. **Validation rules** — required fields, ranges, cross-field, ambiguity flags.
4. **Approval policy** — auto vs required, and which role (from the security plan).
5. **Commit** — staged rows go live **only** via `import_commit_batch()` (V46).
6. **Reconciliation** — counts/spot-checks vs the legacy importer before cutover.
7. **Rollback** — `import_reverse_batch()` removes only this batch's rows.

The engine (parse → map → stage → validate → review → approve → commit) is shared;
adapters supply only the module-specific map/key/rules.

---

## 3. Phase 2 — priority adapters

### 3.1 Fleet / Asset Master  → `vehicle_fleet`

| Aspect | Definition |
|---|---|
| Canonical map | `Asset No / Fleet No / رقم المعدة → asset_no`; `Plate → plate_number`; `Chassis/VIN → chassis_no`; `Make/Model/Year`; `Site/Project/الموقع → site`; `Status`; `Meter → odometer`; tyre config/size/count; registration & insurance; GPS group; driver. Unknown cols (Driver Name, GPS Group, Registration Expiry, Fuel Type, Contract No, Workshop Group) → `import_rows.custom_data` + `custom_field_catalog`, **never dropped**. |
| Natural key | `organisation_id + country + company_id + asset_no` (replaces the unsafe global `onConflict:'asset_no'`) |
| Validation | `asset_no` required; site/country known; registration/insurance expiry → compliance alert; meter sane |
| Approval | Auto-commit after validation if source trusted; else Country PMV Manager |
| Commit / rollback | `import_commit_batch` (`fleet→vehicle_fleet`) / `import_reverse_batch` |
| Reconciliation | Row count + asset_no set parity vs `FleetMaster.jsx` upsert; confirm no country collisions |

### 3.2 Tyre Lifecycle  → `tyre_records`

| Aspect | Definition |
|---|---|
| Canonical map | Reuse the existing strong synonyms from `UploadData.jsx` (fuzzy + Arabic + `field_synonyms`). Importer must first **classify the file** (master list / lifecycle event / stock opening / supplier delivery / inspection / warranty) — not every serial row is the same record type. |
| Natural key | Master: `org + country + tyre_serial`. Event: `tyre_serial + asset + event_type + event_date + source_doc/job_card`. |
| Validation | Serial required; fitted-before-manufacture/purchase blocked; removal-mileage < fitment-mileage blocked; missing cost flagged |
| Approval | Lifecycle event auto-commits **only when no conflict**; else review |
| Commit / rollback | `import_commit_batch` (`tyre→tyre_records`) / `import_reverse_batch` |
| Reconciliation | Compare staged vs legacy `pending_uploads`/`tyre_records.insert`; preserve `extra_fields` parity |

### 3.3 Stock & Procurement  → `stock_records` (+ `stock_movements`)

| Aspect | Definition |
|---|---|
| Canonical map | item code/desc; serial; brand/pattern/size; warehouse/bin; qty/UoM; price + **currency (ISO)**; supplier; PO/GRN/invoice; snapshot date; movement type |
| Natural key | Opening: `item_code + country + warehouse + bin + snapshot_date`. Movement: `source_doc_no + line_no + country/company`. |
| Validation | Negative qty without approved adjustment blocked; missing currency on price list blocked; **no silent currency conversion** (store original amount + currency) |
| Approval | **Required** (Finance/Stock Approver); no overwrite of live balance without approval; controlled adjustment workflow |
| Commit / rollback | `import_commit_batch` (`stock→stock_records`) / `import_reverse_batch` |
| Reconciliation | Balance delta reconciled against `stock_movements`; assert no balance change pre-approval |

---

## 4. Phase 3 — accidents + attachments

| Aspect | Definition |
|---|---|
| Target | `accidents` (replaces the fixed-column `Accidents.jsx` bulk uploader) |
| File support | Excel/CSV **+ optional ZIP** package (photos, police reports, invoices, quotations, estimates, insurance/claim/workshop docs) |
| Attachment matching | `import_attachment_matches` by accident_no / claim_no / asset_no / source_doc / configurable filename pattern; all docs stored **privately** (signed URLs only) |
| Canonical map | accident no/date/time; country/company/site; asset; driver; insurer/broker; policy/claim no; vendor; estimate/approved/actual cost; claim/recovered/excess/unrecovered; downtime; root cause; repair/closure status |
| Natural key | `country/company + accident_no` **or** `claim_no`; if absent → review match on `asset + date + driver + site + approx cost` |
| Validation | actual cost > approved → flag; recovery > claim → block; missing estimate/invoice/approval/closure → follow-up task |
| Approval | **Required** (Manager + Finance for cost); never auto-post |
| Post-commit value | claim follow-up tasks, overdue/unrecovered flags, link tyre/wheel damage to tyre lifecycle, link downtime to asset history — all linked to batch + source row |
| Rollback | `import_reverse_batch`; attachments retained per retention policy |

Urgent field accident reporting stays separate/fast but reuses the same data
model, validation, private-file rules, and audit trail.

---

## 5. Phase 4 — remaining adapters (same pattern)

| Module | Target table | Natural key (org+country scoped) | Approval |
|---|---|---|---|
| Inspections | `inspections` | `asset + template + datetime + inspector + source_ref` | Auto if trusted device |
| Work orders | `work_orders` | `wo_no + country/company` | Manager |
| Warranty | `warranty_claims` | `tyre_serial + claim_ref` (serial **required**) | Required |
| Suppliers | (supplier master) | `org + country + supplier_name/code` (same name across countries = distinct) | Required |
| Drivers | (driver master) | `org + country + driver_id` | Operational |
| Gate pass | `gate_passes` | `gatepass_no + country` | Operational |
| GPS / ERP | staging only / integration | source-defined | Auto after profile approval |
| Custom | staging only | n/a — preserved in `custom_data` + catalog | n/a |

Modules without a live target in `import_target_table()` stay in staging and are
surfaced via the Custom Field Catalogue until promoted.

---

## 6. Non-destructive guarantees

| Guarantee | How |
|---|---|
| Legacy history readable | `pending_uploads`, `column_mappings`, `field_synonyms`, `upload_history` are **untouched** by V45/V46 |
| No uploader broken before replacement | Each legacy uploader (`UploadData.jsx`, `FleetMaster.jsx`, `StockManagement.jsx`, `Accidents.jsx`) stays live until its adapter is reconciled, then is switched to open the shared engine with the module pre-selected |
| No schema rename/drop pre-migration | Additive only; cutover per module after reconciliation passes |
| Rollback safety | `import_reverse_batch()` deletes only rows linked via `target_record_id` — never later valid business activity (Test Case 14) |
| Green build maintained | Web build/tests + mobile typecheck must stay green at every phase boundary (Test Case 15) |

---

## 7. Per-phase completion report (required, per directive §25)

Each phase PR must report: what changed; files changed; migrations created;
modules migrated; country-scope rules implemented; security improvements; tests
run + results; data reconciliation result; remaining risks; exact next phase.
Nothing is "complete" until implemented, tested, **and wired into the real user
flow**.
