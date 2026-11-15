# Commercial Foundation Audit

Date: 2026-11-12. Scope: tenant creation, structure, users, plans, billing, limits, onboarding, migration
tools, localisation, support, privacy, demo tenant, platform console. Read-only. Working tree
`claude/tyrepulse-inspector-build-7rxp2t` at `6d54c6fb` (main is `af2ff56b`; the uncommitted differences are
console and Flutter files and do not change any finding here). Database: project `jhssdmeruxtrlqnwfksc`,
SELECT only, no impersonation writes.

## 1. The two verdicts

**Internal Production Readiness (current company): READY, with one live trap (CF-08).**
The commercial layer is dormant for the current tenant: 0 subscriptions, 0 invoices, plan limits inert,
sign-up lands people in the existing company by design. Nothing in this area blocks daily work. One click path
can switch the dormant limit on against the current company and stop new vehicles being added.

**Commercial SaaS Readiness (a new company from zero): NOT READY. Class 4 overall.**
A second company cannot be created, joined, billed or limited without a platform operator working in the
console and in SQL. Tenant data isolation (the org wall) is strong and was audited separately. What is missing
is everything around it: the front door, the money, and the per-tenant configuration. Six items are P0 or P1
blockers and must be fixed before a contract is signed with a second company. A managed, operator-assisted
pilot for one friendly company is feasible after CF-01, CF-03, CF-04, CF-05, CF-08 and CF-09 are closed.

Counts by severity: P0 3, P1 9, P2 6, P3 2.

## 2. Live facts this audit rests on (VERIFIED by SQL, 2026-11-12)

| Fact | Value |
|---|---|
| Organisations | 5: Default Organisation (id ends 0001; 768 profiles, 1,618 vehicles, 11,242 tyre rows, 96,941 job cards, 218,776 expense lines, 67 sites), Tyre Pulse Demo Fleet (1 profile, 4 vehicles, 18 tyres, 3 inspections, 3 job cards, 2 accidents, 2 sites), and three empty shells named after countries |
| Profiles | 768, all approved, 2 super admins, 773 of 781 auth users use a synthetic email |
| `subscription_plans` | 4 rows: trial (25 vehicles, 3 users), starter (USD 49, 100 vehicles, 10 users), professional (USD 199, 750, 50), enterprise (no caps, price 0) |
| `org_subscriptions`, `invoices` | 0 and 0 |
| `organisation_memberships` | 1 row |
| `onboarding_tasks`, `user_issues`, `account_deletion_requests`, `support_sessions`, `org_units`, `api_keys`, `currency_rates` | all 0 |
| `country_currency` | 3 rows (KSA SAR base, UAE AED, Egypt EGP), one global table, no organisation column |
| `module_permissions` | 1,346 rows, every one global (`org_id` null), 0 per organisation |
| `custom_roles` | 33, all belonging to the current company |
| `modules` | 197 rows, 122 live, 75 disabled, one global table |
| `system_config` | `single_tenant_mode=true`, `registration_open=true`, `require_approval=true`, `default_currency=SAR`, `max_users_per_org=500` |
| Tables in `public` | 485, of which 388 carry an organisation column |
| Functions that hard-code the current company's id | 20 |
| Functions that contain a literal KSA, UAE or Egypt | 21 |

## 3. Capability table

Internal status: ready / at risk / broken. Commercial class: 1 to 6 as defined in the brief.

| # | Capability | What exists (reuse this) | Internal | Commercial class | Main gap | Findings |
|---|---|---|---|---|---|---|
| 1 | Company creation | `organisations` table; Console Organisations page inserts a row (`src/console/pages/ConsoleOrganisations.jsx:160`); RPC `create_workspace_owner` live in the database but not executable by anyone | ready | 4 | No path a customer can use; operator path creates an empty shell with no owner, no subscription, no sites | CF-02 |
| 2 | Tenant data isolation | RESTRICTIVE org policies on 388 tables, `app_current_org()` | ready | 2 | Covered by the RLS audit; residual global objects listed in CF-05, CF-09, CF-13 | CF-05, CF-09 |
| 3 | Country management | `COUNTRIES` constant, `country_currency`, `profiles.country[]`, country RLS | ready | 4 | Three countries are compiled into the web app, the sign-up trigger and 21 SQL functions | CF-11 |
| 4 | Site and branch management | `sites` (org scoped, typed, with region), Site Management page, Sites intake, `site_aliases` | ready | 2 | Works for a new company once it has a country that exists; `site_aliases` and store maps are global | CF-11 |
| 5 | Org hierarchy | `org_units`, `user_org_assignments`, Org Hierarchy page | ready (unused) | 4 | 0 rows, not enforced anywhere | none |
| 6 | Sign-up | Web `Login.jsx:336`, Flutter `self_registration_repository.dart:138`, trigger `handle_new_user` | ready | 4 | Every sign-up joins the current company | CF-01 |
| 7 | Invitations | Console "Invite user" drawer | ready | 4 | It only copies the login link (`PeopleTab.jsx:513`); there is no invitation record, token or email | CF-12 |
| 8 | Approval and user admin | Console Users, `admin_update_profile`, `admin_mobile_user_action`, `guard_profile_privileged_cols`, last-admin guard | ready | 3 | All user administration UI is in the super-admin console; a company's own Admin has no screen | CF-12 |
| 9 | Roles and permissions | 10 built-in roles, `custom_roles`, `module_permissions`, `user_access_grants`, Access Manager | ready | 3 | Role matrix is one global set; only the platform owner can edit it | CF-13 |
| 10 | Plans and packages | `subscription_plans`, `entitlements.js`, Billing page | ready (dormant) | 3 | Any company Admin can edit the plan catalogue; plan features are not enforced | CF-03, CF-05 |
| 11 | Module entitlements | `modules` status (global), feature flags, `planAllows()` | ready | 4 | No per-company module switch; `planAllows` is only used to draw ticks on the Billing page | CF-05 |
| 12 | Trials, renewals, suspension, cancellation | `subscriptionAccess.js`, `SubscriptionGate`, `organisations.locked/active` | ready (dormant) | 4 | Nothing ends a trial; gate is browser only and fails open; lock flags are not read by any function | CF-07 |
| 13 | Payment | Edge functions `billing-checkout` (v11) and `billing-webhook` (v12), signature check | ready (dormant) | 3 | Never run; no idempotency, no invoice events, no upgrade path, self-activation hole | CF-04, CF-06 |
| 14 | Invoicing | `invoices` table, Billing page list | ready (dormant) | 4 | Nothing writes invoices; company Admin can write its own | CF-04, CF-06 |
| 15 | Usage limits | `enforce_plan_limit` on `vehicle_fleet` and `api_keys`, `org_can_add` | at risk | 3 | Users and storage not limited; trap for the current company | CF-08 |
| 16 | Setup wizard | `OnboardingWizard.jsx`, `onboarding_tasks`, `onboardingReadiness.js` | ready (unused) | 2 | Admin checklist with live readiness facts; starts empty, creates nothing | CF-14 |
| 17 | Excel and CSV import (generic) | `src/lib/import/*` (10 modules, templates, auto-detect, staging, reverse), Data Intake Center, Console Smart Import | ready | 2 | Tenant neutral; runs as the signed-in user so the org is correct | CF-10 |
| 18 | ERP intake and staging pipes | `/erp-intake`, `erpIntake.js`, `partsExpense.js`, 21 country staging tables, `process_stg_*` | ready | 6 | Built around one customer's Ramco exports and three countries; stamps the current company | CF-10 |
| 19 | Units, currency, localisation | `country_currency`, `currency_rates`, FX functions, en/ar (ur on Flutter), `organisations.timezone` | ready | 3 | Currency follows the hard-coded country list; no per-company units, timezone use or date format | CF-11 |
| 20 | Company settings | `organisations.settings` (guarded), branding RPC, `settings`, `app_settings`, `system_config` | ready | 3 | `settings`, `app_settings` and `system_config` are platform-global and super-admin only | CF-11 |
| 21 | Support and issue reporting | `user_issues`, `submit_user_issue`, Report a problem (web and Flutter), console Error Center, breach cron | ready (0 rows) | 2 | Works per organisation; never exercised; no customer-facing ticket history or SLA text | CF-15 |
| 22 | Audit | `audit_log_v2`, `access_audit`, audit seals, console Audit Trail | ready | 2 | Retention is one global number | CF-16 |
| 23 | Data export | Edge function `tenant-export`, console page, exports on every register | ready | 3 | Super admin only; 37 tables of 388; no storage files | CF-16 |
| 24 | Deletion | `account_deletion_requests`, `/data-deletion`, console queue, `admin_delete_empty_org` | ready | 4 | Request log only; no procedure deletes a person or a company with data | CF-16 |
| 25 | Demo tenant | Org "Tyre Pulse Demo Fleet" plus one Manager account | ready | 3 | Isolated but thin, hand-seeded, lives in the production database | CF-17 |
| 26 | Platform console | `/console`, about 60 pages, isolated session, 2FA, audit | ready | 6 | Strong for one tenant; missing "create company with owner and plan" and per-company billing actions | CF-02, CF-18 |

## 4. Findings

### CF-01 Every new sign-up is enrolled in the current customer's company
- Severity P0. Confidence VERIFIED.
- Evidence: live `handle_new_user()` inserts `org_id` and `organisation_id` = `00000000-0000-0000-0000-000000000001`
  and coerces region to KSA, UAE or Egypt, default KSA. `profiles.org_id` column default is the same id.
  `Login.jsx:340` sends `region: 'KSA'`. Trigger `on_auth_user_created` is enabled on `auth.users`.
- What happens: a person from a prospective customer who registers on the web or in the Flutter app becomes a
  pending Reporter inside the existing company. They appear in that company's user list. Once approved they
  see that company's KSA data.
- Internal: ready (this is the intended behaviour today). Commercial: class 4.
- Impact on a second company: there is no way to register into any other company. Approving the wrong person
  would be a cross-company data disclosure caused by the design, not by a bug in RLS.
- Fix: extend `handle_new_user` to resolve the organisation from a signed invitation or company join code
  carried in sign-up metadata (see CF-12); when none is present and `single_tenant_mode` is true keep today's
  behaviour; when false, create the profile with no organisation and no access.
- Risk to current company: low. With `single_tenant_mode=true` the path is byte for byte what runs now.
- Acceptance: (a) sign up with a valid invite for company B, profile lands in B, pending; (b) sign up with no
  invite while single-tenant mode is on, lands in the current company as today; (c) with the mode off and no
  invite, profile has null org and reads 0 rows from every table.
- Area: DB, web, Flutter.

### CF-02 There is no working way to create a company with an owner
- Severity P0. Confidence VERIFIED.
- Evidence: `create_workspace_owner(p_org_name, p_kind)` exists live (PROJECT_MEMORY says it was never applied;
  that note is stale) but `has_function_privilege('authenticated', ...)` is false, so every call is refused.
  Its only caller is the unused stub `src/lib/api/onboarding.js:223`. No page calls it. The console path
  (`ConsoleOrganisations.jsx:160`) inserts only the `organisations` row.
- What a console-created company gets: a name. No owner, no `org_subscriptions` row, no sites, no country, no
  roles. An operator must then move a user in with `admin_update_profile(p_org_id)` and set role Admin.
- Defects in the RPC to fix before it is ever granted: it runs `ALTER TABLE profiles DISABLE TRIGGER` inside
  the function, which takes an exclusive lock on the table every signed-in user reads; it refuses an existing
  approved Admin but otherwise lets any pending Reporter of the current company leave and found a company; it
  sets no country and no site scope; it does not seed sites, currency or onboarding tasks.
- Internal: ready (unused). Commercial: class 4.
- Fix: one console action "Create company" built on the existing Organisations page that calls a new
  super-admin-only RPC wrapping the same steps (organisation, owner profile, membership, trial subscription,
  primary country, first site, starter onboarding tasks). Replace the trigger disable with a transaction-local
  setting that `guard_profile_privileged_cols` honours. Keep self-serve creation off until billing is proven.
- Risk to current company: none for the console action (new code path). Medium if the existing RPC is granted
  as it stands, because of the table lock and because current users could detach themselves.
- Acceptance: operator creates company B with owner email; owner signs in, sees an empty app, 0 rows of the
  current company, a trialing subscription and one site.
- Area: DB, console.

### CF-03 Any company Admin can rewrite the global plan catalogue
- Severity P0. Confidence VERIFIED (policy text; not exercised, writes are forbidden in this audit).
- Evidence: policy `subscription_plans_admin_write` is FOR ALL with the only condition "caller's role is
  Admin". There is no organisation or super-admin test and no RESTRICTIVE write policy on the table.
- What happens: the Admin of any tenant can set `price_monthly` to 0, raise `max_vehicles`, or flip features
  for every tenant. `billing-checkout` reads the price from this table, so the checkout amount follows.
- Internal: at risk in theory only (both Admins are the platform owners). Commercial: class 3.
- Fix: change the write policy to `is_super_admin()`. Read stays open.
- Risk to current company: none. Nobody but the two super admins writes this table.
- Acceptance: as a tenant Admin, update of `subscription_plans` affects 0 rows; as super admin it succeeds.
- Area: DB.

### CF-04 A company Admin can give itself a paid plan and write its own invoices
- Severity P1. Confidence VERIFIED (policy text and absence of any trigger on the table).
- Evidence: `org_subscriptions_admin_write` is FOR ALL for the org's Admin; the only trigger on the table is
  `set_updated_at`. The guard "paid plans must go through checkout" lives only in the browser
  (`src/lib/api/billing.js:79`). `invoices_admin_write` has the same shape.
- What happens: one REST call sets `plan_code='enterprise', status='active'` or extends `trial_ends_at`.
- Internal: ready (no rows). Commercial: class 3.
- Fix: remove client write access to both tables; keep SELECT. Writes come only from the webhook (service
  role) and from two narrow RPCs: "schedule cancellation" for the org Admin and "set plan" for super admin.
- Risk to current company: none (0 rows, Billing page reads only). `changePlan` and `setCancelAtPeriodEnd`
  must be repointed to the RPCs in the same change.
- Acceptance: tenant Admin PATCH on `org_subscriptions` returns 0 rows; cancel-at-period-end still works.
- Area: DB, web.

### CF-05 Module availability and plan features are platform-wide, not per company
- Severity P1. Confidence VERIFIED.
- Evidence: `modules` has no organisation column; policy `modules_write` allows `is_super_admin() OR role =
  'Admin'` with no org test, so a tenant Admin can disable a module for all tenants. `planAllows()` is called
  in exactly one place, `Billing.jsx:434`, to draw the feature ticks. No route, RPC or policy reads
  `subscription_plans.features`. The 75 modules disabled today are disabled for every future tenant too.
- Internal: ready. Commercial: class 4.
- Fix: (1) restrict `modules_write` to super admin now; (2) add an `org_module_entitlements` overlay read by
  the existing `ModuleRoute` and by `app_user_can`, defaulting to "follow the global status" so the current
  company sees no change; (3) derive the overlay defaults from the plan.
- Risk to current company: none for step 1. Low for step 2 if the default is "inherit".
- Acceptance: module off for company B stays on for the current company; tenant Admin cannot write `modules`.
- Area: DB, web, Flutter (module registry reads the same source).

### CF-06 Payment path has never run and is incomplete for real subscriptions
- Severity P1. Confidence VERIFIED for code, NOT VERIFIED for whether Stripe secrets are set (no access to
  edge function secrets; only names were read).
- What is good: signature is HMAC-SHA256 over `t.payload`, constant-time compare, 5 minute tolerance, 503 when
  the secret is missing, 500 on handler error so Stripe retries, redirect origin comes from `APP_URL` and not
  from the request, only an approved Admin can start checkout, price is read server side.
- Gaps:
  1. Handled events are only `checkout.session.completed`, `customer.subscription.updated`,
     `customer.subscription.deleted`. `invoice.paid`, `invoice.payment_failed`, `invoice.finalized` are not
     handled, so `invoices` can never fill and a failed renewal is seen only when Stripe later changes the
     subscription status.
  2. No idempotency: no table of processed event ids. Upserts make replays mostly harmless, but events that
     arrive out of order can move a subscription backwards (an old `updated` after a `deleted`).
  3. `checkout.session.completed` does not check `payment_status` and writes the period end from the clock,
     not from Stripe.
  4. An existing subscriber who upgrades gets a second Stripe subscription; nothing cancels or swaps the
     first. There is no customer portal link, no proration, no seat quantity, no card update path.
  5. Each checkout creates an inline product (`price_data`), so Stripe reporting has no stable products.
  6. If the caller's profile has no organisation, `org_id` is sent as an empty string and the webhook upsert
     fails on the uuid cast forever (500 loop).
  7. Prices are USD only; no VAT or tax id handling (KSA and UAE customers will ask for a tax invoice).
  8. Stripe status `unpaid`, `incomplete`, `paused` all map to `expired`; `suspended` used by
     `subscriptionAccess.js` is not allowed by the table CHECK, so it can never be stored.
- Internal: ready (dormant). Commercial: class 3.
- Test-mode run needs (names only): `STRIPE_SECRET_KEY` (test key), `STRIPE_WEBHOOK_SECRET` (test endpoint
  secret), `APP_URL`, plus the standard `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `ALLOWED_ORIGINS`. Must run against the test environment, never the production project.
- Fix: add a `billing_events` table keyed on the Stripe event id; handle the three invoice events and write
  `invoices`; store Stripe price ids on `subscription_plans`; use the Stripe customer portal for upgrades and
  cards; reject checkout when the org is null. Decide tax handling with the owner.
- Risk to current company: none (no subscription row, functions are not called).
- Acceptance: in Stripe test mode, checkout, renewal, failed payment, upgrade and cancel each leave exactly
  one correct row in `org_subscriptions` and `invoices`, and replaying any event changes nothing.
- Area: edge fn, DB, web, owner action (Stripe account, tax decision).

### CF-07 Trials never end and suspension is not enforced on the server
- Severity P1. Confidence VERIFIED.
- Evidence: none of the 27 cron jobs touches `org_subscriptions`. `SubscriptionGate.jsx` is the only consumer
  of the status; it fails open and never blocks an Admin (lines 137 to 152). No SQL function references
  `organisations.locked` or `organisations.active` (0 matches), and `app_is_active()` reads only the profile.
  The mobile apps do not read subscription state.
- What happens: a trial stays `trialing` for ever; a locked or cancelled company keeps full API and mobile
  access; only non-admin web users would see a block screen.
- Internal: ready. Commercial: class 4.
- Fix: a daily job that moves expired trials to `expired`; one SQL helper `org_in_good_standing()` used by
  `app_is_active()` so a locked or expired company loses writes at the database. Read-only access and export
  must stay available during a grace period.
- Risk to current company: medium if done carelessly, because `app_is_active()` gates every table. Make the
  helper return true when the org has no subscription row and is not locked, which is the current company's
  state, and ship it behind a config switch.
- Acceptance: company B trial passes its end date, next day writes are refused on web and mobile, reads and
  export still work; the current company is unaffected with the switch on.
- Area: DB, web, Flutter.

### CF-08 One click can turn the vehicle limit on against the current company
- Severity P1. Confidence VERIFIED for the database chain, PLAUSIBLE for the exact button.
- Evidence: `ensure_org_subscription()` is executable by any signed-in user and inserts a trial row for the
  caller's org. `enforce_plan_limit` (on `vehicle_fleet` and `api_keys`) becomes active the moment that row
  exists. Trial cap is 25 vehicles; the current company has 1,618. The `billing` flag defaults on and the
  Billing page is in the Admin menu; `changePlan({planCode:'trial'})` calls `ensure_org_subscription`.
- What happens: after that row exists, every new vehicle insert by a signed-in user fails with "Plan limit
  reached". Service-role imports are exempt, in-app adds and imports are not.
- Internal: at risk. Commercial: class 3 (limits also miss users and storage: `max_users` is displayed only;
  the overview counts 768 users against whatever the plan says but nothing blocks).
- Fix: insert an explicit enterprise or "legacy" subscription row for the current company (no caps) so the
  state is deliberate, and revoke `ensure_org_subscription` from `authenticated`. Add the users limit to the
  approval step (not to sign-up) for new tenants.
- Risk to current company: low. The row removes the trap; enterprise has null caps so nothing is blocked.
- Acceptance: current company can still add a vehicle after any Billing page action; company B on trial is
  refused at vehicle 26 and at user 4.
- Area: DB, owner action (confirm the plan label for the current company).

### CF-09 Some identifiers are unique across all companies
- Severity P1. Confidence VERIFIED.
- Evidence: `work_orders UNIQUE (work_order_no)`; `profiles UNIQUE (username)` plus unique lower(username)
  and lower(employee_id) indexes; `ux_sites_org_country_name` coalesces a null org to the current company.
- What happens: company B importing job card `JC-0001` fails or, through the importer's merge-on-key path,
  targets a number that already belongs to another company (RLS hides the row, so the insert collides with a
  row the user cannot see). Usernames and employee ids such as `1001` or `ahmed` can be held by only one
  person on the whole platform, and "already taken" reveals that another company uses it. Login is by
  username or employee id, so this is the sign-in namespace.
- Internal: ready. Commercial: class 3.
- Fix: make job card uniqueness `(organisation_id, work_order_no)` and repoint the `on conflict` clauses in
  `process_stg_job_cards` and the importer; for login either scope username and employee id per organisation
  with a company code at sign-in, or state that usernames are global and add a company prefix.
- Risk to current company: medium for job cards (the staging trigger and the in-app merge both rely on the
  global key; must be changed together and tested with a re-import). Low for usernames if the current
  company keeps a default company code.
- Acceptance: two companies hold the same job card number and the same employee id; each signs in and sees
  only its own.
- Area: DB, web, Flutter, edge fn (`sign-in`).

### CF-10 Import tools: the generic importer is sellable, the ERP path belongs to one customer
- Severity P1. Confidence VERIFIED for code and functions, PLAUSIBLE for the country pipe behaviour.
- Evidence, generic and reusable: `src/lib/import/` (parse, detect module, synonyms, mapping profiles,
  validate, staging in `import_batches`/`import_rows`, `import_commit_batch`, `import_reverse_batch`, CSV
  templates in `templates.js`) covers fleet, tyre, stock, accident, inspection, work order, warranty, gate
  pass, supplier, driver. It writes as the signed-in user, so the org is right for any tenant.
- Evidence, customer specific: `erpIntake.js` and `partsExpense.js` parse Ramco report layouts including the
  misspelled `Trye` header; job card prefixes AFKR, GCKR, RM, EG decide country; 21 staging tables are named
  `_ksa`, `_uae`, `_egypt`; `process_expenses_country` falls back to the current company id;
  `stamp_import_default_org` stamps the current company on 13 tables while `single_tenant_mode=true`;
  `process_stg_assets` skips an asset when the same asset number exists in the same country in any company
  (no org in its duplicate test); `_stg_country_pipe` picks "the oldest organisation whose country matches"
  when there is no session; `brain_*` classifier tokens and code ranges come from this customer's item codes;
  `get_login_showcase` (anon executable) returns the current company's fleet counts.
- Internal: ready. Commercial: generic importer class 2; ERP intake, staging pipes and Supabase dashboard
  imports class 6 (internal tools for the current customer and the operator).
- Fix: sell the generic importer only. Hide `/erp-intake`, `/erp-import` and the staging workbook from other
  tenants with the entitlement overlay of CF-05. Before a second tenant exists: add the org to the duplicate
  test in `process_stg_assets`, make the country pipe refuse when there is no session org, and scope the
  classifier cache and material master per org (the tables already carry the column). Keep
  `single_tenant_mode` true until then; dashboard CSV imports stay an operator tool.
- Risk to current company: low. All changes keep the current org as the resolved org for its own users.
- Acceptance: company B imports the fleet template with asset numbers that also exist in the current
  company; all rows land in B; no row is skipped; the current company's counts do not move.
- Area: DB, web.

### CF-11 Countries, currency and settings are compiled in for KSA, UAE and Egypt
- Severity P1. Confidence VERIFIED.
- Evidence: `SettingsContext.jsx:21-22` hard-codes `COUNTRIES` and `COUNTRY_CURRENCY`; `COUNTRIES` is imported
  by 54 source files and the literal `'KSA'` appears 77 times in `src`; `handle_new_user` accepts only those
  three; `country_currency` is a global 3-row table; `currency_rates` is empty; plans are priced in USD while
  `default_currency` is SAR; `settings`, `app_settings`, `system_config` carry no organisation and are
  restricted to super admin; `workshop_status_timezone` is one global value (Asia/Riyadh);
  `organisations.timezone` exists but nothing reads it for date maths; week boundaries are GCC Sunday to
  Saturday in code; distance is km only.
- What happens: a company in Qatar, Kuwait, Oman, Jordan, or outside the region cannot be configured without
  a code release. A company that operates only in UAE still sees the three-country picker.
- Internal: ready. Commercial: class 3 for GCC customers in the three listed countries (class 2 there),
  class 4 for any other country.
- Fix: one source of truth for the country list: read `country_currency` (add the missing countries and an
  optional org-enabled subset on `organisations.countries`, which already exists and is empty) and have
  `SettingsContext` export the loaded list under the same names so the 54 importers do not change. Move
  timezone and week start to `organisations`. Keep the never-blend-currency rule.
- Risk to current company: low if the loaded list falls back to today's constant when the read fails.
- Acceptance: company B enabled for Qatar only sees one country, QAR labels, and can sign users up there;
  current company still sees three.
- Area: DB, web, Flutter.

### CF-12 No invitation flow and no user administration for a company's own Admin
- Severity P1. Confidence VERIFIED (code), PLAUSIBLE that no other tenant-admin user screen exists.
- Evidence: "Invite user" copies `origin/login` to the clipboard (`PeopleTab.jsx:513`). Main-app `/users`,
  `/admin`, `/master-access-control` redirect to `/console/*` (`App.jsx:760, 870, 886`), which admits only
  super admins. Sign-up uses a synthetic email for most accounts (773 of 781), so there is no email to send
  an invitation to and password recovery goes through "ask my admin". Bulk accounts for the current company
  were created by an operator script (`scripts/provision-driver-accounts.mjs`).
- What happens: company B's Admin cannot approve, assign a role, set country or site scope, lock or reset a
  password for its own staff. The database would allow it (`guard_profile_privileged_cols` lets an Admin
  manage users in its own org) but there is no screen. Every user change needs the platform operator.
- Internal: ready (the owners are the super admins). Commercial: class 4.
- Fix: an `org_invitations` table (org, role, country, sites, code, expiry, uses) read by `handle_new_user`
  (CF-01), and a tenant "Team" page in the main app that reuses the console People components against
  org-scoped RPCs. Do not open the console to tenants.
- Risk to current company: none (additive).
- Acceptance: company B Admin creates an invite, a new person signs up with it and is pending in B with the
  invited role; B Admin approves; no super admin involved.
- Area: DB, web, Flutter.

### CF-13 The role and permission matrix is shared by all companies
- Severity P2. Confidence VERIFIED.
- Evidence: all 1,346 `module_permissions` rows have `org_id` null; the writers are super-admin only;
  `normalize_profiles_role` accepts a role name if it exists in `custom_roles` of any organisation; the 33
  custom roles are the current company's trades (for example "Ice Plant Technician").
- What happens: company B gets the current company's role defaults, cannot change them, and a change made
  for one company changes all. B's role picker (if it read custom roles of other orgs through a definer
  function) would be wrong; through RLS it is empty, so B has only the 10 built-in roles.
- Internal: ready. Commercial: class 3.
- Fix: the reader already supports per-org rows. Seed a standard matrix per new org at creation and let the
  tenant Admin edit only its own rows; make the role-name check org aware.
- Risk to current company: low (its global rows stay as the fallback).
- Area: DB, console, web.

### CF-14 Setup wizard is a checklist, not a setup
- Severity P2. Confidence VERIFIED.
- Evidence: `OnboardingWizard.jsx` (Admin only) lists `onboarding_tasks` (0 rows) and shows readiness facts
  from `onboardingReadiness.js`. It does not create the company profile, countries, sites, currency or
  users, and there is no starter task set, so a new company opens an empty page.
- Internal: ready (unused). Commercial: class 2.
- Fix: seed a standard task list at company creation (CF-02), each task linking to the existing page (sites
  intake, import templates, team page). No new wizard engine.
- Risk to current company: none.
- Area: DB, web.

### CF-15 Support and issue reporting exists and is untested
- Severity P2. Confidence VERIFIED (code and RPC present), NOT VERIFIED end to end (0 rows; a write test is
  forbidden here).
- Evidence: `submit_user_issue` stamps the reporter's org; console Error Center lists across orgs for super
  admins; breach check cron runs every 30 minutes. `support_email` is one global value.
- Internal: ready. Commercial: class 2. Gap: no published support hours or response targets, no customer
  view of open tickets beyond "my issues", no status page link configured (`VITE_STATUS_PAGE_URL`).
- Fix: exercise it in the test environment; write the support policy. Risk to current company: none.
- Area: ops, owner action.

### CF-16 Privacy lifecycle is partial: export is operator-only and incomplete, deletion is a log
- Severity P2. Confidence VERIFIED.
- Evidence: `_tenant_export_tables()` returns 37 tables; 388 tables carry an organisation column. Profiles,
  checklist templates, accident sub-tables, workforce tables, approvals and every storage bucket are outside
  the export. The function is super-admin only. `ConsoleAccountDeletions.jsx:11` states the page records
  status and deletes nothing. `admin_delete_empty_org` works only for an empty company. Audit retention
  (365 days) and data retention are single global values; the cleanup tool is platform-wide.
- Internal: ready. Commercial: class 3 for export, class 4 for deletion and offboarding.
- Fix: extend the export table list (derive it from the catalog: every table with an organisation column
  minus an exclusion list) and add storage objects; write and test an "offboard company" runbook (export,
  confirm, delete by org in dependency order, delete auth users); make retention per org. A data processing
  agreement and a data residency statement (the database is in Tokyo, `ap-northeast-1`) are owner actions.
- Risk to current company: none for export changes; deletion tooling must be super-admin only and refuse the
  current company's id unless typed in full.
- Area: DB, edge fn, console, owner action.

### CF-17 Demo tenant is isolated but too thin and lives in production
- Severity P2. Confidence VERIFIED.
- Evidence: its own organisation id, one approved Manager (KSA, all sites, not super admin), 4 vehicles, 18
  tyre rows (all priced), 3 inspections, 3 job cards, 2 accidents, 2 sites, 0 expense lines, 0 stock, 0 meter
  readings, no subscription row. No seed script exists in the repository (only two documents mention it), so
  it cannot be rebuilt. It shares the database, auth and storage with the customer.
- What a prospect sees: most cost, CPK, expense and stock screens empty or N/A.
- Internal: ready (used for store review). Commercial: class 3.
- Fix: a repeatable synthetic seed (see TEST_ENVIRONMENT_PLAN.md) used for both the test environment and the
  demo org; reset on a schedule. Never copy customer rows.
- Risk to current company: none if the seed always sets an explicit organisation id and refuses the current
  company's id.
- Area: DB, ops.

### CF-18 Leftover and duplicate organisation state
- Severity P3. Confidence VERIFIED.
- Evidence: three empty organisations named after countries with `plan='starter'`; the live company and the
  demo carry `organisations.plan='standard'`, a code that does not exist in `subscription_plans`;
  `organisations.plan` and `max_users` duplicate `org_subscriptions`; `organisation_memberships` (1 row) is
  writable by any Admin, Manager or Director with no org test and is read by `create_workspace_owner`.
- Fix: archive the three shells with `admin_archive_empty_org`; treat `org_subscriptions` as the only plan
  source; scope the memberships write policy. Risk to current company: none. Area: DB, console.

### CF-19 Marketing and pricing do not match the plan table
- Severity P3. Confidence VERIFIED.
- Evidence: `marketing/app/pricing/page.tsx:53` offers "Request pricing" and a contact form; there is no
  register or trial link. The plan table holds USD 49 and USD 199 self-serve prices and a 14 day trial.
- This is consistent with a sales-led launch. Decide which model is real and remove the other.
- Area: owner action, marketing.

## 5. The new-customer journey as it would run today

| Step | Today | What blocks or needs an operator |
|---|---|---|
| 1. Visit the site | Works | Marketing site is live; pricing is "request a quote" |
| 2. Register | Blocked | Sign-up creates a pending Reporter inside the current company (CF-01) |
| 3. Create company | Operator only | Super admin inserts the organisation in the console, then moves the user and sets role Admin by RPC (CF-02) |
| 4. Choose plan | Blocked for customers | Billing page shows plans; with no subscription row the company is treated as an open-ended trial with no end date (CF-07) |
| 5. Pay | Blocked | Stripe never configured or run; if secrets are missing checkout answers "not configured" (CF-06). Operator alternative: none safe today; a manual SQL insert of the subscription row |
| 6. Invite users | Operator only | No invitations; staff self-register into the wrong company (CF-01); operator must move each one and approve; the company Admin has no user screen (CF-12) |
| 7. Countries, sites, currency | Partly works | Sites: works in Site Management and Sites intake once the Admin exists. Countries: only KSA, UAE, Egypt. Currency: follows that list (CF-11) |
| 8. Import fleet | Works | Data Intake Center with the fleet template, as the company Admin. Asset numbers are unique per org and country, so no collision |
| 9. Add tyres | Works | Tyre template or manual entry. Job card numbers can collide across companies (CF-09) |
| 10. First inspection on mobile | Works with operator help | Flutter app is in closed testing; the user needs a role with the inspect module in the global matrix; push, AI and checklists templates are org scoped and start empty |
| 11. First report | Works, mostly empty | Dashboards render honest N/A. Expense-based reports need the expense grid, whose intake is Ramco specific (CF-10) |

Summary: steps 1, 8, 9 and 11 work; 3, 6, 7 and 10 work only with a platform operator; 2, 4 and 5 are blocked.

## 6. Recommended order (each is additive for the current company)

1. CF-03, CF-04, CF-05 step 1, CF-18 memberships policy: four policy changes. Risk none.
2. CF-08: explicit unlimited subscription row for the current company, revoke `ensure_org_subscription`.
3. CF-02 and CF-12 and CF-01 together: console "Create company", invitations, org-aware sign-up, tenant Team page.
4. CF-09 and CF-10: per-org keys and import guards.
5. CF-06 and CF-07 in the test environment with Stripe test mode, then production.
6. CF-11, CF-13, CF-14, CF-16, CF-17.

## 7. Not verified

- Whether `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `APP_URL` are set on the project (no secret access).
- Whether the deployed `billing-checkout` and `billing-webhook` match the repository byte for byte.
- Any write behaviour (policies were read, not exercised): CF-03, CF-04, CF-05 are proven from policy text.
- The exact Billing page control that calls `changePlan('trial')` (CF-08); the database chain is proven.
- Flutter and Expo handling of a user whose organisation is empty or new (code not traced end to end).
- `ConsoleBilling.jsx` actions were not read in detail.
- Behaviour of `_stg_country_pipe` and the `process_stg_*` chain for a second tenant (read, not run).
