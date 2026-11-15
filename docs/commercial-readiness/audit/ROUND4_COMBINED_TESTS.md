# Round 4: PR #519 and PR #520 together, in ship order (2026-11-15)

**Environment: local synthetic staging, NOT production.** Local PostgreSQL 16 at 127.0.0.1:54329, copies of
`tyrepulse_staging` (synthetic Alpha/Beta/Gamma). Nothing was applied to production, nothing was merged or deployed.

Code under test: branch `claude/round3-integration-7rxp2t` = old main + PR #519 at `d7f12edb` (contains #528) +
PR #520 at `21fb8a1a`, then #520 again after the D4 fix (`9d0fe9ca`, `c0c03df4`). The one conflict from round 3
(`src/lib/checklistAccess.js`) kept its unified resolution: one `CHECKLIST_MODULE_GATED_PATHS` map that spreads
`SUPERVISOR_WORK_PATHS` and adds `'/actions'`. The drafts README keeps both sections. A new conflict appeared in
`src/lib/api/correctiveActions.js` once the D4 fix landed (see "Merge note").

## Front end checks on the combined tree

| Check | Result | Status |
|---|---|---|
| `npm run lint` | 0 errors, 8 warnings (all pre-existing `exhaustive-deps`) | Verified Fixed |
| `npx vite build` | exit 0 | Verified Fixed |
| vitest: checklistAccess, checklistOnlyNav, closureSafeDegrade, workOrder* (9 files), jobCard* (6 files), navRouteAccessParity, commandSearchCoverage, rowCapGuard, webI18nKeyCoverage | 23 files, 289 tests passed | Verified Fixed |
| vitest after the D4 merge: correctiveActionStatusRefusal, api, closureText, closureSafeDegrade, webI18nKeyCoverage | 5 files, 70 tests passed | Verified Fixed |

## Database: drafts in ship order on one fresh copy (`tp_combined`)

Runner: `supabase/tests/staging_combined_519_520.sh` (new in this round). It copies `tyrepulse_staging`, loads the
closure synthetic fixture, hashes, applies the nine drafts each in its own transaction (`psql -1`), hashes, runs
both staging suites on that SAME database, hashes again, and drops the copy.

| # | Draft | PR | Result |
|---|---|---|---|
| 1 | 20261113130000_cur_work_orders_manager_director_default | #519 | applied, no error |
| 2 | 20261115140000_wo_permission_resolver | #519 | applied, no error |
| 3 | 20261115140500_wo_policies_and_guards | #519 | applied, no error |
| 4 | 20261115141000_wo_supervisor_module_visibility | #519 | applied, no error |
| 5 | 20261115141500_wo_cost_approval_not_collector | #519 | applied, no error |
| 6 | 20261115142000_wo_cost_entries_ledger | #519 | applied, no error |
| 7 | 20261116100000_clo_corrective_action_review | #520 | applied, no error |
| 8 | 20261116101000_clo_checklist_acknowledge_exception | #520 | applied, no error |
| 9 | 20261116102000_clo_supervisor_actions_visibility | #520 | applied, no error |

| Suite (on the combined database) | Expected | Observed | Status |
|---|---|---|---|
| `staging_work_order_permissions.sql` | 305 cases | `cases=305 passed=305 failed=0` | Verified Fixed |
| `closure/tests.sql` (+ the runner's existing-rows check) | 76 | 75 ok + existing rows identical = 76, 0 not ok | Verified Fixed |

Ran twice (once by hand, once through the committed runner): same counts both times.

### Stored rows (md5 over every row; suites roll back)

`corrective_actions` excludes the review columns the closure draft adds, `checklist_submissions` excludes the
acknowledge columns (the same exclusion `closure/run_staging.sh` uses), so the hash measures existing data only.

| Table | Before draft 1 | After draft 9 | After both suites | Equal |
|---|---|---|---|---|
| work_orders | 1298 `1ec97e72b021bc142aa492543aa47783` | same | same | yes |
| corrective_actions | 13 `3fe633817f449bf9c8e655a188604fad` | same | same | yes |
| checklist_submissions | 8 `32f5bdcdb9fc99deb3409c1208d50ed2` | same | same | yes |
| parts_consumption | 1406 `d6dba764d25676adf8d8c56d43000f6b` | same | same | yes |

(The second run has different corrective action and checklist hashes because the fixture stamps new ids and
times on each load; within that run all three columns were again equal.)

## Browser on the combined build

Stack: `E2E_DB=tp_browser4`, PostgREST 54350, gateway 54351, web 5220; database rebuilt with `--rebuild-db`, then
`round2_setup.sh` (all six work order drafts incl. the ledger, the three closure drafts, synthetic people incl.
`r2.monitor`).

**Harness finding:** `round2_setup.sh` applies the drafts after PostgREST has started and does not reload its schema
cache. The first ledger run therefore saw no cost ledger RPCs ("Add a cost" not offered on any role) and was
discarded. After `NOTIFY pgrst, 'reload schema'` the run below is clean. `round2_setup.sh` now ends with that NOTIFY
(added in this round).

| Spec | Verified Fixed | Verified Failed | Not Tested |
|---|---|---|---|
| round3_ledger (cost ledger) | 17 | 0 | 0 |
| round2_closure actions | 30 | 0 | 0 |
| round2_closure checklists | 16 (+1 refusal case) | 0 | 0 |

### round3_ledger

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| managerAdds | Manager | Draft cost line | added | `pending_reconciliation recon=cannot_tell amount=20.00` | Verified Fixed |
| managerAddsPartsCostAfter | Manager | Stored parts cost untouched | 250.00 | `parts_cost=250.00` | Verified Fixed |
| managerSelfApprove | Manager | No approve on own line | not offered | `decided_by=-` | Verified Fixed |
| selfApproveDb | Manager | Database refuses | refused | "You entered this cost, so another person has to decide it." | Verified Fixed |
| selfApproveDbStatus | Manager | Unchanged | unchanged | `pending_reconciliation` | Verified Fixed |
| supervisorApproves | Workshop Supervisor | Not offered | not offered | `decided_by=-` | Verified Fixed |
| adminApproves | Admin | Independent approval | total 621.00 | totals `601.00/20.00/621.00` | Verified Fixed |
| collectorAddsUnassigned | Tyre Data Collector | Not offered | no add control | no row | Verified Fixed |
| collectorAddsAssigned | Tyre Data Collector | Draft line | added | `amount=15.00` pending | Verified Fixed |
| collectorApproveOwn | Tyre Data Collector | Not offered | not offered | `decided_by=-` | Verified Fixed |
| collectorApproveDb | Tyre Data Collector | Refused | refused | "You are not allowed to approve costs on this work order." | Verified Fixed |
| collectorReverseDb | Tyre Data Collector | Refused | refused | same message | Verified Fixed |
| managerApprovesCollector | Manager | Independent approval | total 1,706.28 | East totals `1691.28/15.00/1706.28` | Verified Fixed |
| monitorClose | Data Monitor Officer | Cannot close | button disabled | `Quality Inspection` | Verified Fixed |
| technicianSubmit | Technician (My Jobs) | Submit, cannot close | submit offered, close explained | event `complete_task`, `Quality Inspection` | Verified Fixed |
| supervisorClose | Workshop Supervisor | Close after QC | closed | `Completed` | Verified Fixed |
| supervisorCloseClosedAt | Workshop Supervisor | Close time stamped | stamped | `2026-11-15 14:57:17+00` | Verified Fixed |

### The previously blocked path: exception on a never-submitted action (fixed by #520 `21fb8a1a`)

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Link on a never-submitted action (T6) | Manager | "Ask for a documented exception instead" offered | offered | `review_status` NULL before | Verified Fixed |
| Reason under 10 characters | Manager | Request button disabled | disabled | n/a | Verified Fixed |
| Request | Manager | Stays open, waits for someone else | "Exception requested. The action stays open until a different authorised person decides." | `In Progress`, `exception_requested`, event `exception_requested` | Verified Fixed |
| Requester view | Manager | Cannot decide own request | label "Exception requested, waiting for a decision", self-block notice, no decide control | n/a | Verified Fixed |
| Same person asks and decides (database) | Manager | Refused | refused | "You asked for this exception, so another authorised person has to decide it." (42501); action unchanged | Verified Fixed |
| Independent decider approves | Admin | Closed as exception | "Exception approved. The action is closed as a documented exception." | `Closed`, `review_status=exception`, events `exception_requested,exception`, `closed_by` set | Verified Fixed |
| History keeps both people and times | n/a | Requester and decider with times | `exception_requested by Test Alpha Manager (Manager) at 15:06`, `exception by Test Alpha Admin (Admin) at 15:08`; row: requested_by alpha.manager, reviewed_by alpha.admin | `corrective_action_review_events` | Verified Fixed |
| Checklist fault action, never submitted (Horn) | Manager then Admin | Requested, then approved by another person | both messages as above | compliance before decision `fault_open, compliant=false`; after `exception, exception_count=1, compliant=true` | Verified Fixed |
| Sheet reads compliant by exception | Admin | "compliant by exception" on the sheet | "Acknowledged, compliant by exception ... Horn (Not OK) Exception recorded" | `v_checklist_fault_compliance.fault_state=exception` | Verified Fixed |
| Requester closes by the status field while pending (D4) | Manager | Plain sentence about the pending exception | "An exception has been requested on this action. Approve or refuse the exception first." (before the fix: "This record changed since you opened it.") | status stays `In Progress` | Verified Fixed |

### round2_closure actions

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Worker opens assigned action | Tyre Data Collector | Submit, progress, exception link | all offered | n/a | Verified Fixed |
| Save as progress | Tyre Data Collector | History event, stays open | "Update saved." | event `progress`, `In Progress` | Verified Fixed |
| Close by status field | Tyre Data Collector | Refused | "This action was not updated. Only a Manager or an Admin can change..." | unchanged | Verified Fixed |
| Photo + submit | Tyre Data Collector | Submitted, not closed | "Submitted. A reviewer will approve..." | `submitted`, 1 photo | Verified Fixed |
| Another collector, not assigned | Tyre Data Collector 2 | Read only | no controls, waiting label | n/a | Verified Fixed |
| Return needs a comment | Manager | Disabled without comment | disabled | n/a | Verified Fixed |
| Return for correction | Manager | Back to worker | "Returned to the worker for correction." | `returned`, comment stored | Verified Fixed |
| Worker sees return and resubmits | Tyre Data Collector | Comment shown, resubmit | resubmitted | events progress,submitted,returned,submitted | Verified Fixed |
| Supervisor reaches /actions, reviews own site | Workshop Supervisor (North) | Approve | "Closure approved. The action is closed." | `Closed`, `approved`, closed_by set | Verified Fixed |
| History | Manager | Who, role, when, comment | 5 entries with names and roles | events table | Verified Fixed |
| Self submit then decide | Manager | No approve on own submission | no approve control | still `submitted` | Verified Fixed |
| Self close by status | Manager | Refused, plain | "You submitted this action, so another reviewer has to close it." | unchanged | Verified Fixed |
| Supervisor (North) on East action | Workshop Supervisor (North) | Not visible | not listed | unchanged | Verified Fixed |
| Independent reviewer approves | Admin | Approved | "Closure approved." | `Closed` | Verified Fixed |
| Exception link on never-submitted action | Manager | Offered | offered | `review_status` NULL before | Verified Fixed |
| Short reason disabled | Manager | Disabled under 10 characters | disabled | n/a | Verified Fixed |
| Exception requested | Manager | Stays open | "Exception requested..." | `exception_requested` | Verified Fixed |
| Requester cannot decide | Manager | Self-block | self-block notice, no decide control | n/a | Verified Fixed |
| Requester closes by status (D4) | Manager | Plain sentence about the exception | "An exception has been requested on this action. Approve or refuse the exception first." | 409, unchanged | Verified Fixed |
| Independent decider approves | Admin | Closed by exception | "Exception approved..."; label "Closed by exception" | `Closed`, `exception`, events exception_requested,exception | Verified Fixed |
| History keeps both people | n/a | Requester + decider + times | alpha.manager 15:35, alpha.admin 15:37 | events + row columns | Verified Fixed |
| Same person asks and decides (database) | Manager | Refused | "You asked for this exception, so another authorised person has to decide it." | rolled back, action unchanged (`Open`, NULL) | Verified Fixed |
| Submitter requests exception on own submission | Manager | Allowed to ask | requested | `exception_requested` | Verified Fixed |
| Submitter closes by status while pending | Manager | Plain sentence | same D4 sentence | unchanged | Verified Fixed |
| Different person refuses exception | Admin | Back to worker | "Exception refused. The action is back with the worker." | `returned`, comment stored | Verified Fixed |
| TPE on open action | Tire Planning Engineer | Can work on it | submit offered; exception link offered (reviewer role, see observations) | n/a | Verified Fixed |
| Creator collector on own unassigned action | Tyre Data Collector | Assignee by creator rule | submit + exception offered | n/a | Verified Fixed |
| /actions route | Supervisors North, East | Allowed | open | n/a | Verified Fixed |
| /actions route | Tyre Man | Refused | Access Restricted | n/a | Verified Fixed |
| Other company | Beta Manager | Does not see Alpha action | not seen | n/a | Verified Fixed |

No page errors. Failed requests are only the expected refusals (403 on the self close, 409 on the pending-exception close).
The first actions run (before the D4 fix was built in) gave the same results except the two pending-exception closes, which read "This record changed since you opened it.".

### round2_closure checklists

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Approve a sheet with a fault | Workshop Supervisor (East) | Refused | Approve disabled, "still has items marked as a fault" | unchanged | Verified Fixed |
| Acknowledge with fault | Workshop Supervisor (East) | Allowed with signature | "Acknowledged. The fault stays on record..." | `acknowledged`, locked, answers unchanged | Verified Fixed |
| List label | Workshop Supervisor (East) | "Acknowledged, Action Required" | shown; Pending approval 0, Action required 1 | n/a | Verified Fixed |
| Viewer drawer label | Workshop Supervisor (East) | Label shown | Row selected, "Open viewer" opens the drawer: "Status Acknowledged, Action Required", no raw word | n/a | Verified Fixed (spec locator fixed) |
| Audit Pack, author role | Manager | Tile and record row | tile "Acknowledged, Action Required 1"; Records tab row "Synthetic Single Sign ... TM007 ... Acknowledged, Action Required ... Test clo.sup.east"; no raw word, no failed request | n/a | Verified Fixed |
| Audit Pack, non-author | Workshop Supervisor (East) | Refused | Access Denied on `/checklist-audit` | n/a | Verified Fixed (see defect R4-D5) |
| Other site supervisor | Workshop Supervisor (North) on East sheet | Not visible | not found | n/a | Verified Fixed |
| Own sheet | Workshop Supervisor (North) | Cannot acknowledge | "another signer has to acknowledge it" | n/a | Verified Fixed |
| Two-stage first signature | Workshop Supervisor (North) | First signature only | signed | `pending_area_manager` | Verified Fixed |
| Collector | Tyre Data Collector | Cannot acknowledge | "Only a final signer can acknowledge this checklist." | n/a | Verified Fixed |
| Area manager on own sheet | Workshop Maintenance Area Manager | Refused | "another signer has to acknowledge it" | n/a | Verified Fixed |
| Tyre Man | Tyre Man | Read only | label, no controls | n/a | Verified Fixed |
| Final signer acknowledges two-stage | Admin | Allowed after first signature | acknowledged | `acknowledged`, locked | Verified Fixed |
| Exception on the fault's action | Manager | Link offered | offered, requested | `fault_open` until decided | Verified Fixed (was D1) |
| Sheet compliant by exception | Admin | "compliant by exception" | shown | `fault_state=exception, compliant=true` | Verified Fixed (was blocked by D1) |
| Collector on another action | Tyre Data Collector 2 | No panel | no panel | n/a | Verified Fixed |
| Compliance after acknowledge | n/a | Not compliant while open | `fault_open`, compliant false | view | Verified Fixed |

## Rollout intermediate states

Question (owner): can the web build ship before the database drafts without breaking work order operations, and are
the financial baseline, approved costs and historical records protected in between?

Set-up: one web build (`wt-r4` integration build = main + #519 + #520, served from the same dist), PostgREST pointed
in turn at two fresh copies of the staging template (`e2e/staging/switch_db.sh <db>`):

- **S1** `tp_rollout_s1`: `R2_DRAFTS=none round2_setup.sh`, i.e. no draft at all (the database as production holds it today), plus the synthetic people.
- **S2** `tp_rollout_s2`: `R2_DRAFTS=wo round2_setup.sh`, i.e. the six #519 drafts (cur manager/director default, resolver, policies and guards, supervisor visibility, cost approval, cost ledger) and none of the three #520 closure drafts.

Spec: `e2e/staging/specs/rollout_states.cjs` (reuses the round 2 / round 3 work order and ledger helpers; every case
reads the database before and after; synthetic rows it creates are removed by `_ro.reset()` before the closing hash).

### Money and history fingerprints

md5 over every row, taken before the first role and after the last role (after the test rows were removed):

| Table | S1 before | S1 after | S2 before | S2 after |
|---|---|---|---|---|
| work_orders (id, parts_cost, labour_cost, total_cost) | 1298 `076fd291b66b774ca887da0d1d36fcdf` | same | 1298 `076fd291b66b774ca887da0d1d36fcdf` | same |
| work_orders (whole row) | 1298 `d63f5db06c6971f14703e58a33f2fea2` | same | 1298 `d63f5db06c6971f14703e58a33f2fea2` | same |
| parts_consumption (whole row) | 1406 `11c9d210dc0d9dbfce250e293fea9271` | same | 1406 `11c9d210dc0d9dbfce250e293fea9271` | same |
| approval_execution_requests | 1 `1b4838afa4c43363573858c480dda1dc` | same | 1 `a2f62160e5b8b733de357aee92e21431` | same |
| work_order_cost_entries / events | table absent | table absent | 0 rows | 0 rows |

The cost hash is identical in S1 and S2: applying the six #519 drafts does not touch any stored work order cost.
(The approval request row differs only because the two copies were created at different times; it is the harness row.)
Per role, the imported parts cost of three marked jobs (`ALP/JC/R0019/0426=100.00`, `ALP/JC/R0049/1026=1775.82`,
`ALP/JC/R0108/0926=250.00`) was read before and after: unchanged for every role in both states.

### Cases

| Case | Role | State | Expected | Observed | Label |
|---|---|---|---|---|---|
| Open Work Orders | Manager | S1 | Opens | opens, no raw database text, no error screen | Verified Fixed |
| Open a job, costs | Manager | S1 | Job and costs shown, ledger absent without error | dialog shows Labour/Total cost; no cost ledger panel; no failed request | Verified Fixed |
| Edit scope / notes / status | Manager | S1 | Same as main: the database lets only Admin write work orders today | Edit and status disabled, "You are not allowed to record progress on this work order."; database probe as Manager: update writes 0 rows | Verified Fixed (honest refusal; see note 1) |
| Add a cost | Manager | S1 | Ledger absent, said honestly | no ledger panel, no Add cost control; the page's ledger read gets 404 and the screen stays clean (no message, no error); no entry anywhere | Verified Fixed |
| Assign on Live Control | Manager | S1 | Works as on main | "Technician assigned.", 1 active assignment; the owner stamp on the work order is refused by today's database (owner not set) while the flash still reads success (see note 2) | Verified Fixed (assignment); note 2 |
| My Jobs | Manager | S1 | New screen degrades | opens, empty list, no error | Verified Fixed |
| Open, view | Data Monitor Officer | S1 | Read only, as main | opens; Labour/Total shown; Edit and status disabled with "You are not allowed to record progress on this work order." | Verified Fixed |
| Add a cost, Live Control | Admin | S1 | Ledger absent; Live Control as main | no Add cost; assigned, owner set, moved to In Progress | Verified Fixed |
| Open Work Orders | Workshop Supervisor | S1 | Same as main (module off for the role) | no Work Orders link, route returns to Checklists, no error | Verified Fixed |
| Live Control / My Jobs | Workshop Supervisor | S1 | Same as main | returns to Checklists | Verified Fixed |
| Work Orders, Live Control, My Jobs | Technician (Tyre Man) | S1 | Same as main (no work order module) | "Access Restricted", "This section requires Admin / Manager / Director / Maintenance Supervisor access." | Verified Fixed |
| Open Work Orders, job, costs | Admin | S1 | Works as on main | opens; Labour/Parts/Total shown; no ledger panel | Verified Fixed |
| Edit scope, notes, status | Admin | S1 | Works as on main | saved (`scope`, `notes` changed, `Awaiting Assignment`), parts_cost unchanged | Verified Fixed |
| Open Work Orders, job, ledger | Manager | S2 | Opens, ledger shown | ledger "Imported cost (as stored) 601.00 SAR ... Calculated total 601.00 SAR" | Verified Fixed |
| Edit scope, notes, status | Manager | S2 | Allowed (cur draft) | saved; parts_cost 1775.82 before and after | Verified Fixed |
| Add a cost | Manager | S2 | Draft entry, imported cost unchanged | `pending_reconciliation`, 20.00; imported 601.00 unchanged | Verified Fixed |
| Approve own cost | Manager | S2 | Refused | no Approve button; database: "You entered this cost, so another person has to decide it." | Verified Fixed |
| Assign, move on Live Control | Manager | S2 | Allowed | "Technician assigned.", 1 active assignment, moved to In Progress | Verified Fixed |
| Open Work Orders, edit, status | Workshop Supervisor | S2 | Allowed (supervisor drafts) | opens; scope and notes saved; Awaiting Assignment | Verified Fixed |
| Add a cost / approve own | Workshop Supervisor | S2 | Draft only, no approval | `pending_reconciliation`; database: "You are not allowed to approve costs on this work order." | Verified Fixed |
| Assign on Live Control | Workshop Supervisor | S2 | Allowed | "Technician assigned.", moved to In Progress | Verified Fixed |
| My Jobs | Workshop Supervisor | S2 | Not a technician screen | returns to Checklists (checklist-only role path list) | Verified Fixed |
| My Jobs, Submit work done | Technician (Tyre Man) | S2 | Assigned job moves to Quality Inspection, cannot close | `Quality Inspection`, event `complete_task`, "You cannot close a job." | Verified Fixed |
| Work Orders / Live Control | Technician (Tyre Man) | S2 | Not offered | Work Orders returns to My Jobs; Live Control "Access Restricted" | Verified Fixed |
| Open, view, ledger | Data Monitor Officer | S2 | Read only | opens, ledger shown, Add a cost not offered | Verified Fixed |
| Edit, status | Data Monitor Officer | S2 | Refused with a reason | disabled, "You are not allowed to record progress on this work order."; database unchanged | Verified Fixed |
| Live Control | Data Monitor Officer | S2 | Not offered | "Your role does not have permission to access this module." | Verified Fixed |
| Edit, status, assign | Admin | S2 | Allowed | saved; assigned; In Progress | Verified Fixed |
| Approve own cost | Admin | S2 | Refused (separation of duties holds for Admin too) | no Approve button; database: "You entered this cost, so another person has to decide it." | Verified Fixed |
| Raw errors, blank screens | all five | S1, S2 | none | no raw database text on any screen or alert, no error screen, no failed request; one page error on S2 Workshop Supervisor is the local realtime shim ("cannot add postgres_changes callbacks ... after subscribe()"), not an app path | Verified Fixed |
| Main build on S1 | all | S1 | Baseline comparison | main's own build was not served in this round; "same as main" above is read from main's code paths and the database probe | Not Tested |

Note 1: on S1 (production today) the Manager, Workshop Supervisor, Tyre Man and Data Monitor Officer cannot write work
orders at the database (only Admin; `app_user_can('work_orders','edit')` false, update writes 0 rows). The new build
reads that through `legacyWorkOrderAccess` and disables the controls with a reason instead of offering an Edit whose
save writes nothing. Nothing that works today for these roles stops working; the Manager write right arrives with
draft `20261113130000_cur_work_orders_manager_director_default` (S2: Manager update writes 1 row).

Note 2: on today's database a Manager's Live Control assignment inserts the `wo_assignments` row but the follow-up
owner stamp on `work_orders` writes 0 rows (only Admin may write work orders today), and "Technician assigned." is shown
anyway. Same code path on main, so not a rollout regression; it disappears once the cur draft gives Managers the write.
The 404s on `work_order_my_access` and `work_order_cost_entries` in S1 are the expected "not on the database yet" probes;
the client falls back (`legacyWorkOrderAccess`) and nothing reaches the screen.

### Proposed rollout order

1. **Web first** (main + #519 + #520, one Vercel production build). Safe on today's database (S1): every screen
   opens, new features degrade (no cost ledger panel, no My Jobs for roles without the module, Edit disabled with a
   reason where the database already refuses). No stored cost moves.
2. **Same session, within minutes**: the six #519 drafts in order (`20261113130000`, `20261115140000`,
   `20261115140500`, `20261115141000`, `20261115141500`, `20261115142000`), then `notify pgrst, 'reload schema'`
   (state S2: proven above). Users with an open tab keep working; the ledger and supervisor rights appear on the next
   load (prompt-mode PWA: reload).
3. **Then** the three #520 closure drafts (`20261116100000`, `20261116101000`, `20261116102000`) and a second schema
   reload (the combined state = round 4 above).
4. Window guidance: no maintenance window is needed for steps 1 to 3; between 1 and 2 Managers see Edit disabled
   exactly as the database already enforces today. Run 2 and 3 back to back in one session; do not leave the
   database between drafts of one PR. Before step 2 and after step 3, take the four hashes above on production
   (read only) and compare: they must be equal.
5. Rollback: web can roll back alone at any point (the old build ignores the new tables and functions); each draft
   carries its own rollback in its header.

### Defects found

- **R4-D5 (minor, nav vs route)**: a checklist-only role (Workshop Supervisor) is shown "Audit Pack" in the sidebar
  (`CHECKLIST_PATH_PREFIXES` includes `/checklist-audit`) while the route is `RoleRoute allowed={CHECKLIST_AUTHOR_ROLES}`
  and refuses him (evidence: `k1_audit_pack_non_author`, sidebar text "... Checklist Insights Audit Pack ..." on the
  Access Denied page). Fix: drop `/checklist-audit` from the checklist-only prefixes or hide the nav item for
  non-authors. Not fixed on #520 (report only).
- Observation: the viewer drawer of an acknowledged sheet still prints "Correct the fault and have the line re-marked,
  or send the sheet back for correction." under the fault; the status line is correct. Wording only.

## Fixes pushed in this round

| Where | Commit | What |
|---|---|---|
| `claude/closure-workflow-7rxp2t` (PR #520) | `9d0fe9ca` | D4: a direct Close refused because an exception is pending now reads "An exception has been requested on this action. Approve or refuse the exception first." (en + ar). The fixed closure guard sentences pass through `updateCorrectiveAction`; any other database text stays sanitised. Test `src/test/correctiveActionStatusRefusal.test.js`. |
| `claude/closure-workflow-7rxp2t` (PR #520) | `c0c03df4` | Test mock also accepts a trailing `.select()`, so the test passes before and after #519 ships. |

### Merge note for whoever merges #520 after #519

#519 (via #511) changed `updateCorrectiveAction` to `.select('id')` + `expectRows` (zero-row refusals). #520 now
maps guard refusals in the same function. The integration branch carries the combined version: map
`result.error` through `actionWriteError` first, then `expectRows`. Use that resolution when #520 is rebased.

## Other observations (not app defects)

- With D1 fixed, the creator of an unassigned action counts as its assignee (`corrective_action_is_assignee`), so
  `clo.collector` now gets Submit and the exception link on the "Brakes" action it created. Round 3 recorded "no
  panel" only because the permission read came back null. The spec's case name `collector_on_unassigned` is
  misleading; the behaviour matches the database writer.
- Tire Planning Engineer is in the default `ca_reviewer_roles`, and reviewers may ask for an exception, so the
  exception link is now offered to that role. Round 3's expectation "no exception link" was taken while D1 hid
  every link. Owner to confirm whether Tire Planning Engineer should keep exception requests.

## Spec changes in this round (tests only)

- `round2_closure.cjs`: new cases `exception_history`, `exception_people`, `exception_closed_view`,
  `exception_self_decide_db`, `exception_self_decide_request_alone_db`, `exception_self_decide_after`
  (database-level refusal when the same person asks and decides, run in a rolled-back transaction).
