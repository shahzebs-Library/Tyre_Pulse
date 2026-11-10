# 24. Rollback Plan

| Field | Value |
|---|---|
| Deliverable | 24 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Every layer has a rollback path, and data corrections ship with snapshots and undo functions. Gaps: no rehearsed full-database restore, edge-function rollback is manual (redeploy from git), mobile binaries cannot be rolled back (only rolled forward), and the Expo secure-storage format is not rollback-safe. |
| Evidence | Code verified: `vite.config.js` PWA settings, `.github/workflows/vercel-production.yml`, `vercel.json`, `scripts/vercel-ignore-build.mjs`, `.github/workflows/flutter-release-play.yml`, `eas-update.yml`. Live 2026-11-10: 15 undo/restore/revert functions, 125 `_bak` tables, 30 `backups.snapshots`. Mobile and deployment history from PROJECT_MEMORY. |
| Related docs | [23 Migration plan](23-migration-plan.md), [21 Monitoring](21-monitoring-and-support-design.md), [25 Test plan](25-test-plan.md), `docs/TEST_AND_RELEASE_PLAN.md` |

## 1. Rollback matrix

| Layer | How it ships | Rollback mechanism | Time to roll back | Data risk |
|---|---|---|---|---|
| Web app (Vite PWA) | Push to `main` to `vercel-production.yml` builds and deploys Vercel project `tyre-pulse` | Promote the previous READY production deployment (Vercel dashboard or `request_rollback`), or revert the commit and redeploy | Minutes | None (static) |
| Marketing site | Vercel project `tyre-pulse-eezl` (root `marketing/`) | Promote previous deployment | Minutes | None |
| Database schema / functions | MCP `apply_migration` / SQL editor | Rollback SQL in each migration header; previous function bodies kept in `_bak.fn_defs_*` | Minutes to hours | Depends on change |
| Data corrections | Snapshot + update/delete | Restore from `_bak.*` or the matching undo RPC | Minutes | Low if snapshot exists |
| Whole database | Supabase platform | Point-in-time recovery (PITR) on the platform | Hours | Loses writes after the restore point |
| Edge functions | MCP `deploy_edge_function` or CLI | Redeploy the previous version from git history | Minutes | Low |
| Flutter Android | `flutter-release-play.yml` to Play closed testing (`alpha`) | Halt rollout in Play Console; ship forward with a higher versionCode; raise `flutter_min_version` only after the fix is live | Hours to days | Local offline queue on devices |
| Expo Android (legacy, production) | Store builds retired; OTA via `eas-update.yml` only | Republish previous update group / roll back in EAS dashboard | Minutes (applies after two app opens) | See section 4 |
| iOS (Flutter) | `flutter-release-ios.yml`, TestFlight / review | Remove build from sale or ship forward | Days | |

## 2. Web app

- Production deploys only from `main` (one push = one production build). `vercel.json` `ignoreCommand` skips builds for paths the bundle cannot read; feature branches are listed in `git.deploymentEnabled: false`.
- Rollback = promote the last known-good production deployment. Always confirm `target: production` and the commit sha after promoting (a green CI run proves nothing about what is deployed).
- PWA behaviour (`vite.config.js`): `registerType: 'prompt'`, `skipWaiting: false`, `clientsClaim: false`. An open tab keeps its current build and lazy chunks until the user accepts the update prompt or closes every tab; a waiting update is never applied while the tab is hidden. Consequences for rollback:
  - A rollback reaches users only after they accept the prompt or reload. Tell users to reload before judging a fix.
  - A tab on a broken build stays broken until reload; `src/lib/chunkRecovery.js` reloads once (one-shot per tab) when a lazy chunk 404s after a deploy.
- Database-coupled releases: a web rollback does not roll back a migration. Ship schema changes backwards-compatible (additive columns, `isMissingColumn` fallbacks) so either web version runs against the current schema.

## 3. Database

### Undo functions available live

| Function | Undoes |
|---|---|
| `tyre_price_backfill_undo(batch)` | A tyre price backfill batch (restores prior value including NULL) |
| `tyre_cost_correction_undo(batch)` | Tyre cost corrections |
| `tyre_replacement_undo(batch)` | ERP replacement reconcile / rotation close |
| `tyre_learn_undo(batch)` | Learned brand/size/reason facts (deactivates the rule first) |
| `parts_cost_fill_undo(batch)` | Zero-cost expense line fills |
| `reclassify_revert(batch)` | Material-master driven re-bucketing of expense money |
| `admin_dup_restore(...)` | Duplicate-control removals (full row archive in `dup_resolve_archive`) |
| `admin_db_revert_change(id)` | A single Data Browser edit or delete (`admin_row_changes`) |
| `import_reverse_batch(batch)` | A committed import batch (org and country guarded, V555) |
| `reverse_legacy_upload(...)` | Legacy pending-upload imports |
| `promote_erp_undo(batch)` | ERP staging promotion (V415) |
| `backup_restore_preview(snapshot, table)` / `backup_restore_missing(...)` | Re-insert rows deleted since a nightly snapshot; never overwrites newer data |
| `admin_run_restore_test` / `admin_list_restore_tests` | Restore drills recorded in `backups.restore_tests` |

### Snapshots

- `_bak` schema: 125 tables (live), one per correction, named `_bak.<topic>_<date>`. No schema usage granted to app roles. Restore = update/insert from the snapshot by id, with relevant triggers disabled where the migration header says so (e.g. classify trigger, km processing trigger).
- `backups.snapshots`: 30 nightly restore points (`nightly-backup` 00:30 UTC, 30-day purge) over a curated core-table list. This is ROW recovery, not disaster recovery. `work_orders`, `parts_consumption` and `work_order_line_items` are deliberately excluded for size.
- Function bodies before replacement: `_bak.fn_defs_*` tables and the migration header.

### Deliberate non-rollbacks (decisions)

- Deletions the owner confirmed final have no snapshot (UAE non-workshop buildings, 2026-08-19).
- `audit_log_v2` is immutable (`prevent_audit_mutation`); history is never rewritten.
- `data_retention_months` stays saved-only: business data is never auto-deleted, so there is nothing to roll back.

### Disaster recovery

PITR is a platform feature of the Supabase project; it has NOT been rehearsed by this team. A full restore to a new project, repointing the apps, has never been tested.

## 4. Mobile

### Flutter (field app)
- Releases go to Play closed testing only (guard in the workflow forbids other tracks and packages). Production is the owner's call.
- A Play binary cannot be rolled back. Options: halt the staged rollout; release a fixed build with a higher versionCode; or rebuild the previous commit with a higher versionCode.
- Forced update gate: `system_config.flutter_min_version` (separate from Expo's key). Set it only AFTER the new build is live on the track; builds older than the `APP_VERSION` dart-define fix default to 999.0.0 and can never be blocked.
- Offline work is in a local durable queue; a bad build must not clear it. Test upgrade and downgrade on a device before promoting.

### Expo (legacy production app, 1.6.0)
- Store builds retired. Hotfixes only via OTA: branch cut from the installed binary commit `6c27046`, only the fix, `eas-update.yml` with `source_ref`; the workflow refuses a ref that changes native config or more than 20 files. Never publish from `main`.
- Roll back an OTA from the EAS dashboard (previous update group).
- **The chunked secure-storage format (commit `e7008e78`) is forward-compatible but NOT rollback-safe.** A device rolled back to the old adapter reads the new metadata, finds no legacy chunk keys, and treats both offline queues as empty, then overwrites them. Field workers lose unsynced inspections. If that build is on devices: halt and ship forward, never roll back.
- `mobile_min_version` = `mobile_latest_version` = 1.6.0 (live). Never raise the minimum above a released build.

## 5. Edge functions

- No version history is kept by the team; the repo is the source. Rollback = check out the previous commit of `supabase/functions/<name>` and redeploy with the same `verify_jwt` mode (see [16](16-api-audit.md)).
- Before redeploying a large self-contained function (`send-scheduled-reports`), byte-diff the deployed source against the repo; hand-inlining has caused drift before.
- Secrets are not versioned; rotating a key is not reversible without the old value. `cron_config` holds the cron secrets read by SQL jobs.

## 6. Rollback triggers and owners

| Trigger | Action | Owner |
|---|---|---|
| Error rate spike in `system_logs` / new fatal Sentry issue after a release | Promote previous web deployment | Engineer on duty |
| A data correction produced wrong totals | Run the batch undo or restore from `_bak` | Engineer + owner sign-off |
| Mobile crash after release | Halt rollout, ship forward | Owner (builds are owner-controlled) |
| Security regression | Revert function/policy from migration header rollback SQL | Engineer |

## 7. Gaps

| Gap | Phase | Effort |
|---|---|---|
| Rehearse PITR restore into a scratch project and record the runbook | 1 | M |
| Release checklist that records the previous deployment id, migration rollback SQL and edge fn commit before each release | 1 | S |
| Edge-function deploy script that tags the git sha in the function | 1 | S |
| Rollback-safe secure storage on Flutter (dual-read for one release) | 5 | M |
| Include the three large financial tables in an export-based backup (object storage) | 3 | M |

## Open decisions for the owner

- Budget for PITR retention length and a quarterly restore drill.
- Whether to keep the Expo listing live once Flutter reaches production (affects how long the rollback-unsafe storage matters).

## Next actions

1. Phase 1 (M): PITR drill into a scratch project; write the runbook.
2. Phase 1 (S): add "previous deployment id + rollback SQL" fields to the release checklist.
3. Phase 1 (S): `admin_run_restore_test` on a schedule (monthly) and alert on failure.
