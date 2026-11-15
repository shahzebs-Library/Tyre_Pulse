# Closure workflow, round 2 (owner decisions 2026-11-15)

Stream: CLOSURE. Branch `claude/closure-workflow-7rxp2t`. Date: 2026-11-15.

**Nothing was applied to production.** Production was read with SELECT only (counts). No corrective action
and no checklist was closed, approved, rejected, acknowledged or edited. Everything below is proven on the
local synthetic staging database (PostgreSQL 16, companies Alpha, Beta, Gamma) unless it says otherwise.

## 1. The two workflows in plain English

### A. Closing a corrective action

1. An action is raised (by hand, from an inspection, or automatically from a checklist fault) and assigned.
2. The assigned worker, for example a Tyre Data Collector, can record progress and photographs on the
   actions assigned to them, and when the work is done they **submit completion evidence**: a written note
   is always required, and the company can require one or more photographs.
3. Submitting does not close anything. The action shows "Waiting for review".
4. A reviewer (by default Supervisor roles, Tyre Engineer, Manager, Admin; each company sets its own list)
   opens it and either **approves the closure** or **returns it for correction** with a comment. A returned
   action goes back to the worker, who fixes it and submits again. This can repeat.
5. The person who submitted cannot approve their own submission, unless the company switches that on.
6. Every step is written to a history that nobody can edit or remove, not even an administrator: who,
   which role, when, the comment, the evidence, and the asset, tyre, inspection or checklist and job card
   the action belongs to.
7. Where a fix is not going to happen (vehicle sold, risk accepted), an authorised role can close the
   action with a **documented exception**: name, time and a written reason are kept permanently.
8. The words Open, In Progress and Closed keep their meaning. Review progress is a separate field, so every
   existing count, report and phone screen keeps working.

### B. Signing a checklist that has a fault

1. A checklist with an item marked "Not OK" still **cannot be approved**. That rule is unchanged.
2. Instead the signer can **acknowledge** it: "I have seen this sheet and its fault". The supervisor signs
   first and the final signer acknowledges, in the same order as an approval. A signature is required. The
   person who filled in the sheet cannot acknowledge it themselves.
3. Acknowledging never changes the answer. The fault stays exactly as written and the sheet is locked.
4. Before it signs, the system makes sure every faulty item has a corrective action.
5. An acknowledged sheet is **not compliant** while a fault is open. It becomes compliant when every fault
   is closed on review (workflow A) or has a documented exception. The sheet itself is never rewritten.
6. Each company can add roles (for example Workshop Supervisor) that may give the final signature. Site
   limits still apply: a supervisor signs only for sites they are authorised for.
7. Every sign-off step from now on is written to a history that cannot be edited.

## 2. Design choices

| Question | Choice | Why |
|---|---|---|
| New status "Pending Review"? | No. `review_status` column instead | 18 readers (web, Expo, AI tools, alerts) compare status to 'Open' or 'Closed'. A new value would drop actions out of open counts without an error. No CHECK on status is changed |
| Reuse the approval engine? | No second engine, and not the policy engine either | `approval_policies` freezes a document while it is pending and supports 4 entity types through private functions. A corrective action must stay editable until evidence is submitted and can be returned many times. The drafts add one state column, one event table and four writers using the existing role, country and site helpers |
| Checklist with a fault | New outcome `acknowledged` plus a derived compliance view | Keeps the blocking rule byte for byte; the fault is preserved; compliance is computed from the linked actions, so history is never rewritten |
| Old screens that close directly | Still accepted for reviewer roles while `ca_allow_direct_close` is true, recorded as `direct_closed` | The installed Expo task list and the Action Center mirror write status Closed directly. Refusing them on day one would break current use. The company can switch direct closing off |

## 3. Files

Drafts (`supabase/pending_migrations/`, NOT applied):

- `20261116100000_clo_corrective_action_review.sql`
- `20261116101000_clo_checklist_acknowledge_exception.sql` (depends on the first)

Web: `src/lib/closureWorkflow.js` (pure rules), `src/lib/api/closureReview.js` (service),
`src/components/correctiveActions/ClosureReviewPanel.jsx`, `ClosureReviewSettings.jsx`,
`src/components/checklist/ChecklistFaultPanel.jsx`; edited `src/pages/CorrectiveActions.jsx` (review panel
in the action dialog, "Waiting for review" filter, review rules for Admins),
`src/components/checklist/ChecklistViewerDrawer.jsx`, `src/pages/ChecklistSubmission.jsx`,
`src/lib/checklist/checklistApproval.js` (status text for `acknowledged`).

The web works against production as it is today: until the drafts are applied the new panels do not render
and the fault list is read-only.

Tests: `supabase/tests/closure/` (`fixture.sql`, `tests.sql`, `run_staging.sh`),
`src/test/closureWorkflow.test.js`, `src/test/closureReview.api.test.js`.

## 4. Test results

| Suite | Result |
|---|---|
| Staging SQL (`run_staging.sh`, own database `tp_closure`) | 66 passed, 0 failed |
| vitest, new files (2) | 45 passed |
| vitest, existing files touching the changed code (16 files, incl. the mobile mirror parity test) | 202 passed |
| eslint on changed files | clean |
| `vite build` | passed |

Proven on synthetic staging (Verified Passed):

- Existing rows byte-identical after both drafts (corrective actions, checklist sheets, Action Center items,
  work orders, inspections: fingerprint before equals after).
- Role by site by country by company matrix: Tyre Man, a second collector, Director (not listed), an
  engineer in another country, a supervisor of another site, a manager of another company and the submitter
  are all refused; the site supervisor and the in-country Tyre Engineer are accepted.
- Self-review refused, also through the old status field; allowed only after the company switches it on.
- Return-for-correction loop: submitted, returned, progress, submitted, approved, in that order in history.
- Evidence required: no note refused; no photograph refused when the company requires one.
- History written and immutable: update and removal refused for a signed-in admin and for the database owner.
- Reviewer roles per company: Beta narrows its list, Alpha is unaffected and cannot read Beta's settings.
- Blocking-mark rule still holds after the drafts.
- Acknowledge: clean sheet refused, signature required, signing order kept, own sheet refused, other site
  refused, other company refused, sheet locked, answer unchanged, cannot later be approved or edited.
- Exception needs an authorised role and a reason of 10 characters or more; who, when and why are stored.
- Compliance: open fault is not compliant; resolved on review is compliant; exception plus resolved is
  compliant by exception; approved history keeps its result.
- Anonymous callers cannot execute any new function; helpers that take a company id are not callable.

Not Tested:

- Production (PostgreSQL 17). Staging is 16 and carries no approval policies.
- The screens in a real browser. Only unit tests and the build were run.
- A sheet routed through a published approval policy (the writer refuses it; production has no published
  checklist policy).
- Resolving a mirrored item in the Action Center as a non-reviewer (see risks).
- Expo and Flutter against the new status.

## 5. The checklists nobody can approve (production, read-only, counts only)

On 2026-11-12 the figure was 58 of 90. Today it is **57 of 89**: one sheet was rejected on 2026-11-15.
Open corrective actions today: 175 (144 checklist, 24 inspection, 7 by hand), 2 closed.

| Group | Sheets | Cause | Why nobody can approve | Correction |
|---|---|---|---|---|
| 1 | 48 | Blocking mark, waiting for the first signature | 117 "Not OK" answers. A supervisor may give the first signature today, but final approval is refused by rule, and the area manager's one-step approval is refused for the same reason | Supervisor signs; final signer acknowledges (workflow B) |
| 2 | 9 | Blocking mark, supervisor already signed | 23 "Not OK" answers. Final approval refused by rule; no screen re-marks an answer | Final signer acknowledges |

Causes checked and ruled out for all 57: missing role holder (holders exist for both steps), country or
site scope (every signer account covers all sites, one country), template configuration (one form, two
signatures, template present), approval policy routing (none), missing corrective action (every fault has
one). The other 32 waiting sheets are clean and can be approved today by the existing final signers.

Their historical results do not change: acknowledging adds a signature and a status; answers, scores and
the 40 decided sheets are untouched.

A second cause sits behind the queue and is a people matter, not a rule: 4 accounts can give the final
signature and one of them did almost all of it until 2026-10-07. The draft lets the company add roles for
the final signature (default: none added).

## 6. Mobile mirrors that must follow (not changed here)

Expo: `mobile/lib/checklistApproval.ts` (statusSummary; final signer roles if a company adds any),
`mobile/lib/checklists.ts` (status type, `historyStateOf`), `mobile/app/(app)/checklists/history.tsx`
(status key), `mobile/app/(app)/checklists/approvals/[submissionId].tsx` (offer acknowledge),
`mobile/app/(app)/tasks.tsx` and `mobile/lib/recordQueue.ts` (close goes through submit and review).

Flutter (no reserved wiring file is involved, none was touched):
`lib/features/approvals/domain/checklist_approval.dart`,
`lib/features/approvals/presentation/checklist_approval_review_screen.dart`,
`lib/features/approvals/data/queued_checklist_approval_decision.dart`,
`lib/features/checklists/domain/checklist_history_view.dart`,
`lib/features/checklists/data/checklist_history_row.dart`,
`lib/features/tasks/data/tasks_repository.dart`, `lib/features/my_work/domain/my_work_item.dart`.

Until then a phone shows an acknowledged sheet as "No approval needed". Nothing breaks.

## 7. Impact

Current company, when applied: no existing record changes. The 57 blocked sheets can be signed. Workers
can submit evidence; the 7 Workshop Supervisors, the Maintenance Supervisor, Managers and Admins can review.
One behaviour change: only reviewer roles can set an action to Closed or reopen it.
Two settings the owner must make in Access Control for it to be usable: open the Corrective Actions module
to Workshop Supervisor and Maintenance Supervisor (it is off for both today).

Commercial: reviewer roles, exception roles, final signer roles, self-review and evidence rules are per
company. No role name is hard-coded in the review path except the seeded defaults.

## 8. Order, dependencies, rollback

1. `20261116100000` then `20261116101000`. The second needs the first.
2. Neither depends on the other pending drafts. If the Manager work-order draft (`20261113130000`) is
   applied, either order works.
3. The second file replaces `checklist_is_area_manager()`. Any other draft that also replaces it must be
   merged by hand.
4. Rollback statements are in each file header. The second file should not be rolled back once a sheet has
   been acknowledged (the status value would have no meaning).

## 9. Remaining risks

- Action Center: if a non-reviewer resolves the mirrored item of a corrective action, the existing sync
  trigger swallows the refusal and logs it, so the item reads resolved while the action stays open.
- Checklist-raised actions have no Action Center item (the mirror trigger skips nested inserts), so their
  "assigned worker" is the person who submitted the sheet until someone assigns them.
- Evidence photographs are stored compressed inside the action row (up to 6). A storage bucket is the
  better home at scale.
- The decision-history trigger is not error-swallowing by design: if it failed, the sign-off would fail too.
- Direct closing by reviewers is left on by default, so a reviewer can still close without evidence
  (recorded as such).

## 10. Questions for the owner

1. Reviewer roles: is the default list right (Admin, Manager, Workshop Supervisor, Maintenance Supervisor,
   Tyre Engineer, Tire Planning Engineer, PMV Manager, both Area Manager roles)?
2. Should photographs be mandatory with every completion (0 today, can be 1 to 6)?
3. Should direct closing by reviewers be switched off once the phones are updated?
4. Should Workshop Supervisors give the final checklist signature within their sites (one setting), or
   only the first signature as today?
5. Who may record an exception? Default: Admin, Director, Manager, PMV Manager, both Area Manager roles.
6. May a supervisor still give the first signature on their own sheet (allowed today, unchanged)?
