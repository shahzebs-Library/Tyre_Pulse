# Supabase RLS and tenant isolation audit - 2026-11-12

Project `jhssdmeruxtrlqnwfksc`. Read-only audit; every write test ran in a rolled-back transaction.
Status words are defined in [SECURITY_AUDIT.md](SECURITY_AUDIT.md).

## Method

- Impersonation: JWT claims set per statement plus `set local role authenticated`, one identity per statement.
- Read sweep: row count of every public table `authenticated` can select (484 tables), per identity, compared
  with a privileged baseline.
- Write tests: rows actually written were counted (`get diagnostics`, `UPDATE ... RETURNING`, or a privileged
  recount after `reset role`). A blocked write under RLS returns 0 rows silently, so "no error" was never
  taken as a pass.
- PROVEN = observed by impersonation. CATALOG = read from `pg_catalog` only.

Identities (referred to by tag only):

| Tag | Role, organisation, scope |
|---|---|
| DEMO-MGR | Manager, demo organisation, KSA |
| KSA-MGR | Manager, Company A, KSA, all sites |
| KSA-DRV | Driver, Company A, KSA, all sites |
| KSA-DRV-NOSITE | Driver, Company A, KSA, no site list (12 such accounts) |
| KSA-TYREMAN | Tyre Man, Company A, KSA |
| KSA-FLEETSUP | Fleet Supervisor, Company A, KSA |
| EG-TDC | Tyre Data Collector, Company A, Egypt |

Population: 5 organisations; Company A 768 profiles, demo organisation 1, three others empty.

## Findings

### RLS-1 (P1) Self-widening of site scope - FIXED
- Evidence (PROVEN, KSA-DRV-NOSITE): `update profiles set sites = {ALL}` on own row wrote 1 row; tyre_records
  2,249 -> 8,353, vehicle_fleet 1 -> 1,031, work_orders 1 -> 69,440. `countries`, `web_access`,
  `module_overrides`, `employee_id` also writable. The guard trigger covered only the legacy scalar `site`.
- Fix: `20261112141000_profile_guard_access_columns.sql`. The guard now also protects sites, countries,
  web_access, module_overrides, employee_id, email, and username when it equals another person's employee id.
- Verified (rolled back): Driver self-update of each column -> 42501, tyre_records stays 2,249; full_name,
  language, push_token, avatar_url, phone still editable; super admin and admin RPC paths still work.

### RLS-2 (P1) `tyre_replacement_undo` crossed countries - FIXED
- Evidence (PROVEN, KSA-MGR): the call restored 28 rows of a batch that was 18 UAE + 10 Egypt (privileged
  recount). `list_tyre_replacement_batches` listed that batch.
- Fix: `20261112142000_tyre_replacement_undo_scope.sql`. A batch with any row outside the caller's country or
  site scope is refused whole (42501) and not listed.
- Verified: KSA-MGR -> 42501, recount 0; KSA control batch still restores; super admin sees both.
- NOT VERIFIED: `tyre_learn_undo`, `promote_erp_undo`, `resolve_tyre_import_review` with a real foreign batch id.

### RLS-3 (P0) Cross-tenant read of `ksa_asset_master_upload` - FIXED
- Evidence (PROVEN, DEMO-MGR): 1,236 rows readable (plates 782, chassis 778, engine 1,026). No org column;
  role-only policy.
- Fix: `20261112140000_tenant_walls_null_org_rows.sql`. Column `organisation_id` added, all rows stamped
  Company A, RESTRICTIVE org isolation.
- Verified: DEMO-MGR 1,236 -> 0; KSA-MGR still 1,236.
- Same class, 0 rows readable by DEMO-MGR at audit time, not changed: `ksa_kms`, `uae_kms`,
  `*_country_upload_template_staging`, `_plan_load_staging` (role-only gates, no org column). OPEN, re-check if
  a gate is widened.

### RLS-4 (P0 for `report_send_log`, P2 for the rest) Null-organisation rows shared - FIXED
- Evidence (PROVEN, DEMO-MGR): report_send_log 192 rows with recipients populated; system_logs 273;
  domain_events 51 null-org; workflow_definitions 25.
- Fix: `20261112140000`. 164 report_send_log rows stamped from their schedule; 28 orphans, platform
  system_logs rows and null-org domain_events are super-admin only; workflow_definitions stamped Company A.
- Verified: DEMO-MGR report_send_log 0, system_logs 0, domain_events 30 (own), workflow_definitions 0.
- Stated side effect: Company A users no longer read the 28 orphan log rows, 273 platform log rows and 51
  null-org events.

### RLS-5 (P1) Cross-tenant writes to shared rows - FIXED
- Evidence (PROVEN, DEMO-MGR, rolled back): workflow_definitions 25 rows updated, kpi_targets 7,
  column_mappings 16, null-org system_logs insert 1.
- Fix: `20261112140000`. Org column + RESTRICTIVE isolation on kpi_targets and column_mappings; system_logs
  insert must carry the caller's own organisation.
- Verified: all four statements write 0 rows or raise 42501 as DEMO-MGR.
- Stated side effect: the unique keys on kpi_targets and column_mappings are still global.

### RLS-6 (P1) Handover sign-off forgery - FIXED
- Evidence (PROVEN, Driver): inserted a row already `approved` with another user's sign-off ids; edited an
  approved row.
- Fix: `20261112143000_handover_signoff_forgery_guard.sql` (insert guard, sign-off columns only through
  `decide_handover_approval`, approved rows frozen) and `20261112155000` (content frozen once the supervisor
  has signed).
- Verified: forged insert -> 42501; direct status change -> 42501; field edit of a pending row still works;
  supervisor and incharge RPC path works; edit at `pending_incharge` -> 42501.
- Note: `handover_reports` held 0 rows at apply time.

### RLS-7 (P2) Site isolation missing on site tables - FIXED / OPEN
- Evidence (PROVEN, KSA-DRV-NOSITE): sited rows readable on odometer_logs 2,033, engine_hours_logs 1,216,
  inspection_schedules 245, action_items 161, checklist_submissions 130 and 7 more.
- Fix: `20261112180000_site_isolation_remaining_site_tables.sql`, RESTRICTIVE SELECT site policy on 11 tables.
- Verified: no-site Driver reads 0 sited rows on all 11; all-sites accounts unchanged; a Driver narrowed to
  one site inside a rolled-back transaction reads 0 rows from another site.
- OPEN: `profiles`, `parts_consumption` (218,776 rows, no site policy), and site WRITE policies. Unreachable
  today except for the 12 no-site Drivers.

### RLS-8 (P2) Country gaps on event and audit tables - OPEN
- Evidence: KSA-MGR reads 223,151 of 223,191 domain_events (PROVEN); 27,741 events belong to UAE/Egypt work
  orders (privileged join; that these are inside the readable set is INFERRED). audit_log_v2 null-country
  rows with foreign payloads (known item V579, not re-measured). workflow_notifications 4,573 rows.
- Reason open: needs a country column at emit time or a super-admin-only read; no migration written.

### RLS-9 (P2) Profile rows and emails readable by every member - FIXED / STAGED
- Evidence (PROVEN): a Driver reads 768 profile rows (115 push tokens, 41 admin notes, 4 real emails);
  `get_user_email_by_id` returned the 4 real addresses to a Driver.
- FIXED: `20261112170000_profile_directory_and_private_readers.sql`. PII-free `list_profile_directory`,
  elevated-only `list_profile_private`, `get_user_email_by_id` limited to self / elevated same org / super
  admin. Verified: Driver directory 768 rows, private 0, real email via RPC 0 (was 4).
- STAGED: `pending_migrations/20261112171000_profiles_secret_columns_not_selectable.sql` (column privileges
  that withdraw push_token, notes and recovery fields). Not applied: it must wait until the web build that
  stops selecting those columns (commit f39aae1f) is live, or console sign-in breaks.
- OPEN after both: `email` and `phone` stay selectable (installed Expo build selects them at sign-in). Row
  narrowing draft `pending_migrations/20261110147000_profiles_pii_read.sql` is held for the owner.

### RLS-10 (P2) Field-role reach and blanket update policies - FIXED / OPEN
- Evidence (PROVEN): a Driver updated all 161 action_items and 2,416 odometer_logs; reads 118,205
  parts_consumption, 212,567 production_logs and other ledgers inside own country.
- FIXED: `20261112154000` (action_items, odometer_logs update scope) and `20261112181000` (engine_hours_logs).
  Verified: Driver updates 0 action_items and only own readings; capability holders unchanged.
- OPEN: whether Drivers should read the financial ledgers at all (owner decision); other tables with a
  blanket ALL policy (asset_utilization 556 rows, gate_passes 2).

### RLS-11 (P2) `system_config` readable by every account - FIXED / OPEN
- Evidence (PROVEN): DEMO-MGR, a Driver and the locked account each read all 62 keys.
- Fix: `20261112182000_system_config_read_levels.sql`. Read levels all / elevated / super; active accounts only.
- Verified: Driver 36 keys, Manager 41, locked account 0, super admin 62.
- OPEN (stated in the migration): the 5 elevated keys are still readable by a Manager of any organisation; a
  super admin without an MFA session still reads and writes all keys through two older policies.

### RLS-12 (P3) Storage policy gaps - FIXED / OPEN
- FIXED: `20261112152000` (inspection-photos upload needs an active account; vehicle-photos update needs owner
  or authorised same-org user). Verified by metadata-row probes.
- OPEN: `inspection_photos_delete` dead lowercase role arm. The statement is written at the foot of
  `20261112152000` for the owner to paste; NOT applied.

### RLS-13 (P3) Default privileges and non-public schemas - FIXED / OPEN
- FIXED: `20261112157000`. New functions created by `postgres` are no longer anon-executable; anon sequence
  USAGE 0 of 44.
- OPEN / NOT VERIFIED: `net.*` (pg_net) and schema `private` functions are executable by anon / authenticated;
  reachable only if those schemas are exposed by PostgREST (platform setting, not readable).

### RLS-14 (P3) Anon-executable definer functions: 14 - OPEN
- All 14 judged justified in the audit. `get_login_showcase` discloses counts to anon (owner-accepted).
  `get_user_module_permissions` answers for another organisation's user id (PROVEN). No change made.

### RLS-15 (P3) Advisors - OPEN
- Security: 0 ERROR. WARN: authenticated definer functions 519, graphql table exposure 479, anon definer 14,
  mutable search_path 7, extensions in public 2.
- Performance: auth_rls_initplan 316, multiple_permissive_policies 514, unused_index 859.

### RLS-16 (P3) Smaller observations - OPEN
- `profiles_admin_update` has no org term (cross-org update still refused in practice); `set_scrap_reason`
  returns ok for a no-op; `workforce_qualification` answers for any profile id (tables empty).

## Tenant isolation matrix at audit time (before fixes)

| Identity | Verdict on core business tables | Failures found |
|---|---|---|
| DEMO-MGR | PASS (reads only own 18 tyres, 4 vehicles, 3 work orders) | RLS-3, RLS-4, RLS-5 |
| KSA-MGR | PASS (0 UAE/Egypt rows on country tables) | RLS-2, RLS-8 |
| KSA-DRV | Country PASS | RLS-9, RLS-10 (breadth) |
| KSA-DRV-NOSITE | PASS on core tables | RLS-7, RLS-1 |
| KSA-TYREMAN | handover only tested | RLS-6 |
| EG-TDC | PASS (Egypt only) | - |

Direct cross-country and cross-organisation inserts and updates were refused (42501) for KSA-MGR and DEMO-MGR.

## Checked and clean

- 484 public tables: 0 with RLS off, 0 with RLS on and no policy.
- anon: 0 table grants in public.
- 757 SECURITY DEFINER functions in public; 0 with an unpinned search_path.
- 21 views, all `security_invoker`.
- Privilege escalation through the profile row (role, super admin flag, org, country) refused.
- `user_devices`, `user_signatures`, `password_reset_requests`: own-only or admin-only, proven.
- Realtime publication: 17 tables, all under RLS.

## NOT VERIFIED

- Which schemas PostgREST exposes.
- Site WRITE isolation and the all-sites path of definer RPCs (no narrowed account exists).
- Definer functions created since 2026-11-01 tested with a real foreign-country record id.
- Storage: no object was read or written; assessment is from the catalog and metadata-row probes.
- audit_log_v2 foreign-payload count (V579) was not re-measured.
- Whether the demo Manager credentials are held by anyone outside the owner.
