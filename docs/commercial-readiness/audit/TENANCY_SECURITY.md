# Tenancy, RLS, authorization and entitlements: commercial readiness audit

Date: 2026-11-12. Project `jhssdmeruxtrlqnwfksc`. Working tree: branch `claude/tyrepulse-inspector-build-7rxp2t`.
Read-only. Every database statement was a SELECT; the one impersonation probe ran inside `begin; ... rollback;`.
This report starts from `docs/audit-2026-11/` and does not repeat it. IDs from that audit (RLS-n, API-n, CON-n,
AI-n, FILE-n, AUTH-n) are referenced, not re-described.

## 1. The two verdicts

| Question | Verdict | Basis |
|---|---|---|
| Internal Production Readiness (Company A, 3 countries, current users) | READY, with the owner actions already listed in `PRODUCTION_READINESS.md` | The organisation wall, the country wall and the site read wall hold on the business tables. Nothing in this report is exploitable by a current Company A user beyond what the earlier audit already recorded. There are 0 plain (non super) Admin accounts today, so the Admin reach findings below are dormant. |
| Commercial SaaS Readiness (a second, independent company on this database) | NO | Four findings let a second tenant's ordinary Admin or Manager read or overwrite Company A data or change platform-wide settings (TEN-1 to TEN-4). Entitlements can be bypassed by the customer's own Admin (TEN-5, TEN-6). There is no supported, safe way to create the tenant and its first Admin (TEN-9). Shared global configuration would make tenant B run on Company A's roles, site aliases and module switches (TEN-7, TEN-8). |

Clear answer: it is NOT safe to put a second independent company on this database today. Nine blockers must be
closed first (section 6). None of the fixes needs a rewrite; all can be additive and leave Company A unchanged.

## 2. Method and evidence base

- Catalog queries over `pg_class`, `pg_policy`, `pg_proc`, `pg_trigger`, `pg_constraint`, `storage.*`,
  `pg_publication_tables`, `cron.job`.
- One rolled-back impersonation of the only non Company A account (a Manager in the demo organisation,
  tagged DEMO-MGR, 18 tyres, 4 vehicles).
- Source read: `src/components/ProtectedRoute.jsx`, `src/components/SubscriptionGate.jsx`,
  `src/lib/entitlements.js`, `src/lib/subscriptionAccess.js`, `src/lib/api/billing.js`,
  `src/lib/api/onboarding.js`, `src/console/pages/ConsoleOrganisations.jsx`, every
  `supabase/functions/*/index.ts`.
- Confidence words: VERIFIED (observed in the live catalog, a live function body, or by impersonation),
  PLAUSIBLE (follows from verified facts but the exploit itself was not run because it needs a write or an
  account type that does not exist), NOT VERIFIED.

Live numbers at audit time: 485 public tables, 0 with RLS off, 0 with no policy. 108 tables have no organisation
column. 178 have a nullable organisation column, 199 NOT NULL. 5 organisations: Company A (768 profiles, 2 Admin
role accounts, both super admins), demo (1 Manager), 3 empty. 0 plain Admins. 0 rows in `org_subscriptions`.
4 plans. `system_config.single_tenant_mode = true`. 520 SECURITY DEFINER functions executable by `authenticated`.
0 views without `security_invoker`. 9 storage buckets, all private. 15 tables in the realtime publication.

## 3. What holds today (VERIFIED, do not re-open)

- DEMO-MGR reads only its own rows: tyre_records 18, vehicle_fleet 4, profiles 1, organisations 1,
  material_master 0, checklist_templates 0, report_schedules 0, workflow_definitions 0, custom_roles 0,
  storage objects 0, `ksa_country_upload_template_staging` 0, `ksa_kms` 0.
- `app_settings` and `settings` carry a RESTRICTIVE `is_super_admin()` platform boundary.
- `system_config` writes are super admin only. `set_module_permissions`, `admin_update_profile`,
  `admin_data_cleanup_run`, `create_backup_snapshot`, `admin_db_query`, tenant export (RPCs and edge function)
  are super admin only in their bodies.
- Storage reads are bound to the uploader's organisation through `storage_object_in_my_org(owner)` on
  tyre, inspection, accident, vehicle and import buckets. Workforce and import paths are org-prefixed.
- No policy and no column default other than `profiles.org_id` names the Company A id. No file under `src/`,
  `mobile/` or `tyre_pulse_flutter/lib/` hard-codes it (tests only; the retired native Kotlin app does).
- The System Console admits only a super admin with an MFA-complete session.

## 4. Findings

Format: ID, title, severity (for a two-tenant database), confidence, evidence, what happens, impact, fix,
acceptance test, area. Each carries Internal status (ready / at risk / broken), Commercial class (1 to 6) and the
fix's risk to the current company.

### TEN-1 Job card import overwrites another tenant's work orders (P0, VERIFIED body / PLAUSIBLE exploit)
- Evidence: live body of `process_stg_job_cards` (SECURITY DEFINER) ends
  `insert into work_orders ... on conflict (work_order_no) do update set country = excluded.country, ...`
  with no `where work_orders.organisation_id = v_org`. Constraint `work_orders_work_order_no_key` is unique
  across ALL organisations. Policy `stg_job_cards_write` admits any `app_is_elevated()` caller whose
  organisation is not null.
- What happens: a Manager in tenant B who uploads a job card file whose number matches a Company A number
  (the numbers follow a predictable pattern) silently rewrites Company A's work order: country, asset, dates,
  hours, custom data. No error, no audit attribution to the victim. The same global key also means tenant B
  simply cannot have a job card number Company A already used through the in-app importer (23505, whole batch
  aborts) and the failure tells B that the number exists elsewhere.
- Same class, VERIFIED global unique keys: `purchase_orders.po_number`, `tyre_status_marks (serial, mark_type)`,
  `brand_aliases.alias`, `kpi_targets (metric, year, month, site)`, `column_mappings.fingerprint`.
- Internal: ready (one tenant, the key is effectively per company). Commercial: class 3.
- Fix: (a) add `where work_orders.organisation_id = excluded.organisation_id` to the conflict update in
  `process_stg_job_cards` now; (b) replace each global unique key with a key that leads with
  `organisation_id`, then change the `on conflict` targets and the client de-dup reads to match.
- Risk to current company: (a) none, behaviour is identical for one organisation. (b) low to medium: the
  constraint swap is safe for the data (all rows are one organisation) but `on conflict (work_order_no)` in the
  staging trigger and the ERP intake de-dup must change in the same migration or imports fail. Test on a
  branch database first.
- Acceptance: as a tenant B Manager, staging a row with a Company A job card number creates a NEW row in B and
  leaves the A row byte-identical (privileged recount); the same number can exist once per organisation.
- Area: DB, web (ERP intake).

### TEN-2 Company A's raw upload tables are readable by any tenant's Admin (P0, VERIFIED policy / PLAUSIBLE read)
- Evidence: `ksa_country_upload_template_staging` (about 282,000 rows), `ksa_kms` (about 3,000), `uae_kms`
  (about 1,300) have no organisation column. Their only read policy is
  `is_super_admin() OR app_is_org_admin()`, and `app_is_org_admin()` is
  `is_super_admin() OR app_role() = 'admin'`. No RESTRICTIVE organisation policy exists on them.
  DEMO-MGR reads 0 only because that account is a Manager. This is the open remainder of RLS-3.
- What happens: the Admin of any second company reads Company A's full KSA job card, tyre and telematics
  history.
- Also in this class (no org column, role-only or all-authenticated gate): `daily_km` (0 rows),
  `cleaning_log` (0), `fleet_master` (0, read by any signed-in user), `stg_job_cards*`, `stg_wo_lines*`,
  `stg_tyre_brand*` (pipes, normally empty), `pending_uploads` (has a nullable organisation column but NO
  organisation policy: any Admin or Manager of any tenant reads every pending upload, any Admin approves or
  deletes it; 0 rows today).
- Internal: ready. Commercial: class 6 (internal landing tables that must be walled off).
- Fix: add `organisation_id uuid not null default app_current_org()` stamped Company A on the three populated
  tables plus a RESTRICTIVE `organisation_id = app_current_org() OR is_super_admin()` policy (the RLS-3
  recipe); add the same RESTRICTIVE policy to `pending_uploads` after making its organisation column NOT NULL;
  make the empty legacy tables super admin only.
- Risk to current company: low. Company A users keep their rows because every row is stamped Company A. The
  two KSA triggers that write these tables run as definer and are unaffected.
- Acceptance: a throwaway Admin in a second organisation counts 0 on all of them; a Company A Admin counts the
  same as before.
- Area: DB.

### TEN-3 A customer Admin can change platform-wide configuration (P0, VERIFIED policies)
- Evidence: write policies gated only on role Admin, on tables with no organisation column and no super admin
  boundary: `modules` (`modules_write`: `is_super_admin() OR get_my_role() = 'Admin'`), `subscription_plans`
  (`profiles.role = 'Admin'`), `due_alert_rules`, `brand_aliases`, `metric_registry`, `metric_versions`,
  `quality_rules`, `data_assets`, `lineage_edges`, `dashboard_registry`, `widget_bindings`, `releases`,
  `release_impacts`.
- What happens with a second tenant: its Admin can switch any module to disabled or maintenance for EVERY
  company (197 rows, shared), edit plan prices and limits for every company, change who receives due alerts
  everywhere, and add brand aliases that rewrite other tenants' tyre brands on write.
- Internal: ready today (the only Admin accounts are the two platform owners). At risk the day a plain Admin is
  created inside Company A too. Commercial: class 3.
- Fix: change each of these write policies to `is_super_admin()` only. Where a tenant genuinely needs its own
  setting (alert recipients, module switches), add a per-organisation override row (see section 5).
- Risk to current company: none today (0 plain Admins lose anything). The console pages that write these
  tables already run as super admin.
- Acceptance: a plain Admin updating `modules`, `subscription_plans`, `due_alert_rules` writes 0 rows (count
  with `update ... returning`), a super admin still writes.
- Area: DB.

### TEN-4 Two admin RPCs act on any user in any organisation (P1, VERIFIED bodies)
- Evidence: `admin_set_user_sites(p_user_id, ...)` and `admin_set_web_access(p_user_id, ...)` gate on
  `is_super_admin() OR get_my_role() = 'Admin'` and then `update profiles ... where id = p_user_id` with no
  organisation comparison. `admin_set_user_sites` also disables `trg_guard_profile_privileged` around its
  update, so the V307 same-org guard does not run.
- What happens: tenant B's Admin can clear or widen the site scope of a Company A user, or switch off their web
  access, if they hold the user id. User ids are not listed across organisations, but
  `get_user_module_permissions(p_user_id)` answers for any id (RLS-14), so the wall is obscurity only.
- Internal: ready. Commercial: class 3.
- Fix: add `and (is_super_admin() or org_id = app_current_org())` to both updates and raise when 0 rows match.
  Restrict `get_user_module_permissions` to self, same-org elevated, or super admin.
- Risk to current company: none.
- Acceptance: plain Admin of org B calling either RPC with an org A user id gets 42501 and the row is
  unchanged.
- Area: DB.

### TEN-5 The customer's own Admin can grant itself any plan (P1, VERIFIED policies and code)
- Evidence: `org_subscriptions_admin_write` is FOR ALL with
  `organisation_id = app_current_org() AND role = 'Admin'`. `organisations_write` lets the same Admin update
  their own `organisations` row, including `plan`, `active`, `locked`, `max_users`. `subscription_plans` is
  Admin-writable (TEN-3) and `billing-checkout` reads the price from that table. `src/lib/api/billing.js:76`
  blocks paid plans only in browser code.
- What happens: one REST call sets `plan_code = 'enterprise', status = 'active'`; or the Admin lowers the plan
  price and pays the lowered amount; or un-locks their own suspended organisation.
- Internal: ready (no billing in use). Commercial: class 4.
- Fix: `org_subscriptions` writes only through the service role (webhook) and a super admin RPC; drop the
  Admin write policy, keep read. Add a BEFORE UPDATE guard on `organisations` so `plan`, `active`, `locked`,
  `max_users`, `parent_organisation_id` change only for a super admin (extend the existing
  `guard_organisation_configuration`). Make `ensure_org_subscription` the only way a trial row appears.
- Risk to current company: none (0 subscription rows; Company A has no plain Admin).
- Acceptance: plain Admin update of `org_subscriptions.plan_code` or `organisations.locked` writes 0 rows or
  raises; the Stripe webhook path and the console still write.
- Area: DB, edge fn.

### TEN-6 Subscription state, plan limits and module switches are not enforced where it counts (P1, VERIFIED)
- Evidence:
  - `enforce_plan_limit` returns NEW when the organisation has no `org_subscriptions` row. There are 0 rows,
    and nothing creates one for a new organisation except `ensure_org_subscription` (called from the Billing
    page) and the disabled `create_workspace_owner`. Triggers exist on `vehicle_fleet` and `api_keys` only;
    users and storage have no trigger.
  - `get_subscription_overview` for an organisation with no row reports a synthetic trial with
    `trial_ends_at = null` (DEMO-MGR result), so the trial never ends.
  - `SubscriptionGate.jsx:145-152` and `ProtectedRoute.jsx:199, 220` let role Admin through an expired
    subscription and through a disabled module.
  - 0 RLS policies and 0 access helpers reference `organisations` (`app_is_active()` reads only the profile),
    so a locked or inactive organisation keeps full data access (CON-5, still open).
  - No edge function checks plan, subscription status or module status (0 references in all 18). The AI budget
    is one global number (AI-2). Flutter and Expo read no subscription state.
- Internal: ready (nothing depends on it). Commercial: class 4.
- Fix: section 5.
- Risk to current company: low if Company A is given an explicit unlimited internal plan row BEFORE any
  enforcement is switched on (it has 1,031 vehicles against a trial cap of 25). High if that step is skipped.
- Acceptance: see section 5 tests.
- Area: DB, web, edge fn, Flutter.

### TEN-7 Second tenant shares, and is shaped by, Company A's configuration (P1, VERIFIED by impersonation)
DEMO-MGR reads: `modules` 197, `module_permissions` 1,346 (all global, 0 per-org), `site_aliases` 54,
`brand_aliases` 36, `upload_feeds` 35, `due_alert_rules` 8, `metric_registry` 12, `quality_rules` 10,
`dashboard_registry` 15, `country_currency` 3, `system_config` 41 keys, `subscription_plans` 4.

| Object | Second tenant would | Consequence |
|---|---|---|
| `module_permissions` (global rows only; writer is super admin only) | share and see; cannot customise | B's Manager gets Company A's role matrix. Role names of A's 33 custom roles are visible as matrix rows. B's Admin cannot change what its own roles see. |
| `custom_roles` | isolated per org (good) | but `normalize_profiles_role` accepts a role name that exists in ANY organisation, and `module_permissions` is keyed by role name globally, so a B role named like an A role inherits A's matrix. |
| `modules` | share, see, and overwrite (TEN-3) | the 75 modules disabled today are disabled for every tenant; there is no per-tenant switch. |
| `site_aliases` + trigger `normalize_site` | share; no one but a migration can write | B's site names are rewritten by A's aliases on every insert (for example a B site spelled like an A alias becomes A's canonical name), and any name ending `-ST` or `_ST` is stripped. Silent data change for B. |
| `brand_aliases` | share, overwrite | same, for tyre brands. |
| `system_config` | share and see 36 to 41 keys | one maintenance switch, one registration switch, one AI budget, one accident mailbox (`accident_email_to`, `accident_email_cc` readable by B's managers: RLS-11 open part), one company logo and report palette for all tenants. |
| `upload_feeds`, `due_alert_rules` | share | coverage alerts and due alerts run on A's choices. |
| `country_currency` | share, read only | fine as reference data; a tenant in a fourth country needs a platform row. |
| `material_master`, `brain_cache`, `tyre_life_targets`, `store_site_map`, `checklist_templates`, `departments`, `accident_email_templates`, `approval_policies`, `workflow_definitions`, `kpi_targets` | isolated (0 visible) | B starts EMPTY: no checklist templates, no routing rules, no approval policy, no departments. Seeds exist for Company A only. |
| AI settings (`ai_*` keys, `ai_models`) | share the keys, see 0 models | one budget for all; one tenant can exhaust it. |

- Internal: ready. Commercial: class 2 for the empty-start items (needs a tenant seed), class 3 for the
  shared items that alter B's data or leak A's settings.
- Fix: (a) add `organisation_id` (nullable = platform default) to `site_aliases`, `brand_aliases`,
  `due_alert_rules`, `upload_feeds`; resolve own-org row first, then the default; stamp today's rows Company A,
  not null, so they stop applying to others. (b) write per-org `module_permissions` rows (the reader
  `get_user_module_permissions` already overlays `org_id = my org` on the global rows; only the writer lacks an
  org argument). (c) move tenant-facing `system_config` keys (accident mailbox, logo, palette, support email,
  AI budget) to `organisations.settings`. (d) one `seed_new_organisation(org)` function that copies the default
  checklist templates, departments, routing rules, email templates and approval policy.
- Risk to current company: low for (b), (d). Medium for (a) and (c): the normalise triggers and the report
  palette loader change their lookup; Company A must be stamped in the same migration and its figures
  re-checked (site counts per table before and after must be identical).
- Acceptance: a new organisation inserts a site whose name equals a Company A alias and it is stored as typed;
  its Admin edits its own role matrix and Company A's matrix hash is unchanged.
- Area: DB, web, console.

### TEN-8 Hard-coded Company A fallbacks route a second tenant's data into Company A (P1, VERIFIED bodies)
- Evidence, 20 live functions contain the Company A id:
  - `handle_new_user`: every sign-up gets `org_id` and `organisation_id` = Company A, role Reporter, pending.
    The column default of `profiles.org_id` is also Company A.
  - `stamp_import_default_org` (13 triggers): a null-org insert is stamped Company A while
    `single_tenant_mode = true`.
  - `process_stg_job_cards`, `process_stg_monthly_tyres`, `process_stg_open_wo`, `process_stg_wo_lines`,
    `process_expenses_country`, `process_expenses_import`, `process_daily_km`, `material_master_*`,
    `reclassify_from_master`, `extract_tyre_freetext_candidates`, `list/resolve_tyre_import_review`:
    `coalesce(app_current_org(), Company A)`.
  - `sync_ksa_kms_to_meter`: falls back to Company A.
  - `get_login_showcase` (anon): counts Company A only.
- What happens: any load done from the Supabase Table Editor or a service connection for tenant B lands in
  Company A and is visible to all of Company A. A person who signs up for company B appears in Company A's
  pending user list (name, email, employee id visible to A's admins) and, if approved by mistake, sees A's data.
- Internal: ready (this is the designed single-tenant behaviour). Commercial: class 3.
- Fix: keep `single_tenant_mode` as the switch. When it is false: `handle_new_user` creates the profile with
  NO organisation unless the sign-up carries a valid invitation token (TEN-9); the staging functions raise
  PT409 instead of falling back (the resolver in `stamp_import_default_org` already does this and already
  honours `tp.import_org`); drop the column default. Do not flip the switch until TEN-9 exists.
- Risk to current company: none while the switch stays true; medium at the moment it is flipped (Table Editor
  loads then need `set tp.import_org`). Write the runbook line first.
- Acceptance: with the switch false in a branch database, a service-role staging insert without
  `tp.import_org` raises PT409 and writes 0 rows; a sign-up without an invitation has `org_id is null` and
  reads 0 rows everywhere.
- Area: DB, ops.

### TEN-9 No safe tenant lifecycle: creation, first Admin, invitation, off-boarding (P1, VERIFIED)
- Create: `ConsoleOrganisations.jsx:160` inserts an `organisations` row directly. Nothing else is created: no
  subscription row, no owner, no seed data, no storage prefix.
- `create_workspace_owner(text, text)` EXISTS live (contrary to the project memory that says it was never
  applied) but EXECUTE is revoked from `authenticated` and `anon`, so it is inert. It makes the caller Admin
  of a new organisation and inserts a 14-day trial. `src/lib/api/onboarding.js:223` still calls it and would
  get a permission error.
- First Admin and members: the only path is a super admin moving an existing Company A sign-up with
  `admin_update_profile(p_org_id)`. There is no invitation table or token. `organisation_memberships` holds
  1 row and no policy or helper reads it; `app_current_org()` reads `profiles.org_id`. A user belongs to
  exactly one organisation.
- `org_id` versus `organisation_id` on profiles: kept equal by trigger, 0 mismatches. Storage and
  `get_user_module_permissions` read `organisation_id`, RLS reads `org_id`. Working, but two names for one fact.
- Global identity keys: `profiles.username` and `profiles.employee_id` are unique across ALL tenants
  (`profiles_username_lower_uidx`, `profiles_employee_id_lower_uidx`). Two companies cannot both have employee
  1001, and sign-in by employee id cannot tell them apart. Field staff here sign in by employee id.
- Export: super admin only tenant export exists and is org-scoped (edge function and RPCs). No customer
  self-service export.
- Delete: `admin_delete_empty_org` and `admin_archive_empty_org` work only for an organisation with no data.
  There is no purge of one tenant's rows and files. Account deletion is a request record only.
- Suspension: recorded, not enforced (CON-5). Support sessions: recorded, do not scope access; a super admin
  reads every tenant at all times.
- Internal: ready. Commercial: class 4.
- Fix: one super admin RPC `admin_provision_organisation(name, plan, owner_email)` that creates the
  organisation, the subscription row, the seed data (TEN-7 d) and an invitation; an `org_invitations` table
  (token hash, org, role, expiry) consumed by `handle_new_user`; identity keys made unique per organisation
  with sign-in resolving by organisation code plus employee id; `admin_purge_organisation` that runs only on a
  locked organisation after an export job has completed; enforcement of `organisations.locked` inside
  `app_is_active()`.
- Risk to current company: low for provisioning, invitations and purge (new objects). Medium for the identity
  key change and for touching `app_is_active()` (it is on the hot path of every policy; one extra indexed
  lookup, must be measured, and Company A must be confirmed `locked = false, active = true` first).
- Acceptance: a new company is provisioned from the console in one action, its invited Admin signs up and
  lands in the new organisation only, employee id 1001 exists in both companies, locking the organisation
  makes every member read 0 rows within one request, purge leaves 0 rows carrying that organisation id in
  every table and 0 objects owned by its users.
- Area: DB, console, web, Flutter (sign-in), ops.

### TEN-10 Null-organisation rows and arms that remain (P2, VERIFIED)
- Policies that still admit `organisation_id IS NULL` rows to every tenant: `report_schedules` (4 policies;
  API-3 policy half, 0 null rows today), `business_rules` (select and write; any elevated user of any tenant
  can create a shared rule; 0 null rows), `user_dashboards` and `report_definitions` shared read (0 rows),
  `user_access_grants` isolation, `module_permissions` (by design).
- 178 tables keep a nullable organisation column. On the business tables the 13 stamp triggers cover it; on
  the rest a null row is hidden by `organisation_id = app_current_org()`, so the risk is lost rows, not leaks.
- `domain_events`, `workflow_notifications`, `report_send_log`, `ai_tyre_inspection_jobs` and about 40 more
  have only a PERMISSIVE organisation policy (no RESTRICTIVE one). Correct today; one future permissive policy
  without an org term would open them. Country gaps on events (RLS-8) are unchanged.
- Internal: ready. Commercial: class 3.
- Fix: remove the null arms (stamp any null rows first); add the standard RESTRICTIVE policy to tables that
  rely on a single permissive one; set NOT NULL where the count of nulls is 0.
- Risk to current company: low; each table needs a null count first.
- Area: DB.

### TEN-11 Shared-service edge functions without tenant limits (P2, VERIFIED source)
- `chat-ai` and `ai-orchestrator`: user JWT and org-scoped reads, but one budget and one rate limit for all
  tenants (AI-2 open).
- `ai-tyre-inspection`: checks `inspection.organisation_id = profile.organisation_id` (good) but downloads the
  photo path with the service role; `tyre-photos` paths are not org-prefixed (API-11, FILE-4 open; 27,243
  objects). Uploads to tyre, inspection, accident and vehicle buckets have no path rule, only reads are
  org-bound.
- `send-email`: any elevated user of any tenant can mail any recipient from the platform sender (API-1 open).
- `send-scheduled-reports`: org scoping is skipped when a schedule's `org_id` is null (API-3).
- `workflow-notify`: delivers whatever recipients the queued payload names; the queue is written by definer
  consumers that scope by org (not re-audited here).
- `billing-webhook`: trusts `metadata.org_id` from the checkout it created; no idempotency (API-7).
- `public-api`: org-scoped by key (good); scopes not enforced (API-5).
- Nightly backup, upload-gap, due-alert, SLA crons iterate all organisations with platform-wide rules.
- Internal: ready. Commercial: class 3.
- Fix: per-organisation AI budget and rate limit keyed on `ai_token_logs.organisation_id`; org-prefixed upload
  paths enforced in the storage insert policies for new objects (old objects keep working through the owner
  rule); per-organisation daily mail cap and sender identity; refuse null-org schedules.
- Risk to current company: low. New-object path rule needs the web, Expo and Flutter uploaders to send the
  prefix first; installed phone builds that do not would fail uploads, so ship clients before the policy.
- Area: edge fn, DB, web, Flutter.

### TEN-12 Items from the earlier audit that changed or remain (P2/P3, VERIFIED where stated)
- `profiles.push_token` is still selectable by `authenticated` (the pending column-privilege migration is not
  applied): RLS-9 staged part still open.
- `auth.sessions` = 252, no server expiry (AUTH-7 open, owner action). 2 users have a verified MFA factor.
- `system_config` still has two write policies that test `profiles.is_super_admin` directly, so an aal1 super
  admin session can write config (AUTH-1 remainder, open).
- `create_workspace_owner` present but not executable (new observation, TEN-9).
- Edge function deployment state, Auth dashboard settings, CAPTCHA, webhook secrets: NOT VERIFIED (no access),
  unchanged from the audit documents.

## 5. Entitlements: what exists, the gap, and the minimal model

What exists (VERIFIED):

| Piece | State |
|---|---|
| `subscription_plans` (4 rows: limits `max_vehicles`, `max_users`, `max_api_keys`, `max_storage_gb`; `features` jsonb with 5 keys: ai_tools, erp_sync, tv_display, report_scheduling, automation_platform) | global, Admin-writable (TEN-3) |
| `org_subscriptions` | 0 rows; Admin-writable (TEN-5) |
| `get_subscription_overview`, `org_can_add`, `ensure_org_subscription` | work; default to a never-ending trial when no row |
| `enforce_plan_limit` | 2 tables; inert without a row; skipped for service role |
| `src/lib/entitlements.js` (`planAllows`, `canAdd`), `subscriptionAccess.js`, `SubscriptionGate` | browser only; Admin passes; fail-open when not loaded |
| `modules` (197 rows, status live / maintenance / disabled) | platform-wide switch, not per tenant; web only; Admin passes |
| `module_permissions` (role x module, optional `org_id`) | all rows global; per-org overlay supported by the reader, not by the writer |
| `user_access_grants` | per user, org-walled, super admin writes |
| Nav `flag:` keys in `Layout.jsx` | hide menu items only; the storage of these flags was not traced (NOT VERIFIED) |

Gap to "centralised per-tenant, per-plan entitlements enforced in navigation, routes, RPCs/RLS and edge
functions":
1. No link from a plan to modules. Plans know 5 feature keys; the app has about 200 module keys.
2. No per-tenant module state. `modules.status` is one value for everyone.
3. No server enforcement of features at all, and limits on only 2 resources.
4. Customer Admin bypasses every client gate and can write the subscription.
5. Phones ignore all of it.

Minimal model that reuses the existing tables (4 additive changes, no parallel system):
1. `modules.min_plan_feature text null`: the plan feature key (or tier) a module needs. Null = in every plan.
   This is the single plan-to-module mapping, edited in the existing Module Control page.
2. `org_module_overrides (organisation_id, module_id, state check in ('on','off'), reason, set_by, expires_at)`,
   RESTRICTIVE org read, super admin write. Covers pilots, add-ons and per-tenant switch-off.
3. One STABLE SECURITY DEFINER function `org_entitled(p_module text) returns boolean`:
   organisation not locked AND subscription status in (trialing and not past `trial_ends_at`, active, past_due)
   AND `modules.status = 'live'` AND (override 'on' OR (no override 'off' AND plan features satisfy
   `min_plan_feature`)). Super admin returns true; customer Admin does NOT.
   `get_my_entitlements()` returns the whole map in one call for web, Expo and Flutter.
4. Enforcement points, all calling the same function:
   - Navigation and routes: `AuthContext` loads `get_my_entitlements()` once; `ModuleRoute`,
     `ModuleStatusGate` and `shouldShowNavItem` AND it with the existing role check, and the Admin exception is
     removed for entitlement (kept for maintenance if wanted).
   - RLS/RPC: `app_user_can(module, cap)` gains `and org_entitled(module)`. It already gates writes on 11 core
     tables, so write enforcement arrives without new policies. Read-heavy paid RPCs (AI, scheduled reports,
     TV share creation, public API key creation) call it at the top.
   - Edge functions: one shared helper in `_shared/auth.ts` that calls `org_entitled` with the caller's JWT;
     used by chat-ai, ai-orchestrator, ai-tyre-inspection, send-scheduled-reports, public-api, tenant-export.
   - Limits: extend `enforce_plan_limit` to `profiles` (users) and make "no subscription row" mean trial
     limits, after Company A has its own row.
5. Lock the writers (TEN-3, TEN-5) so the model cannot be edited by the customer.

Order that protects Company A: first insert an `internal` plan (all features, null limits) and an
`org_subscriptions` row for Company A with status active; verify `org_entitled` returns true for all 122 live
modules as a Company A Manager; only then attach enforcement. Risk to current company with that order: low.
Without it: high (1,031 vehicles against a trial cap of 25, and the feature map would switch off reporting and
ERP sync).

Acceptance tests: (1) org on plan without `report_scheduling`: menu item absent, route shows the upgrade
screen for its Admin too, `insert into report_schedules` refused, `send-scheduled-reports` send-now returns
403. (2) expired trial: Admin reaches Billing only; a direct PostgREST write to `tyre_records` is refused.
(3) override 'on' restores exactly one module. (4) Company A hashes of `get_my_entitlements()` before and
after enforcement are identical. (5) Flutter hides the same modules from the same map.

## 6. Second tenant blockers, in order

| # | Blocker | Sev | Exact fix | Acceptance test | Risk to Company A |
|---|---|---|---|---|---|
| 1 | TEN-1 cross-tenant overwrite through job card import; global business keys | P0 | org guard on the conflict update; per-org unique keys on work_orders, purchase_orders, tyre_status_marks, kpi_targets, column_mappings, brand_aliases | B staging an A job card number leaves A's row unchanged and creates B's | none for the guard; low to medium for the key swap |
| 2 | TEN-2 Company A raw upload tables and pending_uploads readable by another tenant's Admin | P0 | org column + RESTRICTIVE policy; super-only on dead tables | second-org Admin counts 0 | low |
| 3 | TEN-3 customer Admin writes platform config (modules, plans, alert rules, registries) | P0 | write policies to `is_super_admin()` | plain Admin writes 0 rows | none |
| 4 | TEN-4 admin RPCs without org check | P1 | same-org predicate in both RPCs; narrow `get_user_module_permissions` | cross-org call raises 42501 | none |
| 5 | TEN-5 self-granted plan, self-unlock | P1 | remove Admin write on `org_subscriptions`; guard plan/locked/active on `organisations` | plain Admin write refused; webhook still works | none |
| 6 | TEN-8 Company A fallbacks in sign-up and imports | P1 | invitation-bound sign-up; PT409 instead of fallback when `single_tenant_mode` is false | branch test: no invitation = no org; service insert without `tp.import_org` refused | none until the switch is flipped; medium then |
| 7 | TEN-9 no provisioning, invitation, per-org identity keys, suspension, purge | P1 | provisioning RPC, `org_invitations`, per-org username and employee id, `locked` enforced in `app_is_active()`, purge RPC | full lifecycle test in section TEN-9 | low to medium |
| 8 | TEN-7 shared aliases, role matrix, module switches, mailbox and palette; empty start for B | P1 | org column on alias and rule tables; per-org matrix writer; tenant keys to `organisations.settings`; seed function | B site name stored as typed; B edits own matrix; A unchanged | low to medium |
| 9 | TEN-6 entitlements not enforced | P1 | section 5 | section 5 tests | low with the stated order, high without |
| 10 | TEN-10 null-org arms, permissive-only org policies | P2 | remove arms, add RESTRICTIVE policies | DEMO-MGR sweep unchanged; null-org insert refused | low |
| 11 | TEN-11 per-tenant AI budget, mail caps, org-prefixed uploads, null-org schedules | P2 | as listed | tenant B exhausting its AI budget leaves A working | low (clients before policy) |
| 12 | Open items from the earlier audit: CON-5, API-3, AI-2, RLS-8, FILE-4, API-11, RLS-9 staged, AUTH-7 | P2 | as written there | as written there | as written there |

Items 1 to 9 must be closed before a second company's real data is loaded. A demo tenant with invented data and
a Manager-only account (today's demo organisation) is acceptable now.

## 7. Role separation summary (what a customer Admin reaches beyond its company today)

| Capability | Reach | Reference |
|---|---|---|
| System Console sign-in | no (super admin + MFA) | verified in the earlier console review |
| Global role matrix write | no (`set_module_permissions` super only) | VERIFIED |
| Module status for all tenants | YES | TEN-3 |
| Plans and prices | YES | TEN-3, TEN-5 |
| `system_config` | read 36 to 41 keys, no write | RLS-11 |
| Data cleanup, backups, data browser, tenant export | no | VERIFIED |
| Users in other organisations | cannot list; CAN change site scope and web access by id | TEN-4 |
| Own subscription and own lock flag | YES | TEN-5 |
| Bypass disabled module or expired subscription in the web app | YES | TEN-6 |
| Company A raw upload tables | YES (read) | TEN-2 |
| Brand aliases, alert rules, metric and dashboard registries | YES (write) | TEN-3 |
| Mail relay from the platform sender | YES (also Manager, Director) | API-1 |

## 8. Not verified

- No plain Admin account exists and no write was permitted, so TEN-1 to TEN-5 exploits are proven from live
  policy text and function bodies, not by running them. They should be confirmed on a branch database with a
  throwaway second-org Admin before and after the fixes.
- Deployed edge function versions, function secrets, Auth dashboard settings, PostgREST exposed schemas,
  realtime authorisation settings.
- Where the nav `flag:` values are stored and whether they are per organisation.
- The 520 authenticated definer functions were screened by pattern (19 reference no org or role helper, all
  reviewed by name as login, normaliser or delegating functions); they were not individually impersonated.
  Functions that take a target id (undo, review, approval) were not tested with a foreign-org id.
- Site WRITE isolation, storage object reads, and Flutter or Expo behaviour on a device.
- Differences between this branch and `main` for the files read were not diffed; the gate code cited
  (`ProtectedRoute.jsx`, `SubscriptionGate.jsx`, `billing.js`) is from the working tree.
