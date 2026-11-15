# Work order permissions (round 2, owner decision 2026-11-15)

Branch `claude/work-order-permissions-7rxp2t` (includes draft PR #511). Nothing applied to production. Production
was read only (policies, triggers, role counts).

## What was found on production
- Company, country and site WRITE walls already exist on `work_orders`, `wo_tasks`, `wo_assignments`,
  `tech_activity_events` (restrictive, FOR ALL). Delete is Admin only. These stay.
- Writing the job itself was one yes or no (`app_user_can work_orders create / edit`). Anyone with it could change
  any column of any work order, including closed ones and costs (97,204 of 97,242 are closed).
- Assigning, tasks and events were tied to three role names (`app_is_elevated`): a Workshop Supervisor could do none.
- Any approved person could log an event against any job. Supervisors could not see technicians' events.
- Workshop Supervisor and Maintenance Supervisor are checklist-only on the web: no Work Orders, no Live Control.

## Drafts (supabase/pending_migrations, AUTHORED NOT APPLIED)
| File | What |
|---|---|
| `20261115140000_wo_permission_resolver.sql` | Table `work_order_role_rules` (company row replaces built-in default), 30 seed rows, `work_order_can`, `work_order_scope`, `work_order_my_access`, helpers. Changes no behaviour alone |
| `20261115140500_wo_policies_and_guards.sql` | ALTER POLICY on 7 policies, one new task policy, triggers `wo_write_guard`, `wo_delete_guard`, `wo_tasks_progress_guard`. No removal statement |
| `20261115141000_wo_supervisor_module_visibility.sql` | 5 `module_permissions` rows so supervisors see Work Orders and Live Control |

Order: `20261113130000` (PR #511), then the three above. Deploy the web build BEFORE the SQL (an old browser tab
saves a quality check in two writes; the second is refused once closed work orders are locked).

## Rule
Actions create, edit, assign, progress, qc; scope all, tyre, assigned. Admin only and not configurable: delete,
change a closed work order, change the cost of an approved work order. Roles with a rule are decided by the rule
table alone; roles without one keep Access Control. Per-user grant and revoke still apply.

## Code
New: `src/lib/workOrderAccess.js` (mirror), `src/lib/api/workOrderAccess.js`, `src/hooks/useWorkOrderAccess.js`,
`src/test/workOrderAccessMirror.test.js`, `supabase/tests/staging_work_order_permissions.{sh,sql}`.
Changed: `WorkOrders.jsx`, `WorkshopLive.jsx`, `WorkshopLiveParts.jsx`, `JobCardForm.jsx`, `api/workshopLive.js`
(quality check in one write), `checklistAccess.js`, `Layout.jsx`, `LegacyLayout.jsx`, `App.jsx`, `commandSearch.js`.
Fixed on the way: editing a work order overwrote `created_by` with the editor. The pages work before and after the
SQL (they fall back to today's rules when the resolver is absent). Mobile and Flutter: no change, no build.

## Tests
- Local staging copy, synthetic companies: 183 of 183 cases (role x action x own site, other site, other country,
  other company, assigned, closed, approved cost, delete, ERP pipe, in-app intake). Work order table hash identical
  before drafts, after drafts, after matrix. Four mutations (write guard off, old update policy, old event policy, delete guard off) each produced failures. Verified Fixed on synthetic data.
- Vitest: mirror 21, related existing 227 (23 files), all pass. eslint 0 errors. `vite build` clean.
- Not Tested: production, a real browser, Flutter and Expo against the new rules, PGlite.

## Effect on today's users if applied (approved accounts)
- Gain full work order management: Workshop Supervisor 7, Maintenance Supervisor 1, Workshop Maintenance Area
  Manager 1, Manager 3. Tyre work only: Tire Planning Engineer 1. Progress on own assigned job: Tyre Man 17 and
  38 trade accounts.
- Lose: Tyre Data Collector 7 and Data Monitor Officer 1 can no longer change closed work orders, the assigned
  owner or an approved cost. Stored rows changed: none.
- Every non-driver account holds ALL sites today, so "their sites" means every site of their country until
  `profiles.sites` is narrowed.

## Rollback
Header of each file. `140500`: disable three triggers, eight ALTER POLICY statements restore the live text.
`141000`: restore from `_bak.wo3_module_permissions_20261115`.

## Risks
- No screen yet to edit `work_order_role_rules` (SQL or a later console page).
- Insert cost for a Manager about 0.6 ms a row, update 1.3 ms (Admin unchanged within noise).
- Guard messages reach the user only through the exact sentences listed in `WO_REFUSAL`.
- `pending_migrations/README.md` and `PROJECT_MEMORY.md` not edited (shared files).

## Questions for the owner
1. Closed means Completed, Closed or Cancelled. Should a supervisor have a grace period to add costs after completion?
2. "Approved cost" is read as a work order with an execution approval. Correct?
3. Helpers, welders, painters seeded as technicians. Keep?
4. PMV Manager and Fleet Supervisor are not in the decision and get nothing. Intended?
5. Director is seeded like Manager. Agreed?

---

# Follow-up after the browser tests (owner decisions 2026-11-15, second set)

Nothing applied to production. Production was read only (module switches, Access Control switches for work orders,
the approval engine's approver list, counts). Everything below is proven on synthetic staging data only.

## What changed
- **Drafts renumbered** so they no longer share a number with PR #518: `20261115160000 / 160500 / 161000` are now
  `20261115140000 / 140500 / 141000`. Every reference on this branch was updated. The browser harness on
  `claude/round2-browser-tests-7rxp2t` (`e2e/staging/round2_setup.sh`) still names the old files.
- **Technicians work on their assigned jobs on the web (W4).** `141000` now also switches Work Orders on for
  Tyre Man and the 21 trade roles. New screen `/my-jobs` (My Jobs): the person's own open assigned jobs, status
  moves, their own tasks, a note of work done or a problem. `/work-orders` sends a technician there. The Tyre Man
  "Work" tab points to it and is hidden while the module is off, so it never leads to Access Restricted.
- **Final closure is its own right (`close`).** Moving a work order to Completed, Closed or Cancelled needs it.
  Managers, supervisors and tyre engineers have it. Technicians and Tyre Data Collectors do not: they move the job
  to Quality Inspection and a supervisor closes it.
- **Tyre Data Collector limits (W9).** The role now has a rule row: create, edit and progress on every work order
  inside its company, country and sites; quality check only on work orders assigned to it; no assigning, no final
  closure, no closed work order, no approved cost, no delete. A per-user grant can no longer add the quality check,
  assigning or closing. New draft `20261115141500` removes the role from the approval engine's approver list for
  work orders (it was written into the function; unused today: no published policy, no approval request).
- **W7** one `title` on the drawer's Edit button. **W8** a technician on somebody else's job is told "You can
  update work orders assigned to you only", and disabled status buttons carry the reason.
- Live Control: a person who may record a quality check but not close records the result only.
- Not touched: W1, W5, W6 (PR #528 owns the save path).

## Tests (exact)
- Staging matrix `supabase/tests/staging_work_order_permissions.sh` on `tp_wo3`: 238 of 238 (was 183). Work order
  table hash identical before drafts, after drafts, after the matrix (1,298 rows). Four mutations each produced
  failures: collector back in the approver list (1), collector quality check scope removed (2), collector rule off
  (8), technicians given closing (5).
- Vitest: `workOrderAccessMirror` 25, `myJobs.render` 8, plus 75 related files; 77 files, 941 tests, all pass.
- eslint on changed files: 0 errors. One `vite build`: clean.
- Not Tested: production; a real browser for My Jobs and the new limits; Expo and Flutter against the new rules;
  photographs from the web (My Jobs sends a written note; photographs stay on the phone app).

## Apply order
`20261113130000`, `20261115140000`, `140500`, `141000`, `141500`. Web build first.

## Rollback
Header of each file. `141500`: re-create the function from `_bak.wo4_person_eligible_20261115`.
`141000`: switch the rows off and restore `_bak.wo3_module_permissions_20261115`.

## Effect on today's users if applied (approved accounts, counts only)
- Tyre Man 17 and 38 trade accounts: can open My Jobs; progress on their own job; cannot close.
- Tyre Data Collector 7: lose the quality check on jobs not assigned to them, closing and cancelling, and
  eligibility as a work order approver. Keep create, edit, progress.
- Data Monitor Officer 1: unchanged from the first round (no rule; Access Control decides, including closing).

## Risks and questions
1. Technicians could set Completed in the first round; now they cannot. Confirm that "update assigned tasks and
   submit evidence only" means a supervisor always closes.
2. "Assigned quality check" is read as: the collector is the owner of the job, has an active assignment, or has a
   task on it. Is a separate "quality checker" assignment wanted?
3. Data Monitor Officer still closes work orders through Access Control. Same limits as the collector?
4. The collector can still enter costs on a work order that has no approval. Only approved costs are locked.
5. My Jobs evidence on the web is a written note (activity record a foreman confirms). Photographs need storage
   work and were not built.
