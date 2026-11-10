# 12 - Data Intake Centre Design

| Field | Value |
|---|---|
| Deliverable | 12 of 29 (spec section 9, "Advanced Data Intake Centre") |
| Date | 2026-11-10 |
| Status | Partly built. Five browser intake paths and one database staging path work and are guarded against the duplication incidents of July 2026. Missing: a server-side bulk pipeline, scheduled/API intake monitoring beyond daily coverage, a quarantine table, unit/currency conversion at intake, and one shared front door. |
| Evidence | Verified in code (2026-11-10): file paths, constants (`MAX_SAVE_ROWS`, `ROW_CAP`, `INSERT_CHUNK`, `PREVIEW_SAMPLE`, `LARGE_FILE_ROWS`), fingerprint wiring in three pages, `importTargets.js` re-import flags, migration files. Verified live (read-only SQL, 2026-11-10): `parts_consumption` 220,425 rows, 89,999 with NULL `import_uid`; `dup_resolve_archive` 9,863 rows. From PROJECT_MEMORY: incident figures (8,248 duplicate rows, EGP 17.4M), timings and per-country source-row coverage. |
| Related docs | `docs/IMPORT_CENTER_DATA_MODEL.md`, `docs/IMPORT_CENTER_COMMIT_FRAMEWORK.md`, `docs/IMPORT_CENTER_SECURITY_PLAN.md`, `docs/IMPORT_CENTER_MULTICOUNTRY_AUDIT.md`, `docs/ERP_INTEGRATION.md`, `docs/DATA_COLUMN_GUIDE.md`, `docs/tyre/BUSINESS_RULES.md` (T11-T13), doc 11 of this pack |

Note: the older IMPORT_CENTER_* docs describe only the `/data-intake` staging engine. They predate the
per-country `stg_*` tables (V395), the ERP promotion RPCs (V415), the Console Smart Import and the
idempotency work (V363/V365). Treat this document as the current map.

## 1. Current intake paths

| # | Path | Surface | Engine | Lands in | Approval / undo | Status |
|---|---|---|---|---|---|---|
| P1 | Data Intake Center | `/data-intake` (`src/pages/DataIntakeCenter.jsx`, 1,700 lines) | `src/lib/api/imports.js` (`createBatch`, `saveSheets`, `stageRows`, `submitForApproval`, `approveBatch`, `commitBatch`, `verifyBatchLanding`, `reverseBatch`, `reprocessRow`); mapping profiles; `src/lib/import/*` (parseWorkbook, synonyms, detectModule, headerDiff) | `import_batches` / `import_files` / `import_rows`, then 10 master tables via `import_commit_batch` | Approval gate + `import_reverse_batch` (country-guarded since V555) | Built |
| P2 | ERP Intake (self-routing Ramco exports) | `/erp-intake` (`src/pages/ErpIntake.jsx`) | `src/lib/erpIntake.js` (detectReport, footer stripping, per-report mappers, `orderFitRemove`), `src/lib/api/erpIntake.js` (merge loaders) | `parts_consumption`, `tyre_records` (via `tyre_import_reconcile`), `work_orders`, `vehicle_fleet`, `open_work_orders` | Merge: new key inserted, existing key refreshed, exact duplicate unchanged; held tyre rows go to review (T13) | Built |
| P3 | ERP Import (review staging) | `/erp-import` (`src/pages/ErpImport.jsx`) | `src/lib/erpImport.js` (normalizeCell, `deriveTyreActivity`, validateExpense), `src/lib/api/erpImport.js` | `erp_asset_import` / `erp_tyre_change_import` / `erp_tyre_expense_import` (V277), then master via `promote_erp_assets`, `promote_erp_tyre_changes`, `promote_erp_tyre_expense` (V415, dry run default) | `promote_erp_undo`, `erp_promote_bak.promotion_log` | Built |
| P4 | Console Smart Import | `/console/smart-import` (`src/console/pages/ConsoleSmartImport.jsx`, super-admin) | `detectModule` picks the module from headers, then the P1 pipeline | same as P1 | same as P1 | Built |
| P5 | Cost per m3 ledgers | `/production-m3`, `/sco-costs`, `/sany-invoices`, `/sites-intake` and tabs inside `/data-intake` (`src/components/costm3/LedgerPage.jsx`) | `src/lib/costPerM3.js` (`IMPORT_TEMPLATES`, `HEADER_SYNONYMS`, `mapImportRows`), PDF parser `src/lib/import/parsePdf.js` (SANY proforma + line items, V525) | `production_logs`, `sco_costs`, `sany_invoices`, `sany_invoice_lines`, `sites` | Logs to `import_files` / `import_batches` | Built |
| P6 | Database staging (Supabase Table Editor CSV) | 25 per-country tables, e.g. `stg_job_cards_ksa`, `expenses_uae` (`src/lib/importTargets.js`, V395) | BEFORE INSERT triggers forward into the base pipe and RETURN NULL; `_stg_pick` reads headers by normalised name (V386) | master tables; staging stays empty | Trigger-level dedupe / merge; no batch undo | Built |
| P7 | Org stamp for dashboard CSV imports | n/a | `trg_stamp_import_default_org` (V290) fills `organisation_id` when NULL on 10 import tables | n/a | n/a | Built; single-org assumption (see decisions) |
| P8 | Mobile capture (meter logs, washing, inspections) | Expo / Flutter | offline queues with `client_uuid` idempotency | `odometer_logs`, `engine_hours_logs`, `wash_records`, `inspections` | idempotent upsert on `client_uuid` | Built (not an intake centre path) |

Reference surfaces (the `/console/*` paths below are legacy entry points that now redirect to tabs of
`/console/operations`, verified in `src/App.jsx`): `/console/import-history` (`ConsoleImportHistory.jsx`: Uploads, Load activity, Daily
coverage, What we changed), `/console/duplicates` (`ConsoleDuplicateControl.jsx`: scan, preview, resolve,
restore, and the "Where to import" reference with an upload workbook download), `/console/material-master`,
`/data-reconciliation`.

## 2. Duplication incidents and the fix each one produced

| Date (per project memory) | Incident | Root cause | Fix (migration / file) |
|---|---|---|---|
| 2026-07-26 | 8,248 duplicate expense rows; Egypt overstated by EGP 17,414,847 (18%) | Staging triggers did bare INSERTs; a retried upload chunk re-inserted (paired `created_at` clusters ~110 s apart) | V362 duplicate control (scan by business key, `source_row` discriminator, archive + undo); V363 `import_uid` with `on conflict do nothing`; V365 site-aware identity (store + cost centre in the key); duplicates deleted with archive |
| 2026-07-26 | `stg_open_wo` re-import created rows | Bare INSERT despite docs claiming snapshot replace | V363 update-in-place on (org, country, job_card_no); `reimportSafe` flag derived per target, not from prose |
| 2026-07-23 / 2026-08-10 | UAE re-upload duplicated 9,051 rows the same day | `#` column not mapped, so no `import_uid` | Content-identical dedupe with multiplicity capping; standing rule "map the # column" |
| 2026-08-10 | KSA August file carried 886 UAE job cards | Cross-country rows in one export | V491 `trg_aa_expense_country_guard`: job-card prefix decides country (AFKR/GCKR = KSA, RM = UAE, EG = Egypt), rejects to `expense_import_rejects` |
| 2026-08-06 | Production file uploaded twice (84,787 rows, 903,014 m3) | Same file 20 minutes apart | V516 dedupe on `dn_number` + full content (a DN never repeats inside one file) |
| 2026-07-28 | Egypt file loaded as UAE (1,524 rows, EGP 5.39M labelled AED) | Wrong country chosen; trigger only fills a NULL currency | V405 move + explicit currency + recomputed `import_uid` |
| 2026-11-09 | Tyre loads stamped the NEW serial on the REMOVED tyre row (KSA 1,599, UAE 453, Egypt 89) | ERP "remove_date/remove_KM" describe the old tyre | 20261109120000 / 130000 data fixes with backups; `_tyre_close_replaced` held-row review |
| 2026-07-12 | Commit reported "Committed - 0 rows" as success | `import_commit_batch` returned committed when nothing was eligible | V404 `nothing_to_commit` status + `not_eligible` breakdown |

## 3. Dedupe rules in force

| Target | Key | Where | Re-import safe? |
|---|---|---|---|
| Expense lines (`parts_consumption`) | `import_uid` = md5(country, source_row, business key, store_code, cost_center) | `parts_import_uid`, unique partial index | Only when the `#` column is mapped; live 2026-11-10: 89,999 of 220,425 rows have NULL `import_uid` |
| Job cards (`work_orders`) | `work_order_no`, GLOBAL unique | `on conflict (work_order_no) do update` in `process_stg_job_cards`; ERP intake dedupe reads all countries | Yes (refresh in place) |
| Tyre fitments (`tyre_records`) | serial + asset + position + issue_date; reconcile closes or holds | `insertTyreRecords`, `tyre_import_reconcile`, `_tyre_close_replaced` | Yes; ambiguous rows held |
| Assets (`vehicle_fleet`) | (organisation_id, country, asset_no), V348 | merge loaders | Yes |
| Production (`production_logs`) | `dn_number` + content | V516 rule; staging guard | Yes for numbered DNs |
| Any uploaded file | sha256 of the file | `fileSha256` + `checkImportFingerprint` (`src/lib/api/importHistory.js`), wired into `DataIntakeCenter.jsx`, `ErpIntake.jsx`, `ConsoleSmartImport.jsx` (verified 2026-11-10; the "DataIntakeCenter not wired" note in project memory is now stale) | Warns and requires acknowledgement |
| Repeated business key in work order line items | NOT a duplicate when `source_row` differs (47,693 protected rows, per project memory) | `_dup_scan_spec` | n/a |

Tables deliberately excluded from duplicate removal (repeated key is real data): `production_logs` by
site/date/truck, `inspections`, `accidents` (project memory V362).

## 4. Header handling

- Header detection on the row under a title band; footer rows (GRAND TOTAL, Printed By, Applied filters)
  dropped by `isFooterRow`.
- Mapping profiles keyed by header fingerprint. V391 stores the file's FULL header list
  (`import_mapping_profiles.header_columns`). On a fingerprint MISS, `HeaderChangeDialog.jsx` over
  `src/lib/import/headerDiff.js` shows renames (suggested, never assumed), missing and new columns, and only
  the rename is a decision. `MIN_OVERLAP = 0.5` stops it comparing unrelated reports.
- Database path: `_stg_pick` normalises NBSP, doubled spaces and case (V386). Supabase Table Editor matches CSV
  headers byte for byte; an invisible-character header cannot be fixed server-side (project memory, V386).

## 5. Limits

| Limit | Value | Where |
|---|---|---|
| Browser save cap (ERP Import) | 100,000 rows per sheet | `MAX_SAVE_ROWS` in `src/lib/api/erpImport.js`, `ROW_CAP` in `ErpImport.jsx` |
| Insert chunk | 250 rows, 6 retries with jittered backoff, deferred sweep | `INSERT_CHUNK`, `saveImportRows` |
| Admin upload policy | `system_config.max_upload_rows` (100,000 live per project memory) | `DataIntakeCenter.jsx`, `ErpImport.jsx` |
| Smart Import preview sample | 2,000 rows; banner above 50,000 | `PREVIEW_SAMPLE`, `LARGE_FILE_ROWS` |
| Commit throughput | ~0.3 ms per expense row in the classifier with cache (V373); `work_orders` audit + event triggers are ~71% of insert cost | project memory (V387 profile) |

Beyond about 100,000 rows the browser path is the wrong tool; the database staging path (P6) handles larger
files but has no batch-level undo.

## 6. Gap analysis against spec section 9

| Required capability | Status | Where / note |
|---|---|---|
| Upload wizard, column mapping, reusable templates | Built | P1, profiles, upload workbook |
| Preview and validation | Built | `transformRow`, `validateRow`, row issues |
| Duplicate detection | Built | section 3 |
| Master-data matching | Partly | asset lookup, site aliases (`site_aliases`, V247/V395), brand learning (V471/V472) |
| Unit conversion | Not built | units taken as given |
| Date conversion | Built | `coerceDate` day-first (fixed 2026-07-26), `erp_parse_date`, `erp_parse_ts`, `master_parse_date` (two-digit year pivot) |
| Currency conversion | Not built at intake; `fx_convert` exists but no approved rates | V380 |
| Country-aware mapping | Built | per-country staging tables, country picker, V491 guard |
| AI-assisted cleaning | Partly | `detectModule`, classification brain; no LLM cleaning |
| Error classification | Partly | row issues; `toUserMessage` |
| Partial import / approval / audit history / rollback / reprocess | Built for P1, P3; partial for P2; none for P6 | |
| Scheduled imports, API intake monitoring | Partly | daily coverage (V389, 35 feeds registry V484-V487, cron `upload-gap-check` active) and push on gaps; no scheduled pull |
| Quarantine for invalid records | Partly | `expense_import_rejects`, held tyre rows, `stg_monthly_tyres_audit`; no single quarantine table |
| Data lineage | Partly | `get_figure_lineage` (V458), `import_batches` provenance; see doc 19 |
| GPS / TPMS / RFID / OCR / QR / barcode / images / documents | Partly | telematics km loads (V406-V408), RFID registry, QR labels, mobile scanner; `tpms_readings` empty |

## 7. Proposed design

Principle: one front door, many engines. Do not merge the engines; route to them.

1. **Single front door** (`/data-intake` stays the route). Step 1 detects the file: `detectReport` (Ramco
   exports), `detectModule` (generic modules), PDF parser, or "very large file". It then hands off to the
   right engine with the country already chosen. P2/P3/P4/P5 remain as engines; their pages become tabs or
   are retired behind redirects (doc 4 decides retirement). Phase 2, M.
2. **Mandatory identity column** for expense files: refuse commit when the `#` line-number column is not
   mapped (closes the NULL `import_uid` risk). Phase 2, S.
3. **Server bulk pipeline** for files above 100,000 rows. Upload the original file to the private storage
   bucket (already done by `uploadOriginalFile`), enqueue a job, and let an edge function or worker stream it
   with COPY into a per-batch staging table, transform in SQL with the existing `process_*` functions, then
   promote with the V415 dry-run and undo pattern. Batch rows keep `import_batches` as the single history.
   Report progress through realtime. Phase 4, XL.
4. **Quarantine table** `import_quarantine` (batch, row, reason code, raw jsonb, resolution) fed by every
   path, replacing the scattered rejects/held tables in the UI (the tables can stay underneath). Phase 3, M.
5. **Conversion layer**: units (litres/gallons, km/miles) and currency (only with an approved rate) applied
   in `transformRow`, recorded per row so the original stays visible. Phase 4, M.
6. **Bulk-import audit flag**: gate `trg_audit_row_change` on `app.bulk_import` so a 30,000 row import does not
   write 30,000 audit rows (94.5% of `audit_log_v2` came from 8 import days, per project memory). Needs owner
   sign-off because it changes the audit contract. Phase 3, S.

## Open decisions for the owner

1. Stop auditing bulk imports row by row (item 6)? Changes the audit contract.
2. Retire the separate `/erp-import` and `/erp-intake` pages behind the single front door, or keep both?
3. V290 org stamp assumes one tenant (Company A). Before a second customer uses the dashboard CSV importer,
   the stamp must resolve the org per batch. Approve that work before onboarding tenant two.
4. Whether to require the `#` column for every expense upload (blocks some legacy files).

## Next actions

| Action | Phase | Effort |
|---|---|---|
| Require `#` mapping for expense files | 2 | S |
| Single front door routing to existing engines | 2 | M |
| Quarantine table and one review screen | 3 | M |
| Server bulk pipeline (storage, job, COPY, promote) | 4 | XL |
| Unit and currency conversion at intake | 4 | M |
| Update IMPORT_CENTER_* docs to point here | 1 | S |
