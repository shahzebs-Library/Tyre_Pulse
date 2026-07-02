# Data Intake Center - Test Cases (Phase 0)

> The 15 scenarios from `Data correction.md`, as a concrete acceptance checklist.
> Enforcement column names the V45 table / V46 RPC / RLS that guarantees each.
> Engine unit tests live in `src/test/import.test.js`; DB self-tests in
> `tests/rpc_import_commit.sql`.

| # | Scenario | Setup | Action | Expected | Enforced by |
|---|----------|-------|--------|----------|-------------|
| 1 | Country-A fleet, Arabic headers + unknown cols | KSA fleet xlsx, Arabic headers, extra columns | parse → map → stage | Arabic headers recognised; unknown columns preserved in `import_rows.custom_data` + `custom_field_catalog`; nothing dropped | `synonyms.js` (Arabic aliases), `mapping.js` (`preserve_custom`), `import_rows` |
| 2 | Country-B tyre, same asset_no as Country-A | UAE tyre file reusing a KSA asset number | stage + validate | Treated as a **different** record (not a duplicate) - natural key includes country | `NATURAL_KEY.tyre = country+serial_no`; org/country scope |
| 3 | Country-C stock, mixed units + local currency | bar/PSI mixed, local currency | transform | Original + normalised units kept; `amount_original`+`currency_original` kept, **no silent conversion** | `transform.js` (unit/currency normalisation) |
| 4 | Accident broker ZIP with attachments | accident xlsx + ZIP of photos/invoices | stage + match | Files private; attachments matched to claim/asset | `import-files` bucket (private), `import_attachment_matches` |
| 5 | Same file uploaded twice | re-upload identical file | upload | Detected by SHA-256; blocked/flagged as duplicate file | `import_files.sha256` UNIQUE per org |
| 6 | Ambiguous dates (03/04/2026) | file with ambiguous dates, no format chosen | validate | Not auto-imported; flagged for a date-format/profile decision | `validate.js` ambiguous-date issue; batch `date_format` |
| 7 | Cross-country access | Country-A user opens Country-B import | read | Denied - cannot see another country/org's batches/rows/files | RESTRICTIVE `*_org_isolation` RLS (`app_current_org`) on all import_* tables |
| 8 | Mapping profile reuse | next month's same ERP export | upload | Saved profile auto-applies by module+source+country+fingerprint+version | `import_mapping_profiles` (composite identity), `import_mapping_rules` |
| 9 | Unknown fields catalogued | file with novel columns | stage | Appear in `custom_field_catalog` with occurrence/example/recommendation | `custom_field_catalog` |
| 10 | Duplicate tyre serial = lifecycle event | serial seen again with new fitment | classify | Flagged as event/duplicate for review, **not silently skipped** | `validate.js classifyDuplicates` |
| 11 | Stock adjustment blocked until approved | stock batch | commit before approval | Commit refused until `approval_status='approved'` | `import_commit_batch` guard |
| 12 | Original file + raw row retained | any import | after commit | Original file (private bucket) + `import_rows.raw_source_data` remain retrievable | `import_files`, `import_rows` |
| 13 | Reprocess a corrected failed row | row with an error, then fixed | reprocess | Row reset to `pending` and re-validated (only if uncommitted) | `import_reprocess_row` |
| 14 | Rollback doesn't delete later valid records | committed batch, then reverse | reverse | Only the rows **this batch created** are removed (by `target_record_id`) | `import_reverse_batch` (elevated-only) |
| 15 | Existing build/tests/typecheck stay green | - | CI/gate | `npm run test:run` (389), `npx vite build`, `mobile tsc` all pass | repo gate |

## Engine coverage (`src/test/import.test.js` - 11 tests, passing)
Maps English + Arabic headers to canonical targets with confidence thresholds;
unmatched → `preserve_custom`; module-scoped synonyms (stock≠tyre); transform
keeps raw in `mapped` and cleaned in `transformed`, preserves custom; validation
flags missing required identifier; duplicate classification by natural key; CSV
delimiter parse + header-row detection; stable `rowFingerprint`.

## Still to add (later slices)
UI-level E2E for upload→map→validate→approve→commit (scenarios 1, 4, 6, 7, 11
exercised through the Data Intake Center page) and the accident-ZIP adapter.
