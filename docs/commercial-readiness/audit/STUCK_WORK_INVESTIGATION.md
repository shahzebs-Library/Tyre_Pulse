# Stuck work investigation: open corrective actions and checklists waiting for sign-off

Date: 2026-11-12. Database: production (project jhssdmeruxtrlqnwfksc), read-only.
Scope: the 159 open corrective actions (2 closed) and the 90 checklist sheets waiting for sign-off
reported as MODB-14.

**Nothing was changed.** No action was closed, no sheet was approved or rejected, no row was edited.
Every figure below comes from SELECT statements. Permission answers come from calling the live
permission functions while impersonating each role inside a transaction that was rolled back. One of
those probes used a temporary table inside the rolled-back transaction to collect its output; it
left nothing behind, and the later probes used plain SELECT only.

No names, emails or record contents appear here. Counts, roles, sites and dates only.

## 1. Short answer

| Question | Answer |
|---|---|
| Are the 159 open actions genuine work? | Partly. 28 are already fixed on the vehicle (a later sheet shows the item OK), 12 are confirmed still faulty, 104 have never been looked at again, 15 are ordinary recent actions. |
| Are they stuck because of a fault in the system? | Yes, mostly. 144 of them were created in one batch on 2026-11-08, are unassigned, were overdue the day they were created, and can be closed only by 4 people, none of whom has worked the list. |
| Did the automatic trigger create duplicates? | No exact duplicates. 12 rows are the same fault on the same vehicle reported again on a later daily sheet (a repeat finding, which is real information). |
| Are the 90 sheets waiting because people are slow? | No. 58 of the 90 cannot be given final approval by anyone, because the system refuses to close a sheet that still has an item marked "Not OK" and there is no screen to correct that mark. The other 32 are waiting on one person who last signed on 2026-10-07. |
| Is anyone allowed to act? | Yes, people with the right exist for every step. The fault is not a missing permission to approve; it is a rule that makes approval impossible plus a process that depends on one person. |

## 2. Corrective actions (159 open, 2 closed)

### 2.1 Where they came from

| Source | Open | Created | Notes |
|---|---|---|---|
| Checklist fault trigger | 144 | all on 2026-11-08 | One batch. The "raise corrective actions for existing sheets" run, covering 59 Workshop Daily Checklist sheets submitted between 2026-08-19 and 2026-11-04 |
| Inspection defect ("Raise action") | 8 | 2026-11-08 to 2026-11-11 | 7 assigned to a person, due 2026-11-12 to 2026-11-22 |
| Entered by hand | 7 | 2026-07-13 to 2026-11-08 | All by an Admin; 3 overdue, 1 assigned |
| Closed | 2 | closed 2026-07-12 and 2026-08-08 | Both by an Admin |

Age by creation date: 156 created in the last 7 days, 2 in the last 30, 1 older than 90 days. The
creation date hides the real age of the 144: the faults they describe were written on sheets that
are 0 to 14 days old (7 actions), 15 to 30 days (79), 31 to 60 days (35) and over 60 days (23).

### 2.2 The 144 checklist actions, classified

Every one of the 144 comes from an item marked "Not OK" on a Workshop Daily Checklist. For each, the
later sheets for the same vehicle and the same form were checked for the same item.

| Group | Count | Evidence | What it is | Recommended action |
|---|---|---|---|---|
| A. Fixed since | 28 | The most recent later sheet for the same vehicle marks the same item OK (26), Changed (1) or Repaired (1) | Stale. The fault was dealt with in the workshop and nobody closed the action | Owner or a Manager closes these with the later sheet's number as the closure note. Safe to do in one sitting from a list |
| B. Still faulty | 12 | The most recent later sheet still marks the item Not OK | Genuine and persistent. These are also the 12 "repeat" rows (same vehicle, same item, two sheets) | Assign each to a named technician with a date; raise a job from the action so parts and labour are tracked |
| C. Never re-checked | 104 | No later sheet exists for that vehicle on this form | Unknown. Genuine until someone inspects the vehicle | Do not close in bulk. Have the workshop supervisors re-check these vehicles on the next daily sheet; group A and B then sort themselves |

Most frequent items across the 144: cabin shock absorber and bush (16 actions, 13 vehicles), main
chassis and sub chassis (15, 14), seat and seat belts (14, 12), glasses, mirrors, wipers and wash
(14, 13), tyres and wheel bolts (13, 12), foot brake and hand brake (8, 8). Brakes, seat belts and
wheel bolts are safety items; group C contains them and should be re-checked first.

By site (open): NHC 71, DIRIYAH-G1 28, QIDDIYA-LOWER PLATEAU 20, DIRIYAH-G2 13, QIDDIYA-UPPER
PLATEAU 9, RIY-MET 8, KSP-TP 5, RED SEA 4, AMAALA 1. All KSA. 57 vehicles are involved.

### 2.3 Duplicates

- Exact duplicates (same sheet, same item, same vehicle): **0**. The trigger checks for an existing
  action for the sheet and item before inserting, and that check holds.
- Same vehicle and same item from two different sheets: 12 pairs (12 extra rows). These are repeat
  findings on a later day, not duplicates. They are group B above.
- An average of 2.4 actions per sheet, at most 8 from one sheet. That is one action per faulty item,
  as designed.

### 2.4 Why they are not being closed

1. **Nobody was told.** 151 of the 159 open actions have no assignee. The batch of 144 was created
   with the sheet's submitter as creator and no owner, so they appear in no one's task list.
2. **They were born overdue.** The due date is set from the priority: High is 72 hours after
   creation. The 144 were created on 2026-11-08 as High, so all of them became overdue on
   2026-11-11, three days after a batch that described faults up to 81 days old. 147 of 159 are
   overdue today, which makes the overdue figure useless as a signal.
3. **Only 4 people can close one, and the people who do the repairs are not among them.** The
   update rule on corrective actions admits the roles Manager and Admin, plus anyone holding the
   corrective_actions edit capability. Confirmed by impersonation: the capability is off for every
   other role checked (Workshop Supervisor, Maintenance Supervisor, PMV Manager, Workshop
   Maintenance Area Manager, Fleet Supervisor, Inspector, Tyre Man, Tyre Data Collector, Data
   Monitor Officer, Reporter). So 2 Admins and 2 Managers in the company can close an action. The
   7 Workshop Supervisors and the Maintenance Supervisor, who submitted the sheets and supervise the
   repairs, cannot.
4. **When one of them tried, nothing told them it failed.** Until today's fix a refused status
   change changed nothing and showed no error (MODB-7). The audit log shows the consequence: in the
   whole life of the table there are 3 updates to a corrective action, all by an Admin or the
   system. No Manager has ever changed one.
5. **Closing the action does not close the sheet, and closing the sheet does not close the
   action.** The two records are linked only by a reference. See section 3.3.
6. **No job is linked.** 0 of the 159 open actions has a work order. A Manager cannot raise one
   today because Managers cannot create work orders (see CURRENT_PRODUCTION_FIXES_A.md, issue 1).

### 2.5 Recommended actions for the corrective action backlog

| Step | Who | What | Changes data? |
|---|---|---|---|
| 1 | Owner | Decide who closes corrective actions. Recommendation: give the corrective_actions edit capability to Workshop Supervisor and Maintenance Supervisor in Access Control, so the people who supervise the repair close it. No migration needed, the capability rule already exists | Access setting only |
| 2 | Owner or Manager | Close group A (28) citing the later sheet | Yes, after owner approval |
| 3 | Manager | Assign group B (12) and the safety items of group C to named people with real dates | Yes |
| 4 | Workshop supervisors | Re-check the remaining group C vehicles on the next daily sheet | New sheets only |
| 5 | Development (not done here) | When the trigger raises an action for an old sheet, set the due date from the sheet date or leave the batch as Medium, so a backfill is not instantly overdue; give the action an owner (the site supervisor) | Code change, needs a decision |
| 6 | Development (not done here) | Offer "close the action" when a later sheet marks the same item OK, Changed or Repaired, instead of leaving two records to drift | Code change |

## 3. Checklists waiting for sign-off (90)

### 3.1 What is waiting

All 90 are one form: **Workshop Daily Checklist**, which needs two signatures (supervisor, then area
manager).

| State | Count | Submitted | Age |
|---|---|---|---|
| Waiting for the first signature (pending) | 81 | 2026-09-12 to 2026-11-09 | 1 sheet 3 to 7 days, 59 sheets 8 to 30 days, 21 sheets over 30 days |
| Signed by a supervisor, waiting for the area manager | 9 | 2026-08-19 to 2026-09-19 | all over 30 days |

By site: NHC 37, DIRIYAH-G1 23, RIY-MET 8, QIDDIYA-LOWER PLATEAU 7, DIRIYAH-G2 7, QIDDIYA-UPPER
PLATEAU 4, KSP-TP 3, RED SEA 1. All KSA.

Submitted by: Workshop Supervisor 50 sheets, Maintenance Supervisor 39, Admin 1.

For comparison, the system has 38 approved sheets (last one approved 2026-10-07), 1 rejected and 4
that needed no approval. No sheet submitted after 2026-10-07 has been signed by anyone.

### 3.2 Who is allowed to sign, and do those people exist

| Step | Roles the database accepts | Active people | Has anyone in the role ever signed |
|---|---|---|---|
| First signature (supervisor) | Admin, Maintenance Supervisor, Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector | 2 + 1 + 7 + 1 + 0 + 1 + 7 = 19 | Only Workshop Maintenance Area Manager (41 supervisor signatures) and Admin (4) |
| Final approval (area manager) | Admin, Director, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager | 2 + 0 + 1 + 0 + 1 = 4 | Workshop Maintenance Area Manager (37 approvals), Admin (1) |

So the permission exists and the people exist. In practice **one person** (the single Workshop
Maintenance Area Manager) has done 41 of 45 first signatures and 37 of 38 final approvals, using the
rule that lets an area manager give both signatures in one step. That person's last decision was on
2026-10-07. The PMV Manager account has never signed and last signed in on 2026-08-13. The 7
Workshop Supervisors are allowed to give the first signature, including on their own sheets (the
database does not stop a submitter signing their own sheet), and none of them ever has.

Managers are not approvers for this form at all (role Manager is in neither list). That is by the
company's current design, noted as MODB-2 for the commercial product.

Sign-in activity in the last 7 days, by approver role: Admin 1 of 2, Tyre Data Collector 2 of 7,
every other approver role 0. Push notification tokens exist for 2 of 7 Workshop Supervisors, 0 of 1
PMV Manager and 1 of 1 Workshop Maintenance Area Manager, so most approvers are not being notified
on a phone either.

### 3.3 The structural fault: 58 of the 90 sheets cannot be closed by anyone

The approval guard on a checklist refuses the final "approved" state while any answer on the sheet
still carries a blocking mark ("Not OK"). The message is: the sheet "still has items marked Not OK.
It cannot be closed until they are corrected or re-marked."

- 58 of the 90 waiting sheets have at least one open corrective action raised from a "Not OK"
  answer: 49 of the 81 pending sheets and **all 9** of the sheets waiting for the area manager.
- The first signature is still allowed on such a sheet (so that a fault found at the end of the day
  can be recorded). The final approval is not.
- The area manager's usual one-step approval ends in "approved", so on those 49 pending sheets it
  is refused as well.
- **There is no screen that re-marks an answer on a submitted sheet.** The web service has an
  update function for a submission but nothing calls it; the detail screens are read-only. (Web:
  confirmed by reading the code. Flutter: the submission detail screen is read-only as documented;
  not exercised on a device.)
- Closing the corrective action does not change the answer on the sheet, so even a fully repaired
  fault leaves its sheet unclosable.

The only route out of the queue for those 58 sheets today is to reject them, which records a
repaired vehicle as a rejected inspection sheet. That is why they sit there.

This also explains part of the timeline: the approver kept pace until early October, the sheets
with faults accumulated because they could not be closed, and the queue then stopped moving
altogether.

### 3.4 The 90 sheets, classified

| Group | Count | Evidence | Recommended action |
|---|---|---|---|
| 1. Blocked by an uncorrected "Not OK", waiting for final approval | 9 | status pending_area_manager; every one has an open action from a blocking answer | Cannot be approved until the answer can be corrected. Needs the development change in 3.5. Do not reject them to clear the queue |
| 2. Blocked by an uncorrected "Not OK", waiting for the first signature | 49 | status pending; open action from a blocking answer | A supervisor can give the first signature now. Final approval needs the same change |
| 3. Clean sheets waiting for a signature | 32 | status pending; no blocking answer | Genuine outstanding sign-off. Any of the 4 final approvers can clear these in one step each. Oldest first; 59 of all pending sheets are 8 to 30 days old |

### 3.5 Recommended actions for the sign-off queue

| Step | Who | What | Changes data? |
|---|---|---|---|
| 1 | Owner | Confirm who signs while the area manager is away. The PMV Manager and both Admins can already give final approval; no permission change is needed | No |
| 2 | Final approvers | Sign the 32 clean sheets (group 3) | Yes, normal use of the product |
| 3 | Workshop supervisors | Give the first signature on group 2 so the record shows the supervisor has seen the fault | Yes, normal use |
| 4 | Owner decision, then development | Choose how a sheet with a fault is closed. Recommended: let the approver close it when every blocking item has a corrective action that is Closed (the repair is then on record in the action, and the original answer is kept as the evidence of what was found). Alternative: add a "re-mark as Repaired" control for supervisors, with the original mark kept in the history. Either needs a database change to the approval guard and a screen, and must be tested first | Not done; needs the owner's choice |
| 5 | Development (not done here) | Tell approvers. Only 3 of the 9 supervisor and area manager accounts have a phone registered for notifications | Operational |

## 4. What links the two queues

The two backlogs are one loop:

1. A supervisor marks an item "Not OK" on the daily sheet.
2. The trigger raises a corrective action. It has no owner and only a Manager or Admin can close it.
3. The sheet cannot be given final approval while the item says "Not OK", and nobody can change
   what it says.
4. Closing the action (if anyone could) would not release the sheet.

So the more faithfully the workshop reports faults, the more sheets become unclosable and the more
unowned actions pile up. The fix is a decision about step 3 (section 3.5, step 4) and about who
closes actions (section 2.5, step 1). Neither was applied here.

## 5. Evidence index (all read-only)

| Fact | How it was obtained |
|---|---|
| 159 open, 2 closed; sources, priorities, sites, due dates, assignees | Aggregates over corrective_actions |
| 144 created on 2026-11-08 from 59 sheets | Group by creation date and source; join to checklist_submissions |
| 28 fixed, 12 still faulty, 104 never re-checked | For each action, the same answer key on the most recent later sheet for the same vehicle and form, tested against the form's blocking list |
| 0 exact duplicates, 12 repeat pairs | Group by source sheet, item and vehicle; then by vehicle and item |
| Who can update a corrective action | pg_policies (actions_update, corrective_actions_cap_update) and app_user_can('corrective_actions','edit') evaluated as each role, rolled back |
| 3 updates ever, none by a Manager | audit_log_v2 grouped by action and actor role |
| 90 waiting, one form, ages, sites, submitter roles | Aggregates over checklist_submissions joined to checklist_templates |
| Approver roles | Live definitions of checklist_is_supervisor, checklist_is_area_manager and decide_checklist_approval |
| Who has actually signed | supervisor_by and approved_by joined to profiles, grouped by role |
| Final approval refused with a blocking answer | Live definition of guard_checklist_approval_stages |
| 58 of 90 carry a blocking answer | Waiting sheets that have an open action raised from them |
| No screen corrects an answer | src/lib/api/checklists.js updateSubmission has no caller in src |
| Due date rule | Live default_corrective_action_due_date and checklist_governance_defaults (High 72 hours, Medium 168 hours) |

## 6. Not verified

- Whether the 28 "fixed since" items were actually repaired or simply marked OK by a different
  person on a later day. The sheets say OK; the vehicle was not inspected.
- Whether the Flutter app offers a way to correct an answer on a submitted sheet. The documented
  screen is read-only; it was not run on a device.
- Why the main approver stopped on 2026-10-07 (leave, role change or the blocked queue). The data
  shows the date, not the reason.
