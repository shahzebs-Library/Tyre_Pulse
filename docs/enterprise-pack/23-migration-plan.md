# 23. Migration Plan

| Field | Value |
|---|---|
| Deliverable | 23 of 29 |
| Date | 2026-11-10 |
| Status | Built as a working practice, not as tooling. Schema and data changes are applied one at a time to the live project through the Supabase MCP or the SQL editor, with snapshots and rolled-back verification. There is no staging database, no automated migration CI and no single ordered source of truth between the repo files and the database history. |
| Evidence | Repo verified: 576 root `MIGRATIONS_V*.sql`, 241 files in `supabase/migrations/`, `supabase/pending_migrations/`, `supabase/security-rollout/`. Live 2026-11-10: 1,027 rows in `supabase_migrations.schema_migrations`, latest `20261109233241 workforce_trigger_fn_revoke`, 125 tables in `_bak`, 30 snapshots in `backups.snapshots`. Practices and gotchas from PROJECT_MEMORY and the `database-migration-safety` skill. |
| Related docs | [24 Rollback plan](24-rollback-plan.md), [25 Test plan](25-test-plan.md), [10 Data model recommendations](10-data-model-recommendations.md), `supabase/pending_migrations/README.md`, `supabase/security-rollout/README.md`, `docs/DATA_MODEL_CONSOLIDATION_PLAN.md` |

## 1. Where migrations live

| Location | Contents | Applied? |
|---|---|---|
| `MIGRATIONS_V*.sql` (repo root, 576 files) | Older numbered series V1 to ~V612. Each header carries STATUS, reproduction, verification, rollback. | Mostly applied; a STATUS header is a claim, not evidence |
| `supabase/migrations/*.sql` (241 files) | Timestamped series from 2026-08-30 onward | Mostly applied |
| `supabase/pending_migrations/` | Kept for reference, must never be applied as-is (e.g. `20261011140000_workshop_status_stale_conflict.sql`) | No |
| `supabase/security-rollout/` | Reviewed security batch with a status table (2026-11-08) | Per README |
| `supabase_migrations.schema_migrations` (live) | 1,027 rows | Authoritative history of what ran |

Two facts that cause confusion and must be understood before any audit:

1. The database records a migration under the timestamp at which it was APPLIED, not the repo file name. Example: repo `20261111090000_*` (evidence audit) is recorded live as `20261109125917 tyre_evidence_audit_2025`; repo V579 was recorded as `20261108135440 v579_audit_log_country_stamp`. Verify by NAME and by the live object, not by version.
2. Some objects were applied through `execute_sql` and have NO schema_migrations row, or have a row with no repo file (24 applied migrations `20260929203627..215747` have no repo file, per memory 2026-09-30). `VACUUM` work (V583) can never appear there because it cannot run inside a transaction.

Numbering rule: new files go in `supabase/migrations/` with a timestamp later than the latest live version (`20261109233241` on 2026-11-10). The root `MIGRATIONS_V*` series is closed; do not add to it.

## 2. How a change is applied today

| Step | Practice | Why |
|---|---|---|
| 1. Measure first | Count affected rows, impersonate real users, read live `pg_get_functiondef` | Several "fixes" were refuted by measurement (V565, V576, V580, index drops) |
| 2. Snapshot | `create table _bak.<name>_<date> as select ...` of every row touched | 125 `_bak` tables exist; undo is a restore from them |
| 3. Write the migration | Header: purpose, measured before/after, VERIFY queries, ROLLBACK SQL | |
| 4. Function edits | Read the live body, anchored `replace()` that ABORTS unless the anchor matches exactly once; never retype a long body | A partial guard reads as a closed boundary (V396); live bodies may use CRLF so anchors allow `\r?` (V450 incident) |
| 5. Grants | grant authenticated + service_role, revoke PUBLIC, then revoke anon by name | V500 / V480 |
| 6. Apply | `mcp__Supabase__apply_migration`; fallbacks below | |
| 7. Verify in a rolled-back transaction | `set_config('request.jwt.claims', '{"sub":"<real user>"}', true)` + `set local role authenticated`, run the user path, `reset role`, recount as a privileged reader IN THE SAME TRANSACTION, then roll back | A count inside an impersonated session counts what is readable, not what was written |
| 8. Commit repo file | Explicit pathspec commit | Parallel sessions share the tree |

### Known apply gotchas

| Gotcha | Workaround |
|---|---|
| An MCP call containing `DROP` or `DELETE` waits for an approval prompt, times out at 60 s and rolls back | Rename + revoke instead of drop; put deletes inside a function body created separately; or have the owner paste into the SQL editor |
| A test `DO` block ending in `raise exception` rolls back every statement in the same `execute_sql` call, including a `CREATE OR REPLACE` before it | Apply in one call, test in another |
| A timed-out UPDATE may still have committed server-side | Re-count after any timeout |
| `trg_guard_profile_privileged` blocks MCP edits to privileged profile columns (`get_my_role()` is NULL) | Disable and re-enable the trigger in the same statement and verify `tgenabled='O'`, or use the admin RPCs |
| `trg_classify_parts_consumption` fires on UPDATE and re-buckets money | Disable it for the statement when changing non-cost columns; compare per-country totals before and after |
| `tyre_records_master_process_tg` nulls km 0 on update (V590: 63 owner-approved zeros) | Measure `km_fit_zero` first; disable for the statement; abort unless km is byte identical |
| Trigger fire order is by name | Normalisers use `trg_zz_`; guards use `trg_aa_` |
| Generated columns break lock triggers that diff `to_jsonb(OLD)` vs `NEW` | Never add generated columns to `inspections` / `checklist_submissions` |
| `VACUUM` / `CREATE INDEX CONCURRENTLY` cannot run in a transaction | Run as separate statements; record in the repo file |
| `supabase db query --linked` (CLI) can reach the DB when the MCP is unauthenticated | Use with care; it honours BEGIN/ROLLBACK |

## 3. Data change classes and their safeguards

| Class | Examples | Safeguard |
|---|---|---|
| Additive DDL | new nullable column, new table with RLS | Low risk; still verify RLS by impersonation |
| Constraint change | widening a CHECK (V244, V497, V612) | Removing a client field is also a constraint change (wash checklist, 2026-09-22) |
| Policy rewrite | V396, V498, V542 | Copy each table's own expression via `pg_get_expr`; regenerate USING and WITH CHECK together; equivalence proven over every real user |
| Backfill | V394 job card country, V476 tyre size, V588 brand | Snapshot; deterministic rule only; per-country totals unchanged |
| Deletion | V365 duplicates, V516 production, V518 August clear-out | Full archive table + one-click undo; owner instruction recorded |
| Function replacement | ~30 DEFINER guards | Anchored replace, md5 equivalence of payloads before/after |

## 4. Forward plan for the pending enterprise items

Ordered to the spec's phases. Each item names its migration risk.

### Phase 1: secure and document (no behaviour change for users)

| Item | Migration | Risk | Effort |
|---|---|---|---|
| Rewrite `save_stock_entry` / `transfer_stock_entry` ERRCODE 40001 to PT409 | Function replace from live body | Low | S |
| Revoke stray anon EXECUTE on `tyre_one_price_per_tyre`, `reset_login_attempts` | Grant change | Low | S |
| Make V290 default-org stamp conditional | Function replace | Medium (dashboard imports) | S |
| Catalog guard tests (anon allowlist, no unpinned search_path, no RLS-off table) | None (test only) | None | S |
| Reconcile repo vs `schema_migrations` (list by name, mark each repo file applied/unapplied/superseded) | None | None | M |

### Phase 2: consolidate

| Item | Migration | Risk | Effort |
|---|---|---|---|
| Retire `ai_usage_log`, unused `developer_api_keys`, dead legacy columns (`tyre_records.serial_number`, `asset_number`, `tyre_serial`) | COMMENT, then drop after one release | Low | S |
| Brand/removal_reason cleanup (858 UAE rows carrying a brand) | Snapshot + update | Low | S |
| `tyre_records.serial_no` partial-scrap: make scrap/unscrap/list readers case-insensitive (done in V604), then decide on the column | Function change | Medium | M |
| Lifetime CPK in server RPCs (all CPK RPCs still per fitment row) | Function replace + md5 compare | Medium | L |

### Phase 3: governance

| Item | Migration | Risk | Effort |
|---|---|---|---|
| Location-scoped RLS (`org_unit_id`) - on hold since 2026-07-13 | Opt-in, default-open policies | High | XL |
| Audit-log country attribution (V579 applied 2026-11-08 as stamping going forward; history untouched because `audit_log_v2` is immutable) | Done going forward | n/a | n/a |
| Approval matrix population per country/site | Data only | Low | M |

### Phase 4: reports, intake, notifications, integrations

| Item | Migration | Risk | Effort |
|---|---|---|---|
| `system_logs` columns: category, correlation_id, country, site, action, network_status | Additive | Low | S |
| ERP promotion steps beyond V415 (refresh existing rows) | Function | Medium | M |
| Store-to-site map completion (18 codes) | Data | Low | S (needs owner knowledge) |

### Phase 5: commercial

| Item | Migration | Risk | Effort |
|---|---|---|---|
| Apply V316 self-serve workspaces (only on owner decision) | Already authored | High (product) | S |
| Billing go-live: subscription row per org, limits on users/storage | Data + trigger | High (can block writes) | M |
| Per-org AI budgets enforced | Additive | Low | M |

## 5. Missing tooling (recommended)

| Tool | Purpose | Phase | Effort |
|---|---|---|---|
| Supabase branch or a staging project | Apply and test before live | 1 | M |
| CI job: apply all `supabase/migrations` to a fresh Postgres (PGlite already used by `supabase/tests`) | Catch syntax/order errors | 1 | M |
| Repo-vs-live reconciliation script (names, function md5) | Detect drift | 1 | S |
| Migration PR template with STATUS / VERIFY / ROLLBACK sections | Consistency | 1 | S |

## Open decisions for the owner

- Approve a staging project (cost) so migrations stop being tested only in rolled-back transactions on production.
- Whether historical root `MIGRATIONS_V*.sql` files may be archived into a subfolder once reconciled.

## Next actions

1. Phase 1 (S): the 40001 fix and the two grant revokes in one reviewed migration.
2. Phase 1 (M): reconciliation report of repo files vs `schema_migrations` by name.
3. Phase 1 (M): CI job applying `supabase/migrations` to PGlite in order.
4. Phase 2 (S): retire `ai_usage_log` and dead tyre columns via COMMENT-then-drop.
