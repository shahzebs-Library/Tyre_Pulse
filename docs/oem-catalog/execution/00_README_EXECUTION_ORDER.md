# OEM catalog release: execution package v2

Branch `claude/oem-catalog-engine-7rxp2t` (PR #565). Migration `supabase/pending_migrations/20261118100000_oem_catalog_advanced.sql`,
**sha256 `46d2df34de13b7999c334730b4d8a254704223f382e2591e85574310b23b2412`** (unchanged from v1; the migration text was not modified).
All SQL files are generated from that one file by `scripts/build-oem-execution-package.py`; 02 and 03 embed it verbatim.

Owner rules implemented: catalog administration = Admin and Super Admin only. Manager, Director and other members keep read access
(manuals, drawings, categories, search, selection) and the existing parts-request flow (`parts_requests` is not touched).

## What changed in v2 (release safety only)
1. Rehearsal and apply are single transactions (`begin;` first, `lock_timeout 5s`, `statement_timeout 120s`). A guard aborts before touching anything unless the catalog is exactly 4 manuals, 1652 entries, fingerprint `4270e1621f940a37d226c538118114e7`, the migration objects do not exist, and the baselines exist. Apply ends with an assert block and `commit;`.
2. Rehearsal probes never touch existing rows: synthetic manual, entries and figures are created inside the transaction by the owner role (same organisation); update, delete, correction, reassign, merge, split and storage-insert probes use only those ids. Real tables are only counted.
3. Rollback is driven by the saved baseline `_bak.oem_policies_20261118` and ends with a zero-difference assertion against the baseline policies and grants (new baseline grants table saved in step 1).
4. Vinay grant: explicit `granted_by`, audit reason and guards (below).
5. Step 7 records the manual run in the migration ledger.

## Run order (Supabase SQL Editor, project `jhssdmeruxtrlqnwfksc`; paste each file whole)
| Order | File | Expected result |
|---|---|---|
| 1 | `01_PREFLIGHT_before.sql` | manuals 4, entries 1652, fingerprint `4270e1621f940a37d226c538118114e7`, storage objects 2, baseline 4 / 1652 / 22 / (grants count: note it), admin_fn_exists false, figures_exists false. Creates `_bak.oem_grants_20261118` (only write; `_bak` only). |
| 2 | `02_REHEARSAL_rolled_back.sql` | An **ERROR** starting `PROBE RESULTS:` (the success signal; nothing persists). Lines: manager, tyreman, vinay: `realManuals=4 realEntries=1652`, `insertManual=blocked`, `updateSynthetic=0`, `correction=blocked`, `deleteSynthetic=0`, `reassign=blocked`, `merge=blocked`, `split=blocked`, `storageInsert=blocked`, `partsRequestsVisible=<their normal count>`; admin: `insertManual=ALLOWED`, `updateSynthetic=1`, `correction=ALLOWED`, `deleteSynthetic=1`, `deleteCorrectedSynthetic=blocked` (the corrected entry is protected), `reassign=ALLOWED`, `merge=ALLOWED`, `split=ALLOWED`, `storageInsert=ALLOWED`. A `GUARD:` or `ASSERT:` error instead means stop and send me the text. A normal success (no error) means the rollback did not happen: run 02b. |
| 3 | `02b_after_rehearsal_nothing_persisted.sql` | starts with `rollback;` (harmless warning if none open). Then false, false; 4 / 1652; synthetic_rows_left 0. If anything persisted, run 04. |
| 4 | `03_APPLY_migration.sql` | Success, no error (guard + migration + assert + commit; all or nothing). |
| 5 | `05_VERIFY_after_apply.sql` | values in the file comments: counts and fingerprint unchanged, 6 functions, 4 tables, anon cannot execute figure tools, every write policy mentions `oem_catalog_admin()`, 4 storage policies, new tables empty. |
| 6 | `04b_VERIFY_rollback_vs_baseline.sql` | after apply: 9 rows `baseline_not_live` and 9 rows `live_not_baseline` (the nine admin-only write policies). After a rollback: zero rows. |
| 7 | `06_VINAY_view_only_grant.sql` | one grant row (grant, view, `granted_by` shahzeb) and one `access_audit` row with the reason text. |
| 8 | `07_RECORD_in_migration_ledger.sql` | one row version `20261118100000`, name `oem_catalog_advanced`. |
Rollback only if the apply or the verification fails: `04_ROLLBACK_only_if_needed.sql` (contains the word *drop*; the SQL Editor does not prompt, the connector does).

## After you say "executed" (agent, on the branch, no further approval)
Move the migration from `supabase/pending_migrations/` to `supabase/migrations/`, update the two supabase tests that read it, confirm CI, make #565 ready, squash-merge, verify the production Vercel deployment.

## What is verified, and how
- Live database, read-only (2026-11-18/19): catalog counts and fingerprint, policies, grants, column NOT NULL lists, dependency functions, `user_access_grants` columns, foreign keys and the two audit triggers, `schema_migrations` columns and recent rows, the two super admin ids.
- In memory (PGlite), `supabase/tests/oem_execution_package.test.mjs`, 6 tests: rehearsal and apply contain identical migration bytes equal to the file and the stated sha256; the rehearsal ends in `PROBE RESULTS`, persists nothing and touches no real row, and each role's probe outcome equals the table above; the guard aborts with zero change on a different catalog; apply is atomic (a failed assert leaves nothing); apply then the baseline rollback ends with zero policy differences, baseline grants intact and 1652 entries. `oem_catalog_access.test.mjs` (8 tests) still passes against the unchanged migration.
- **Not** verified here: running these files in the real Supabase SQL Editor (needs you); real JWT claims through PostgREST (the rehearsal uses `request.jwt.claims` the same way the existing impersonation checks do); behaviour of `anum_integration.apply_reader_policies()` (skipped in memory, executed in production; the apply assert checks the integration reader policies are unchanged and aborts the whole apply if not).

## Vinay (verified read-only)
Profile `06161659-c666-48ac-82f3-5887b1082dc2`: VINAY KUMAR T, role Workshop Maintenance Area Manager (custom role, active), approved, not locked, not super admin, org_id = organisation_id = `00000000-0000-0000-0000-000000000001`, country {KSA}, sites {ALL}, no existing grants. Route key `/parts-catalog/oem-preview` -> `parts_catalog_oem_preview` (no explicit navigation key; derived by `governingModuleKey`). The route allows Admin, Manager, Director; a custom role passes only with an explicit grant or an enabled `module_permissions` row, and his role has a row only for `stock`, so **the grant is required for the page to open**. His database rights (read published manuals, no writes) do not depend on it. The sidebar entry `/parts-catalog` is Admin/Manager/Director only, so he opens the OEM page by address or link. Audit: `user_access_grants` has two audit triggers; the SQL Editor has no signed-in user (actor NULL), so step 5 sets the audit reason and `granted_by` (shahzeb Rahman, super admin; nullable FK to profiles) explicitly.
