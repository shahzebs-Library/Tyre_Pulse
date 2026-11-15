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
| `20261115160000_wo_permission_resolver.sql` | Table `work_order_role_rules` (company row replaces built-in default), 30 seed rows, `work_order_can`, `work_order_scope`, `work_order_my_access`, helpers. Changes no behaviour alone |
| `20261115160500_wo_policies_and_guards.sql` | ALTER POLICY on 7 policies, one new task policy, triggers `wo_write_guard`, `wo_delete_guard`, `wo_tasks_progress_guard`. No removal statement |
| `20261115161000_wo_supervisor_module_visibility.sql` | 5 `module_permissions` rows so supervisors see Work Orders and Live Control |

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
Header of each file. `160500`: disable three triggers, eight ALTER POLICY statements restore the live text.
`161000`: restore from `_bak.wo3_module_permissions_20261115`.

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
