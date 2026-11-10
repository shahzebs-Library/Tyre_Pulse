# 09 - Admin Console Structure

| Field | Value |
|---|---|
| Deliverable | 9 of 29 |
| Date | 2026-11-10 |
| Status | Built for the Platform Super Admin. The System Console (`/console`) is a separate, super-admin-only surface with its own sign-in, tab-local session, idle and absolute timeouts, and five areas. Not built: a Company Admin console (tenant admins have no console; all administration is platform-owner only), and several spec master-data areas (defect codes, numbering sequences, units) as managed lists. |
| Evidence | Code read: `src/console/components/ConsoleLayout.jsx` (CONSOLE_NAV), `src/App.jsx` console routes and redirects, `src/console/ConsoleAuthContext.jsx`, `src/console/ConsoleAuthBridge.jsx`, `src/lib/supabase.js`, `src/lib/api/systemConfig.js` (ENFORCEMENT_STATUS), `src/lib/platformMap.js`. Live: `system_config` values and cron jobs read 2026-11-10. History from PROJECT_MEMORY.md. |
| Related docs | [07 Access](07-master-access-control.md), [08 Approvals](08-country-site-approval-matrix.md), [17 Security](17-security-audit.md), `docs/` console notes |

## 1. Who can enter and how

| Control | Implementation |
|---|---|
| Gate | `ConsoleGuard` + `resolveAdmin` in `src/console/ConsoleAuthContext.jsx`: only `profiles.is_super_admin = true`, approved, unlocked. Live: 2 super admins, both with verified MFA. |
| Separate surface | `src/lib/supabase.js`: a tab that boots on `/console` stores its session in `sessionStorage` under `tp_console_auth`; the main app uses `localStorage` `tp_auth`. Sessions never cross tabs; the console session dies on tab close. |
| No entry from the main app | Owner rule (2026-08-05): the main app surfaces NO console link or button. `ConsoleSurfaceGate` (App.jsx) refuses `/console` in a tab that booted on the main app. Pinned by `consoleSurfaceGuard.test.js`. |
| MFA | `hasUnmetMfa()` (`src/lib/authAssurance.js`): an AAL1 session with an enrolled factor is not admitted. |
| Timeouts | 10 minutes idle, 8 hours absolute, console surface only. |
| IP allowlist | `console_ip_allowlist` + `_console_ip_allowed()` guard in 81 console writer/reader RPCs. Flag `console_ip_allowlist_enabled` = false live; 0 entries. Fails open on error. |
| Break-glass alerts | Triggers on `console_sessions` notify every super admin on console login and on risky actions; `access_audit` entity super_admin raises a critical log (V-20260924091000). |
| Audit | `console_sessions` written only by `log_console_event` (server stamped, V275); client INSERT blocked. |
| Main-app pages reused inside | `ConsoleAuthBridge.jsx` provides the main-app auth context so pages such as PermissionMatrix, SecurityCenter and UserManagement render verbatim inside the console. |

## 2. The five areas (sidebar, `CONSOLE_NAV`)

### Monitor

| Page | Route | Controls |
|---|---|---|
| Overview | `/console` | Waiting-on-you panel (pending approvals, unresolved errors, trust alerts, locked accounts, stale feeds); "could not check" instead of silent zero |
| System Health | `/console/health` | 0 to 100 health score, `system_logs` error log with resolve |
| Platform Map | `/console/platform-map` | Plain-English map of every console page, web area, mobile module and a NOT_BUILT list with who can move each item. Test fails if a console page has no description. |
| Analytics | `/console/analytics` | Usage, AI usage (tab `ai`), Metric catalogue (tab `metrics`) |
| Alert Center | `/console/alerts` | Alert rules (no-code over `alert_thresholds`), incidents (`platform_incidents`), self-healing scans, trust alerts |

### Platform

| Page | Route | Controls |
|---|---|---|
| Users | `/console/users` | Approve, lock, role, country, sites (`admin_set_user_sites`), bulk role, password requests, support sessions tab, account deletions tab, user detail |
| Organizations | `/console/organisations` | Overview, edit and lock (lock recorded, NOT enforced on members: owner decision open), tenant export |
| Billing | `/console/billing` | Plans and subscriptions (billing not live; paid plans only via Stripe webhook) |
| Operations | `/console/operations` | Data ops hub, cleanup (snapshot first, typed confirm), duplicates, import history, material master, classifier learning, data learning, smart import |

### Trust

| Page | Route | Controls |
|---|---|---|
| Access Control | `/console/access` | 19 tabs, see doc 07 |
| Access Reviews | `/console/access-reviews` | Review campaigns (0 live) |
| JIT Elevation | `/console/jit-elevation` | Time-boxed capability grants |
| Access Policies | `/console/access-policies` | IP allowlist, per-org SSO required |
| Approvals | `/console/approvals` | Dual-control queue |
| Security Audit | `/console/security-audit` | 14 live catalog checks, weekly cron `security-audit-weekly` (last run 2026-11-08, score 89, 1 high: anon definer functions) |
| Sign-in and SSO | `/console/security` | SSO connections, sign-in toggles |
| Compliance | `/console/compliance` | 20 SOC2/ISO controls from live evidence + expiring attestations |
| Audit Trail | `/console/audit-trail` | Unified view of `audit_log_v2`, `access_audit`, `console_sessions`; IP/device/severity tabs |
| Audit Integrity | `/console/audit-integrity` | Hash-chained daily seals (`audit-seal-daily` cron) |

### Runtime

| Page | Route | Controls |
|---|---|---|
| Notifications | `/console/notifications` | Announcements, delivery and push receipts |
| API Monitor | `/console/api-keys` | Canonical `api_keys` (create/revoke, break-glass revoke) |
| Database Center | `/console/database` | Sections incl. backups, read-only safelisted data browser (`admin_db_*`), trust: control center, quality, reconciliation, correction cases, lineage |
| Storage | `/console/storage` | Buckets, usage, retention rules (stored, not auto-run) |
| Error Center | `/console/crash-reports` | Sentry issue stream via `sentry-issues` edge fn (token server-side), fatal-crash alert cron |

### Engineering

| Page | Route | Controls |
|---|---|---|
| Developer | `/console/developer` | Pipeline monitor, integration events, Flutter app control (`flutter_min_version`, `flutter_latest_version`) |
| Releases | `/console/releases` | `releases` + `release_impacts` |
| Feature Flags | `/console/flags` | Flags, scheduled flag changes, Module Control (Live / Maintenance / Off, enforced by `ModuleRoute`, fails open) |
| System Settings | `/console/config` | `system_config` switches, report colours, navigation editor, vehicle designer (tab `vehicle`) |

Route-only (no nav item): `sessions` (Sessions and Devices), `automation`, `mobile-app`, `navigation`,
`appearance`, `system`, `backups`, `ai-admin`, `admin-roles`. 28 legacy console paths redirect to their new tab
(`ConsoleTabRedirect` / `LegacyRedirect` in App.jsx) so old links keep working.

## 3. system_config: what is enforced (ENFORCEMENT_STATUS)

`src/lib/api/systemConfig.js` is the single reader; `ENFORCEMENT_STATUS` drives the badge shown next to every
switch.

| Key | Status | Where enforced |
|---|---|---|
| maintenance_mode | active | `MaintenanceGate` (web) |
| registration_open | active (live: true) | Web + mobile signup via `get_public_config` |
| require_approval | active (live: true) | `handle_new_user` + ProtectedRoute |
| max_upload_rows / export_enabled / max_export_rows | active | Data Intake guard, `exportUtils` |
| session_timeout_hours | active | Web idle sign-out |
| two_factor_required | active | Admin 2FA enrolment gate |
| backup_enabled | active | `cron_run_backup` (nightly, last success 2026-11-10) |
| ai_enabled / ai_monthly_budget_usd / ai_rate_limit_per_min / ai_cache_ttl_hours | active | `chat-ai`, `ai-orchestrator` edge fns |
| password_min_length, email_notifications, push_notifications | active | signup/reset, `send-email`, `workflow-notify` |
| max_login_attempts | active (live: 5) | Lockout V287 |
| audit_retention_days | active | Logs-only purge V288, `audit-log-retention` cron |
| new_features_admin_only, auth_google/microsoft_enabled, qr_login_enabled, new_shell | active | resolver / login pages / shell picker |
| ai_model | saved | Model locked server-side by design |
| alert_email | saved | Sentry uses its own email |
| digest_frequency | saved | Schedules own cadence |
| data_retention_months | saved (deliberate) | Business records are never auto-deleted (data safety decision) |

## 4. Spec section 7 coverage

| Spec block | Present in console | Missing |
|---|---|---|
| Organization | Organizations, sites (main app `/sites`) | Countries, regions, branches, projects, workshops, departments, teams, cost centres as managed lists; org hierarchy page is orphaned (doc 06) |
| Identity and Access | Users, roles, matrix, sessions, devices, MFA, delegations | Organization Directory, location assignments UI |
| Workflow | Dual control, approvals queue | Approval policy editor lives in the main app (`/approval-matrix`); escalation rules, SLA configuration, workflow templates (`/workflow-settings` in main app) |
| Master data | Material master, vehicle designer | Vehicle/equipment types, tyre sizes/brands/patterns, defect codes, failure reasons, units, statuses, numbering sequences as governed lists |
| Platform | Themes (report colours), flags, notifications, API keys, AI admin, security, audit, health, retention, backups | Webhooks UI, languages, white-label per tenant |

## 5. Structural issue: there is no tenant (Company Admin) console

Every administrative function is super-admin only (owner direction 2026-09-24: "all administration stays
under the super-admin console, no company-admin tier"). For a multi-tenant SaaS this means the platform
owner administers every customer. Before onboarding a second paying company the product needs a Company
Admin surface scoped to `app_current_org()` for users, roles, sites and approvals, while platform-only
pages (organizations, billing, flags, database, releases, security audit) stay super-admin.

## 6. Recommended target structure

| Area | Audience | Content |
|---|---|---|
| Platform (existing `/console`) | Platform Super Admin | Tenants, billing, flags, releases, database, platform security, Sentry |
| Company Admin (new, inside the app, `/admin/*`, org-scoped RLS) | Company Admin | Users, directory, roles and matrix for own org, locations, approval policies, delegations, notifications, master data |
| Shared kit | both | `src/console/pages/shared/pageKit.jsx`, `consoleTable.js` |

## Open decisions for the owner

- Introduce a Company Admin tier before a second tenant is onboarded?
- Enforce organisation lock on members (currently recorded only)?
- Turn on the console IP allowlist (needs at least one office IP entry first)?
- Move the approval policy editor and workflow builder into the console?

## Next actions

1. Phase 2, S: add nav items or Platform Map entries for route-only pages (sessions, automation, mobile-app).
2. Phase 2, S: re-mount Organization Hierarchy and Holding Company inside Organizations.
3. Phase 3, XL: Company Admin console with org-scoped admin RPCs and tests that a company admin cannot
   reach any platform function.
4. Phase 3, M: governed master-data lists (defect codes, failure reasons, units, numbering sequences).
5. Phase 3, S: enforce organisation lock in `app_is_active()`.
