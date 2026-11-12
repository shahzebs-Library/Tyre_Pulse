# 26 - Priority Roadmap

- Deliverable 26 of 29
- Date: 2026-11-10
- Status: Not built as a single plan before this document. Most platform modules are Built; this roadmap lists only
  what is still OPEN against spec sections 1 to 21 of `Tyre pulse enterprise.md`.
- Evidence: open items mined from `PROJECT_MEMORY.md` (grep for OPEN / STILL OPEN / NOT DONE / owner decision /
  NOT APPLIED / NOT DEPLOYED). The following were re-checked LIVE on 2026-11-10 with read-only SQL against project
  `jhssdmeruxtrlqnwfksc` and the edge-function list: `approval_matrix` 0 rows, `org_units` 0 rows,
  `org_subscriptions` 0 rows, `api_keys` 0 rows, `checklist_schedules` 0 rows, approved `currency_rates` 0 rows,
  vehicle insurance expiry blank on 1,622 of 1,622 fleet rows, `audit_log_v2` 654 MB vs `shared_buffers` 32768
  blocks (256 MB), `system_config.accident_emails_enabled = 'true'`, deployed `send-scheduled-reports` v28 does NOT
  contain the `workshop_status` digest that the repo carries. Everything else is "per project memory".
- Related docs: 27-cost-and-complexity-estimate.md, 28-risks-and-dependencies.md, 29-change-register.md,
  `docs/PRODUCT_GAP_REGISTER.md` (older, partly stale), `docs/SECURITY_RISK_REGISTER.md` (older),
  `docs/flutter-migration/09-migration-matrix.md`, `docs/tyre/BUSINESS_RULES.md`, `docs/tyre/CALCULATION_SOURCE_MAP.md`.

## How to read this roadmap

| Field | Meaning |
|---|---|
| Id | R-NNN. The same id is used in documents 27, 28 and 29. |
| Spec | Section of the master spec (1 to 21, EH = Enterprise Error Handling). |
| Phase | Spec phase 1 (audit, secure) to 5 (AI, billing, monitoring, commercial). |
| Priority | P0 = data loss / security / blocks customers now. P1 = needed for enterprise sale. P2 = important. P3 = nice to have. |
| Effort | S (up to 2 days), M (3 to 7), L (8 to 20), XL (more than 20 engineer-days). See doc 27. |
| Owner | ENG = engineering can do it now. OWN = needs an owner decision. CUS = needs customer data or files. OPS = account / console setting only the owner can change. |
| Dep | Roadmap ids that must happen first. |

Rule carried from the spec: do not change everything at once. Phase 1 and the P0 rows come first.

## Standing decisions (recorded, NOT on the roadmap)

These are deliberate and must not be "fixed" by a later engineer without a new owner instruction.

| Decision | Source | Reason |
|---|---|---|
| Open self-serve workspace signup (`create_workspace_owner`, V316) stays OFF | memory 2026-07-20; live migration `revoke_create_workspace_owner` | Invite-only onboarding, matches spec 14 |
| `data_retention_months` stays saved-only; business data is never auto-deleted | memory 2026-07-19 (V288) | Data safety; logs-only purge is automatic |
| `is_admin_or_above()` lower-case bug left in place | memory 2026-08-16 (V551-V553) | Repairing it opens `accident_audit_log` cross-tenant |
| `audit_log_v2` history is not back-filled with country | memory 2026-11-08 | Table is immutable (`prevent_audit_mutation`), ISO wants it untouched; trigger stamps going forward |
| Expo store builds retired, Flutter is the only mobile build target | memory 2026-09-27 | Owner instruction |
| No mobile build without an owner request | memory 2026-08-19 | Owner instruction |
| `FORCE ROW LEVEL SECURITY` not applied | V580 | No-op here (owner role has BYPASSRLS), would mislead |
| Production logs with no DN number stay | memory 2026-08-11 | Owner ruling; already excluded from cost/m3 by approval rule |
| `gun` not added to the oil-part veto | V400 | Genuinely ambiguous in this business |
| Maps and cost work on the 16 empty-table pages deferred | memory 2026-10-05 | No maps key; owner ruling |
| All administration stays under the super-admin `/console`; no company-admin tier for now | memory 2026-09-24 | Owner instruction; conflicts with spec 7/14, so R-074 asks for a new decision |

## Phase 1 - Audit, map, document, secure

### Engineering can do now

| Id | Title | Spec | Pri | Effort | Dep |
|---|---|---|---|---|---|
| R-001 | Deploy the repo `send-scheduled-reports` (workshop_status digest, claims digest paging) and byte-diff deployed vs repo | 10, 20 | P1 | S | - |
| R-002 | Move the client `audit_log_v2` INSERT (src/lib/auditLogger.js login rows) behind a DEFINER RPC, then revoke INSERT | 14 | P1 | M | - |
| R-003 | Recipient allowlist + per-user rate limit on `send-email` edge function (insider relay risk) | 14, 11 | P1 | M | - |
| R-004 | Scheduled reports: never treat a null `org_id` schedule as global; `createSchedule` falls back to `organisation_id` | 14, 10 | P1 | S | - |
| R-005 | `get_report_snapshot` honours the share token `pages` list server side (KPI-only links still return job cards and cost) | 14, 10 | P1 | M | - |
| R-006 | Org check on the vehicle-photo storage UPDATE policy | 14 | P1 | S | - |
| R-007 | Site isolation policy on `parts_consumption` (only definer paths are site-guarded) | 14 | P2 | M | R-030 |
| R-008 | Fix duplicate migration timestamps in `supabase/migrations` (two files each at 20261109160000 and 20261109170000) | 20 | P1 | S | - |
| R-009 | Back-fill repo files for migrations applied live with no file (V301-V305 bodies, 20260929203627..215747, V476/V477) | 20 | P2 | M | - |
| R-010 | CI: `deno check` job for the 19 edge functions; secret and dependency scanning gates | 20 | P2 | S | - |
| R-011 | Login enumeration residue: `record_login_failure` reveals `remaining` only for real accounts | 14 | P2 | S | - |
| R-012 | Error handling: one reference-id contract across web, Flutter and edge functions; correlation id on every request | EH | P1 | M | - |
| R-013 | Fold `tyreSerialCheck.js` onto `isStrongSerial` (mirror of SQL `tyre_serial_is_strong`) | 8 | P3 | S | - |
| R-014 | Re-measure realtime WAL decoder under daytime load (V582 result was one evening window) | 17 | P3 | S | - |
| R-015 | Retire or upgrade the Expo `mobile/` dependency chain (14 prod advisories; workflows already retired) | 20 | P2 | S | OWN |

### Blocked on owner or customer

| Id | Title | Spec | Pri | Effort | Owner |
|---|---|---|---|---|---|
| R-020 | Supabase compute tier: `audit_log_v2` 654 MB is 2.5x the 256 MB cache; I/O bound by design | 17 | P1 | S | OPS |
| R-021 | Stop auditing bulk imports (94.5% of audit rows) or shorten `audit_retention_days` 365 to 90 | 18, 19 | P1 | S | OWN |
| R-022 | Restrict the Firebase Android API key (package + SHA-1) in Google Cloud Console | 14 | P1 | S | OPS |
| R-023 | Super-admin hygiene: enrol 2FA, rename guessable username `shahzeb` | 14 | P0 | S | OPS |
| R-024 | `_user_issue_admin()` admits plain org Admins to the Error Center - keep or restrict | 14 | P2 | S | OWN |
| R-025 | Turnstile CAPTCHA: create site key, set Vercel env, then Supabase Auth; ONLY after Flutter sends a token | 14 | P2 | M | OPS + R-071 |
| R-026 | `VITE_POSTHOG_KEY` / host in Vercel (0 events received) | 17 | P2 | S | OPS |
| R-027 | Vercel token for in-console rollback | 20 | P3 | S | OPS |

### Data integrity (customer data)

| Id | Title | Spec | Pri | Effort | Owner |
|---|---|---|---|---|---|
| R-030 | KSA job-card dates: 574 day/month-swap rows held back, ~11,000 rows years 0022-0024 left as is | 8, 18 | P1 | S | CUS (re-upload) |
| R-031 | Vehicle document expiry file (insurance, MVPI, operating card) - blank on 1,622/1,622 (verified) | 8, 11 | P1 | S | CUS |
| R-032 | FX rates: enter and approve AED to SAR and EGP to SAR (0 approved, verified) | 16, 18 | P1 | S | OWN |
| R-033 | UAE/Egypt expense files lack the `#` line number (UAE 51,546 / Egypt 38,451 rows unkeyed) | 9, 18 | P1 | S | CUS |
| R-034 | Tyre evidence audit proposals P1-P6 (2026-11-09) incl. 1 legacy active tyre to close | 8 | P1 | M | OWN |
| R-035 | Run `tyre_close_rotations` for real (10 candidates) and re-run the migration rollback test | 8 | P2 | S | OWN |
| R-036 | 58 tyre groups whose copies disagree on mileage; 6 KSA + 14 UAE ambiguous old/new pairs | 8 | P2 | S | OWN |
| R-037 | `removal_reason` still holds a brand on ~858 UAE rows (excluded from reports by V614) - clear or keep | 18 | P3 | S | OWN |
| R-038 | Missing SANY Apr-Jul 2026 generator proforma PDF (row is gross x 3.75, likely overstated) | 8 | P2 | S | CUS |
| R-039 | Insurance: CPM bordereau schedule (SAR 135.5M) not in file; chassis/plate on only ~38% of KSA fleet | 8, 18 | P2 | M | CUS |
| R-040 | Placeholder fitment km (MP class meter files), 691 UAE active tyres with no position, 98 TR-MIXER with no odometer | 8 | P2 | M | CUS |
| R-041 | KSA 2026 tyre amount ~75k gap vs customer chart; blank vehicle_type on ~497 fleet rows | 8, 18 | P3 | S | CUS |
| R-042 | Contested cross-country asset codes (56) and a country-qualified asset key | 18 | P2 | L | ENG + OWN |

## Phase 2 - Consolidate modules, permissions, shared logic

| Id | Title | Spec | Pri | Effort | Owner | Dep |
|---|---|---|---|---|---|---|
| R-050 | One permission engine: rewire call sites onto `src/lib/accessResolver.js`; adopt `module.resource.action` keys | 5 | P1 | XL | ENG | R-051 |
| R-051 | Server enforcement of create/edit/delete/approve beyond the 11 pilot tables (V238/V241) | 5, 14 | P1 | L | ENG | - |
| R-052 | Sub-module and export capabilities are stored, not enforced server side | 5 | P2 | M | ENG | R-050 |
| R-053 | Governed cost: migrate the ~121 "needs a decision" inline cost sites onto `src/lib/governedCost.js` | 8 | P1 | L | ENG | R-032 |
| R-054 | Lifetime CPK end to end in server RPCs and ~40 web helpers (still per fitment row) | 8 | P1 | L | ENG | R-034 |
| R-055 | One definition each of "scrapped" (4 today) and "work order done" (Closed vs Completed) | 1, 8 | P2 | M | ENG | - |
| R-056 | Accident lifecycle: retire dead `closure_status`, keep `workflow_stage` single source | 1, 8 | P2 | M | ENG | - |
| R-057 | Duplicate-file removal + dead code (BulkActionBar, Can.jsx, useCapability, useRealtime, apiClient) | 1 | P3 | S | OWN | - |
| R-058 | `org_id` vs `organisation_id` single column (profiles, billing, module_permissions) | 3, 14 | P2 | L | ENG | - |
| R-059 | Remove or adopt the dead react-query layer (only 2 files call `useQuery`) | 17 | P3 | M | ENG | - |
| R-060 | Asset master merge: FleetMaster + AssetManagement one surface | 1, 18 | P2 | L | ENG | R-042 |
| R-061 | Claims / incidents / RCA / KPI cluster review; keep `/claims-summary` vs `/insurance-claims` split documented | 1 | P3 | M | ENG | - |
| R-062 | Arabic RTL device QA (43-screen checklist blank); Urdu web locale missing | 15, 21 | P1 | M | ENG | - |
| R-063 | Flutter parity residue: offline workforce evidence; checklist photos stored as local paths | 1, 9 | P1 | M | ENG | - |
| R-064 | Flutter cutover phase 11 (iOS completion) and phase 12 (parallel validation) | 20 | P1 | L | ENG + OWN | R-071 |
| R-065 | Flutter reads Module Control status (web only today) | 7 | P2 | S | ENG | - |

## Phase 3 - Admin Console, hierarchy, approval engine, governance

| Id | Title | Spec | Pri | Effort | Owner | Dep |
|---|---|---|---|---|---|---|
| R-070 | Organization hierarchy P3-P4: populate `org_units` (0 rows), opt-in location-scoped RLS | 3 | P1 | XL | ENG + OWN | R-058 |
| R-071 | Organization Directory: one employee master (`workforce_employees` + `profiles`) feeding contacts for notifications | 4, 11 | P1 | L | ENG | R-070 |
| R-072 | Approval engine live: configure `approval_matrix` (0 rows), route inspections, checklists, accidents, work orders through `resolve_approvers` | 6 | P0 | XL | ENG + OWN | R-070 |
| R-073 | Delegation, acting manager, approval limits, expired-delegation tests | 6, 21 | P1 | L | ENG | R-072 |
| R-074 | Platform Owner vs Company Admin split (spec 7/14). Owner ruled 2026-09-24 that all administration stays super-admin only; the Admin Roles page was retired. Needs a new owner decision before any build | 7, 14 | P1 | L | OWN | - |
| R-075 | Org suspend enforcement | 16 | P1 | M | OWN | - |
| R-076 | `support_sessions` retarget reads into the inspected org (records only today) | 14, 17 | P2 | L | ENG | - |
| R-077 | Master-data governance: approval before change, effective dates, version history, data steward role | 18 | P1 | L | ENG | R-072 |
| R-078 | Storage retention rules exist but never run; announcements table read by no client | 18, 11 | P3 | S | OWN | - |
| R-079 | Saved-only config keys: password_min_length, app_version, email_notifications, push_notifications, digest_frequency | 7 | P2 | M | ENG | - |
| R-080 | Theme and branding manager: tenant branding editor reachable from the console; font/density/radius settings | 15 | P2 | M | ENG | - |
| R-081 | Workshop Status: stale-conflict migration RECONCILED 2026-11-12 (draft retired; live guard holds the rule). Remaining: loops 19-20 (ops hygiene, final review) | 3 | P2 | S | OWN | - |

## Phase 4 - Reports, executive, Data Intake, notifications, integrations

| Id | Title | Spec | Pri | Effort | Owner | Dep |
|---|---|---|---|---|---|---|
| R-090 | Three export modes (Current view / Full filtered / Executive) on every report surface from one engine | 10 | P1 | L | ENG | R-053 |
| R-091 | Public share links: render Executive and Accident builder layouts from the snapshot | 10 | P2 | M | ENG | R-005 |
| R-092 | Executive and claims email digests honour the schedule period | 10 | P2 | S | ENG | R-001 |
| R-093 | Server COPY pipeline for million-row ERP loads (browser path tops out ~100k rows) | 9 | P1 | L | ENG | - |
| R-094 | Notification engine: honour `notification_preferences` on every channel; WhatsApp channel; Expo receipt polling | 11 | P1 | L | ENG | R-071 |
| R-095 | Accident email routing went live (`accident_emails_enabled = true`, verified) - confirm recipients, Resend sender, bounce handling | 11 | P1 | S | OWN | - |
| R-096 | Alert rules approaching-threshold to anomaly feed (no second alert table) | 11, 17 | P2 | M | ENG | - |
| R-097 | Integration platform: OpenAPI spec, versioned paths, webhooks, IP restrictions, key rotation UI (`api_keys` 0 rows) | 13 | P1 | XL | ENG | R-050 |
| R-098 | ERP / BI connectors (SAP, Oracle, Dynamics, Power BI), GPS/TPMS providers | 13 | P2 | XL | ENG + CUS | R-097 |
| R-099 | Checklist schedules configured (0 rows) so "due" lists fill; chiller log and compressor hours linked to PM | 6, 8 | P2 | M | OWN | - |
| R-100 | Washing: schedule, correction workflow, downloadable log (owner questions partly answered) | 8 | P3 | M | ENG | - |
| R-101 | Workforce: stock readiness in recommendation ranking; device testing | 6 | P3 | M | ENG | - |

## Phase 5 - AI, automation, billing, monitoring, support, commercial

| Id | Title | Spec | Pri | Effort | Owner | Dep |
|---|---|---|---|---|---|---|
| R-110 | Billing go-live: `org_subscriptions` 0 rows, plan-limit trigger inert by design, Stripe live keys | 16 | P1 | L | OWN | R-075 |
| R-111 | Per-tenant usage metering (storage, API, AI, automation) shown in console | 16 | P2 | M | ENG | R-110 |
| R-112 | Automation runtime decision: n8n vs pg_cron + edge workers (webhooks.js exists, no n8n deployed) | 12 | P2 | L | OWN | - |
| R-113 | AI accuracy gate thresholds confirmed; per-finding correction source; real-photo adjudication; worker budget overshoot | 12 | P2 | M | OWN | - |
| R-114 | Monitoring: OpenTelemetry, uptime checks, public status page, queue and worker dashboards | 17 | P1 | L | ENG | - |
| R-115 | Help and support: tickets with SLA/assignment/screenshots over `user_issues` (0 rows), knowledge base, release notes | 17 | P2 | L | ENG | - |
| R-116 | DR: written RTO/RPO, PITR tier, tenant-level restore test, legal hold, data residency statement | 19 | P1 | M | OWN + ENG | R-020 |
| R-117 | Staging environment (no staging DB or workflow in `.github/workflows`) + release approval | 20 | P1 | L | OWN + ENG | - |
| R-118 | Test programme: 18 spec roles, cross-tenant attacks, report-vs-screen comparison, performance, migration tests | 21 | P1 | XL | ENG | R-117 |
| R-119 | iOS push: App ID push capability, APNs .p8 to Firebase, `GOOGLE_SERVICE_INFO_PLIST` secret | 11, 20 | P2 | S | OPS | - |
| R-120 | Flutter release hygiene: Sentry DSN secret, launcher icon, app label, `allowBackup` off | 17, 20 | P1 | S | ENG + OPS | - |
| R-121 | Play Closed to Production promotion; set `flutter_min_version` (live value NULL) after release | 20 | P1 | S | OPS | R-120 |
| R-122 | Marketing site custom domain move and contact-form Resend env vars | 16 | P2 | S | OPS | - |
| R-123 | Mobile waves 25-26: voice, OCR, live map (needs maps key), company switch | 1 | P3 | XL | OWN | - |

## Summary counts

| Phase | Items | P0 | ENG now | Blocked on owner/customer |
|---|---|---|---|---|
| 1 | 36 | 1 | 15 | 21 |
| 2 | 16 | 0 | 14 | 2 |
| 3 | 12 | 1 | 6 | 6 |
| 4 | 12 | 0 | 9 | 3 |
| 5 | 14 | 0 | 6 | 8 |

Counts are by primary owner; several items need both.

## Recommended sequence

1. Week 1: R-023, R-001, R-004, R-006, R-008, R-022 (all S, high value, low risk).
2. Weeks 2 to 4: R-002, R-003, R-005, R-012, R-020/R-021 decision, R-030 to R-033 customer requests sent.
3. Next block: R-072 approval engine with R-070 hierarchy pilot on one country, then R-050/R-051.
4. Then R-053/R-054 (calculation truth), R-090 (export modes), R-117 staging before R-110 billing.

## Open decisions for the owner

- R-020 compute tier and R-021 bulk-import auditing (both affect the audit contract and cost).
- R-074 whether to introduce a Company Admin tier (reverses the 2026-09-24 super-admin-only rule).
- R-024 Error Center access for plain Admins; R-075 org suspend; R-110 billing go-live date.
- R-034 / R-035 / R-036 / R-037 tyre data proposals; R-081 Workshop Status reconcile option.
- R-112 automation runtime (n8n or not); R-117 staging environment budget.
- R-095 accident emails are now ON in production: confirm that was intended.

## Next actions

- Phase 1, S: ship R-001, R-004, R-006, R-008 in one batch (one merge, one production build).
- Phase 1, M: R-002 and R-003 security items.
- Phase 3, XL: scope R-072 with one real chain (Qiddiya G2 example from spec 6) before building generic UI.
