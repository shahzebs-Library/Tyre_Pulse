# Round 3 browser tests (2026-11-15)

**Environment: local synthetic staging, NOT production.** Database `tp_browser4` on a local PostgreSQL 16
(127.0.0.1:54329), a copy of the synthetic Alpha/Beta/Gamma staging data with every work order draft (incl. the
cost ledger) and the three closure drafts applied there only. Web build from branch
`claude/round3-integration-7rxp2t` (main + PR #519 with #528 + PR #520), served locally, driven by Playwright
(Chromium). Nothing was applied to production; production was not touched.

Every case reads the database before and after; a screen that only looks right does not pass.
Raw results: `$E2E_RUN/results_r2/*.json`, `$E2E_RUN/results_r3_*.out` (outside the repository).

Spec changes in this round (tests only, no `src/` change):
- `round2_work_orders.cjs`: added `r2.monitor` (Data Monitor Officer, all sites); the save helper now waits up to
  8 s for the dialog to close or an alert to appear (a fixed 2.5 s wait read a slow but successful save as
  "form still open" for Admin on the first edit after a create; a manual re-run proved the save works).

## Summary

Counts are table rows below (one row can cover several roles or both languages).

| Spec | Verified Fixed | Verified Failed | Not Tested |
|---|---|---|---|
| round3_ledger (cost ledger) | 17 | 0 | 0 |
| round2_work_orders (9 roles) | 28 | 1 (D3, pre-existing) | 0 |
| round2_closure actions | 23 | 1 (D1) | 2 (blocked by D1) |
| round2_closure checklists | 12 | 1 (D1) | 3 |
| round2_responsive (390 px, en + ar) | 3 | 0 | 1 |

## Real app defects

| # | Severity | Where | Evidence | Fix |
|---|---|---|---|---|
| D1 | P1 | `supabase/pending_migrations/20261116100000_clo_corrective_action_review.sql` line 353 (PR #520), `corrective_action_my_permissions` | On an action that was never submitted, `review_status` is NULL, so `v_exc_pending := a.review_status = 'exception_requested'` is NULL and `can_request_exception` (and `can_review`, `can_decide_exception`) come back `null`. Called as `alpha.manager` on action `...0006`: `{"can_request_exception": null, "can_review": null, ...}`. The panel fails closed, so "Ask for a documented exception instead" is never offered on an open action (Manager on T6, Manager on the Horn fault action, worker on T1 before submit). Once the action has a review status the link appears. | `v_exc_pending := coalesce(a.review_status = 'exception_requested', false);` (the writers already test `if a.review_status = 'exception_requested'`, which is safe). Re-run `node specs/round2_closure.cjs` after applying. |
| D2 | P3, pre-existing (not #519/#520) | `src/hooks/useRealtimeAlerts.js:295` | Page error in the North supervisor session: `cannot add postgres_changes callbacks for realtime:tp-db-notifications after subscribe()`. The hook is mounted twice (`Layout.jsx` and `NotificationCenter.jsx`), both call `supabase.channel('tp-db-notifications')`; the second gets the already subscribed channel and `.on()` throws. Intermittent. | Give each subscription its own name, e.g. `.channel(\`tp-db-notifications-${user.id}-${Math.random().toString(36).slice(2)}\`)`. |
| D3 | P3, pre-existing (also in round 2) | `src/components/workorders/JobCardForm.jsx:120-125` | New work orders created by KSA-only users with the scope bar on All are stored with `country` NULL (Manager WO-2026-00002, Workshop Supervisor all sites WO-2026-00003, Tire Planning Engineer WO-2026-00006). The asset (MP001, KSA) fills the site but not the country. A NULL country row is visible to every country scope. | Add `country: asset.country,` to the `fill` object (the `country` field is already editable in `jobCard.js`). |
| D4 | P3, minor message | corrective action status guard (PR #520) | Manager setting status Closed on an action with an exception pending gets "This record changed since you opened it. Refresh and try again." (PT409 mapped to the stale-record message), while the same attempt on a submitted action reads "You do not have permission to do that." DB stays open both times (correct). | Map the guard's PT409 text through (as `WO_REFUSAL` does for work orders) so the person reads "An exception has been requested on this action...". |
| D5 | P3, a11y, pre-existing | `src/components/checklist/SignatureField.jsx` | "Draw a new signature" link is 16 px tall at 390 px (en and ar). | Give it `min-h-[40px] inline-flex items-center`. |

## round3_ledger (from `results_r3_ledger.out`, run earlier on the same stack)

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| managerAdds | Manager | Add a cost line as a draft | Line shown under "Not approved yet" | `pending_reconciliation recon=cannot_tell amount=20.00` | Verified Fixed |
| managerAddsPartsCostAfter | Manager | Stored parts cost untouched | 250.00 before and after | `parts_cost=250.00` | Verified Fixed |
| managerSelfApprove | Manager | No approve control on own line | Not offered | still `pending_reconciliation` | Verified Fixed |
| selfApproveDb | Manager | Database refuses self approval | Refused | "You entered this cost, so another person has to decide it." | Verified Fixed |
| selfApproveDbStatus | Manager | Line unchanged | unchanged | `pending_reconciliation` | Verified Fixed |
| supervisorApproves | Workshop Supervisor | Not an approver of cost | Not offered | `decided_by=-` | Verified Fixed |
| adminApproves | Admin | Independent approval | Approved, total 621.00 | `approved decided_by=alpha.admin` | Verified Fixed |
| collectorAddsUnassigned | Tyre Data Collector | No add on a job not assigned | Not offered | no row | Verified Fixed |
| collectorAddsAssigned | Tyre Data Collector | Add on assigned job | Draft line | `pending_reconciliation amount=15.00` | Verified Fixed |
| collectorApproveOwn | Tyre Data Collector | Not offered | Not offered | `decided_by=-` | Verified Fixed |
| collectorApproveDb | Tyre Data Collector | Database refuses | Refused | "You are not allowed to approve costs on this work order." | Verified Fixed |
| collectorReverseDb | Tyre Data Collector | Database refuses reverse | Refused | same message | Verified Fixed |
| managerApprovesCollector | Manager | Independent approval | Approved, total 1,706.28 | `approved decided_by=alpha.manager` | Verified Fixed |
| monitorClose | Data Monitor Officer | Cannot close | Button disabled | status stays `Quality Inspection` | Verified Fixed |
| technicianSubmit | Technician (My Jobs) | Submit work done, cannot close | Submit offered, close explained | `Quality Inspection`, event `complete_task` | Verified Fixed |
| supervisorClose | Workshop Supervisor | Closes after QC | Closed | `Completed` | Verified Fixed |
| supervisorCloseClosedAt | Workshop Supervisor | Close time stamped | stamped | `2026-11-15 13:17:03+00` | Verified Fixed |

## round2_work_orders (9 roles)

Fixture jobs: GENERAL (North, Open), TYRE (North, Tyre Change), EAST (East), ASSIGNED, PARTS, APPROVED (approved
cost), CLOSED (Completed), QC (Quality Inspection). Fixtures reset between roles.

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Sidebar + open | Admin | Work Orders, Live Control | both shown, page opens | n/a | Verified Fixed |
| Create own site | Admin | Created | created | WO-2026-00008 North, status New | Verified Fixed |
| Edit open / other site / assigned / parts job | Admin | Saved | saved | scope changed on all four | Verified Fixed |
| Approved cost / scope; closed job | Admin | Admin only may change | saved | `tyre_cost=777`; closed scope changed | Verified Fixed |
| Status move | Admin | Allowed | Awaiting Assignment | status in DB | Verified Fixed |
| Delete | Admin | Admin only | deleted | row count 0 | Verified Fixed |
| Live Control: assign, move, QC | Admin | Allowed | Technician assigned, In Progress, QC pass | 1 active assignment, owner set | Verified Fixed |
| Create / edit open, other site, assigned, parts | Manager (KSA, all sites) | Allowed | saved | scope changed | Verified Fixed |
| Approved cost | Manager | Refused | "Only an Admin can change an approved cost." | tyre_cost unchanged (403) | Verified Fixed |
| Scope on approved job | Manager | Allowed | saved | scope changed | Verified Fixed |
| Closed job | Manager | Refused | Edit disabled | unchanged | Verified Fixed |
| Delete | Manager | Not offered | absent | n/a | Verified Fixed |
| Live Control | Manager | Assign, move, QC | allowed | assignment + status in DB | Verified Fixed |
| Same set as Manager | Workshop Supervisor (all sites) | Same as Manager | identical | identical | Verified Fixed |
| Create own site | Workshop Supervisor (North) | Created | created | WO-2026-00004 North, country KSA | Verified Fixed |
| Create other site (East asset) | Workshop Supervisor (North) | Refused | "You do not have permission to do that." | not created (403) | Verified Fixed |
| Other site job listed | Workshop Supervisor (North) | Not visible | not listed, not on board | n/a | Verified Fixed |
| Edit own site, approved cost, closed | Workshop Supervisor (North) | As Manager | as Manager | as Manager | Verified Fixed |
| Job types offered | Tire Planning Engineer | Tyre Change only | Tyre Change only | n/a | Verified Fixed |
| Create tyre job / edit tyre job / move tyre job | Tire Planning Engineer | Allowed | created, saved, Awaiting Assignment | WO-2026-00006, scope, status | Verified Fixed |
| Edit general, other site, assigned, parts, approved, closed | Tire Planning Engineer | Refused | Edit disabled on all six | unchanged | Verified Fixed |
| Live Control | Tire Planning Engineer | Not offered | Access Restricted | n/a | Verified Fixed |
| Work Orders route | Tyre Man, Mechanic | Lands on My Jobs | heading My Jobs | n/a | Verified Fixed |
| Live Control | Tyre Man, Mechanic | Refused | Access Restricted | n/a | Verified Fixed |
| Create / edit open, other site, assigned, parts | Tyre Data Collector | Allowed (keeps Access Control) | saved | scope changed | Verified Fixed |
| Approved cost, closed job, assign owner | Tyre Data Collector | Refused | refused / disabled / "not allowed to assign" | unchanged | Verified Fixed |
| Create | Data Monitor Officer | Refused | New disabled with reason | n/a | Verified Fixed |
| Edit any job, status move | Data Monitor Officer | Refused | Edit and status buttons disabled | status stays Open | Verified Fixed |
| Live Control | Data Monitor Officer | Refused | "Your role does not have permission to access this module." | n/a | Verified Fixed |
| Country on created job | Manager, Supervisor (all), TPE, Admin | Country from the asset | NULL | see D3 | Verified Failed (pre-existing, D3) |

No page errors and no raw database text on any role. The only failed requests are the expected 403 refusals.

## round2_closure actions

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Worker opens assigned action | Tyre Data Collector | Submit and progress offered | offered | n/a | Verified Fixed |
| Save as progress | Tyre Data Collector | History event, stays open | "Update saved." | event `progress`, status In Progress | Verified Fixed |
| Close by status field | Tyre Data Collector | Refused | refused, plain message | unchanged | Verified Fixed |
| Photo + submit | Tyre Data Collector | Submitted, not closed | "Submitted..." | `review_status=submitted`, 1 photo | Verified Fixed |
| Another collector, not assigned | Tyre Data Collector 2 | Read only | no controls, waiting text | n/a | Verified Fixed |
| Return needs a comment | Manager | Disabled without comment | disabled | n/a | Verified Fixed |
| Return for correction | Manager | Back to worker with comment | "Returned..." | `review_status=returned`, comment stored | Verified Fixed |
| Worker sees return and resubmits | Tyre Data Collector | Comment shown, resubmit | resubmitted | events progress,submitted,returned,submitted | Verified Fixed |
| Supervisor reaches /actions, reviews own site | Workshop Supervisor (North) | Approve offered | approved, closed | `Closed`, `approved`, closed_by set | Verified Fixed |
| History | Manager | Who, role, when, comment | 5 entries with names and roles | events table | Verified Fixed |
| Self submit then decide | Manager | Cannot approve own submission | no approve control, "another reviewer" text | still submitted | Verified Fixed |
| Self close by status | Manager | Refused | "You do not have permission to do that." | unchanged | Verified Fixed |
| Supervisor (North) on East action | Workshop Supervisor (North) | Not visible | not listed | unchanged | Verified Fixed |
| Independent reviewer approves | Admin | Approved | "Closure approved." | `Closed` | Verified Fixed |
| Exception on an open action | Manager | Link offered | not offered | `can_request_exception=null` | Verified Failed (D1) |
| Exception approve path | Admin | Approves a pending exception | not reachable (no request could be made) | n/a | Not Tested (blocked by D1) |
| Short reason disabled | Manager | Disabled under 10 characters | not reached on T6 | n/a | Not Tested (blocked by D1) |
| Submitter requests exception on own submission | Manager | Allowed to ask | requested | `review_status=exception_requested` | Verified Fixed |
| Requester cannot decide | Manager | Blocked | self-block notice | n/a | Verified Fixed |
| Requester closes by status | Manager | Refused | refused (message, D4) | unchanged | Verified Fixed |
| Different person refuses exception | Admin | Back to worker | "Exception refused." | `returned`, comment stored | Verified Fixed |
| TPE on open action | Tire Planning Engineer | Can work on it, no exception link | as expected | n/a | Verified Fixed |
| Collector on unassigned action | Tyre Data Collector | No panel | no panel | n/a | Verified Fixed |
| /actions route | Supervisors North, East | Allowed | open | n/a | Verified Fixed |
| /actions route | Tyre Man | Refused | Access Restricted | n/a | Verified Fixed |
| Other company | Beta Manager | Does not see Alpha action | not seen | n/a | Verified Fixed |

## round2_closure checklists

| Case | Role | Expected | Observed | Database evidence | Status |
|---|---|---|---|---|---|
| Approve a sheet with a fault | Workshop Supervisor (East) | Refused | Approve disabled with reason | unchanged | Verified Fixed |
| Acknowledge with fault | Workshop Supervisor (East) | Allowed with signature | acknowledged (saved signature pre-filled) | `acknowledged`, locked, signature stored, answers unchanged | Verified Fixed |
| Compliance after acknowledge | n/a | Not compliant while fault open | `fault_open`, compliant false | `v_checklist_fault_compliance` | Verified Fixed |
| List label | Workshop Supervisor (East) | "Acknowledged, Action Required", not pending | label shown, Pending approval 0, Action required 1 | n/a | Verified Fixed |
| Viewer drawer label | Workshop Supervisor (East) | Label shown | row locator found nothing | n/a | Not Tested (spec locator stale) |
| Audit Pack tile | Workshop Supervisor (East) | Tile | route refused for this role (author roles only) | n/a | Not Tested (needs an author role) |
| Other site supervisor | Workshop Supervisor (North) on East sheet | Not visible | refused / not found | n/a | Verified Fixed |
| Own sheet | Workshop Supervisor (North) | Cannot acknowledge own | "another signer has to acknowledge it" | n/a | Verified Fixed |
| Two-stage first signature | Workshop Supervisor (North) | First signature only | signed | `pending_area_manager`, supervisor signed | Verified Fixed |
| Collector | Tyre Data Collector | Cannot acknowledge | "Only a final signer can acknowledge" | n/a | Verified Fixed |
| Area manager on own sheet | Workshop Maintenance Area Manager | Refused | "another signer has to acknowledge it" | n/a | Verified Fixed |
| Tyre Man | Tyre Man | Read only | label shown, no controls | n/a | Verified Fixed |
| Final signer acknowledges two-stage | Admin | Allowed after first signature | acknowledged | `acknowledged`, both signatures | Verified Fixed |
| Exception on the fault's action | Manager | Link offered | not offered | `can_request_exception=null` | Verified Failed (D1) |
| Sheet compliant by exception | Admin | "compliant by exception" | not reached | still `fault_open` | Not Tested (blocked by D1) |
| Collector on another action | Tyre Data Collector 2 | No panel | no panel | n/a | Verified Fixed |

## round2_responsive (390 x 844, English and Arabic)

The spec found no action in `submitted` state after the closure run reset, so the reviewer-view panel was not
measured (2 cases Not Tested). Measured: open action panel and two checklist fault panels, each in en and ar.

| Case | Expected | Observed | Status |
|---|---|---|---|
| Open action panel en / ar | No overflow, rtl in ar, no raw keys | width 390, no overflow, dir rtl, 0 Latin words in ar | Verified Fixed |
| Pending sheet panel en / ar | Same | no overflow, rtl; "Draw a new signature" 16 px tall | Verified Fixed (D5 minor) |
| Acknowledged sheet panel en / ar | Same | no overflow, rtl | Verified Fixed |
| Reviewer panel (submitted action) en / ar | Same | no submitted action in fixture at run time | Not Tested |

Screenshots: none kept (no overflow found; the JSON results carry the measurements).
