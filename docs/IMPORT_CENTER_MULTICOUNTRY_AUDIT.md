# Data Intake Center - Multi-Country Import Audit (Phase 0)

> **Scope.** Read-only audit of the *current* import situation across the TyrePulse
> platform, and what the new **Multi-Country Data Intake Center** (`Data correction.md`)
> fixes. The DB foundation is already on `main` (`MIGRATIONS_V45_IMPORT_CENTER.sql`
> staging schema + `MIGRATIONS_V46_IMPORT_COMMIT.sql` commit RPCs); this document
> maps each existing gap to the staging schema and the work still outstanding. No
> code or schema is changed here.
>
> Companion Phase-0 docs: `IMPORT_CENTER_DATA_MODEL.md`,
> `IMPORT_CENTER_COMMIT_FRAMEWORK.md`, `IMPORT_CENTER_SECURITY_PLAN.md`,
> `IMPORT_CENTER_MIGRATION_PLAN.md`, `IMPORT_CENTER_TEST_CASES.md`.

---

## 1. The requirement that drives this

TyrePulse operates across **three countries**, with different companies/legal
entities, sites, warehouses, currencies, date formats, time zones, suppliers, and
local naming conventions. The operating principle from the directive:

- **Never mix records from one country into another by accident.**
- **Every upload must keep all original data**, even columns the system does not
  yet understand: original private file → import batch → per-sheet records → raw
  rows → mapped/transformed rows → validation/conflict review → approval → live
  records → audit/reprocess/rollback.
- **No browser/mobile insert directly into live operational tables.** A
  server-side commit is the only path into `vehicle_fleet`, `tyre_records`,
  `stock_records`, `accidents`, etc.

The current importers were each built in isolation, predate the org/country
model, and violate one or more of these principles. This audit is the factual
baseline for the migration (Phase 2+).

---

## 2. Current importers - inventory

| Importer | File | Mechanism | Raw preservation | Direct live insert? | Country/org scope |
|---|---|---|---|---|---|
| **Tyre upload** (strongest) | `src/pages/UploadData.jsx` (~1,724 lines) | Client parse → smart map → preview → dup review → `pending_uploads` + `tyre_records.insert` / `stock_records.insert` | Partial - unmapped cols → `tyre_records.extra_fields` (capped 50 keys); whole staged set → `pending_uploads.rows` (one JSON blob) | **Yes** (`tyre_records`, `stock_records` chunked inserts) | `country` is free text on `upload_history`; no org scope |
| **Fleet Master** | `src/pages/FleetMaster.jsx` | Client parse → fixed header map → `vehicle_fleet.upsert(onConflict:'asset_no')` | **None** - unmapped columns dropped | **Yes** (`vehicle_fleet`) | `asset_no` conflict key is **global** - collides across countries |
| **Stock** | `src/pages/StockManagement.jsx` (+ stock path in `UploadData.jsx`) | Client → `stock_records.insert` + `stock_movements.insert` | **None** for unmapped cols | **Yes** (`stock_records`) | No org/country scope; balance writes unguarded |
| **Accident bulk** | `src/pages/Accidents.jsx` | Fixed-column template → validate `_valid` flag → `accidents.insert(payload)` | **None** - only template columns kept; extras discarded | **Yes** (`accidents`) | No country scope; no attachment/ZIP package support |
| **Mobile** | `mobile/app/*` (`recordQueue`) | Generic queued inserts directly to Supabase tables | None | **Yes** | Table-level RLS only |

### 2.1 What the tyre uploader does well (must be preserved, not lost)

`src/pages/UploadData.jsx` is the reference for quality and its capabilities are
the bar the shared engine must meet or exceed:

- **Smart mapping** with substring + Levenshtein fuzzy fallback and a confidence
  score 0-100 (`smartMapping`, `matchScore`).
- **Arabic/English synonyms** and transliterations baked into the guess list
  (e.g. `Serial No.` / `رقم التسلسل`); user-defined permanent synonyms from
  `field_synonyms` score 100.
- **Saved mappings** recalled by header fingerprint (`fingerprintHeaders` →
  `column_mappings.fingerprint`).
- **Data-quality preview + duplicate review** (exact/fuzzy) before commit.
- **Unmapped-column preservation** into `extra_fields` with a visible
  "these N columns will be saved and not lost" notice.

The directive is explicit: **do not create weaker per-module uploaders.** Fleet,
Stock and Accident currently *are* the weaker uploaders, and the shared engine
must lift them to this standard.

---

## 3. Current staging & storage reality

| Concern | Current state | Risk |
|---|---|---|
| Staging shape | New imports land in `pending_uploads.rows` as **one large JSONB blob** | Not per-row queryable, not per-row reviewable, no per-row issue attachment, lossy at scale |
| Original file retention | Not consistently retained in private storage | Source-of-truth lost; cannot re-derive a value after import; no audit-grade provenance |
| Mapping profile identity | Keyed by **header fingerprint alone** (`column_mappings.fingerprint`) | Two unrelated countries/modules with the same headers collide on one profile; no module/source/country/company/version scope |
| Live-record preservation | Relies on `tyre_records.extra_fields` only (and only for tyre) | Fleet/Stock/Accident drop unknown columns entirely; `extra_fields` capped at 50 keys |
| Attachments | Accident photos can produce **public URLs**; no ZIP package flow | Confidential police reports/invoices world-readable; broker ZIP packages unsupported |
| Write boundary | Browser/mobile insert directly into live tables | No server-side permission/scope/idempotency/atomicity guarantees |

---

## 4. Gaps by severity

### 4.1 Critical (data loss / cross-country leakage / live-table integrity)

| # | Gap | Where | Fixed by |
|---|---|---|---|
| C1 | **Unmapped columns dropped** in Fleet & Stock imports | `FleetMaster.jsx`, `StockManagement.jsx` | `import_rows.raw_source_data` + `custom_data` preserve every cell; `custom_field_catalog` surfaces them (V45) |
| C2 | **Direct browser/mobile inserts into live tables** (no server guard) | all importers, `recordQueue` | `import_commit_batch()` SECURITY DEFINER RPC is the only commit path (V46); browser inserts to be retired per adapter |
| C3 | **No country scope** - `asset_no` upsert is globally unique; same asset legitimately exists in 2 countries | `FleetMaster.jsx` (`onConflict:'asset_no'`) | `import_batches.country` (NOT NULL) + country-aware natural keys at commit; org isolation already RESTRICTIVE in RLS (V45) |
| C4 | **Original files not retained privately** | all importers | `import_files` (private `import-files` bucket, `sha256`, metadata-only DB) (V45) |
| C5 | **Public URLs for accident attachments** | `Accidents.jsx` | Private bucket + signed URLs; path `org/country/module/batch/uuid` (V45 storage policies) - see `IMPORT_CENTER_SECURITY_PLAN.md` |

### 4.2 High (review quality / approval / provenance)

| # | Gap | Where | Fixed by |
|---|---|---|---|
| H1 | **Single JSON blob staging** - no per-row review/issues | `pending_uploads.rows` | `import_rows` (per row) + `import_row_issues` (per field) (V45) |
| H2 | **No approval workflow** - staged data goes live immediately | Fleet/Stock/Accident | `import_batches.approval_status`; commit blocked unless `approved` (V46) |
| H3 | **Mapping profile fingerprint too broad** | `column_mappings.fingerprint` | `import_mapping_profiles` keyed by module+source+country+company+fingerprint+**version** (V45) |
| H4 | **No source-row → live-record link** | all importers | `import_rows.target_record_id` set on commit (V46); enables rollback/reprocess |
| H5 | **No rollback** - a bad import cannot be reversed safely | all importers | `import_reverse_batch()` deletes only rows linked via `target_record_id` (V46) |
| H6 | **Accident fixed columns + no ZIP** | `Accidents.jsx` bulk | `import_attachment_matches` (accident_no/claim_no/asset_no/source_doc/filename pattern) (V45); Phase 3 adapter |

### 4.3 Medium (consistency / observability / UX)

| # | Gap | Where | Fixed by |
|---|---|---|---|
| M1 | **No multi-sheet identity** - sheets flattened | all importers | `import_batch_sheets` (sheet name/order/header/columns/summary) (V45) |
| M2 | **No import history/audit per action** | partial (`upload_history` tyre only) | `import_audit_events` (append-only) (V45) |
| M3 | **Ambiguous dates / mixed units / currency** auto-imported | all importers | Profile carries `date_format`/`timezone`/`source_currency`/`unit_system`; validation engine flags ambiguity (Phase 1 engine) |
| M4 | **No custom-field insight** for product decisions | none | `custom_field_catalog` (occurrence count, examples, promote/archive) (V45) |
| M5 | **Reprocessing a corrected row impossible** | none | `import_reprocess_row()` resets uncommitted rows (V46) |
| M6 | **Per-module uploaders diverge** in UX/validation | Fleet/Stock/Accident | One shared engine + module adapters (Phase 2+) |

---

## 5. What is now in place (foundation on `main`)

| Layer | Artefact | Status |
|---|---|---|
| Staging schema | `import_files`, `import_batches`, `import_batch_sheets`, `import_rows`, `import_row_issues`, `import_mapping_profiles`, `import_mapping_rules`, `import_attachment_matches`, `custom_field_catalog`, `import_audit_events` | **DONE - V45**, all org/country-scoped, RLS on every table (RESTRICTIVE org isolation + `is_approved_and_unlocked()` writes) |
| Private storage | `import-files` bucket (private, 100 MB cap) + storage policies | **DONE - V45** |
| Commit framework | `import_commit_batch()`, `import_reverse_batch()`, `import_reprocess_row()`, `import_target_table()` | **DONE - V46**, SECURITY DEFINER, org-scoped, atomic, idempotent, audited |
| Legacy | `pending_uploads`, `column_mappings`, `field_synonyms`, `upload_history` | **Untouched** - remain readable; not yet retired |

---

## 6. Residual risks the foundation does not yet close

These are tracked into `IMPORT_CENTER_SECURITY_PLAN.md` and the migration plan;
they are **not** regressions, they are the remaining Phase 2+ work.

1. **Country-scope on writes is not yet enforced in RLS.** V45 RLS enforces **org**
   isolation (RESTRICTIVE `organisation_id = app_current_org()`), but `profiles.country`
   is a loose `text[]`; a same-org cross-country read/commit gate must be added in
   the commit RPC + UI (the commit RPC stamps `country` from the batch but does not
   yet verify the caller is assigned that country).
2. **Role-scoped approval gates not yet in the RPC.** `import_commit_batch()`
   checks `is_approved_and_unlocked()` and org match, but the Finance-approves-stock /
   no-self-approval-of-financial rules live in the (still-to-build) approval UI/RPC.
3. **Reversal lacks an "unmodified-since-import" guard** (documented limitation in
   `IMPORT_CENTER_COMMIT_FRAMEWORK.md`).
4. **Existing uploaders still write directly to live tables.** They stay in place
   until each module's adapter replaces them (Phase 2-4); no destructive change
   until reconciliation per adapter is documented.

---

## 7. Audit conclusion

The DB foundation eliminates the *structural* causes of data loss and unsafe
writes: every original file and row is now preservable, profiles are properly
scoped and versioned, and the only sanctioned path to live tables is a guarded,
atomic, idempotent, audited server-side RPC. The remaining work is **adapter
migration** (Fleet → Tyre → Stock first) plus the **country-scope and role-based
approval gates**, sequenced in `IMPORT_CENTER_MIGRATION_PLAN.md` and verified by
`IMPORT_CENTER_TEST_CASES.md`. No existing uploader is broken until its
replacement is in place and reconciled.
