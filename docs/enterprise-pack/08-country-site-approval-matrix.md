# 08 - Country, Region, Site and Department Approval Matrix

| Field | Value |
|---|---|
| Deliverable | 8 of 29 |
| Date | 2026-11-10 |
| Status | Partly built. Approval is enforced in the database per domain (inspections, checklists, accidents, work orders, tyre changes, workforce). A governed, versioned policy engine for routing by country / site / role / named person exists (`approval_policies`) but has 0 published policies, so every live approval still follows fixed role rules. The older `approval_matrix` (V477) has 0 rows. Region, department, cost, risk and urgency are not routing inputs. |
| Evidence | Code read: `supabase/migrations/20260910182201_governed_approval_policies.sql`, `20260910185625_approval_pre_execution_gates.sql`, `src/lib/approvalMatrix.js`, `src/lib/api/approvalMatrix.js`, `src/lib/api/approvalDecisions.js`, `src/lib/api/dualControl.js`, `src/lib/checklist/checklistApproval.js`, `MIGRATIONS_V594_CHECKLIST_TWO_STAGE_APPROVAL.sql`, `MIGRATIONS_V600_WHO_SIGNS.sql`, `MIGRATIONS_V203_APPROVAL_DELEGATIONS.sql`, `src/App.jsx`. Live read-only counts 2026-11-10. Earlier measurements from PROJECT_MEMORY.md. NOTE: the governed policy engine is NOT recorded in PROJECT_MEMORY; it was found in code and confirmed live. |
| Related docs | [06 Hierarchy](06-organization-hierarchy-model.md), [07 Access](07-master-access-control.md), [09 Console](09-admin-console-structure.md) |

## 1. Inventory: every approval mechanism in the platform

| # | Mechanism | Objects | Applies to | Routing inputs | Live state |
|---|---|---|---|---|---|
| A | Governed approval policies | `approval_policies`, `approval_policy_events`, schema `approval_private` (permits, decisions, stage_deliveries), RPCs `approval_policy_save/publish/retire/simulate`, `decide_approval`, `approval_delegate_stage`, `approval_reassign_stage`, `approval_recover_route`, `approval_dashboard`, `my_pending_approvals` | inspection, checklist, work_order, tyre_change | org, country, site, role, named user; priority; 1 to 5 ordered stages, each a named user or role, signature required, prevent self-approval, distinct reviewer, SLA hours | 3 policies, 0 published. Opt-in: existing records keep legacy routing. |
| B | Legacy approval matrix (V477) | `approval_matrix`, `resolve_approvers()`; JS mirror `src/lib/approvalMatrix.js` | inspection, checklist, accident, work_order, tyre_change | country, site, role, user; specificity = count of pinned fields | 0 rows. Now described in code as "legacy matching helpers" that do not grant signing authority. |
| C | Inspection sign-off | `decide_inspection_approval` (V597/V602) | inspections | role list (V600) | Signers: PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager, Admin. Signature mandatory server-side (V602). Manager and Director refused (V600, proven live in memory). |
| D | Checklist two-stage | `decide_checklist_approval`, trigger guard (V594/V597), `src/lib/checklist/checklistApproval.js` | checklist_submissions | template flag + role per rung | Supervisor rung (trade supervisors + area/PMV), final rung (area managers, PMV Manager, Admin, Director - Director kept deliberately, migration aborts if removed). Blocking "Not OK" marks refuse final close. `closesInOneSign` (20261108100000): area manager / PMV / Admin / Director close a two-stage sheet in one signature. Mirrored in Expo + Flutter: change all. |
| E | Accident closure | `accident_closure_reviews`, `accident_request_closure`, `accident_decide_closure`, `approve_accident_closure`, closure enforce trigger (V417) | accidents | workstream completeness | No admin bypass on the closure gate. NA-waived workstreams still need approval. |
| F | Pre-execution approvals | `approval_execution_requests` + `approval_private.tyre_execution_permits` | work orders, tyre changes | via A | 0 rows. "No tyre fitment or work start occurs on approval itself." |
| G | Workforce gates | `workforce_assignment_transition`, `zz_workforce_assignment_qualify`, `workforce_reassign` | task assignment / verify | task type, skill, cert, site | Hard refusal for safety-critical gaps; soft gaps need `override_reason`. Status changes only through the RPC. |
| H | Generic workflow engine | `workflow_definitions`, `workflow_instances`, `workflow_step_events`, `/workflow-settings` builder | configurable | step definition | 25 definitions, 52 instances live. Org ids on definitions underivable (V312). |
| I | Delegations | `approval_delegations` (V203), `approval_delegate_stage`, `approval_revoke_delegation`, Access Control "Delegations" tab | approvers | date window | 0 delegations live. |
| J | Dual control (four eyes) | RPCs `admin_request_approval` / `admin_decide_approval` / `admin_list_approvals` / `admin_set_dual_control` (V-20260924110000), `src/lib/api/dualControl.js`, `/console/approvals` | 3 destructive admin RPCs | requester <> decider (CHECK) | `dual_control_enabled` = false live (default). |
| K | Capability override | `app_cap_revoked(module,'approve')` / `app_cap_granted` | writers C, D, E, F | per user | Revoke blocks a decision; grant admits to first rung. |
| L | Data intake approval | `pending_uploads`, `approve_pending_upload` (V320) | mobile uploads | elevated role | |

Approval UI surfaces: `/approvals` (unified queue, `src/pages/Approvals.jsx`, bulk approve applies the
approver's saved signature from `user_signatures` V601 and refuses unsigned), `/approval-matrix`
(`ApprovalMatrix.jsx`, Admin only, policy editor + simulate), `/workflow-settings`, `/approval-delegations`,
console `/console/approvals`.

## 2. How a decision is protected today

- Approver identity and timestamp come from `auth.uid()` server-side, never the client (fixed in mobile when
  inspections moved from direct UPDATE to `decide_inspection_approval`).
- Optimistic concurrency: `decide_approval` takes `p_expected_revision` + `p_expected_stage` + `p_operation_id`
  (idempotent). Stale decisions raise `PT409`, never `40001` (PostgREST retries 40001 forever: V-20260926090000).
- Content locks: `lock_inspection_content` and `approval_private.guard_document` refuse edits to decided
  documents; only allowed approval columns pass.
- Permits: `approval_private.permits` keyed by `txid_current()` so a client-settable setting cannot forge a
  bypass.
- History: `approval_policy_events` (snapshot per publish), `approval_private.decisions`, `inspection_audit_log`,
  `accident_case_workstream_events`, `warranty_claim_events`, `audit_log_v2`. Append-only by trigger.

## 3. Gaps against spec section 6

| Requirement | State |
|---|---|
| Configurable engine in Admin Console | Partly: policy editor is on the main app `/approval-matrix` (Admin), not under `/console`. |
| Do not hardcode approver names | Built for policies (role or named user per stage). Legacy domain rules hardcode ROLE names in SQL (V600 lists). |
| Route by country, site, role, user | Built in A. |
| Route by region, branch, project, workshop, department | Not built (no such scopes; see doc 06). |
| Route by cost, risk, record type, asset category, urgency, business rule | Not built. |
| Sequential approvals | Built (ordered stages, max 5). |
| Parallel / conditional / optional / auto / emergency | Not built. |
| Approval and cost limits | Not built (no approval_limit on any person record). |
| Acting managers, leave, backup approvers, temporary delegation | Partly: `approval_delegate_stage` + `approval_delegations`; no leave source, 0 delegations. |
| SLA timers, reminders, escalation | Partly: stage `sla_hours` + `approval_dashboard` overdue; accident SLA engine (`accident_sla_scan`, cron not wired per memory). No generic reminder cron. |
| Reassignment | Built (`approval_reassign_stage`, `approval_recover_route`). |
| Rejection, return for correction, resubmission, cancellation | Rejection built everywhere; return = reject to editable state on inspections; no formal "return" action. |
| Workflow versioning | Built for policies (version, publish snapshot, retire) and checklist templates (immutable revisions). |
| Step evidence: signature, comment, reason | Built (signature mandatory on approve). |
| PIN, OTP, GPS, device, QR, photo per step | Not built. |
| Immutable history with role, location, device, prev/new status | Partly: user, status, signature, time captured; device and location not on approval rows. |
| Applied to tyre repair, scrap, warranty, issuance, transfer, PO, invoice, release, disposal, report publishing | Only inspections, checklists, accidents, work orders, tyre changes, workforce. Scrap is a direct guarded RPC (no approval). Warranty has a status machine (`warranty_claim_guard`) not an approval chain. |

## 4. Worked example: the spec's Qiddiya G2 chain

Spec chain: Tyre Man > Inspector assigned to Qiddiya G2 > Site Fleet Supervisor > Riyadh Workshop Manager
(when required) > KSA PMV Manager (when required).

| Step | Expressible today? |
|---|---|
| Policy match country=KSA, site=QIDDIYA-UPPER PLATEAU (canonical site name) | Yes (A) |
| Stage 1 role = Inspector, Stage 2 role = Fleet Supervisor, Stage 3 named Riyadh workshop manager, Stage 4 role = PMV Manager | Yes (A, up to 5 stages) |
| "Inspector assigned to Qiddiya G2" (role AND site assignment) | Partly: stage role is org-wide; eligibility check `approval_private.person_eligible(user, org, type, country, site)` filters by the person's scope. |
| "when required" conditions | No (no conditional stages) |
| Riyadh as a region/branch | No (region not a scope) |

## 5. Target design: one routing engine

1. **Make A the only engine.** Retire B (`approval_matrix`, 0 rows) after confirming nothing reads it;
   keep its JS helpers only as the policy simulator's fallback.
2. **Adapters per domain.** C, D, E keep their domain writers (they hold the business rules: blocking
   faults, closure completeness, safety gates) but obtain WHO may sign from the published policy via
   `approval_private.resolve`. This is already how A calls `decide_checklist_approval` /
   `decide_inspection_approval`.
3. **Routing context** = `{org, country, site, region (from sites), department (from directory), role,
   requestor, record_type, asset_category, cost, risk, urgency}`. Add the new keys to `approval_private.context`
   and as optional `match_*` / `condition` fields on a stage.
4. **Stage types**: `sequential` (now), `parallel_all`, `parallel_any`, `conditional` (expression over the
   context, e.g. `cost > 5000`), `optional`, `auto` (system approves when conditions met).
5. **People source**: Organization Directory (`workforce_employees` with approval_role, approval_limit,
   acting_for, leave). Delegation and acting resolve before a stage is assigned.
6. **SLA**: one cron scanning open stages; reminder at 50 percent, escalate at 100 percent to the
   next-level role from the directory.
7. **Evidence policy per stage**: signature (now), plus optional PIN, GPS, device, photo, checklist.
8. **Console home**: move the policy editor to `/console/access?tab=approvals` (or a Workflow area) and keep
   `/approval-matrix` as a redirect.

## 6. Standing decisions recorded

- Inspection signers are area managers + PMV Manager + Admin only; Manager and Director cannot sign (V600,
  owner instruction "admin should be admin, manager should be manager").
- Director stays on the checklist final rung so a single area manager on leave cannot jam the queue.
- Governed policies are opt-in; existing submissions retain legacy routing (migration header).
- Dual control is OFF by default and can only be changed via `admin_set_dual_control`.
- Accident emails are OFF (`accident_emails_enabled=false`); in-app notifications only.
- A workforce task never creates a tyre replacement; approval of a tyre change never executes it.

## Open decisions for the owner

- Publish the first governed policies (inspection, checklist) for KSA, or stay on role rules?
- Which routing inputs matter first: cost limits, region, or department?
- Should Director remain on the checklist final rung once a second area manager exists?
- Turn on dual control for destructive admin actions?

## Next actions

1. Phase 1, S: record the governed approval engine in PROJECT_MEMORY and the module inventory.
2. Phase 2, S: publish one KSA inspection policy in a pilot site; verify with `approval_policy_simulate`.
3. Phase 2, M: retire `approval_matrix` (V477) after a read-dependency check.
4. Phase 3, L: add context keys (region, cost, asset category, urgency) and conditional / parallel stages.
5. Phase 3, M: generic SLA reminder and escalation cron over `workflow_instances`.
6. Phase 3, M: extend adapters to scrap, warranty, tyre issuance/transfer, asset disposal, report publishing.
