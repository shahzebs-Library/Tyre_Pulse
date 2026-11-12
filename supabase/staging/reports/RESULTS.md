# Tenancy findings: result after the drafted fixes (local PostgreSQL 16 staging)

Run date 2026-11-12. Database: a copy of the local staging database (`tyrepulse_staging_after`, three invented
companies), with these 13 drafts applied in order, all 13 applied, 0 failed (`pending_apply_report.txt`):
TEN-1, TEN-1b, TEN-2, TEN-3, TEN-4, TEN-5, TEN-6, TEN-7, TEN-8, TEN-9 (20261113100000 to 113000) and the three
additions TEN-4b (114000), TEN-5b (114500), TEN-7b (115000). Drafts of other workstreams were NOT applied in
this run. Nothing was applied to production. Raw output: `tests_before.json`, `tests_after.json`.

Isolation checks A to D (cross-company read and write, country scope, empty company): 35 of 35 pass before
and after. PGlite suite `supabase/tests/tenant_isolation_ten*.test.mjs` on the drafts branch: 57 of 57 pass.

Status words: Verified Fixed = the reproduction no longer succeeds on real PostgreSQL and a control shows the
current company path still works. Blocked = the mechanism is verified, but part of the finding stays open on
purpose until an owner decision; the open part is named.

| Finding | Status | Evidence (after-state, from `tests_after.json`) |
|---|---|---|
| TEN-1 job card import overwrites another company work order | Verified Fixed | Alpha asset after=['MP001'] was=MP001; Beta row with the same job card number created=True |
| TEN-2 raw upload tables readable by any company Admin | Verified Fixed | beta.admin count=0; control alpha.admin count=1 |
| TEN-3 customer Admin changes platform-wide configuration | Verified Fixed | modules rows=0, subscription_plans rows=0, due_alert_rules rows=0 |
| TEN-4 admin RPCs act on a user in another company | Verified Fixed | admin_set_user_sites: sites after=['ALL'] "not authorized"; admin_set_web_access: web_access after=True; get_user_module_permissions for a foreign id: module keys returned=0 "not authorized" (TEN-4b); control own map keys=78, same-company Admin keys=78 |
| TEN-5 customer Admin grants itself any plan | Verified Fixed | org_subscriptions rows=0 "Plan, status, seats and billing period are managed by the platform."; organisations: plan after=starter max_users after=100 rows=0 "Plan, status and limits are managed by the platform." (TEN-5b) |
| TEN-6 subscription state and plan limits are not enforced | Blocked | With entitlement_enforcement = on: locked Beta manager reads 0 vehicles; company with no subscription row inserted 0 vehicles; overview no longer reports an endless trial. As shipped (switch off, deliberate, protects the current company): the locked company already reads 0 vehicles, but a company with no subscription row still inserted 30 vehicles and the overview still reports a usable plan with no end date. Blocked on the owner turning the switch on |
| TEN-7 second tenant shares and is shaped by global configuration | Blocked | Closed: mailbox keys visible to beta.manager=0, control alpha.manager=2 (TEN-7b); "BETA NEW-ST" stored as "BETA NEW-ST"; Alpha-only role stored for a Beta user=Reporter. Still open, held by design: beta.manager reads the 538 global role matrix rows (the starter matrix for built-in roles, and how the current company resolves access today). Blocked on the owner confirming decision D1 of the TEN-7 draft; not closable without changing the current company |
| TEN-8 sign-ups and service loads fall back into the first company | Blocked | With single_tenant_mode = false: sign-up with no invitation got organisation=None; service insert refused ("Import refused: organisation_id is null, tp.import_org is not set and single_tenant_mode is off"). As shipped (single_tenant_mode = true, deliberate, current company behaviour): sign-up and service load both still land in Alpha. Blocked on the owner setting the switch to false |
| TEN-9 no safe tenant lifecycle | Blocked | org_invitations exists=True; functions present=admin_provision_organisation, admin_purge_organisation, org_invite_member. Still open as a documented design hold: global unique keys on profiles username remain (profiles_username_key, profiles_username_lower_uidx, ux_profiles_username_lower), because sign-in resolves a user by username alone. Blocked on sign-in taking a company code |

No finding is Verified Failed. No finding is Not Tested.

## Current company unchanged (measured on the same two databases)

Compared before and after for alpha.admin, alpha.manager, alpha.director, alpha.tyreman, alpha.driver and
platform.superadmin: md5 of `get_user_module_permissions()` identical for all six; count of visible
`accident_email%` keys identical (4, 4, 4, 1, 1, 4); count and md5 of every other visible `system_config` key
identical. beta.manager went from 4 to 1 visible `accident_email%` keys (the remaining one is the
`accident_emails_enabled` switch, read level all, not a mailbox address).

## Not verified here

- Nothing ran against production or a hosted Supabase project. PostgreSQL 16 locally, production is 17.6.
- Auth, PostgREST and edge functions are database stand-ins: the server-side branch of TEN-4b (service role
  JWT, no user) was exercised on PGlite only, not through a real API gateway.
- The web and mobile clients were not run against the after-state database. Client readers were checked by
  reading the source: every caller of `get_user_module_permissions` passes no argument; the accident mailbox
  is read by `src/lib/api/accidentWorkflow.js` (current company elevated users) and the console (super admin).
- The seed holds only built-in role rows in the global matrix, so "a custom role row of the first company is
  not served to another company" is proven on PGlite (TEN-7 test), not on this database.
