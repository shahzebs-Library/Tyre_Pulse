# SaaS implementation roadmap: from one tenant to a safe second tenant

Date: 2026-11-12. Scope: findings TEN-1 to TEN-9 (`TENANCY_SECURITY.md`) and CF-01 to CF-08
(`COMMERCIAL_FOUNDATION.md`). Status of everything below: DRAFTED, NOT APPLIED. Nothing in this document
has run on production. Production was read with SELECT only.

Two rules hold for every phase:

1. The current company (Company A, `00000000-0000-0000-0000-000000000001`, about 1,618 vehicles and 768
   profiles) must see no change unless a line says otherwise.
2. A phase is finished when its test gate passes on a BRANCH database, not when the PGlite test passes.
   PGlite proves the logic against copies of the live function bodies; it does not prove the combined run,
   RLS cost under load, or anything a client does.

## 1. What exists after this drafting round

| Draft (supabase/pending_migrations) | Finding | PGlite test (supabase/tests) | Result |
|---|---|---|---|
| 20261113100000 .. 104000 (other author) | TEN-1 to TEN-5 | tenant_isolation_ten1 .. ten5 | see that author's report |
| 20261113110000_ten6_entitlement_enforcement.sql | TEN-6, CF-05, CF-07, CF-08 | tenant_isolation_ten6.test.mjs | 9 of 9 pass |
| 20261113111000_ten7_per_tenant_configuration.sql | TEN-7, CF-13 | tenant_isolation_ten7.test.mjs | 7 of 7 pass |
| 20261113112000_ten8_company_a_fallback_resolver.sql | TEN-8, CF-01 | tenant_isolation_ten8.test.mjs | 6 of 6 pass |
| 20261113113000_ten9_tenant_lifecycle.sql | TEN-9, CF-02, CF-09, CF-12 | tenant_isolation_ten9.test.mjs | 7 of 7 pass |

Run: `node --test --test-concurrency=1 supabase/tests/tenant_isolation_ten6.test.mjs
supabase/tests/tenant_isolation_ten7.test.mjs supabase/tests/tenant_isolation_ten8.test.mjs
supabase/tests/tenant_isolation_ten9.test.mjs` (29 tests, about 80 seconds).

Shared fixture: `supabase/tests/fixtures/tenant_saas_harness.mjs`. It holds VERBATIM copies of 20 live
function bodies read on 2026-11-12 and stand-ins for 15 more (same signature, same count of the Company A
literal). If production changes one of those bodies the draft's own anchor guard aborts on apply.

Three mutation checks were run by hand and are worth repeating before apply: removing the `app_user_can`
patch lets an expired tenant's Admin through; removing the `app_is_active` patch leaves a locked tenant
active; reverting the `normalize_site` patch rewrites tenant B's site with a Company A alias. Each made the
matching test fail, so those assertions are load-bearing.

## 2. Phases, in order

Each phase lists: what, depends on, test gate, risk to Company A, owner decision.

### Phase 0. Branch database and second-tenant fixtures (no production change)
- What: a Supabase branch (or the test project in `TEST_ENVIRONMENT_PLAN.md`) restored from production
  schema, with a throwaway organisation B, one plain Admin and one Manager in it. Production has no plain
  Admin outside Company A, so no refusal below can be proven on production itself.
- Depends on: nothing.
- Gate: the nine `tenant_isolation_ten*.test.mjs` files pass locally; the branch has a tenant B Admin.
- Risk to Company A: none.
- Owner decision: approve the branch (cost) and who may use it.

### Phase 1. Close the cross-tenant holes (TEN-1 to TEN-5, other author's drafts)
- What: job card conflict guard, raw upload tables walled, platform tables super-admin write, admin RPCs
  same-organisation, subscription and organisation write guard.
- Depends on: Phase 0.
- Gate: that author's VERIFY blocks on the branch, as tenant B Admin.
- Risk to Company A: none to low, as stated in each file.
- Why first: TEN-6 reads `modules`, `subscription_plans`, `org_subscriptions` and `organisations`. Until
  TEN-3 and TEN-5 are applied a customer Admin can edit the inputs to its own entitlement, and can set
  `organisations.locked` on its own row, which TEN-9 starts to enforce.

### Phase 2. Entitlement model, switched off (TEN-6 draft)
- What: `internal` plan, a subscription row for every existing organisation, `org_entitled()`,
  `get_my_entitlements()`, `org_module_overrides`, `modules.min_plan_feature`, seat limit, patched
  `app_user_can` / `enforce_plan_limit` / `ensure_org_subscription` / `get_subscription_overview`.
  `system_config.entitlement_enforcement` is inserted as `off`.
- Depends on: Phase 1.
- Gate (branch, then production inside `begin; ... rollback;`): Company A Manager inserts a vehicle;
  `md5(get_my_entitlements())` recorded; `app_user_can` answers for five roles unchanged; Billing page opens
  and shows the Internal plan.
- Risk to Company A: none with the switch off, by construction. Visible change: the Billing page shows
  "Internal, active" instead of a synthetic trial. This phase also removes the CF-08 trap.
- Owner decisions: plan label; that the demo tenant and the three empty organisations also get `internal`;
  grace rules (past_due, cancelled).

### Phase 3. Per-tenant configuration (TEN-7 draft)
- What: `system_config.legacy_config_org`, `org_alias_overrides`, scoped `normalize_site`,
  `normalize_site_name`, `normalize_brand`, own-organisation matrix rows, `set_org_module_permissions`,
  `org_config` / `set_org_config`, custom role names per organisation.
- Depends on: Phase 2.
- Gate: on the branch, per-table `select site, count(*)` for the 39 tables with a site trigger is identical
  before and after a replay of one day's inserts; Company A `get_user_module_permissions` hash unchanged for
  each role; tenant B inserts a site equal to a Company A alias and it is stored as typed.
- Risk to Company A: low. Three extra primary-key lookups per row in the site triggers: time a 5,000 row
  `parts_consumption` insert before and after.
- Owner decisions: starter role matrix for new tenants (today's global rows for the ten built-in roles);
  the list of tenant-owned settings; whether a tenant Admin may edit its own matrix.

### Phase 4. Remove the Company A fallbacks (TEN-8 draft), mode unchanged
- What: resolver calls replace the literal in 20 functions and in the `profiles.org_id` default.
  `single_tenant_mode` stays `true`.
- Depends on: Phase 3 (`_legacy_config_org`, `_single_tenant_org`).
- Gate: on the branch, one sign-up, one Table Editor insert and one staging CSV for each `stg_` table land
  in Company A exactly as before; the catalog query in the file header returns 0 functions with the literal.
- Risk to Company A: none while the mode is true. Brief exclusive lock on `profiles` for the default change:
  apply out of hours.
- Owner decision: none in this phase.

### Phase 5. Tenant lifecycle (TEN-9 draft)
- What: `admin_provision_organisation`, `org_invitations`, `org_invite_member`, invitation-aware sign-up,
  suspension inside `app_is_active()`, per-organisation identity indexes, purge draft.
- Depends on: Phases 1, 2, 3, 4.
- Gate: on the branch, provision tenant B from SQL as super admin; sign up with the token and land in B
  only; lock B and every B member reads 0 rows in the next request while Company A is unchanged; dry-run
  purge returns counts; Company A purge is refused.
- Risk to Company A: medium for suspension (`app_is_active()` is in every policy). Measure one dashboard
  load as a Company A Manager before and after. The migration aborts if any organisation with members is
  locked or inactive at apply time.
- Owner decisions: invited users approved on sign-up; open (no e-mail) invitations for field staff; trial
  and invitation length; purge policy.

### Phase 6. Clients read entitlements (no database change)
Server drafts above change nothing a user sees until the clients ask. Not done in this round:

| Surface | Change | Files to start from |
|---|---|---|
| Web | Load `get_my_entitlements()` once after sign-in; AND it into `ModuleRoute`, `ModuleStatusGate`, `shouldShowNavItem` and the command palette; remove the Admin exception for entitlement (keep it for maintenance if wanted). | `src/contexts/AuthContext.jsx`, `src/components/ProtectedRoute.jsx`, `src/components/SubscriptionGate.jsx`, `src/components/Layout.jsx`, `src/lib/commandSearch.js`, `src/lib/entitlements.js`, `src/lib/subscriptionAccess.js` |
| Web | Billing page: render a non-public plan (`internal`); stop calling `ensure_org_subscription` to "start a trial"; show standing from the entitlement map. | `src/pages/Billing.jsx`, `src/lib/api/billing.js`, `src/hooks/useBilling.js` |
| Web | Suspended and expired screens that work when `app_is_active()` is false (the user can read nothing, including its own organisation row). | `src/components/SubscriptionGate.jsx`, `src/App.jsx` |
| Web | Read tenant settings through `org_config()` instead of `system_config`: report palette, company logo, support e-mail. | `src/contexts/SettingsContext.jsx`, `src/lib/api/brandLogo.js`, `src/lib/api/systemConfig.js` |
| Web | Tenant Team page: invite (`org_invite_member`), revoke, list invitations; tenant role matrix editor on `set_org_module_permissions`; site alias editor on `org_alias_overrides`. | new page reusing the console People components; `src/console/pages/access/AccessManager.jsx` |
| Web | Sign-up accepts `?invite=<token>` and sends it as `invite_token` in sign-up metadata; plain sign-up hidden once `single_tenant_mode` is off. | `src/pages/Login.jsx` (around line 336), `src/lib/api/onboarding.js` (remove the dead `create_workspace_owner` call at line 223) |
| Console | "Create company" calls `admin_provision_organisation` and shows the one-time invitation link; per-tenant module overrides on `set_org_module_override`; lock / unlock; purge dry-run viewer. Stop the direct insert at `ConsoleOrganisations.jsx:160`. | `src/console/pages/ConsoleOrganisations.jsx`, `src/console/pages/ConsoleModuleControl.jsx` |
| Flutter | Read `get_my_entitlements()` with the access grants and AND it into the module registry; accept an invitation token at registration; suspended screen. | `tyre_pulse_flutter/lib/core/auth/access_permissions_repository.dart`, `lib/core/permissions/module_registry.dart`, `lib/features/extras/data/self_registration_repository.dart` |
| Expo (retired, still installed on most phones) | No change possible without a build. It keeps working for Company A. A new tenant must not be given the Expo app. | none |
| Edge functions | One helper in `_shared/auth.ts` that calls `org_entitled(key)` with the caller's JWT; used by `chat-ai`, `ai-orchestrator`, `ai-tyre-inspection`, `send-scheduled-reports`, `public-api`, `tenant-export`. | `supabase/functions/_shared/auth.ts` |
| Edge functions | `billing-webhook` and `billing-checkout`: confirm they still write `org_subscriptions` under the TEN-5 trigger (service role path) and map a paid plan to `status = active`. | `supabase/functions/billing-webhook`, `billing-checkout` |
| Edge functions | Accident e-mail consumer and scheduled reports: take mailbox, logo and palette per organisation (`organisations.settings.tenant_config`), not from `system_config`. The SQL consumer `consume_event_accident_notify` reads `system_config` and was not changed. | `supabase/functions/workflow-notify`, `send-scheduled-reports`, live function `consume_event_accident_notify` |
| Edge function | A purge runner that verifies a super admin, requires a completed tenant export, then calls `admin_purge_organisation` with the service role and removes storage objects and auth users. | new |

- Gate: acceptance tests 1 to 5 in section 5 of `TENANCY_SECURITY.md`, on the branch, with tenant B on the
  trial plan.
- Risk to Company A: low if each client change ships before the switch in Phase 7; the map says "entitled"
  for every module while enforcement is off or the plan is `internal`.

### Phase 7. Switch entitlement enforcement on
- What: `update system_config set value = 'on' where key = 'entitlement_enforcement'` (super admin).
- Depends on: Phase 6 for the web app at least; Flutter if tenant B will use phones.
- Gate: Company A `md5(get_my_entitlements())` equals the value recorded in Phase 2 except for the
  `enforced` flag; one vehicle insert, one tyre record insert and one inspection as a Company A Manager and
  as a Tyre Man on Flutter; tenant B on trial is refused at vehicle 26 and at the 4th approved member.
- Risk to Company A: low. It is on `internal`. Roll back by setting the value to `off` (instant).
- Owner decision: the go-ahead, and the map of modules to plan features (`modules.min_plan_feature`; none
  is set by the drafts, so until then a plan only limits counts, not modules).

### Phase 8. First real tenant, still in single-tenant mode
- What: provision tenant B from the console; owner signs up with the invitation; B's Admin invites staff.
  `single_tenant_mode` can stay `true` for this step: invited sign-ups go to B, uninvited sign-ups still
  go to Company A as pending Reporters, exactly as today.
- Depends on: Phases 5, 6, 7.
- Gate: tenant B reads 0 Company A rows on web and Flutter (the DEMO-MGR sweep from the audit, repeated as
  B's Admin and Manager); Company A reads 0 tenant B rows.
- Risk to Company A: low.
- Limit to state to the customer: usernames and employee ids are unique across the whole platform until
  Phase 10; a B user cannot reuse an id that exists in Company A.

### Phase 9. Switch single-tenant mode off
- What: `single_tenant_mode = 'false'`. From then on a sign-up without an invitation has no organisation and
  no access, and every Table Editor or service load must run `set tp.import_org = '<organisation id>'`.
- Depends on: Phase 8, plus the operator runbook line and a check of every scheduled job and edge function
  that inserts without a session (the staging pipes raise PT409 instead of defaulting).
- Gate: on the branch with the mode off, run every cron job once and every import path once for Company A
  with `tp.import_org` set; 0 PT409 in the Postgres log for a full day.
- Risk to Company A: medium. This is the first step that changes Company A's own daily behaviour (operator
  uploads need one extra line; uninvited sign-ups stop appearing in the pending list).
- Owner decisions: when; and how Company A's own new staff register afterwards (invitation link per site,
  or a standing open invitation that is rotated).

### Phase 10. Identity and key uniqueness per organisation
- What: organisation-code sign-in on web, Flutter and the `sign-in` edge function; `get_email_by_identifier`
  takes the code; then remove the five global unique indexes on `profiles` (the per-organisation indexes are
  already in place from Phase 5). Work order number per organisation is the other author's TEN-1b.
- Depends on: Phase 6 client releases reaching users (Flutter build on phones).
- Gate: employee id 1001 exists in two organisations and each signs in to its own; Company A users sign in
  without typing a code.
- Risk to Company A: medium (sign-in path for 768 users; field staff sign in by employee id).
- Owner decision: company code format and whether Company A users ever need to type one.

### Phase 11. Remaining items before selling widely
- Tenant seed (`_seed_new_organisation`: checklist templates, departments, routing rules, approval policy,
  e-mail templates). The provisioning RPC calls it when it exists.
- Write enforcement for an expired (not locked) tenant on tables whose writes are allowed by the legacy
  role policies: a RESTRICTIVE write policy per table keyed on standing, reads kept for export.
- Daily job that moves ended trials to `expired` and warns before the end (the standing function already
  treats an ended trial as not entitled, so this is for display and notices).
- `sync_ksa_kms_to_meter`: retire or scope (it reads `min(organisation_id)` across all tenants).
- `upload_feeds`, `due_alert_rules`, metric and dashboard registries per organisation (TEN-7 remainder).
- Per-tenant AI budget and mail caps (TEN-11), null-organisation arms (TEN-10).
- Purge: storage objects, auth users, audit retention rule, customer self-service export.
- Stripe test-mode run of checkout and webhook (CF-06).

## 3. Owner decisions, collected

| # | Decision | Needed before | Default the drafts assume |
|---|---|---|---|
| 1 | Plan catalogue: label of the internal plan; which existing organisations are grandfathered | Phase 2 | `internal`; all five |
| 2 | Grace rules: past_due, cancelled until period end | Phase 7 | entitled |
| 3 | Module to plan feature mapping | Phase 7 | none mapped |
| 4 | Should platform `modules.status` be enforced by the server (75 disabled today, Flutter ignores status) | Phase 7 | no, reported only |
| 5 | Starter role matrix and tenant-owned settings list | Phase 3 | today's global rows for ten built-in roles; seven settings |
| 6 | May a tenant Admin edit its own role matrix | Phase 3 | yes, own organisation only |
| 7 | Invited users approved automatically; open invitations allowed | Phase 5 | yes; yes, single use |
| 8 | Operator-set paid plan is `active` without a payment record | Phase 5 | yes |
| 9 | When to switch entitlement enforcement on | Phase 7 | not switched |
| 10 | When to switch single-tenant mode off; how Company A staff register after | Phase 9 | not switched |
| 11 | Global username and employee id uniqueness; company code | Phase 10 | kept global |
| 12 | Purge policy: export first, retention, approver, member accounts | Phase 11 | dry run only |

## 4. Not proven

- The combined run of all nine drafts on one database. Each author tested its own set; anchors could clash
  where two drafts patch the same function (`process_stg_job_cards`: TEN-1, TEN-1b and TEN-8;
  `get_user_module_permissions`: TEN-4 notes and TEN-7). A clash aborts the later migration; it cannot
  half-apply.
- The 15 functions that are stand-ins in the harness (for example `process_stg_job_cards`,
  `process_daily_km`, `material_master_derive`): the literal count was measured live and the guard is tested,
  but their full behaviour after the replacement was not run.
- RLS and trigger cost on production data volumes. No timing was taken.
- That every production path that inserts without a session is known. `single_tenant_mode` off turns an
  unknown one into a PT409, which is loud, not silent.
- Any client behaviour. No file under `src/`, `mobile/`, `tyre_pulse_flutter/` or `supabase/functions/` was
  changed.
- The refusals for a tenant Admin on production (no such account exists there).
