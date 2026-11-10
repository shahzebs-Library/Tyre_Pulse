# 29 - Register of Proposed File, Database, API and Configuration Changes

- Deliverable 29 of 29
- Date: 2026-11-10
- Status: Proposed changes only. Nothing in sections 1 to 6 has been made. Appendix A lists changes that already
  exist in the repo or the database but still wait for an apply, deploy or owner step.
- Evidence: proposed objects are derived from the open items in doc 26 and the code paths that already exist.
  Appendix A was checked on 2026-11-10 against the repo (`ls`, `grep`) and the live project with read-only SQL and the
  edge-function list. Where a row is "per project memory" it was not re-verified.
- Related docs: 26-priority-roadmap.md (every row cites an R-id), 27-cost-and-complexity-estimate.md,
  28-risks-and-dependencies.md, `supabase/pending_migrations/README.md`, `supabase/security-rollout/README.md`.

## Conventions for every change below

- New migrations go in `supabase/migrations/` with a UNIQUE timestamp (see A3). Header: STATUS, verify block,
  rollback block, `_bak` snapshot for any data change. Apply via the `database-migration-safety` skill.
- SECURITY DEFINER functions: pinned `search_path`, re-check org + country + site in the body, revoke from PUBLIC
  then from anon, grant authenticated only when a client calls it (V500 ordering).
- RLS predicates use the zero-argument scope readers wrapped in `(select ...)` (V396 InitPlan rule).
- Read RPCs with nullable filters set `plan_cache_mode = force_custom_plan` (memory 2026-10-11).
- JS mirrors of SQL (for example `tyreKm.js`, `materialMaster.js`, `accidentCase.js`) change in the same commit.
- Names below marked "(proposed name)" are placeholders; the implementer may choose the final name.

## 1. Database

### 1.1 Tables and columns

| Change | Type | R-id |
|---|---|---|
| `send_email_allowlist` (org_id, address_or_domain, created_by) + per-user send counter (proposed name) | new table | R-003 |
| `report_schedules.org_id` NOT NULL after back-fill from creator profile | constraint | R-004 |
| Single org column: converge `profiles.org_id` / `organisation_id`, `module_permissions.org_id`, billing tables | column migration | R-058 |
| `org_units` seed for KSA (country, region, site, workshop) + `org_unit_id` on operational tables, nullable, default-open | data + columns | R-070 |
| `approval_matrix` rows for the first live chain (owner-provided names) | data | R-072 |
| `approval_delegations` effective windows already exist (V203): add approval limit columns (amount, currency) | columns | R-073 |
| `master_data_change_requests` (entity, before, after, status, steward, effective_from) (proposed name) | new table | R-077 |
| `organisations.suspended_at`, `suspended_reason` if not present; enforcement reads it | columns | R-075 |
| Country-qualified asset key: `vehicle_fleet` already unique per (org, country, asset_no); add `asset_uid` surrogate referenced by new joins | column | R-042 |
| Ticket fields on `user_issues`: priority, category, assignee, sla_due_at, resolution, screenshot refs | columns | R-115 |
| `tenant_usage_daily` (org, day, storage_bytes, api_calls, ai_tokens, automation_runs) (proposed name) | new table | R-111 |
| `api_keys`: `allowed_ips`, `version`, `rotated_from` | columns | R-097 |
| `webhook_subscriptions` + `webhook_deliveries` (proposed names) | new tables | R-097 |
| `consent_records` (user, purpose, granted_at, withdrawn_at) (proposed name) | new table | R-116 |
| `legal_holds` (org, entity, reason, placed_by, released_at) (proposed name) | new table | R-116 |

### 1.2 Functions and triggers

| Change | R-id |
|---|---|
| `log_client_audit_event(action, entity, record_id, payload)` DEFINER RPC; `auditLogger.js` calls it | R-002 |
| `get_report_snapshot`: filter payload by `report_shares.pages` | R-005 |
| `record_login_failure`: return the same shape for existing and unknown identifiers | R-011 |
| `resolve_approvers` wired into `decide_inspection_approval`, `decide_checklist_approval`, accident closure and work order approval | R-072 |
| `app_can_see_unit(unit_id)` scope reader (zero-arg form `app_unit_scope()`), opt-in per table | R-070 |
| Server CPK RPCs (`get_fleet_cpk`, `get_cpk_drivers`, `get_brand_size_cpk`) on lifetime CPK (one price per tyre) | R-054 |
| `is_scrapped(tyre_row)` and `wo_is_done(status)` single definitions, used by reports | R-055 |
| `support_session_org()` consulted by `app_current_org()` when an active audited session exists | R-076 |
| `enforce_org_suspension` gate in `app_is_active()` or route-level check | R-075 |
| `tyre_close_rotations(p_dry_run => false)` run (existing function) | R-035 |
| `cron_check_upload_gaps` style scan for approaching alert thresholds feeding the anomaly feed | R-096 |
| Usage rollup cron writing `tenant_usage_daily` | R-111 |

### 1.3 Policies

| Change | R-id |
|---|---|
| Revoke `INSERT` on `audit_log_v2` from `authenticated` after R-002 ships | R-002 |
| Vehicle-photo bucket UPDATE policy: `storage_object_in_my_org(owner)` | R-006 |
| `parts_consumption_site_isolation` RESTRICTIVE SELECT using `app_site_scope()` | R-007 |
| Capability policies (`app_user_can`) on the next table group beyond the 11 pilot tables | R-051 |
| Location-scoped RESTRICTIVE policies, opt-in per table, default open | R-070 |

### 1.4 Data corrections (all with `_bak` snapshot and undo)

| Change | R-id |
|---|---|
| Re-import KSA job cards to repair 574 swap-class and year 0022-24 rows | R-030 |
| Load vehicle expiry dates file into `vehicle_fleet` | R-031 |
| Approve FX rates in `currency_rates` | R-032 |
| Tyre evidence proposals P1-P6, including closing legacy active tyre YMN50625 | R-034 |
| Owner-chosen side for 58 mileage-conflict groups | R-036 |
| Clear brand values from UAE `removal_reason` (repo `MIGRATIONS_V420_REMOVAL_REASON_BRAND_CLEANUP.sql`, renumber first) | R-037 |
| SANY Apr-Jul generator row replaced from proforma PDF | R-038 |

## 2. API and edge functions

| Change | Function | R-id |
|---|---|---|
| Deploy repo version (adds `workshop_status` digest) and byte-diff | `send-scheduled-reports` | R-001 |
| Period-aware executive and claims digests | `send-scheduled-reports` | R-092 |
| Recipient allowlist + rate limit + sanitized provider errors | `send-email` | R-003 |
| Shared error contract: `{ error, code, reference_id }`, correlation id header passthrough | all 19 functions via `_shared/` | R-012 |
| Versioned routes (`/v1/...`), OpenAPI document, IP restriction, webhook delivery | `public-api` | R-097 |
| Honour `notification_preferences`; WhatsApp channel; Expo receipt polling job | `workflow-notify` | R-094 |
| Turnstile token passed by Flutter sign-in | `sign-in` + Flutter auth | R-025 |
| Usage counters per call | `public-api`, `chat-ai`, `ai-orchestrator`, `ai-tyre-inspection` | R-111 |
| New: server import worker reading Storage CSV into staging via COPY (proposed `import-worker`) | new | R-093 |

## 3. Web files (src/)

| Change | Path | R-id |
|---|---|---|
| Audit writes through RPC | `src/lib/auditLogger.js` | R-002 |
| Schedule org fallback to `organisation_id` | `src/lib/api/scheduledReports.js` | R-004 |
| Reference-id error envelope consistent with Flutter | `src/lib/safeError.js`, `src/components/ErrorBoundary.jsx` | R-012 |
| Call sites move to the resolver | `src/lib/accessResolver.js`, `src/contexts/AuthContext.jsx`, `src/components/Layout.jsx`, `src/components/ProtectedRoute.jsx` | R-050 |
| Remaining inline cost sites onto governed cost | `src/lib/governedCost.js` + consumers listed in `docs/tyre/CALCULATION_SOURCE_MAP.md` | R-053 |
| Lifetime CPK helpers | `src/lib/tyreLifetime.js`, `src/lib/kpiEngine.js` | R-054 |
| Fold serial check | `src/lib/tyreSerialCheck.js` | R-013 |
| Remove dead files (owner approval) | `src/components/BulkActionBar.jsx`, `src/components/permissions/Can.jsx`, `src/hooks/useCapabilities.js`, `src/hooks/useCapability.js`, `src/hooks/useRealtime.js`, `src/lib/apiClient.js` | R-057 |
| Remove or adopt react-query | `src/hooks/useSupabaseQuery.js`, `src/hooks/useBilling.js` | R-059 |
| Org hierarchy UI P3/P4 | `src/pages/OrgHierarchy.jsx`, `src/lib/orgUnits.js` | R-070 |
| Approval matrix editor and preview already exist; wire module decisions | `src/pages/ApprovalMatrix.jsx` (route `/approval-matrix`), `src/pages/Approvals.jsx` | R-072 |
| Company Admin tier, only if the owner reverses the super-admin-only rule (Admin Roles page was retired) | `src/console/ConsoleAuthContext.jsx`, `src/console/components/ConsoleLayout.jsx` | R-074 |
| Tenant branding editor in console | `src/console/pages/ConsoleReportAppearance.jsx` (extend) | R-080 |
| Three export modes | `src/lib/exportUtils.js`, report pages | R-090 |
| Ticket workflow | `src/lib/api/userIssues.js`, console Error Center | R-115 |
| Usage panel | console Tenant Health page | R-111 |

## 4. Flutter files (tyre_pulse_flutter/)

| Change | Area | R-id |
|---|---|---|
| Upload checklist photos and store storage refs, not local paths | `lib/core/sync`, checklist submission repository | R-063 |
| Offline workforce evidence via shared sync | `lib/features/workforce` | R-063 |
| Read Module Control status | `lib/core/permissions` | R-065 |
| Error reference id surfaced in error widgets | shared error mapper | R-012 |
| Turnstile or equivalent token on sign-in | `features/auth` | R-025 |
| Release hygiene: launcher icon, app label, `allowBackup=false`, Sentry DSN dart-define | Android manifest, `flutter-release-play.yml` | R-120 |
| iOS completion and parallel validation | iOS project, `flutter-release-ios.yml` | R-064 |

## 5. Configuration

| Change | Where | R-id |
|---|---|---|
| Compute tier step | Supabase dashboard | R-020 |
| `audit_retention_days` 365 to 90 (if approved) | `system_config` | R-021 |
| `app.bulk_import` guard usage in import paths (if approved) | import RPCs | R-021 |
| Restrict Android API key | Google Cloud Console | R-022 |
| 2FA enrolment; rename super-admin username | Console Security / profiles | R-023 |
| `VITE_TURNSTILE_SITE_KEY`, then CAPTCHA secret in Supabase Auth | Vercel + Supabase Auth | R-025 |
| `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | Vercel `tyre-pulse` env | R-026 |
| Vercel API token for rollback | `cron_config` or console secret store | R-027 |
| `ai_monthly_budget_usd` set explicitly per tenant | `system_config` | R-113 |
| `flutter_min_version` after the next release (live value NULL) | `system_config` | R-121 |
| `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` | Vercel `tyre-pulse-eezl` env | R-122 |
| Custom domain move for marketing, `NEXT_PUBLIC_APP_URL` | Vercel domains | R-122 |
| APNs .p8 in Firebase, `GOOGLE_SERVICE_INFO_PLIST` secret, App ID push capability | Apple, Firebase, GitHub secrets | R-119 |
| `FLUTTER_SENTRY_DSN` secret | GitHub secrets | R-120 |
| Second administrator on Supabase, Vercel, Play, Firebase, Sentry | vendor consoles | R-116 / risk P1 |
| Staging Supabase project or branch + staging Vercel environment | vendors | R-117 |
| `checklist_schedules` rows (owner-defined) | console / app | R-099 |

## 6. CI

| Change | File | R-id |
|---|---|---|
| `deno check` job for `supabase/functions/**` | `.github/workflows/ci.yml` | R-010 |
| Migration lint: fail on duplicate timestamp prefixes | `.github/workflows/ci.yml` | R-008 |
| Secret scanning gate | `.github/workflows/ci.yml` | R-010 |

## Appendix A - Already made, waiting for an apply, deploy or owner step

| # | Item | Verified 2026-11-10 | State | Action | R-id |
|---|---|---|---|---|---|
| A1 | `send-scheduled-reports` repo carries `DATASET_DIGEST.workshop_status` | Yes: repo has it, deployed v28 has "Workshop Summary" but no `workshop_status` | Repo ahead of deployed | Deploy + byte-diff | R-001 |
| A2 | `supabase/pending_migrations/20261011140000_workshop_status_stale_conflict.sql` | Yes, file present; README says never apply as-is | Not applied by design | Owner picks reconcile option | R-081 |
| A3 | Duplicate timestamps: `20261109160001_tyre_physical_lifetime_cpk.sql` + `20261109160000_workforce_operations_core.sql`; `20261109170001_tyre_price_provenance.sql` + `20261109170000_workforce_time_accounting.sql` | Yes (`ls`) | Applied live under other version numbers (for example `tyre_physical_lifetime_cpk` = 20261109090920) | Rename files to their live versions | R-008 |
| A4 | Repo file timestamps differ from live versions for the 20261110* tyre files (live versions 20261109102234 to 20261109102620) | Yes (live `schema_migrations`) | Applied | Align names so `db push` does not re-run them | R-008 |
| A5 | `MIGRATIONS_V316_WORKSPACE_ONBOARDING.sql` | File present; live migration `revoke_create_workspace_owner` exists | Kept OFF by decision | None (decision) | - |
| A6 | `MIGRATIONS_V420_REMOVAL_REASON_BRAND_CLEANUP.sql` | File present; live V420 name belongs to accident RPCs | Not applied | Renumber; apply only on owner yes | R-037 |
| A7 | `MIGRATIONS_V421_UNINDEXED_FK_INDEXES.sql` | Index on `assigned_owner_id` exists live | Effectively applied by other migrations | Confirm remaining columns, then retire file | R-009 |
| A8 | `MIGRATIONS_V422_FUTURE_REMOVAL_DATE_FIX.sql` | 0 tyre rows with future `removal_date` live | Obsolete | Retire file | R-009 |
| A9 | `MIGRATIONS_V579_AUDIT_LOG_V2_COUNTRY_ATTRIBUTION.sql` | Live migration `v579_audit_log_country_stamp` (forward stamping only) | Applied in reduced form; history back-fill refused | Mark file header accordingly | R-009 |
| A10 | `MIGRATIONS_V580_FORCE_RLS_ASSESSMENT.sql` | File present | Refused by measurement | None (decision) | - |
| A11 | `tyre_close_rotations` (dry run default) | Function referenced in `supabase/migrations/20261110113000_tyre_exceptions_v2_reviews.sql`, `src/lib/api/tyreExceptions.js` | 10 candidates not closed (per project memory) | Owner approval then run | R-035 |
| A12 | Migration rollback test for 20261109150000 not run (DROP hit approval) | Per project memory | Pending | Run in SQL editor | R-035 |
| A13 | `approval_matrix` engine (V477) | 0 rows live | Built, unconfigured | Configure first chain | R-072 |
| A14 | `org_units` (V206) | 0 rows live | Built, unconfigured | Seed hierarchy | R-070 |
| A15 | Billing plan-limit trigger (V313) | 0 `org_subscriptions` rows live | Inert by design | Billing go-live | R-110 |
| A16 | FX conversion (V380) | 0 approved rates live | Inert by design | Approve rates | R-032 |
| A17 | Accident email routing (V302-V305) | `accident_emails_enabled = 'true'` live | ON (project memory still said OFF) | Owner confirms recipients | R-095 |
| A18 | Repo migration files missing for V301-V305 bodies and V476/V477 | Per project memory | DB applied, repo incomplete | Back-fill from `pg_get_functiondef` | R-009 |
| A19 | Mobile Expo code after binary 1.6.0 | Per project memory | Merged, never built (by rule) | Owner decides build or retire | R-015 |
| A20 | Flutter release with FCM, push, access loader | Per project memory | Builds on Play closed track depend on owner runs | Promote after smoke test | R-121 |

Items checked and found CLOSED since project memory recorded them open: Data Intake Centre now calls
`checkImportFingerprint` (`src/pages/DataIntakeCenter.jsx`); the accident case PDF is wired in
`src/components/AccidentDetailModal.jsx`; `production_station_map` holds 27 plants; push tokens exist (116
profiles with a token, 153 active `user_devices` rows) so the "0 push tokens" note is stale.

## Open decisions for the owner

- A2 Workshop Status reconcile option; A6 removal-reason cleanup; A17 accident emails ON confirmation.
- Approval of the dead-code removal list in section 3 (R-057).
- Which first approval chain to configure (A13) and which country seeds the hierarchy (A14).

## Next actions

- Phase 1, S: A1 deploy, A3/A4 rename migration files, A7/A8 retire obsolete files.
- Phase 1, M: back-fill missing migration files (A9, A18).
- Phase 3, L: A13/A14 configuration with the owner, one country first.
