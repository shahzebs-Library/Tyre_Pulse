# Backup, restore and monitoring: what really exists

Checked 2026-11-12 by read-only SQL against project `jhssdmeruxtrlqnwfksc`. Nothing was changed.
Companion to `docs/runbooks/DR_RUNBOOK.md` (who restores, contact chain). This file is the facts, the gaps,
the tested procedure and the monitoring proposal.

Words used here: CONFIRMED means observed by a read-only query today. UNVERIFIED means it cannot be read from
SQL and the owner must look in the Supabase dashboard. INFERRED means reasoned from code or settings.

## 1. Short answer

| Question | Answer |
|---|---|
| Is there a nightly copy inside the app? | Yes. It ran every night for the last 30 days with no failure (CONFIRMED). |
| Does it cover everything? | No. It really captures 7 small tables. Job cards, the expense ledger, production, audit, users and all photos are not in it (CONFIRMED). |
| Can it survive losing the database? | No. The copies are stored inside the same database (CONFIRMED). |
| Is there a platform backup outside the database? | The database is shipping its change log to Supabase's archive continuously with zero failures (CONFIRMED). Which backup plan, how many days and whether point-in-time restore can be used: UNVERIFIED, owner must check the dashboard (section 4). |
| Has a restore ever been proven? | Only one table of 36 rows, twice, on 2026-11-11 (CONFIRMED). A full restore has never been run (no record exists). |
| Would anyone know if the system went down? | Not from outside. There is no uptime monitor and no status page (CONFIRMED in code). Job failures raise an in-app notice only. |

## 2. In-app row snapshots (schema `backups`)

CONFIRMED facts:

- Job: `nightly-backup`, cron job 9, 00:30 UTC, calls `public.cron_run_backup()`. Last 7 days: 7 runs, 0 failed,
  longest run 19.3 seconds. Last 30 days: a snapshot exists for every day, none missing.
- Switch: `system_config.backup_enabled = true`. A failed run writes a `critical` row to `system_logs`; a run with
  a skipped table writes a `warning`. That warning has been written every night for 30 nights (work_orders is
  skipped) and all 30 are still unresolved in the log, so the warning has become noise.
- Retention: migration `backup_snapshot_retention_14_days` was applied on 2026-11-12 and the job now purges at 14
  days. 30 snapshots still exist because the purge runs with the next nightly job; expect about 14 after
  2026-11-13 00:30 UTC. Size today 456 MB (about 15 MB per night), expected about 215 MB after the purge.
- Tables in the list (`backups._core_tables()`), with the latest snapshot (2026-11-12 00:30 UTC):

| Table | Rows captured | Copy size | Result |
|---|---|---|---|
| inspections | 2,596 | 9.9 MB | ok |
| tyre_records | 11,260 | 3.2 MB | ok |
| accidents | 43 | 1.7 MB | ok |
| vehicle_fleet | 1,622 | 313 kB | ok |
| stock_records | 36 | 7 kB | ok |
| pm_programs | 0 | empty | ok |
| pm_service_records | 0 | empty | ok |
| work_orders | 0 of 96,944 | none | skipped, over the 20,000 row limit |

- What a snapshot can do: re-insert rows that are missing now (`backup_restore_missing`, super admin, Console,
  Backups). It never overwrites a row that still exists, so it cannot undo a wrong edit, only a deletion.
- Access: schema `backups` has no grants to signed-in or anonymous users (CONFIRMED). Restore is super admin only.
- Snapshots are not per company. One snapshot holds every organisation's rows.

## 3. What is NOT covered by the in-app snapshot

CONFIRMED by comparing the list with the live tables:

| Data | Size | Rows (estimate) | Only recovery path |
|---|---|---|---|
| work_orders (job cards) | 189 MB | 96,944 | platform backup |
| parts_consumption (the expense ledger, source of all cost figures) | 139 MB | 218,776 | platform backup, or re-import of the ERP files |
| work_order_line_items | 113 MB | 184,025 | platform backup, or re-import |
| production_logs | 198 MB | 212,567 | platform backup, or re-import |
| audit_log_v2 | 655 MB | 569,498 | platform backup |
| material_master | 19 MB | 22,162 | platform backup (over the row limit) |
| corrective_actions, checklist_submissions, odometer_logs, engine_hours_logs, wash_records, tyre_status_marks, sites, access setup, budgets, KPI targets, SCO and SANY ledgers, accident case workstreams | under 4 MB each | under 6,000 each | platform backup today. Draft migration `20261113142000` adds them to the nightly snapshot |
| profiles and sign-in accounts | 1 MB | 769 | platform backup |
| Files in storage: tyre-photos 27,243 files 5.7 GB, import-files 29 files 47 MB, accident-photos 13 files, vehicle-photos 2 files | 5.8 GB | 27,287 files | NONE that we can confirm. A database backup holds the list of files, not the files. Whether Supabase keeps deleted files is UNVERIFIED |
| Edge function code and secrets | n/a | n/a | code is in the repo; secrets exist only in the Supabase dashboard |

The photos are the largest item and the one with no confirmed recovery path. A deleted photo is not in any
snapshot. This is the most important gap for evidence (inspection and accident photos).

## 4. Platform backups: what the owner must check (UNVERIFIED)

What SQL can show, and does (CONFIRMED today):

- `archive_mode = on`, `archive_command` is Supabase's WAL push, `archive_timeout = 120` seconds.
- `pg_stat_archiver`: 2,176 change-log files archived since the last restart on 2026-11-09, last one at
  2026-11-12 10:02 UTC, `failed_count = 0`.

Meaning: the database is continuously sending its change log to Supabase's storage, which is what both daily
physical backups and point-in-time recovery are built on. This is good evidence that a platform backup exists.
It does NOT tell us which plan is paid for, how many days are kept, or whether a point-in-time restore is
available to us. Those are account facts.

Owner: open the Supabase dashboard, project `jhssdmeruxtrlqnwfksc`, Database, Backups, and write down:

1. The plan (Free, Pro, Team) under Organization, Billing. On Free there are no downloadable or restorable
   backups at all.
2. Scheduled backups tab: is there a list of daily backups, how many days back does it go, and what is the date
   of the newest one.
3. Point in Time tab: is Point in Time Recovery enabled, and what is the retention (7, 14 or 28 days).
   If it says it is an add-on that is not enabled, recovery is "last daily backup", so up to 24 hours of data
   can be lost.
4. Whether "Restore to a new project" is offered (needed for a safe restore test that does not touch production).
5. Storage: Supabase states that database backups do not include the files in Storage buckets. Confirm in the
   current documentation and decide how photos are protected (section 7, item 2).

Record the answers in `DR_RUNBOOK.md` section 1. Until then every statement about recovery point and recovery
time is UNVERIFIED and must not go into a customer contract.

## 5. Restore tests

CONFIRMED:

- `backups.restore_tests` has 2 rows, both 2026-11-11, both `passed`, both ONE table (`stock_records`, 36 rows).
- Cron job 30 `backup-restore-test` runs 03:30 UTC on the 1st of each month. It has never run yet (first run
  2026-12-01). It calls `backups.run_restore_test()`, which tests only `stock_records` and reports a failure
  nowhere except its own table.
- The console button (`admin_run_restore_test`) already rebuilds every captured table into temporary tables and
  compares counts. No run of it is recorded in `backups.restore_tests` so far.
- A full restore of the project (platform backup into a new project) has never been done.

## 6. Tested restore procedure for what is restorable

This is the procedure for the 7 snapshotted tables. Steps 1 to 4 are read-only and safe at any time.
The mechanism was verified on 2026-11-11 (36 of 36 rows rebuilt) and is exercised in
`supabase/tests/ops_backup_health.test.mjs`; an earlier live round trip on tyre_records (delete 3, restore 3,
rolled back) is recorded in PROJECT_MEMORY (V495).

1. Confirm the damage. Count the rows now and compare with the last snapshot:
   Console, Backups, choose the newest snapshot taken BEFORE the damage, press Preview on the table.
   It shows rows in the snapshot, rows now, rows missing now, and rows created after the snapshot.
2. If "missing" is zero, the snapshot cannot help (the rows still exist, they were edited, not deleted). Stop
   and use the platform backup or a `_bak` table from the change that caused it.
3. Run a restore test first: Console, Backups, Run restore test. Every table must read ok.
4. Freeze writes that could collide: Console, System Configuration, maintenance mode on.
5. Recover: Console, Backups, Recover missing rows, type the confirmation. Needs a second super admin's approval
   when four-eyes control is on. Only rows whose id is missing are inserted; existing rows are never changed.
6. Check: Preview again must show 0 missing. Open one recovered record in the app.
7. Maintenance mode off. Record the event in Console, Incidents.

Limits to say out loud: the recovery point is the last 00:30 UTC snapshot (up to 24 hours of new rows are not
in it); edits made after the snapshot to a recovered row are lost for that row; rows in tables that reference a
recovered row (for example inspection photos in storage) are not restored by this.

For anything in section 3 the only path is the platform backup, by the Supabase account owner:
dashboard, Database, Backups, restore to a NEW project first, check it, then decide. Never restore over
production as the first step.

## 7. Gaps, in order of importance

1. Platform recovery point and time are unknown (section 4). Owner action, 10 minutes, no cost.
2. Photos (5.7 GB, 27,243 files) have no confirmed backup. Options, cheapest first: confirm Supabase's own
   storage durability and deletion policy and accept it in writing; or a weekly copy of the buckets to a second
   storage account using the storage API from a scheduled GitHub Action (free minutes are enough for
   incremental copies; storage cost depends on the provider).
3. The cost ledger, job cards and production are outside the snapshot and too large for it. Their protection is
   the platform backup plus the original ERP files. Keep every uploaded ERP file (bucket `import-files` holds
   only 29) or the re-import path does not exist.
4. Small tables that cannot be re-imported are not snapshotted. Closed by draft migration
   `supabase/pending_migrations/20261113142000_ops_backup_coverage_restore_test_health.sql` (21 tables, about
   6 MB per night).
5. The scheduled restore test covers one table and alerts nobody. Closed by the same draft migration (every
   captured table, `critical` log row on failure).
6. A full restore into a new project has never been timed. Do it once after item 1; it is the only way to state
   a recovery time.
7. The nightly "skipped work_orders" warning is written every night and never resolved. Either resolve it as
   accepted or stop logging a known, accepted skip (small follow-up, not drafted).

## 8. Monitoring: what exists

CONFIRMED:

- `cron-health-watch` (job 22, every 5 minutes) watches every scheduled job for: 2 failures in a row, a run
  stuck longer than 5 minutes, a start missed by more than 5 minutes. It opens one alert per job and sends an
  in-app notification to super admins. It closes the alert after 2 good runs.
- It worked: it opened an alert for `due-alerts-scan` on 2026-10-25 10:40 UTC. The job then failed every hour
  until 2026-11-08 (70 failures in the last 7 days alone). So the alarm was raised and nobody acted for 14 days,
  because it only shows inside the app, to people who must open the console.
- Jobs that call an edge function through the network (`send-scheduled-reports`, `embed-knowledge-documents`,
  `sentry-crash-alert`) report "succeeded" when the request was queued, not when the function worked. A broken
  function or a rotated key is invisible to the watchdog (INFERRED from how `net.http_post` works; recorded in
  PROJECT_MEMORY V535).
- Errors: `system_logs` collects app errors, job warnings and Sentry fatal crashes. 30 days: 30 backup warnings,
  3 Sentry criticals, 3 page errors, all unresolved. There is a log, there is no habit of clearing it.
- Sentry: a job polls for new fatal crashes every 15 minutes and emails. Whether the web error reporting key is
  set in the hosting settings is UNVERIFIED (cannot be read from here).
- Uptime: nothing. No outside check of the web app, the database or any function. `/status` in the app says
  monitoring is being configured.

## 9. Monitoring proposal (free options only)

Confirm the free limits on each provider's pricing page before choosing; they change.

1. Outside uptime checks (closes "nobody knows it is down"). A free monitor such as UptimeRobot (free plan:
   5-minute checks) or Better Stack (free plan includes a status page) with three checks:
   - Web app: `https://tyrepulse.app/` expects HTTP 200.
   - Database and jobs: after draft migration `20261113142000` is applied,
     `https://jhssdmeruxtrlqnwfksc.supabase.co/rest/v1/rpc/health_ping?apikey=<the public anon key>` as a keyword
     check for the text `"ok": true` (or `"ok":true`; test which the monitor sees). This one check turns red when
     the database is down, when last night's snapshot is older than 26 hours, when any scheduled job is in alarm
     or when the last restore test failed. The key in the address is the public one that already ships in every
     browser.
   - One edge function: any existing public function address that answers quickly without signing in
     (for example the sign-in function with an empty request, expecting its normal refusal code). Pick one and
     note the expected code.
   Alerts go to the owner's phone and email from the monitor itself, so they do not depend on our own system.
2. Status page: use the monitor's free hosted status page and set `VITE_STATUS_PAGE_URL` in the web hosting
   settings. The in-app `/status` page already switches to "Live status page available" when that is set.
3. Job failure alert that reaches a person: no new build needed once item 1 exists, because `health_ping` goes
   false when the watchdog has an open alert. Until then, check Console, System Health each morning.
4. Heartbeat for the nightly backup (optional, free): a service such as healthchecks.io gives an address that
   must be called once a day; if it is not, it emails. `cron_run_backup` could call it after a good snapshot.
   Not drafted, because item 1 already covers a missed backup within 26 hours.
5. Error budget (a simple, honest target for one small team):
   - Availability target 99.5 percent per calendar month for web app and database, measured by the outside
     monitor. That allows about 3 hours 39 minutes of downtime a month.
   - Scheduled jobs: no job in alarm for more than 24 hours.
   - Backups: a snapshot every night; restore test passed within the last 31 days.
   - Errors: no unresolved `critical` row in `system_logs` older than 2 working days.
   - Rule: when a month uses more than half of the downtime allowance, or any of the other three lines is
     broken, the next change window is spent on reliability, not features.
   Do not publish 99.5 percent to a customer until three months of measured data exist.

## 10. What needs the owner

- Read and record the platform backup facts (section 4).
- Decide how photos are protected (section 7, item 2).
- Approve applying draft migration `20261113142000` (wider snapshots, full restore test, `health_ping`). It adds
  one function that can be called without signing in; that is deliberate and exposes no business data.
- Create the outside monitor account and the three checks (section 9, item 1). About 20 minutes.
- Run one restore into a new project and time it.
