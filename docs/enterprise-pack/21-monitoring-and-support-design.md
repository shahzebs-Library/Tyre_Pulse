# 21. Monitoring and Support Design

| Field | Value |
|---|---|
| Deliverable | 21 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Error capture (Sentry + `system_logs`), a health score, cron health watch, upload-gap and security alerts, trust alerts, push receipts, a user problem-report inbox and support sessions all exist. Correlation/request IDs, several spec-required log fields, a unified error taxonomy across the three clients, uptime monitoring and an on-call path are missing. |
| Evidence | Code verified: `src/lib/monitoring.js`, `src/lib/safeError.js`, `src/components/ErrorBoundary.jsx`, `src/lib/api/systemLogs.js`, `mobile/lib/sentry.ts`, `mobile/lib/safeError.ts`, `tyre_pulse_flutter/lib/core/errors/app_error.dart`, `tyre_pulse_flutter/lib/core/telemetry/*`, console pages under `src/console/pages/`. Live table counts and the `system_logs` / `user_issues` column lists read 2026-11-10. Edge-function deploy state from PROJECT_MEMORY. |
| Related docs | [16 API audit](16-api-audit.md), [20 AI and automation](20-ai-and-automation-architecture.md), [24 Rollback plan](24-rollback-plan.md), `docs/MONITORING.md` (older; predates V255 system_logs and the Sentry console) |

## 1. Monitoring components

| Component | Where | Status | Live state (2026-11-10 unless noted) |
|---|---|---|---|
| Sentry, web | `src/lib/monitoring.js` (`initMonitoring`, `captureError`, `scrubEvent`, lazy SDK, event queue) | Built | Needs `VITE_SENTRY_DSN`; CSP `connect-src` lists Sentry ingest. JWTs and query strings scrubbed. |
| Sentry, Expo app | `mobile/lib/sentry.ts`, `@sentry/react-native` | Built | Build-time symbol upload disabled (#157); `SENTRY_PROJECT` in `eas.json` points at the web project. Expo builds retired. |
| Sentry, Flutter app | `sentry_flutter ^9.27.0`, `lib/core/telemetry/*` | Built in code | Release workflow passes `FLUTTER_SENTRY_DSN` only if the owner adds the secret (memory 2026-11-08). |
| App error sink | `system_logs` (V255) via `logSystemEvent`, fallback anon-safe RPC `log_client_error` | Built | 380 rows: info 186, warning 136, error 50, critical 8; 21 in last 7 days |
| Crash console | `/console/crash-reports` + edge fn `sentry-issues` | Built | Read, assign, comment, resolve inside the console; token in `cron_config`, never in the browser |
| Fatal crash alert | cron `sentry-crash-alert` */15 + edge fn (V284) | Built | Dedupe via `sentry_alert_log`; critical `system_logs` row + one email |
| Health score | `src/lib/adminHealth.js` + `/console/health` | Built | 0-100 from freshness, error rate, reachability, anomalies |
| Cron health | cron `cron-health-watch` */5 using `_cron_watch_state()` | Built | 57-73 ms per run after the 2026-10-11 rewrite |
| Upload coverage | `/console/import-history` Daily coverage tab, `upload_feeds` registry, cron `upload-gap-check` 05:30 | Built | One notice + one push per gap; feeds configurable |
| Security posture | `admin_security_posture()`, `/console/security-audit`, cron Sunday 05:00 | Built | Alerts only on NEW findings |
| Data trust | `metric_registry`, `quality_rules`, `trust_alerts` (V473-V475), console Data Trust cluster | Built | 0 open trust alerts |
| Push delivery | `push_delivery_receipts` + `get_push_delivery_summary` | Built | 2,936 receipts; "accepted" = provider took it, not shown on device. Expo second-phase receipts not polled. |
| Workflow notifications | `workflow_notifications` | Built | 4,259 delivered, 193 skipped |
| Audit integrity | `audit-seal-daily` hash chain, `/console/audit-integrity` | Built | |
| Product analytics | PostHog (`src/lib/analytics.js`) | Built, inert | Received 0 events in 30 days (2026-09-23 memory); `VITE_POSTHOG_KEY` likely unset |
| Uptime / synthetic checks | none | Not built | No external probe of tyrepulse.app or the edge functions |

## 2. Support tooling

| Tool | Where | Status |
|---|---|---|
| Report a problem (web + Flutter) | `user_issues` table, `submit_user_issue`, console Error Center inbox | Built. Columns: org, country, site, reporter, platform, app_version, device, os, page_or_screen, category, severity, reference_id, screenshot_path, linked_log_ids, linked_sentry_ids, status, assignee, SLA due, first response, resolved |
| SLA breach checks | cron `user-issue-breach-check` */30 | Built |
| Support sessions | `support_sessions` + `start/end/current_support_session` (V318) | Built: records and authorises time-boxed, reason-required, audited inspection of one tenant. Does NOT yet retarget `app_current_org()`; 0 sessions recorded. |
| Session revocation | edge fn `admin-revoke-sessions` | Built (access tokens can stay valid up to ~1 h) |
| Password reset requests | `password_reset_requests`, Console Users panel (20261108120000) | Built |
| Incidents | `platform_incidents` (+ Sentry burst auto-incident) | Built |
| Tenant export | edge fn `tenant-export` | Built |

## 3. Error handling framework vs the spec

### What exists

| Layer | Implementation |
|---|---|
| Web message mapping | `src/lib/safeError.js` `toUserMessage(err, fallback)`: code map (42501, 23505, PT409 ...), DB-text markers, never passes raw driver text; `logAndMessage` logs then maps |
| Web service layer | `_client.js` `unwrap` sanitises and keeps the raw error on `.cause`; `isNotProvisioned` is code based |
| Web render crash | `ErrorBoundary.jsx`: reference ID `ERR-XXXXXXXX` (from the Sentry event id), copy button, "Report this to me", dev-only stack; per-route boundary keyed by pathname; stale-chunk auto-recovery not reported to Sentry |
| Expo app | `mobile/lib/safeError.ts`, ErrorBoundary + per-screen `ScreenBoundary` |
| Flutter | `AppError` with `AppErrorKind` {network, authentication, authorization, validation, conflict, storage, sync, server, unknown}; `message` (displayable) kept separate from `technical` (loggable) |
| Edge functions | Generic messages to callers, CORS-wrapped JSON errors |
| Guards | `webI18nKeyCoverage.test.js`, `honestReadGuards.test.js` (failed reads must not render as empty), PDF engine real-library test |

### Spec-required log fields vs what is recorded

| Spec field | `system_logs` | Sentry event | Status |
|---|---|---|---|
| Error Reference ID | `reference_id` | event id | Recorded (web); not shown on Flutter/Expo error screens consistently |
| User | `user_id`, `user_email` | user id, role, site (`setMonitoringUser`) | Recorded |
| Company | `organisation_id` | no | Partly |
| Country | no column | no | Missing |
| Branch | no | no | Missing (no branch level in data) |
| Site | no column (in Sentry user) | site | Partly |
| Module | `module_id` | context | Recorded when callers pass it |
| Screen | `screen`, `url` | route | Recorded |
| Action | no | breadcrumbs | Missing as a field |
| API endpoint | in `detail` when passed | breadcrumb | Partly |
| Request ID / Correlation ID | no | no | Missing (memory mentions `src/lib/traceId.js` from V475, but the file is not present in the repo) |
| Device / Browser | `device` | yes | Recorded |
| App version | `app_version` | release | Recorded |
| Network status | no | no | Missing |
| Timestamp | `created_at` | yes | Recorded |
| Full stack trace | `detail` (when passed) | yes | Recorded in Sentry |
| Sanitised request / response payload | no | scrubbed request | Missing |
| Severity | `severity` (info/warning/error/critical) | level | Recorded |
| Fingerprint / grouping | `error_fingerprint` | yes | Recorded |

### Spec error categories vs taxonomy

The spec lists 20 categories. Web maps by Postgres code and text, not by a declared category; Flutter has 9 kinds; Expo has its own map. Categories with no explicit handling class: Business Rule Violation, Approval Error, Data Integrity Error, Offline (Flutter only), Import, Export, PDF/PPTX Generation, AI, Integration, Background Job. Background job failures reach `system_logs` from SQL (cron failures, backup failures, Sentry alerts) but carry no category.

Recommendation: one shared category enum (`src/lib/errorCategories.js` mirrored in `mobile/lib` and `tyre_pulse_flutter/lib/core/errors`), a `category` column on `system_logs`, and a client-generated `correlation_id` sent as a request header to edge functions and stored on every log row.

## 4. Alert routing today

| Signal | Channel | Who |
|---|---|---|
| New fatal crash | critical `system_logs` + email to `sentry_alert_email` | owner |
| Cron job failure | `cron-health-watch` to system_logs/notification | super admins |
| Backup failure | critical `system_logs` (V495) | super admins |
| Missing upload | in-app + push, once per gap | Admin/Manager/Director of the org |
| Security finding (new) | notification | super admins |
| Break-glass console login / risky action | notification to every super admin | super admins |
| Accident SLA | routing rules + workflow_notifications | resolved per rule |
| Alert rules | in-app only | per rule |

No paging/on-call tool, no escalation if a critical alert is not acknowledged, and email depends on Resend keys being configured.

## 5. Gaps

| Gap | Phase | Effort |
|---|---|---|
| Correlation/request ID end to end (client header, edge fn, `system_logs` column) | 4 | M |
| Add country, site, action, network_status, category columns to `system_logs`; populate from clients | 4 | M |
| Unified error category enum across web, Expo, Flutter, edge | 4 | M |
| Reference ID shown on every error surface (Flutter, Expo, toasts), not only the web boundary | 4 | S |
| External uptime probe (web, edge functions, Supabase) with alerting | 5 | S |
| On-call escalation for unacknowledged critical alerts | 5 | M |
| Expo push second-phase receipt polling | 5 | S |
| Support session retargeting of `app_current_org()` | 5 | L (security-sensitive) |
| PostHog key in Vercel, or remove the SDK | 1 | S (owner) |
| Flutter `FLUTTER_SENTRY_DSN` secret | 1 | S (owner) |
| Mobile Sentry symbol upload + correct project | 5 | S |

## Open decisions for the owner

- Choose an uptime/on-call service (or accept email-only alerting).
- Keep PostHog (set the key) or remove the dead SDK.
- Whether support sessions should ever let a super admin read as the customer, or stay authorise-and-audit only.

## Next actions

1. Phase 1 (S, owner): set `FLUTTER_SENTRY_DSN` and `VITE_POSTHOG_KEY`, or decide to drop PostHog.
2. Phase 4 (M): migration adding `category`, `correlation_id`, `country`, `site`, `action`, `network_status` to `system_logs` + `log_client_error`; client correlation ID module on all three apps.
3. Phase 4 (S): render the reference ID on Flutter and Expo error states.
4. Phase 5 (S): external uptime probe on `/`, `/login`, `get_public_config` and each edge function health path.
