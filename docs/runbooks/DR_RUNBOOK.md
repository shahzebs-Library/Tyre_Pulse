# Disaster Recovery Runbook - Tyre Pulse

Status: DRAFT 2026-11-10 (finding F-K-03). Figures marked OWNER TO SUPPLY must be read from the Supabase dashboard (Project > Database > Backups) and the contract before this is signed.

## 1. Targets
| Item | Value |
|---|---|
| Supabase plan / PITR add-on | OWNER TO SUPPLY (plan tier, PITR on/off) |
| PITR retention window | OWNER TO SUPPLY (days) |
| Daily platform backup retention | OWNER TO SUPPLY (days) |
| RPO (platform, with PITR) | OWNER TO SUPPLY (PITR gives seconds-minutes; without PITR = 24 h) |
| RPO (in-app row recovery) | 24 h (nightly `backups` snapshot, 00:30 UTC, 30-day retention) |
| RTO (row recovery) | under 1 h |
| RTO (full project restore) | OWNER TO SUPPLY (depends on database size, currently ~2.7 GB) |

Target to put in the contract: RPO <= 24 h, RTO <= 4 h. Do not commit to it until the PITR numbers above are filled in.

## 2. What is recoverable and how
| Data | Coverage | Path |
|---|---|---|
| accidents, inspections, pm_programs, pm_service_records, stock_records, tyre_records, vehicle_fleet | Nightly jsonb snapshot in schema `backups` | Console > Backups > preview, then `backup_restore_missing` (re-inserts only rows missing now; never overwrites newer live rows) |
| work_orders (~96.5k rows) | NOT in snapshot (`skipped_too_large`) | Platform PITR / daily backup only |
| parts_consumption (the expense ledger, ~218k rows), production_logs (~212k rows) | NOT in `_core_tables()` | Platform PITR / daily backup only. Ad hoc `_bak.*` tables exist for past corrections; `dup_resolve_archive` holds deleted duplicates |
| audit_log_v2 | Immutable + daily hash seals | Not restored from snapshot |

Why the big tables are excluded: the snapshot is a jsonb copy on a 256 MB shared_buffers instance (V495). Copying ~800k rows nightly would add tens of GB to a 2.7 GB database and is not true disaster recovery. Row recovery for them depends on PITR being enabled, stated explicitly here.

An accidental bulk delete on a big table has no in-app undo beyond `_bak.*`; use PITR (section 4).

## 3. Automated restore test
Migration `20261110145000_backup_restore_test_cron.sql` schedules `backup-restore-test` (03:30 UTC on the 1st of each month). It restores the latest `stock_records` snapshot into a temp table, compares row counts and writes `backups.restore_tests` (`passed`/`failed`). Acceptance: the latest row is `passed` and no older than 31 days. Console Backups should list the uncovered tables above and the last test.

## 4. Who restores and how
1. Declare the incident (owner or on-call). Freeze imports: set `system_config.maintenance_mode='true'`.
2. Small, recent loss (inspections, accidents, tyres, fleet, stock): super admin, Console > Backups > restore preview, then recover-missing with typed confirmation.
3. Loss on work_orders / parts_consumption / production_logs, or whole-database loss: only the Supabase account owner can restore. Dashboard > Database > Backups > Point in time (choose a timestamp just before the damage) or restore the latest daily backup. PITR restore replaces the project data; recent writes after the target time are lost, so export anything needed first.
4. After restore: run `_cron_health()`, re-check `get_fleet_cpk` totals against the last known per-country totals (KSA SAR, UAE AED, EGP kept separate), confirm pg_cron jobs are active, lift maintenance mode.
5. Record the event in Console > Incidents with timeline and root cause.

Restore of a single table without PITR: not supported for the three uncovered tables. If PITR is off this is a gap to close (enable PITR, or add a weekly external dump).

## 5. Contact chain (OWNER TO SUPPLY names and numbers)
1. Product owner / super admin (decides, declares incident).
2. Second super admin (Console access).
3. Supabase account owner (PITR/dashboard restore) and Supabase support (plan-dependent SLA).
4. Vercel project owner (web redeploy; no data impact).

## 6. Owner actions
- Fill every OWNER TO SUPPLY cell above.
- Confirm PITR is enabled; if not, decide: enable PITR (recommended) or accept 24 h RPO on the three big tables in writing.
- Sign off the RPO/RTO wording before it goes into a customer contract.
