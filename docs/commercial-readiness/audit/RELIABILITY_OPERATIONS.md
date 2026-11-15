# Reliability and operations audit

Date 2026-11-12. Read-only. Database read with SELECT only (project `jhssdmeruxtrlqnwfksc`). Code read on the
working tree. Platform dashboards (Supabase backups and PITR, Vercel, Sentry, Play Console, function secrets)
were NOT readable from this session; every statement about them is marked NOT VERIFIED.

## 1. The two verdicts

| Verdict | Result | Why |
|---|---|---|
| Internal Production Readiness (current company) | AT RISK, usable | Scheduled jobs are healthy today, a job watchdog exists, row snapshots run nightly and one tiny restore test passed. But the only real disaster recovery (platform backup and point-in-time recovery) is unconfirmed, the largest tables are outside the in-app snapshot, there is no uptime monitoring, and rollback of a database change depends on hand-written notes. |
| Commercial SaaS Readiness (a second company) | NOT READY. Class 4 for operations | No stated and tested recovery objectives, no status page, no per-company restore, no per-company export a customer can run, a migration history that cannot rebuild the database, in-memory or missing rate limits on public endpoints, and a small shared instance where one company's import affects everyone. |

Counts by severity: P0 0, P1 6, P2 9, P3 4.

## 2. Measured today (VERIFIED by SQL)

| Item | Value |
|---|---|
| Postgres | 17.6, last restart 2026-11-09 09:54 UTC |
| Database size | 2,650 MB |
| Largest objects | `audit_log_v2` 655 MB, `backups.snapshot_tables` 456 MB, `production_logs` 198 MB, `work_orders` 189 MB, `ksa_country_upload_template_staging` 159 MB, `parts_consumption` 139 MB, `work_order_line_items` 113 MB, `cron.job_run_details` 104 MB, `domain_events` 101 MB, `_bak.cron_run_details_20261011` 79 MB |
| Instance settings | shared_buffers about 320 MB, effective_cache_size about 960 MB, max_connections 60, work_mem 3.5 MB |
| Connections now | 46 open of 60, 2 active |
| Statement timeouts | anon 3 s, authenticated 8 s, authenticator 8 s plus lock_timeout 8 s, default 120 s |
| Scheduled jobs | 26 in `cron.job`, all active, all last runs succeeded |
| Job failures, last 7 days | 70, all one job (`due-alerts-scan`), all before 2026-11-08 07:40 UTC, fixed since (last 8 runs succeeded) |
| Migration ledger | 1,089 rows, versions 20260609044306 to 20261112082058 |
| Repo migration files | 301 in `supabase/migrations/`, 576 `MIGRATIONS_V*.sql` at the root, 3 in `supabase/pending_migrations/` |
| In-app snapshots | 30 kept (2026-10-14 to today), nightly at 00:30 UTC |
| Latest snapshot content | accidents 43, inspections 2,596, stock_records 36, tyre_records 11,260, vehicle_fleet 1,622, pm tables 0. `work_orders` (96,944 rows) status `skipped_too_large` |
| Restore tests | 2 rows, both 2026-11-11, both passed, both ONE table and 36 rows |
| `system_logs` | last 7 days: 14 info, 8 warning, 1 critical. 59 unresolved error or critical rows in total |
| Organisations | 5 rows; fleet data in 2 |
| Public API keys | 0 issued |
| Active share links | 2, neither has a password, neither expires |

## 3. Backups and restore

### REL-1 Real disaster recovery is unconfirmed
- Severity P1. Confidence NOT VERIFIED (platform backup tier, PITR on or off, retention) / VERIFIED that the
  runbook leaves them blank (`docs/runbooks/DR_RUNBOOK.md:8-16`, five "OWNER TO SUPPLY" rows).
- What exists: a written runbook with honest gaps. What should be: a known recovery point and recovery time,
  proven by one full restore into a scratch project. What happens today: if the project is lost or badly
  corrupted, nobody can say how much data is lost or how long recovery takes.
- Internal: at risk. Commercial: Class 4 (no contract can state RPO or RTO).
- Fix: owner reads the plan and PITR settings from the Supabase dashboard, fills the runbook, runs one restore
  to a new project and times it. Risk to current company: none.
- Acceptance test: runbook rows filled; a dated restore record with row counts for the ten largest tables.
- Area: owner action, ops.

### REL-2 The in-app snapshot is row recovery only, covers 7 small tables, and lives inside the database it protects
- Severity P1. Confidence VERIFIED.
- Evidence: `backups._core_tables()` lists 8 tables; `work_orders` is skipped at the 20,000 row limit
  (`backup_max_table_rows` = 20000); `parts_consumption` (218,776 rows, the cost ledger),
  `work_order_line_items`, `production_logs`, `checklist_submissions`, `corrective_actions`, accident case
  tables, audit, users and all files in storage are not in the list. Snapshots are jsonb rows in schema
  `backups` in the same database (456 MB).
- What happens: an accidental bulk delete on the expense ledger or job cards has no in-app undo beyond ad hoc
  `_bak` tables. A lost database loses the snapshots too. Restore is "re-insert missing rows" only (by design).
- Internal: at risk. Commercial: Class 3. Snapshots are not per company: one snapshot holds every tenant, and
  restore is a super-admin action, so a customer cannot be restored alone or restore itself.
- Fix: rely on platform PITR as the stated recovery path (REL-1); add a scheduled logical export of the large
  tables to storage outside the database; scope restore preview by organisation. Risk: low (additive).
- Acceptance test: a deleted test row in `parts_consumption` can be recovered by a documented, timed step.
- Area: DB, ops.

### REL-3 The restore test proves little and the monthly job has not run yet
- Severity P2. Confidence VERIFIED.
- Evidence: `backups.restore_tests`: 2 manual runs, `tables_tested` 1, 36 rows (stock_records). Job 30
  `backup-restore-test` (monthly, day 1) has no run recorded yet.
- Fix: test every snapshotted table and compare row counts and a checksum; alert on failure. Risk: none.
- Area: DB.

### REL-4 Backup and audit growth will fill a small database
- Severity P2. Confidence VERIFIED (sizes) / PLAUSIBLE (plan limit, NOT VERIFIED).
- `audit_log_v2` 655 MB (bulk imports are audited, PROJECT_MEMORY records 94 percent of rows from imports) and
  snapshots 456 MB are 42 percent of the database. Snapshot retention was cut to 14 days in repo migration
  `20261112198000`; 30 snapshots still exist, so that change is either not applied or not yet effective
  (NOT VERIFIED which).
- Commercial effect: every new company adds audit and snapshot volume to the same instance.
- Area: DB, owner decision (audit of bulk imports).

## 4. Deployment and rollback

### REL-5 Database changes have no down scripts and the migration history cannot rebuild the database
- Severity P1. Confidence VERIFIED.
- Evidence: the ledger holds 1,089 applied entries stamped at apply time, while the repo holds 301 dated files
  whose stamps do not match (repo files run to `20261112198000`, the ledger ends at `20261112082058` on the
  same day, so repo stamps are drafts, not ledger keys). PROJECT_MEMORY records migrations applied with the
  SQL tool with no repo file (for example V543, V583 `VACUUM`, the V386 trigger body, 24 migrations of
  2026-09-29) and "ledger reconcile deferred". Rollback is a comment block in each file plus `_bak` snapshot
  tables. 576 older `MIGRATIONS_V*.sql` files sit at the repo root.
- What happens: there is no way to stand up a second environment (staging, a customer's dedicated instance,
  a disaster rebuild from source) from the repository. Every change is tested on production in a rolled-back
  transaction. A bad migration is undone by hand.
- Internal: at risk (the team has worked this way with care). Commercial: Class 4.
- Fix: take a schema dump of production as the new baseline, create a staging project from it, adopt one
  apply path (CLI from `supabase/migrations/`), and require a tested down step or a restore point for data
  migrations. Risk to current company: none for the baseline dump; process change only.
- Acceptance test: a fresh project built from the repo passes the PGlite and web test suites and matches a
  production schema diff with no differences.
- Area: DB, ops. See TEST_ENVIRONMENT_PLAN.md.

### REL-6 Pending migrations and staged fixes are waiting on manual steps
- Severity P2. Confidence VERIFIED.
- `supabase/pending_migrations/` holds 3 files (open work orders replace RPC, profiles PII read, profiles
  secret columns). `docs/audit-2026-11/PRODUCTION_READINESS.md` lists 12 owner actions, including deploying
  every edge function from the repo (all edge function security fixes were "STAGED only") and an order
  dependency between a web deploy and a migration that would otherwise lock console sign-in.
- Risk: order mistakes. Area: owner action, ops.

### REL-7 Edge functions: manual deploy, no health check, repo drift
- Severity P2. Confidence VERIFIED (workflow and one drift) / NOT VERIFIED (byte equality of the rest).
- `.github/workflows/deploy-edge-functions.yml` is manual only and needs a repository secret. 18 functions
  are deployed. `ai-tyre-inspection` runs prompt v3 while the repo is v4 (see AI_READINESS.md AI-3).
  `public-api` (v10) and `qr-login` (v8) have not been redeployed since they were created or last changed
  months ago. Rollback of a function is "redeploy the previous commit"; previous versions are not kept by
  this process. No CI typecheck of function code (PROJECT_MEMORY).
- Fix: deploy from CI on merge with a post-deploy smoke call per function; record version and commit.
- Area: ops.

### REL-8 Web deploy and rollback
- Confidence VERIFIED (config) / NOT VERIFIED (Vercel project state).
- `vercel-production.yml` builds and deploys on push to main; `vercel.json` skips builds for non-web paths.
  Rollback is Vercel's instant rollback to a previous deployment (available on the platform, not scripted or
  rehearsed here). The app is a prompt-mode PWA: open tabs keep the old bundle until the user accepts the
  update, so a web rollback or a breaking database change reaches users at different times. The free plan's
  100 deployments a day limit once blocked production builds (PROJECT_MEMORY 2026-08-11).
- Severity P2. Fix: write the rollback step in the runbook, confirm the Vercel plan, add a version check that
  forces reload when the database contract changes. Area: ops, web.

### REL-9 Mobile release reliability
- Severity P2. Confidence VERIFIED from repo and PROJECT_MEMORY; device behaviour NOT VERIFIED.
- Forced update gates exist for both apps (`mobile_min_version`, `flutter_min_version`). Flutter release
  builds warn when the Sentry DSN secret is missing (`flutter-release-play.yml:255`), so crash reporting on
  the Flutter app may be off (secret presence NOT VERIFIED). Expo symbol upload is disabled. The Android
  signing keystore in git history is an open P1 in the security audit.
- Area: ops, owner action.

## 5. Monitoring and incidents

### REL-10 No uptime monitoring and no status page
- Severity P1. Confidence VERIFIED (code) / NOT VERIFIED (whether an external monitor exists outside the repo).
- Evidence: `src/pages/PublicStatus.jsx:14-15` shows "Live status page is being configured ... No automated
  service-health claim is shown until monitoring is connected" unless an environment URL is set. No health
  endpoint, no external probe configuration in the repo.
- What happens: an outage of the app, the database or a function is noticed when a user complains.
- Internal: at risk. Commercial: Class 4 (no availability evidence, no incident communication).
- Fix: external probes on the web app, the Supabase REST endpoint and one function; a hosted status page;
  alert to a phone. Risk: none.
- Area: ops.

### REL-11 Error monitoring is wired but its switches are unconfirmed
- Severity P2. Confidence VERIFIED (code) / NOT VERIFIED (DSNs set in production).
- Web Sentry starts only when `VITE_SENTRY_DSN` is set (`src/lib/monitoring.js:121-130`), 20 percent traces.
  Errors also land in `system_logs` (app error sink) with an in-console viewer. Expo Sentry wired
  (`mobile/lib/sentry.ts`). Flutter depends on a release secret. A cron job polls Sentry for fatal issues
  every 15 minutes and emails (`sentry-crash-alert`). PostHog received nothing as of 2026-07-23
  (PROJECT_MEMORY).
- 59 unresolved error or critical rows sit in `system_logs`: there is a log but no triage habit.
- Edge function logs are console output only; there is no alert on function 5xx rates.
- Area: ops, owner action.

### REL-12 Scheduled jobs: healthy, watched, one silent week
- Severity P2. Confidence VERIFIED.
- 26 jobs. Every-minute: domain events, webhooks, workflow notifications, flag changes. Every 5 minutes: job
  watchdog (`cron-health-watch`), JIT expiry, photo worker. Every 10 to 30 minutes: embeddings, scheduled
  reports, Sentry alert, QR purge, issue breach check. Hourly: escalations, alert thresholds, workshop
  notices, due alerts. Daily: checklist assignments, backup, audit seal, audit retention, run-history
  retention, tenant export retention, driver fines, upload gap check, accident SLA. Weekly: security scan.
  Monthly: restore test.
- `due-alerts-scan` failed 70 times in a row (a type error) until 2026-11-08. The watchdog existed; whether it
  raised an alert that anyone saw is NOT VERIFIED. Jobs that call functions through `net.http_post` report
  "succeeded" when the HTTP call was queued, not when the function worked, so a rotated key or a broken
  function is invisible to the job table (PROJECT_MEMORY V535).
- All jobs are platform-wide loops; a slow tenant slows the loop for all. The upload gap check and several
  consumers were written for one organisation (PROJECT_MEMORY V486b fixed one cross-organisation notice).
- Fix: route watchdog alerts to push or email with acknowledgement; check `net._http_response` status for the
  function-calling jobs. Risk: none.
- Area: DB, ops.

### REL-13 Incident process
- Severity P2. Confidence VERIFIED (objects exist) / NOT VERIFIED (use).
- Console has platform incidents with status flow and postmortem fields, a Sentry-to-incident trigger, and a
  DR runbook. No on-call owner, no support hours, no severity targets are written down. One named owner
  operates everything.
- Commercial: Class 4 until a support and incident commitment exists.

## 6. Concurrency, performance, capacity

### REL-14 Concurrency controls
- Confidence VERIFIED from migrations and PROJECT_MEMORY (not re-probed here).
- Present: optimistic-lock refusals raise `PT409` (never 40001, which caused a week-long retry loop);
  single-open partial unique indexes (breakdowns, corrective actions); advisory locks for accident reference
  numbers and AI budget; idempotent import keys for expenses (`import_uid`) when the line number column is
  mapped; offline queue idempotency by client id.
- Gaps: several business keys are unique across all companies (see TENANCY_SECURITY.md TEN-1 and
  COMMERCIAL_FOUNDATION.md CF-09), so two companies can collide; expense re-import still duplicates when the
  line number column is not mapped; no general row-version column on most editable tables (last write wins).
- Severity P2. Commercial: Class 3.

### REL-15 Performance hot spots (pg_stat_statements since 2026-11-09)
- Confidence VERIFIED.

| Statement | Calls | Mean | Total | Note |
|---|---|---|---|---|
| Realtime WAL decoder | 256,970 | 14 ms (max 14.7 s) | 3,489 s | Still the largest single cost, 18 times the next statement. Publication was reduced in V582; a further reduction is in repo migration `20261112197000` |
| `tyre_records` PostgREST read | 4,595 | 42 ms | 191 s | Most-called app read |
| `cron_health_watch` | 862 | 193 ms (max 1.0 s) | 166 s | Slower than the 57 to 73 ms recorded after V538 |
| An RPC through PostgREST | 42 | 2,541 ms (max 3.4 s) | 107 s | Within 8 s timeout, user-visible wait |
| `work_orders` list reads | 21 to 73 | 322 to 1,470 ms | | Slow for a list page |
| `scan_due_alerts` | 72 | 1,073 ms | 77 s | Hourly |
| `workshop_status_notify_scan` | 72 | 890 ms | 64 s | Hourly |
| Three one-off maintenance statements | 1 each | 95 to 112 s | | Run by hand against production (default 120 s timeout) |

- Severity P2. The app is I/O bound on a small instance (PROJECT_MEMORY: largest table is twice the cache).
- Commercial: one shared small instance; the compute tier is the lever, and its current size and cost are
  NOT VERIFIED.

### REL-16 Imports and timeouts
- Severity P2. Confidence VERIFIED from code notes and PROJECT_MEMORY.
- Browser import: chunked, 4 parallel workers, retry with backoff, statement timeout mapped to a plain
  "server took too long" message. Cap about 100,000 rows per file. Each inserted expense row runs the
  classifier trigger; each work order row runs audit and event triggers (71 percent of insert time).
  Authenticated statement timeout is 8 s, so one slow chunk fails and is retried.
- The Supabase table editor CSV path is an owner tool, not something a customer can use.
- No server-side import pipeline for very large files. An import by one company loads the shared instance.
- Commercial: Class 2 for normal files, Class 4 for million-row onboarding.

### REL-17 Connection headroom
- Severity P3. 46 of 60 connections open while nearly idle. PostgREST and Realtime pool them, so this is not
  an immediate fault, but headroom for direct connections (migrations, exports) is thin. Pooler mode NOT
  VERIFIED.

## 7. Abuse controls on public endpoints

| Endpoint | Control | Status | Evidence |
|---|---|---|---|
| Sign-in (function `sign-in`, anon RPCs) | 5 failures then 15 minute lock per identifier; no per-IP limit; CAPTCHA wired but off because phones send no token | Partial | `sign-in/index.ts:128-147`; security audit AUTH-9 |
| QR sign-in | Feature off by default; per-IP start limit 10 a minute; single use; refuses accounts with MFA | Adequate while off | `qr-login/index.ts:72-94`; PROJECT_MEMORY |
| Public API | Key hash lookup, per key per minute limit in the database, organisation scope, max 100 rows | Present, never used (0 keys). Deployed v10 has not been redeployed since creation; PROJECT_MEMORY records two endpoints selecting columns that do not exist | `public-api/index.ts:101-138` |
| Share links (`/report/:token`, workshop TV, accident portal) | Token, optional password and expiry; password lockout applied but not verified | Partial. Both live links have no password and never expire | SQL above; API-6 |
| Marketing contact form | 5 per 10 minutes per IP, in memory per server instance; honeypot; body cap; no CAPTCHA | Not a real limit on a serverless host (the code says so) | `marketing/app/api/contact/route.ts:37-55` |
| Client error sink | Per IP and global limits in the database | Present | security audit |
| Send email, send-now report | Limits exist in repo code, deployment not confirmed | Staged | security audit API-1, API-2 |
| Embedding function | No limit, no budget check | Open | API-8 |
| File upload | No server limit on size or count beyond bucket rules | Open | FILE-7 |
| Self sign-up | Open (`registration_open` true), lands pending in the current customer's company | See COMMERCIAL_FOUNDATION.md CF-01 |

### REL-18 Abuse controls are uneven
- Severity P1 for commercial (contact form, per-IP sign-in, uploads, embedding), P2 internal.
- Fix: a firewall rate rule for the contact route and sign-in function; expiry required on share links;
  deploy the staged limits; storage size limits. Risk: low.

## 8. Secrets hygiene (names only)

- Database table `cron_config` holds: cron_secret, workflow_notify_secret, sentry_auth_token, sentry_org,
  sentry_region_url, sentry_project, sentry_alerts_enabled, anon_key. RLS deny-all for clients (per earlier
  audits).
- Vault entries read by the photo dispatcher: tyre_ai_worker_jwt, tyre_ai_worker_secret.
- Function secrets referenced in code: ANTHROPIC_API_KEY, OPENAI_API_KEY, AI_PROVIDER_KEY, AI_WORKER_SECRET,
  AI_MODEL, AI_FALLBACK_MODEL, AI_DAILY_LIMIT_USD, AI_RESERVE_USD_PER_CALL, AI_RATE_LIMIT_PER_MIN,
  AI_RATE_LIMIT_PER_DAY, AI_ALLOWED_ORIGIN, ALLOWED_ORIGINS, RESEND_API_KEY, APP_URL, Stripe keys,
  FIREBASE_SERVICE_ACCOUNT, WORKFLOW_NOTIFY_SECRET, SUPABASE_SERVICE_ROLE_KEY.
- CI secrets referenced: SUPABASE_ACCESS_TOKEN, VERCEL_TOKEN, FLUTTER_SENTRY_DSN, Play service account,
  EXPO_TOKEN.
- Findings (from `docs/audit-2026-11/SECRETS_EXPOSURE_AUDIT.md`, not re-tested): a release keystore in git
  history not rotated (P1, open); no client-side secret found; publishable keys only in clients.
- REL-19 (P2): there is no secret inventory with owner, rotation date and blast radius, and no rotation has
  been rehearsed. Jobs that depend on a rotated key fail silently (REL-12).
- Whether each secret is actually set is NOT VERIFIED.

## 9. Go or No-Go criteria for reliability

| # | Criterion | Target for selling | Measured today | Result |
|---|---|---|---|---|
| 1 | Platform backup and PITR confirmed, retention known | Written, 7 days or more | Blank in runbook | NO-GO |
| 2 | Full restore rehearsed and timed | Once per quarter, RTO stated | Never | NO-GO |
| 3 | Row recovery covers the cost ledger and job cards | Yes | 7 small tables only | NO-GO |
| 4 | Database can be rebuilt from the repository | Yes | No | NO-GO |
| 5 | Staging environment | Exists | None | NO-GO |
| 6 | Uptime probes and status page | Live | None in repo | NO-GO |
| 7 | Scheduled job failures alert a person | Yes | Watchdog exists; a 70-run failure streak happened this month | AT RISK |
| 8 | Scheduled jobs succeeding | 100 percent last 24 h | 26 of 26 | GO |
| 9 | Error monitoring on web and both mobile apps | DSNs set and events arriving | Not verified | NOT VERIFIED |
| 10 | Edge functions equal to repo, deployed by pipeline | Yes | At least one behind; manual | NO-GO |
| 11 | p95 of list reads under 1 s | Yes | Work order lists 0.3 to 1.5 s mean | AT RISK |
| 12 | Storage growth plan | Audit and snapshot bounded | 42 percent of the database | AT RISK |
| 13 | Rate limits on every public endpoint | Enforced at the edge | Mixed | NO-GO |
| 14 | Per-company export and restore | Customer can export; operator can restore one company | Operator-only export; no per-company restore | NO-GO |
| 15 | Support and incident commitment | Written | None | NO-GO |
| 16 | No stranded reservations, queues draining | Yes | 0 stranded AI reservations; queues current | GO |

Internal use needs criteria 1, 2, 6 and 7 closed to move from "at risk" to "ready". Commercial sale needs all
of 1 to 6, 10, 13, 14 and 15.

## 10. Recommended order (each additive, low risk to the current company)

1. Owner reads and records backup tier, PITR and retention (REL-1). Half an hour.
2. External uptime probes and a status page (REL-10).
3. Watchdog alerts to a phone; check HTTP results of function-calling jobs (REL-12).
4. Schema baseline and a staging project; one restore rehearsal (REL-5, REL-1).
5. Deploy functions from the repo by pipeline with smoke checks (REL-7).
6. Scheduled export of large tables outside the database (REL-2).
7. Edge rate limits and share link expiry (REL-18).
8. Secret inventory and one rotation rehearsal (REL-19).

## 11. Not verified

- Supabase plan, compute size, PITR, backup retention, pooler mode, disk limit.
- Vercel plan, production deployment commit, firewall rules, environment variables.
- Whether Sentry and PostHog keys are set and receiving events; whether the Flutter release has a DSN.
- Whether the job watchdog's alerts reach anyone.
- Function secrets present or absent; byte equality of deployed functions other than the photo worker's
  prompt version.
- Repo migration `20261112198000` (14 day snapshot retention) applied or not.
- Behaviour under load with a second tenant (no load test exists).
- Device behaviour of either mobile app.
