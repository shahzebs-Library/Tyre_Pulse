# Data Intake Center — Data Model (V45)

> Migration `MIGRATIONS_V45_IMPORT_CENTER.sql` (applied). Additive, backward-
> compatible DB foundation for the Multi-Country Data Intake Center
> (`Data correction.md`). The legacy `pending_uploads` table is untouched and
> stays readable; new imports use this per-row staging model.

## Pipeline
```
import_files (private bytes + metadata)
  → import_batches (one run per sheet/module/country)
      → import_batch_sheets (per-sheet identity)
      → import_rows (EVERY source row: raw + mapped + transformed + custom JSONB)
          → import_row_issues (row-level validation)
  mapping: import_mapping_profiles → import_mapping_rules
  attachments: import_attachment_matches
  insight: custom_field_catalog
  trail: import_audit_events (append-only)
```
Live operational tables are **not** written here. The eventual commit step is a
server-side SECURITY DEFINER RPC (next slice) — never a browser insert.

## Tables (10) — all org/country-scoped
Each carries `organisation_id` (default-org, FK), `created_at`, and (where
relevant) `country`, `created_by`. Highlights:

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `import_files` | original file authority record (bytes in private `import-files` bucket) | `storage_path`, `sha256` (UNIQUE per org → dedupe), `mime_type`, `size_bytes`, `validation_status`, `retention_status` |
| `import_batches` | a controlled import run | `module`, `country` (NOT NULL), `company_id`, `project`/`site`, header rows, `mapping_profile_id`+version, `date_format`/`timezone`/`source_currency`/`unit_system`, `approval_status`, `import_status`, full row counters, reviewer/approver |
| `import_batch_sheets` | per-sheet identity in a workbook | `sheet_name`, `sheet_order`, `header_row`, `source_columns`, `summary` |
| `import_rows` | **every source row preserved** | `raw_source_data`, `mapped_data`, `transformed_data`, `custom_data` (all JSONB), `validation_status`, `dup_status`, `action`, `target_module`, `target_record_id`, `row_fingerprint` |
| `import_row_issues` | validation findings | `severity` (info/warning/error), `issue_code`, `message`, original/transformed value, `suggested_fix`, resolved |
| `import_mapping_profiles` | reusable, **versioned** profiles | identity = `module`+`source_system`+`country`+`company_id`+`header_fingerprint`+`version` (never fingerprint alone), `unit_settings`, `active` |
| `import_mapping_rules` | per-profile column rules | `source_header`, `target_field` (null = preserve as custom), `transform`, `alias_rule`, `confidence` |
| `import_attachment_matches` | photo/doc/ZIP → record | `match_key`, `match_kind`, `matched_entity_type/id`, `status` |
| `custom_field_catalog` | unknown-field insight | `field_name`, `occurrence_count`, `example_values`, first/last seen, `mapping_status`, `recommendation` (UNIQUE per org/module/country/field) |
| `import_audit_events` | append-only import trail | `batch_id`, `actor`, `action`, `detail` |

## Security (RLS) — verified
Every table: **RESTRICTIVE** org-isolation (`organisation_id = app_current_org()`)
ANDed on top of permissive **read** (authenticated) + **write**
(`is_approved_and_unlocked()`). 30 policies total (3 × 10). The `import-files`
bucket is **private** (100 MB cap); objects readable/insertable by authenticated
users, deletable only by elevated roles. Files are served via short-lived signed
URLs (path convention `org/country/module/batch/uuid`). Country scope on writes
is enforced by the commit RPC (next slice) in addition to org isolation.

## Why per-row (not a JSON blob)
`pending_uploads.rows` stored an entire import as one JSON field — unqueryable,
unreviewable per row, and lossy. `import_rows` stores each source row with its
raw/mapped/transformed/custom layers, so every original value stays retrievable,
issues attach per row, and corrected rows can be reprocessed individually.

## Next slices (subsequent PRs)
1. Phase-0 audit docs (`IMPORT_CENTER_MULTICOUNTRY_AUDIT/SECURITY_PLAN/MIGRATION_PLAN/TEST_CASES.md`).
2. Server-side commit RPCs (`import_commit_batch`, `import_reprocess_row`,
   `import_reverse_batch`) — permission + country/org scope + idempotency +
   transactional writes into live tables + `target_record_id` linkage + audit.
3. Shared parse/map/validate engine (`src/lib/import/*`, lazy-loaded xlsx).
4. Data Intake Center UI + module adapters (Fleet → Tyre → Stock first).
