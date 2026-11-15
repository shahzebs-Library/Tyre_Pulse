# Round 2 browser tests (stream BROWSER2)

Date 2026-11-15. Branch `claude/round2-browser-tests-7rxp2t` (from the browser test branch of PR #517, with
PR #518, #519 and #520 merged in; the position service branch was not merged).

**Production was not touched.** One read-only question was asked of production (which module switches five roles
hold today, role names and on or off only) so the test copy could carry the same switches. Everything below ran on
a local copy of the synthetic staging database (`tp_browser2`, companies Alpha, Beta, Gamma) with invented people.
Nothing here is proven on real data.

## How it was run

- Same harness as PR #517 (`e2e/staging`): the built web app in headless Chromium (Playwright), a real PostgREST on
  the database copy, the local sign-in stand-in. No second harness.
- Database copy prepared by `e2e/staging/round2_setup.sh`: closure fixture, then the drafts
  `20261113130000`, `20261115160000`, `160500`, `161000` (work orders, documented order), then `20261116100000`,
  `20261116101000` (closure). All six applied without error. The Recall Tracker fix needs no draft.
- One `vite build` of the merged code: passed.
- Specs: `e2e/staging/specs/round2_recall.cjs`, `round2_work_orders.cjs`, `round2_closure.cjs`,
  `round2_responsive.cjs`. Results as JSON in `$E2E_RUN/results_r2/` (outside the repository).
- Not available locally, so Not Tested: photo storage, emails, push, live updates, MFA, the phone apps.
- Merge note: one conflict, `supabase/pending_migrations/README.md` (both sections kept). Draft numbers `160000`
  and `161000` exist twice with different names (PR #518 and PR #519); both files kept, renumber before any apply.

## Result counts

| Area | Steps | Verified Passed | Verified Failed | Not Tested |
|---|---|---|---|---|
| 1. Recall Tracker | 6 | 6 | 0 | 0 |
| 2. Work orders (8 roles) | 15 | 11 | 3 | 1 |
| 3. Corrective actions | 13 | 11 | 2 | 0 |
| 4. Checklists | 11 | 9 | 1 | 1 |
| 5. Phone width and Arabic (two new panels) | 3 | 2 | 1 | 0 |

"Verified Failed" means the screen did something a user or the owner decision would not accept. The database rules
themselves held in every case tried: no refused action was written.

## 1. Recall Tracker (PR #518): Verified Passed

Admin, Alpha company.

| Step | Result | Evidence |
|---|---|---|
| Create on the KSA view | Passed | Country preset "KSA"; saved; row `R2RC-KSA-1`, country `KSA`, Alpha company |
| Create on the All view, no country picked | Passed | Form stays open with "Choose the country this recall applies to"; 0 rows written |
| Same form, pick UAE, save | Passed | Row `R2RC-ALL-1`, country `UAE` (one country, not a list) |
| Record listed after save | Passed | Both numbers on the page |
| `/recalls/:id` opens | Passed | Heading shows the recall number for both records, no failed request |
| Other company and lower role | Passed | Beta Admin does not see either record; opening the id shows "Recall not found"; Alpha Manager gets Access Restricted |

## 2. Work orders (PR #519)

People: Admin, Manager (KSA), Workshop Supervisor all sites, Workshop Supervisor North plant only, Tire Planning
Engineer, Tyre Man, Mechanic, Tyre Data Collector. Eight marked synthetic job cards (open general, open tyre,
assigned to the Tyre Man and the Mechanic, East plant, closed, approved cost, parts cost, waiting for quality check).

### What each role got

| | Admin | Manager | Supervisor (all) | Supervisor (North) | Tire Planning Engineer | Tyre Data Collector | Tyre Man, Mechanic |
|---|---|---|---|---|---|---|---|
| Sidebar: Work Orders | yes | yes | yes | yes | yes | yes | Tyre Man has a "Work" tab, Mechanic no |
| Sidebar: Live Control | yes | yes | yes | yes | no | yes | no |
| Work Orders page | opens | opens | opens | opens | opens | opens | Access Restricted |
| Create | saved | saved | saved | North saved; East refused "You do not have permission to do that." | only "Tyre Change" offered; saved | saved | no page |
| Edit open job | saved | saved | saved | saved; East job not listed | tyre job saved; others disabled "Your role manages tyre work orders only." | saved | no page |
| Status move | saved | saved | saved | saved | saved (tyre job) | saved | no page |
| Assign (Live Control) | saved | saved | saved | saved; East job not on board | no page | disabled "You are not allowed to assign this work order." | no page |
| Quality check pass | Completed, passed | same | same | same | no page | same | no page |
| Cost on approved job | saved | refused "The cost of this work order was approved. Only an Admin can change an approved cost." | refused, same | refused, same | disabled | refused, same | no page |
| Edit closed job | saved | disabled "This work order is closed. Only an Admin can change a closed work order." | disabled | disabled | disabled | disabled | no page |
| Delete | button, row removed | no button | no button | no button | no button | no button | no page |
| Live Control page | opens | opens | opens | opens | Access Restricted | opens | Access Restricted |

Second pass, Work Orders switched on for Tyre Man and Mechanic in the test copy only: create disabled ("Your role
cannot create work orders..."), every edit disabled, status move disabled on a job not assigned to them (row stayed
Open), status move on their assigned job saved (Waiting for Parts). Switch put back afterwards.

### Against the owner decision

| Owner decision | Result |
|---|---|
| Managers create, assign, update and manage within company and sites | Verified Passed |
| Workshop Supervisors the same for their sites, plus Live Control | Verified Passed (own site and other site both proven) |
| Tyre Engineers: tyre work orders | Verified Passed |
| Tyremen and technicians: progress and evidence on own assigned job only | Rule Verified Passed with the module switched on. **Verified Failed as shipped**: neither role can open Work Orders or Live Control on the web (W4). Evidence upload: Not Tested (no storage locally, and no upload control on these pages) |
| Delete, approved cost, closed records stay Admin only | Verified Passed for every non-Admin role |

### Defects

| # | Severity | What happens | Where | Suggested fix |
|---|---|---|---|---|
| W1 | High | Saving the job card form sets Parts Cost to 0 on any job that has a parts cost but no parts lines typed in the app (all imported job cards). Seen on every role: 1,775.82 became 0.00 after editing only "Scope". Admin editing a closed job did the same (1,154.34 to 0.00). On main today as well; the drafts make it visible | `src/pages/WorkOrders.jsx:549` | Only send `parts_cost` when the parts lines were changed, or when the row already has lines. Never overwrite a stored cost with a derived 0 |
| W2 | High | Because of W1, a Manager or Supervisor cannot save ANY change to a job with an approved cost. Editing "Scope" only is refused with the approved cost sentence, which is not what they did | same line; guard is correct | Fix W1. The guard then sees no cost change |
| W3 | Medium | Admin can silently lower an approved cost and a closed job's cost through W1 (approved job 100.00 to 0.00 while editing Tyre Cost) | same | Fix W1 |
| W4 | Medium | Tyre Man and technicians have no web screen for their own assigned job. Work Orders is off for Tyre Man and absent for trade roles (same on production), and draft `161000` only opens it for supervisors. Tyre Man's "Work" tab leads to Access Restricted | `supabase/pending_migrations/20261115161000_wo_supervisor_module_visibility.sql`; `src/components/Layout.jsx:569` | Owner to decide: phone only (then hide the tab), or add the module rows for the assigned-only roles |
| W5 | Low | Saving the form also rewrites the stored status "Open" to "New" when the person did not touch the status | `src/lib/jobCard.js:480` | Send status only when changed |
| W6 | Low | A job created from the form has no country (Country field starts empty on the All view) | `src/pages/WorkOrders.jsx` create path | Fill country from the asset register lookup or the working country; require it |
| W7 | Low | The detail drawer's Edit button has two `title` attributes; the second wins, so the refusal reason never shows there | `src/pages/WorkOrders.jsx:1184-1185` | One `title`: locked text, else the reason |
| W8 | Low | For a technician, every job that is not theirs says "You can record progress on this work order but not change its details", and the disabled status buttons give no reason | `src/lib/workOrderAccess.js:192-201`; `src/pages/WorkOrders.jsx:1089` | Use the "assigned to you only" sentence when progress is also refused; add a `title` to the status buttons |
| W9 | Info | Tyre Data Collector still creates, edits any site in the country, moves status, passes quality checks and opens Live Control (through Access Control, as the PR says). Not in the owner decision either way | PR #519 note | Owner to confirm |

## 3. Corrective actions (PR #520)

| Step | Result | Evidence |
|---|---|---|
| Assigned worker saves progress | Passed | "Update saved."; history `progress`; status Open to In Progress |
| Worker cannot close | Passed | Status box set to Closed: "This action was not updated. Only a Manager or an Admin can change a corrective action, or it no longer exists."; row still In Progress. No approve button shown |
| Worker submits evidence (note and photograph) | Passed | Preview shown; "Submitted. A reviewer will approve the closure or return it."; review state `submitted`, 1 photograph, status not Closed; badge "Waiting for review" |
| Another collector, not assigned | Passed | No submit, review or exception control |
| Reviewer returns with a comment | Passed | Return button disabled until a comment is typed; "Returned to the worker for correction."; state `returned` |
| Worker sees the comment and resubmits | Passed | "Reviewer asked for a correction: ..." shown; state `submitted` again |
| Reviewer approves | Passed | "Closure approved. The action is closed."; status Closed, state `approved`, closed by set |
| Self-review refused | Passed | Manager who submitted sees "You submitted this action, so another reviewer has to decide it.", no approve button; forcing Closed in the status box gives "You do not have permission to do that."; a different reviewer (Admin) then approved it |
| History shown | Passed | Five lines in order: progress, submitted, returned, submitted, approved, each with date, role and note |
| Exception by an authorised role with a reason | Passed | Button disabled for a short reason; "Exception recorded. The action is closed as an exception."; state `exception`, reason stored. Tire Planning Engineer and collectors are not offered it |
| Other company | Passed | Beta Manager does not see the action |

Tyre Man: `/actions` shows Access Restricted (module off, as on production).

### Defects

| # | Severity | What happens | Where | Suggested fix |
|---|---|---|---|---|
| C1 | High | Workshop Supervisor, a default reviewer, cannot reach Corrective Actions on the web at all. `/actions` sends them back to Checklists, even if the module is switched on, because the role is limited to checklist pages | `src/lib/checklistAccess.js:13,49-52` (`SUPERVISOR_WORK_PATHS`) | Add `'/actions': 'corrective_actions'` to the supervisor paths, and the module rows for both supervisor roles |
| C2 | Medium | The person who submitted can still close their own submission with "Close with a documented exception instead" (evidence below the table) | `supabase/pending_migrations/20261116100000_clo_corrective_action_review.sql:342` and the exception writer near line 466 | Refuse an exception from the submitter while the action is `submitted`, unless self-review is switched on |
| C3 | Low | History shows the role ("by a Manager") but not the person's name or the time of day | `src/components/correctiveActions/ClosureReviewPanel.jsx:230-234` | Show name and time (the event row has the actor id) |
| C4 | Low | Resubmitting without a photograph replaces the stored evidence (1 photograph became 0 on the action; the first set stays only in history) | submit writer in the same draft | Keep earlier photographs unless removed, or say so on screen |
| C5 | Low | A person with no rights on an action sees an empty "Closure review" box with only the heading | `ClosureReviewPanel.jsx:143` | Hide the panel, or say who the action is waiting for |
| C6 | Low | The worker's refusal sentence names "a Manager or an Admin" although reviewers are a per-company list | `src/lib/api/correctiveActions.js` | "Only a reviewer can close a corrective action. Submit it for review." |

C2 evidence (Verified Failed): the Manager submitted completion on "Checklist fault: Seat belts", was told another
reviewer has to decide it, then used the exception link on the same action. Message "Exception recorded. The action
is closed as an exception."; row Closed, state `exception`; history `submitted, exception`. The reason and the name
are kept, so it is visible afterwards, but the self-review rule is bypassed.

## 4. Checklists (PR #520)

| Step | Result | Evidence |
|---|---|---|
| Sheet with a fault cannot be approved | Passed | Approve disabled: "This sheet still has items marked as a fault, so it cannot be closed yet." |
| Site supervisor acknowledges a one-signature sheet with a fault | Passed | East supervisor, sheet at East: row `acknowledged`, locked, answer still "Not OK", acknowledged by name stored |
| Not shown as compliant | Passed on the sheet page | "Acknowledged, 1 fault open"; sign-off line "Acknowledged with a recorded fault"; compliance view `compliant=false`, `fault_open` |
| Supervisor of another site | Passed | North supervisor cannot open the East sheet |
| Person who filled the sheet | Passed | "You submitted this checklist, so another signer has to acknowledge it." (supervisor and area manager cases) |
| Two-signature sheet, first signer | Passed | "Give the supervisor signature first. The final signer then acknowledges the fault."; supervisor signs; row `pending_area_manager` |
| Role that is not a signer | Passed | Collector: "Only a final signer can acknowledge this checklist."; Tyre Man sees the sheet read-only, no control |
| Final signer acknowledges | Passed | Admin: row `acknowledged`, locked, supervisor signature kept, answers unchanged |
| Exception on the fault's corrective action, with a reason | Passed | Manager records it; sheet reads "Acknowledged, compliant by exception", fault line "Exception recorded"; view `compliant=true`, `exception`. A collector is not offered the exception |

No raw database text appeared in any message in sections 1 to 4 (every captured message was checked against the
harness pattern for constraint, column, policy and error code text).

### Defects

| # | Severity | What happens | Where | Suggested fix |
|---|---|---|---|---|
| K1 | Medium | The Checklists list shows an acknowledged sheet as "Pending approval" and counts it in that tile | `src/lib/checklistWorkspaceView.js:65-73` (`workspaceBucket`) | Add an "Acknowledged with fault" bucket, not in the pending count |
| K2 | Medium | Found by reading the code, Not Tested in the browser: the Audit Pack does not know the new status. It would print the raw word `acknowledged`, and such sheets are neither "waiting" nor "approved" in its totals | `src/lib/checklistAuditPack.js:98-99,277,288` | Add the label; decide how auditors should see it (not compliant until resolved) |
| K3 | Low | After acknowledging, the confirmation sentence never appears: the page reloads the sheet and the panel is rebuilt | `src/components/checklist/ChecklistFaultPanel.jsx:86-87`, `src/pages/ChecklistSubmission.jsx:508` | Show the confirmation from the page, or keep the panel mounted |
| K4 | Info | Test fixture only: `supabase/tests/closure/fixture.sql` templates have no `options_ref`, so the screen saw no fault where the database did. The harness adds it. Real templates carry it | fixture | Give the fixture the real shape |

## 5. Phone width (390 px) and Arabic, the two new panels

| Check | Result | Evidence |
|---|---|---|
| Layout at 390 px, English and Arabic | Passed | Closure review panel 343 px, fault panel 313 px, page width 390, no element outside the screen, in worker, reviewer, acknowledge and acknowledged states |
| Raw keys | Passed | None in either panel, either language |
| Arabic text | **Verified Failed** | Closure review panel: 0 Arabic words, all English. Fault panel: English sentences with single words swapped by the old phrase bridge, for example "Acknowledged, 1 fault مفتوح". Direction is right to left |

| # | Severity | What | Where | Suggested fix |
|---|---|---|---|---|
| A1 | Medium | Both new panels and their messages are hard-coded English | `src/components/correctiveActions/ClosureReviewPanel.jsx`, `ClosureReviewSettings.jsx`, `src/components/checklist/ChecklistFaultPanel.jsx`, sentences in `src/lib/closureWorkflow.js` | Move to `t()` keys in `en` and `ar` |
| A2 | Low | Two links are 15 to 16 px tall on a phone ("Close with a documented exception instead", "Open corrective actions") | same panels | Give them the 40 px control height used by the buttons |

## What is and is not proven

- Proven on synthetic data only, in a real browser: the tables above.
- Not Tested: production, real photographs through storage, emails and push, the Expo and Flutter apps against the
  new rules, the Approvals queue page for acknowledged sheets, a company with a narrowed reviewer list on screen,
  Director and Maintenance Supervisor on work orders, work orders under a single-country view.

## Order and rollback

Unchanged from the three PRs. Nothing here adds SQL. Fix W1 in the web build before applying the work order
drafts, or supervisors and managers will be refused on every job with an approved cost.
