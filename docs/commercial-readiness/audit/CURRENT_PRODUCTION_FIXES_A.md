# Current production fixes, set A: permissions, refused saves and KPI targets

Date: 2026-11-12. Repo: working tree on the current branch. Database: production
(project jhssdmeruxtrlqnwfksc), read-only.

Covers MODB-3, MODB-7, MODC-03, MODC-04, MODA-7, MODA-8. The investigation of the open corrective
actions and the sign-off queue (MODB-14) is in `STUCK_WORK_INVESTIGATION.md`.

## How to read this

- **CONFIRMED** means reproduced: either by calling the live permission functions while
  impersonating real accounts inside a transaction that was rolled back, or by running the failing
  statement against a byte-exact copy of the live function or index (PGlite). **INFERRED** means
  read from code and catalog only.
- Nothing was written to production. No migration was applied, nothing was deployed, no git
  command that changes history or the index was run.
- One probe used a temporary table inside a rolled-back transaction to collect its output. It left
  nothing behind. Every other probe was a plain SELECT.
- Database changes are drafts in `supabase/pending_migrations/` (2 files). The web changes work
  against the database exactly as it is today and stay correct after the drafts are applied.

## The one cause behind most of these

Two things were wrong together, on several screens:

1. **The screen and the database disagreed about who may write.** Pages decided with a role list
   written in the page (or showed the control to everyone). The database decides with row policies,
   and for several tables the policy is a capability (`app_user_can`) whose default is "no" for
   every role except Admin. The browser's own capability check (`hasCapability`) defaults to "yes"
   for any module a role can open, so it cannot be used to predict the database.
2. **A refused change was silent.** Row security refuses an UPDATE or DELETE by matching zero rows.
   It raises no error. Services that did not ask for the changed rows back reported success.

The fix has the same two halves everywhere:

- `src/lib/writeAccessRules.js` is a single mirror of the live write policies (read from
  pg_policies on 2026-11-12, pinned by a test). `src/hooks/useWriteAccess.js` combines it with the
  server's own answer from `app_user_can` (`src/lib/api/writeAccess.js`), which is the function the
  policies call. Controls the database would refuse are disabled, with the reason in the tooltip.
- `src/lib/api/writeGuard.js` (`expectRows`, `refuseEmpty`): every guarded write asks for the
  changed ids back, and zero rows becomes a refusal the page shows. The message carries no database
  code, so `toUserMessage` passes it through as written.

A failed permission check never hides a control (it stays enabled and the save reports the
refusal), with one deliberate exception: the budget editors stay read-only until the server
confirms the right.

Live user counts used below (active accounts): Admin 2 (both super admins), Manager 3 (2 in Company
A, 1 in a second organisation), Director 0, Tyre Data Collector 7, Data Monitor Officer 1, Workshop
Supervisor 7, Maintenance Supervisor 1, Tyre Man 17, Inspector 2, Reporter 3, Fleet Supervisor 3,
PMV Manager 1, Workshop Maintenance Area Manager 1, Driver 674.

---

## Issue 1. Managers are refused when creating work orders or using Workshop Live Control (MODB-3)

**Status: CONFIRMED.**

**Root cause.** `work_orders` has no role policy for INSERT or UPDATE. The only permissive write
policies are `work_orders_cap_insert` (`app_user_can('work_orders','create')`) and
`work_orders_cap_update` (`app_user_can('work_orders','edit')`). `app_user_can` answers for a
non-admin from the organisation's stored capability matrix and falls back to false when the matrix
is silent. Impersonating every live Manager (rolled back): `app_user_can('work_orders','create')`
and `('work_orders','edit')` are both **false**, while `app_is_elevated()` is true.

- Company A (2 Managers): the stored matrix holds Manager work_orders create=false, edit=false.
- Second organisation (1 Manager): no matrix at all, so the fallback false applies.

The same screen is half open: assigning a technician and managing tasks write `wo_assignments`,
`wo_tasks` and `tech_activity_events`, whose policies use `app_is_elevated()` (admin, manager,
director). So a Manager could assign a job but not create it, move its status, set its priority,
flag Vehicle Off Road or pass QC. And because the job itself could not be updated, the assignment's
follow-up stamp on the job (owner and status "Assigned") was dropped silently.

Two more defects made it look worse than a refusal:

- Job updates used `.select().single()`. A zero-row refusal came back as "Not found.", so a
  Manager was told the job in front of them did not exist.
- Nothing disabled the buttons, so the refusal arrived only after the form was filled.

Who can write work orders today: 2 Admins, 7 Tyre Data Collectors, 1 Data Monitor Officer (their
matrix rows say true). In the last 30 days every work order change in the audit log came from an
Admin or an import.

**Impact on current users.** 3 Managers cannot create or edit a job card or use the job-level
actions in Workshop Live Control. They also cannot raise a job from a corrective action, which is
part of why 0 of 159 open actions has a linked job.

**The rule decided.** Admin, Manager and Director manage work orders (owner instruction,
2026-11-12). This reverses the 2026-09-30 decision recorded in PROJECT_MEMORY that the job card
register is written by Admin only, so the draft needs the owner's explicit yes before it is applied.
The capability matrix stays the single place the rule is set; what changes is its built-in default.

**Fix, database (draft, not applied).**
`supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql`

1. New `app_role_capability_default(role, module, capability)`: true only for Manager or Director
   on work_orders create or edit. Not executable by anon or authenticated.
2. `app_user_can` uses it instead of the hard-coded false when the organisation matrix has no
   value. One expression changes, by an anchored replacement on the live definition (md5 of the
   live body recorded in the file) that aborts unless the anchor is found exactly once.
3. Where a stored matrix says Manager work_orders create or edit = false, those two values are set
   to true so Access Control shows what is enforced. The previous settings are copied to
   `_bak.cur1_org_settings_20261113` first.

Precedence is unchanged: Admin, then a per-user revoke, then the organisation matrix, then the
built-in default, then a per-user grant. An Admin can still switch it off for Manager, or revoke it
for one person. Delete stays Admin only. Country, site and organisation walls are untouched.

Who gains: 3 Managers (0 Directors exist; a future Director gets it by default). Who loses: nobody.
No other module, capability or role changes.

**Fix, web (works today, before the draft).**

- `src/pages/WorkOrders.jsx`: New Work Order, Edit and the status buttons are disabled when the
  server says no, with the reason.
- `src/pages/WorkshopLive.jsx`, `src/components/workshop/WorkshopLiveParts.jsx`: New Job and the
  job-level controls (status, priority, Vehicle Off Road, QC pass and fail) are disabled with the
  reason. Assigning and tasks stay enabled because the database allows them.
- `src/lib/api/workOrders.js`, `src/lib/api/workshopLive.js`: updates ask for their rows back as a
  list; zero rows is "This job was not changed. Your account is not allowed to change work orders,
  or the job no longer exists." instead of "Not found.".

The pages ask `app_user_can`, so the buttons open by themselves the moment the draft is applied or
an Admin switches the capability on in Access Control. No second release is needed.

**Workaround available today without a migration.** An Admin can open Console, Access Control,
Role Permissions and switch on work orders create and edit for Manager. That makes the same change
as step 3 of the draft for Company A.

**Tests.**
- `supabase/tests/current_prod_work_orders_default.test.mjs` (PGlite, 4 tests, byte-exact copy of
  the live `app_user_can` in `supabase/tests/fixtures/current_prod_live_functions.sql`): reproduces
  the refusal and the silent zero-row update before; after, Managers and a Director create and
  edit; a Tyre Man still cannot; no other module opens; per-user revoke and a locked account still
  lose; another organisation's job is still out of reach; delete still Admin only; the matrix keeps
  its other values and its string shape; a backup row exists; an explicit false set later is
  obeyed; the function half is idempotent; the draft aborts on an unrecognised function body.
- `src/test/writeGuard.test.js`: every job and work order update throws on zero rows and no longer
  reads "Not found.".
- `src/test/useWriteAccess.test.jsx`: a refused Manager gets disabled controls; they open when the
  server allows it.

**Regression risk.** Web: low. Controls are only disabled when the server has answered no; an
unread answer leaves them as before. Draft: low for the current company (additive for 2 people);
`app_user_can` is used by the write policies of 11 tables, and the changed expression alters a
result only where the matrix is silent, for four role and capability combinations.

**Left as is, stated.** `stampJobOwner` (the owner and status stamp after an assignment) still
swallows its own failure by design so an assignment never fails. Until the draft is applied a
Manager's assignment is recorded but the job's owner field is not updated.

---

## Issue 2. KPI targets cannot be saved a second time (MODC-03)

**Status: CONFIRMED** against a copy of the live table rules (PGlite); catalog and code read on
production. Not reproduced by a production write.

**Root cause.** `kpi_targets` has two unique rules that disagree about blanks:

- `kpi_targets_metric_year_month_site_key UNIQUE (metric, year, month, site)`: NULL never equals
  NULL, so two rows with blank month and site do not conflict.
- `kpi_targets_scope_uidx` on `(metric, year, coalesce(month,0), coalesce(site,''),
  coalesce(lower(btrim(country)),''))`: blank counts as a value, so the same two rows do conflict.

Both savers (`src/lib/api/kpiTargets.js` for the KPI Center, `src/lib/api/settings.js` for
Settings) used `upsert(..., { onConflict: 'metric,year,month,site' })`. Targets are saved with
month and site blank, so the conflict target never matched the row saved last time, the upsert
became an INSERT, and the second index refused it (23505, shown as "A record with these details
already exists"). The first save of a year worked; every later save failed. All 7 live rows have
month and site NULL; they were last written in June.

**Impact on current users.** Anyone allowed to set targets (2 Admins, 3 Managers) cannot change a
KPI target after its first save, on either screen.

**Fix, web (works today, no migration).**

- `src/lib/api/kpiTargets.js`: new `saveKpiTargets`. It reads the stored targets for the year,
  matches each row on the same scope the database uses (metric, year, month, site, and country when
  given), updates the match by id or inserts when there is none. An update never rewrites who
  created the target or moves its metric or year. A refused update (zero rows) is returned as an
  error. `upsertKpiTargets` is kept as a name and delegates.
- `src/lib/api/settings.js`: the Settings saver delegates to the same writer (one KPI target
  writer, not two).
- `src/pages/KpiScorecard.jsx`: uses `saveKpiTargets`; the Edit targets button is disabled for
  roles the policy does not admit (the policy admits Manager and Admin).

**Fix, database (draft, not applied).**
`supabase/pending_migrations/20261113130500_cur_kpi_targets_org_scoped_key.sql` replaces both rules
with one that starts with the organisation, so two companies can each hold a target for the same
metric and year (the commercial half of MODC-03). It must be applied after the web release is live,
because an old open tab still sends the old upsert. No policy changes; nobody gains or loses access.
7 rows, all distinct under the new rule; the draft aborts if that stops being true.

**Tests.**
- `src/test/kpiTargetsSave.test.js` (6 tests): an in-memory table with the live uniqueness rule and
  silent zero-row refusal. First save inserts, second save updates in place (the case that failed);
  Settings can save twice; creator and scope are preserved; month, site and country are separate
  scopes; a refused update and a refused insert are both reported.
- `supabase/tests/current_prod_kpi_targets_key.test.mjs` (4 tests): the old upsert fails on the
  live indexes; a second company is refused today; after the draft both companies save and one
  company still cannot hold two rows for a scope; the draft aborts cleanly on existing duplicates.
- Two existing tests pinned the defect (`kpiTargets.api.test.js` and `settings.api.test.js`
  asserted the `onConflict` target). They now assert that no upsert is used and that the stored row
  is updated. The change is commented in each file.

**Regression risk.** Low. The save is now a read plus one write per target (7 targets at most on
these screens) and is not atomic: if one target fails, the ones before it are saved and the error
is shown. `tyreKpiTargets.js` (the tyre board) already saved this way and is untouched.

**Left as is, stated.** A target saved with no country gets the column default `KSA`. For a user
scoped to another country that insert is refused by the country policy, and the user sees the
permission message. Pre-existing; the screens should pass the active country. Not changed here.

---

## Issue 3. Budget editor: Managers and Directors see the editor but the save is refused (MODC-04)

**Status: CONFIRMED.** Impersonation: `app_user_can('budgets','create')` and `('budgets','edit')`
are false for Manager. Policies read from pg_policies.

**Root cause.** `budgets` INSERT and UPDATE admit role Admin, or a holder of the budgets create or
edit capability. `src/pages/Budgets.jsx` had no gate at all, so every role that can open the page
saw Set budget, an editable planner grid and a status dropdown. A save is an insert-or-update, so
the insert check refused it with a permission error after the form was filled. The status dropdown
was worse: an update with no rows returned, so a refused status change looked saved and the page
showed the new status until reload.

**Impact on current users.** 3 Managers (0 Directors exist). The page is also open to other roles
that have the Budgets module.

**The rule decided.** Unchanged in the database: budgets are set by an Admin, or by a role or
person an Admin gives the budgets rights to in Access Control. Setting a budget is a financial
authority, and the capability already exists for delegating it, so no policy was drafted. If the
owner wants Managers to set budgets, switching budgets create and edit on for Manager in Access
Control does it, and both pages open by themselves.

**Fix, web.**

- `src/pages/Budgets.jsx`: Set budget, the planner cells and the status dropdown follow the
  server's answer. A read-only note states the reason. The editor stays read-only until the right
  is confirmed (it is not offered on a guess).
- `src/pages/BudgetPlanner.jsx`: was Admin only by role; now uses the same rule, so a delegated
  budget right works on both pages and they cannot disagree.
- `src/lib/api/budgets.js`: the status update asks for the changed id back and throws a refusal on
  zero rows.

**Tests.** `src/test/budgetsAccess.render.test.jsx` (5 tests): Manager and Director refused by the
server get a disabled editor and the reason; a Manager with the rights gets the editor; Admin
always does; an unconfirmed right stays read-only and says so. The existing
`financeWorkspace.render.test.jsx` (non-admin sees no planner edit) still passes unchanged.

**Regression risk.** Low. Admins are unaffected. A capability holder on a dropped request sees
read-only with "could not be confirmed" until reload.

**Not addressed here.** The budgets unique key has no organisation column (the other half of
MODC-04). It matters only for a second company and changing it would break the upsert conflict
target until both are changed together; it belongs with the tenancy drafts.

---

## Issue 4a. Fleet Master shows add, edit and delete to roles the database refuses (MODA-8)

**Status: CONFIRMED.** Impersonation: `app_user_can('fleet_master','create')` and `('edit')` are
false for Manager and for every other non-admin role checked.

**Root cause.** `vehicle_fleet` is written through the fleet_master capability only (Admin, or a
grant); delete is Admin only (`admin_only_delete_guard`). The page computed `canEdit` as Admin,
Manager or Director and `canDelete` as Admin or Manager, and showed Add Vehicle to everyone. The
edit path also had the silent zero-row problem: `saveFleetRecord` did not ask for the changed row.

**Impact.** 3 Managers saw Add, Edit, Delete and the bulk actions, and every one was refused. Other
roles saw Add Vehicle.

**The rule decided.** Unchanged in the database: the fleet register stays Admin plus delegated
(the owner's 2026-09-30 decision; the instruction for this work names work orders only).

**Fix.** `src/pages/FleetMaster.jsx` uses the server's answer for add and edit and Admin for
delete; Edit is hidden in the row menu and Add and the bulk actions are disabled with the reason.
`src/lib/api/assets.js` `saveFleetRecord` now reports a refused edit.

## Issue 4b. Site Management shows edit to a role the database refuses (MODA-8)

**Status: CONFIRMED** (policy `sites_write`: Admin and Manager).

**Root cause.** The page allowed Admin, Manager and Director. A Director's save would be refused.
No Director account exists today, so nobody is affected yet. The site update also did not ask for
the changed row.

**Fix.** `src/pages/SiteManagement.jsx` takes its rule from `writeAccessRules.js` (Admin and
Manager). `src/lib/api/sites.js` `upsertSite` reports a refused update.

## Issue 4c. Tyre Records reports zero-row updates as saved (MODA-7)

**Status: CONFIRMED** for the permission side (impersonation: tyre_records edit is false for Tyre
Man, Inspector, Reporter, Fleet Supervisor and the workshop roles); the silent zero-row result is
INFERRED from code and PostgREST behaviour, and reproduced on PGlite for the same policy shape in
the work order test.

**Root cause.** `tyre_records` UPDATE admits admin and manager, or the edit capability (Tyre Data
Collector and Data Monitor Officer have it). INSERT also admits inspector and tyre_man. So an
Inspector or Tyre Man can add a record and cannot edit one. `updateRecord` and the bulk
`updateRecordsByIds` did not ask for changed rows, so the single edit, the bulk edit and the bulk
scrap fallback all reported success for changes that never happened. The page showed Add and Edit
to every role.

**Impact.** 17 Tyre Men, 2 Inspectors and every other non-writer role with the Tyre Records
module: edits appeared to save and did not.

**Fix.**
- `src/lib/api/tyreRecords.js`: `updateRecord` returns a refusal as its `error` on zero rows;
  `updateRecordsByIds` returns `{ updated, refused }`.
- `src/pages/TyreRecords.jsx`: the edit form shows the refusal; bulk edit states "N of M records
  were not updated" and stays open; the scrap fallback reports rows it could not mark; Add, Edit
  and Bulk edit are disabled with the reason for roles the database refuses.

## Issue 4d. Corrective action and inspection refused updates fail silently (MODB-7)

**Status: CONFIRMED** for the permission side (impersonation: corrective_actions edit is false for
every role except Manager and Admin; inspections edit is false for Tyre Man); silent result
INFERRED as above.

**Root cause.** `updateCorrectiveAction` and `patchInspection` updated with no returned row.
`deleteInspection` likewise. On top of that, `markDone` and `confirmDelete` in
`src/pages/Inspections.jsx` caught and discarded every error.

**Impact.** Corrective actions: anyone other than the 2 Managers in Company A and the 2 Admins who
changed a status saw no error and no change. The audit log shows 3 updates to a corrective action
ever, none by a Manager (see the investigation). Inspections: 17 Tyre Men can create an inspection
and cannot edit one; Mark done and Delete hid any refusal.

**Fix.**
- `src/lib/api/correctiveActions.js`, `src/lib/api/inspections.js`: the three writes ask for the
  changed id and throw a refusal on zero rows. The Corrective Actions page already shows thrown
  errors, so it needed no change.
- `src/pages/Inspections.jsx`: Mark done and Delete now show the refusal in the page notice.

**Rule not changed.** Who may close a corrective action is an owner decision set in Access Control
(recommendation in `STUCK_WORK_INVESTIGATION.md`, section 2.5).

**Tests for issue 4.**
- `src/test/writeAccessRules.test.js` (11 tests): pins the mirror against the live policy table
  and the role outcomes above; an unread server answer never hides a control; reasons are plain.
- `src/test/writeGuard.test.js` (29 tests): each guarded write (corrective action, inspection patch
  and delete, budget status, work order, Workshop Live status, priority, Vehicle Off Road and QC,
  fleet edit, tyre record edit and bulk edit) throws or returns a refusal on zero rows and
  succeeds on a real change; the refusal message reaches the user unchanged.
- `src/test/useWriteAccess.test.jsx` (7 tests).
- Existing tests that pinned the old shape were updated to supply a returned row, and the one that
  asserted "without a returning select" on `patchInspection` now asserts the opposite, with the
  reason in a comment (`inspectionsPage.api.test.js`). `api.test.js`, `budgets.api.test.js`,
  `tyreRecords.api.test.js` got a returned row for their update cases.

**Regression risk for issue 4.** Low to medium, in one specific way: any caller that updated a row
it could not read back would now see a refusal. The update policies and the read policies on these
tables cover the same people, so no such case was found. A record deleted by someone else between
load and save now reports "not saved" instead of silently doing nothing, which is the intended
behaviour.

---

## Files changed

Web, owned files: `src/pages/WorkOrders.jsx`, `src/pages/WorkshopLive.jsx`,
`src/components/workshop/WorkshopLiveParts.jsx`, `src/lib/api/workOrders.js`,
`src/lib/api/workshopLive.js`, `src/pages/KpiScorecard.jsx`, `src/lib/api/kpiTargets.js`,
`src/pages/Budgets.jsx`, `src/pages/BudgetPlanner.jsx`, `src/lib/api/budgets.js`,
`src/pages/FleetMaster.jsx`, `src/pages/SiteManagement.jsx`, `src/pages/TyreRecords.jsx`,
`src/lib/api/tyreRecords.js`, `src/lib/api/correctiveActions.js`, `src/lib/api/inspections.js`,
`src/pages/Inspections.jsx`.

New: `src/lib/writeAccessRules.js`, `src/lib/api/writeAccess.js`, `src/lib/api/writeGuard.js`,
`src/hooks/useWriteAccess.js`, and tests `src/test/writeAccessRules.test.js`,
`src/test/writeGuard.test.js`, `src/test/useWriteAccess.test.jsx`, `src/test/kpiTargetsSave.test.js`,
`src/test/budgetsAccess.render.test.jsx`.

Outside the owned list, three small edits that the fixes needed, each a few lines:
- `src/lib/api/settings.js`: the Settings KPI saver delegates to the one KPI target writer (it is
  the second KPI target service; leaving it would have left the defect on the Settings screen).
- `src/lib/api/assets.js`: `saveFleetRecord` reports a refused edit (Fleet Master's save path).
- `src/lib/api/sites.js`: `upsertSite` reports a refused update (Site Management's save path).

Existing tests updated: `src/test/api.test.js`, `src/test/budgets.api.test.js`,
`src/test/inspectionsPage.api.test.js`, `src/test/kpiTargets.api.test.js`,
`src/test/settings.api.test.js`, `src/test/tyreRecords.api.test.js`. No test was deleted. Two
assertions that pinned a defect were replaced by assertions of the corrected behaviour.

Drafts and database tests: `supabase/pending_migrations/20261113130000_cur_work_orders_manager_director_default.sql`,
`supabase/pending_migrations/20261113130500_cur_kpi_targets_org_scoped_key.sql`,
`supabase/tests/current_prod_work_orders_default.test.mjs`,
`supabase/tests/current_prod_kpi_targets_key.test.mjs`,
`supabase/tests/fixtures/current_prod_live_functions.sql`. No other file in
`supabase/pending_migrations/` was touched (its README does not yet list the two new drafts).

## Verification run

| Check | Result |
|---|---|
| `npx eslint` on every changed and new file (35 files) | 0 errors, 0 warnings |
| New web tests: writeGuard 29, writeAccessRules 11, useWriteAccess 7, kpiTargetsSave 6, budgetsAccess 5 | 58 of 58 pass |
| `node --test supabase/tests/current_prod_*.test.mjs` (PGlite) | 8 of 8 pass |
| Affected vitest files (129 files that mention the changed pages or services) | 1,521 of 1,526 pass |
| `npx vite build` | exit 0 |

The 5 failures in the affected run are not from this work. They are in files another agent is
editing in the same tree (CPK, cost and legal pages), none of which this work touched:
`boardOverviewAnalytics.test.js` (1), `safetyComplianceAnalytics.test.js` (1),
`expenseReportScopeSurfaces.test.jsx` (2), and `designSystemRatchet.test.js` (1, a raw table added
to `src/pages/Privacy.jsx`). The full vitest suite was not run, as instructed.

## Owner decisions needed

1. Apply CUR-1 (work orders for Manager and Director). It reverses the Admin-only decision of
   2026-09-30. Until then an Admin can switch the capability on for Manager in Access Control.
2. Apply CUR-2 (KPI target key per organisation) after the web release is live. Needed for a second
   company, not for the current one.
3. Whether Managers should set budgets and edit the fleet register. Both are Admin only today and
   both can be delegated in Access Control with no code change.
4. Who closes corrective actions and how a checklist with a fault is closed
   (`STUCK_WORK_INVESTIGATION.md`).

## Not done, stated

- The browser's `hasCapability` default still says "yes" where the server says "no" for modules
  with no stored matrix value. Pages touched here no longer rely on it. Other pages may still.
  Fixing the default at its source is in `src/lib/permissionMatrix.js` and `AuthContext`, outside
  this change.
- Editing a record still rewrites `created_by` on work orders, inspections and fleet (MODA-13,
  MODB-8). Not part of this work.
- Nothing was checked in a browser. The pages were built and their tests run; no screen was opened
  against the live database.
