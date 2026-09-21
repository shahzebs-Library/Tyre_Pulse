# Enterprise checklist governance and reporting plan

Status: active implementation plan  
Baseline reviewed: 2026-09-21  
Source baseline: remote `main` at `8e394e39` and production project `jhssdmeruxtrlqnwfksc`

## Outcome

Build an auditable checklist programme in which every required inspection has a denominator, every completed sheet preserves the exact form used, every material finding has an accountable closure path, and every reported KPI can be reconciled to source records.

Historical submissions, signatures, photographs and signed PDFs are evidence. They must not be rewritten to look complete under newer rules.

## Measured production baseline

| Measure | Baseline |
|---|---:|
| Templates | 6 |
| Published templates | 3 |
| Submissions | 41 |
| Workshop Daily Checklist submissions | 37 |
| Pending supervisor sign-off | 34 |
| Pending area-manager sign-off | 1 |
| Fully approved workshop sheets | 1 |
| Checklist schedules | 0 |
| Checklist assignments | 0 |
| Published checklist approval policies | 0 |
| Checklist-linked corrective actions | 0 |
| Submissions with calculated scores | 0 |

The daily assignment generator exists and is active. With no schedules, it has no obligations to materialise. Submission volume therefore cannot currently be described as compliance.

## Reporting levels

| Level | Primary question | Required measures |
|---|---|---|
| Operator / technician | What must I complete correctly now? | due today, overdue, asset/site, unresolved prior findings, offline/sync state, receipt number |
| Supervisor | Is this shift/site controlled? | due/completed/missed, evidence exceptions, supervisor queue age, blocked assets, finding ownership |
| Area manager | Where is intervention needed? | multi-site adherence, approval SLA, critical findings, repeat defects, overdue actions, supervisor capacity |
| Enterprise leadership | What is the operational and compliance risk? | regional trends, risk exposure, availability impact, recurrence, closure effectiveness, data-quality score |
| Compliance / audit | Can each conclusion be reproduced? | immutable template revision, evidence, actors, approval route revision, corrective closure, export manifest |

## KPI contract

Every published KPI must carry its definition, numerator, denominator, business date, scope, exclusions, source tables, refresh time and drill-down route.

Initial controlled KPIs:

1. Assignment compliance = completed assignments / due assignments excluding authorised skips.
2. On-time completion = assignments completed on or before due date / completed assignments.
3. Approval SLA = decisions completed within the stage SLA / decided stages.
4. Finding closure SLA = findings closed by due date / closed findings.
5. Evidence integrity = completed assignments linked to an exact template snapshot / completed assignments.
6. Repeat defect rate = repeated component/asset findings inside the approved recurrence window / findings.
7. First-time release rate = checklists approved without return or unresolved blocking finding / decided checklists.

When a denominator is zero, report `N/A`; never report a misleading zero percent.

## Delivery workstreams

### A. Evidence integrity

- [x] Add immutable published template revisions.
- [x] Stamp new submissions with the exact revision used.
- [x] Label pre-existing records as `legacy_unavailable` instead of reconstructing history.
- [x] Preserve offline submissions against their recorded version when that revision exists.
- [x] Render the stored snapshot in web review and PDF paths.
- [x] Render the stored snapshot in the primary Flutter approval review path.
- [ ] Release and verify the Flutter snapshot reader on Android and iOS.
- [x] Add evidence-quality filters to the submission register.

Acceptance: changing a published template creates a new version; it never changes the questions or rules shown for an earlier exact-snapshot submission.

### B. Schedule and coverage control

- [x] Add a server-calculated assignment compliance monitor.
- [x] Surface a rolling 30-day assignment monitor in Checklist Insights with an explicit no-denominator state.
- [ ] Approve the active asset population by site and vehicle class.
- [ ] Approve cadence rules by checklist and operating risk.
- [x] Add a controlled one-site pilot boundary with configurable country, site, start and end dates.
- [x] Reject schedules without an explicit site or asset scope and keep generation forward-only.
- [x] Require an immutable skip reason, actor and server timestamp.
- [ ] Add a governed reschedule flow with reason, actor and original due date.
- [ ] Reconcile assignment generation against the active fleet daily.

Acceptance: for a selected day/site, active scope, expected assignments, generated assignments and exclusions reconcile exactly.

### C. Findings and corrective closure

- [ ] Define critical, major and observation classifications for each mark.
- [x] Measure note/photo evidence for each configured exception mark and support tenant-controlled blocking enforcement.
- [ ] Create one structured finding per actionable response.
- [ ] Link repair-required findings to work orders.
- [x] Default missing corrective-action due dates from configurable critical/high/medium/low SLAs.
- [ ] Require accountable owner, correction evidence and independent verification.
- [ ] Prevent operational release when a critical finding remains unresolved.

Acceptance: every blocking answer has either an open controlled action or verified closure; no orphan finding is hidden in free text.

### D. Approval governance

- [ ] Confirm routes by checklist, country/region/site and risk.
- [ ] Publish the checklist policy through independent second-admin review.
- [ ] Configure backup reviewers, delegation and escalation.
- [ ] Verify supervisor, area-manager, return, rejection, correction and reapproval journeys on web and installed mobile.
- [x] Set tenant-configurable supervisor and area-manager SLA targets and report breached queues.

Acceptance: the same user cannot bypass separation of duties, stale/mobile retries cannot duplicate decisions, and every decision has actor, role, stage, revision, time and signature.

### E. Enterprise reporting

- [ ] Replace browser-wide raw-row aggregation with scoped server aggregates.
- [ ] Add operator, supervisor, area-manager, enterprise and audit views.
- [ ] Add finding recurrence and corrective-action aging drill-downs.
- [x] Add approval-stage aging and breach counts from recorded workflow events and configured SLA targets.
- [x] Add assignment and evidence-integrity drill-down by template/site.
- [x] Add configurable submission/evidence/audit retention periods, legal holds and a review-only disposition monitor.
- [ ] Produce controlled CSV/Excel analysis exports and signed PDF audit packs.
- [ ] Add scheduled monthly reconciliation with export metadata/checksum.

Acceptance: dashboard, export and sampled source rows produce the same totals under the same scope and date basis.

## Practical rollout

1. Choose one site and one checklist for a two-cycle pilot.
2. Confirm active assets, roles, cadence, shift cut-off, evidence rules and approval SLA.
3. Publish the template revision and checklist approval route.
4. Generate only current/future assignments.
5. Reconcile expected versus generated assignments before operators begin.
6. Observe submissions, sync receipts, findings and approvals each shift.
7. Review exceptions daily with the supervisor and weekly with the area manager.
8. Complete an independent monthly reconciliation before expanding the scope.

## Daily monitoring runbook

1. Count expected active assets in scope.
2. Count due assignments and confirm the generator ran.
3. Investigate missing, duplicate, unassigned and incorrectly scoped assignments.
4. Reconcile completed assignments to submission IDs.
5. Identify submissions without exact template evidence.
6. Review supervisor and area-manager queue age.
7. Reconcile blocking findings to corrective actions/work orders.
8. Review overdue corrective actions and assets restricted from service.
9. Record each discrepancy with an owner, reason and due date.

## Monthly independent check

Freeze country, region, site, asset class, template version and business-date basis. Reconcile fleet scope → assignments → submissions → findings → actions/work orders → approvals → exported report. Sample records from every participating site and reproduce their PDFs. The reviewer must be independent of the person who configured the reporting period or approval policy.

## Tenant rollout values still required from operations

- Pilot site and start date.
- Applicable asset population and exclusions.
- Checklist cadence by asset class and operating condition.
- Critical/major/observation mapping.
- Whether evidence gaps remain monitored or become blocking after the pilot.
- Supervisor and final approver routes, including backups.
- Any tenant-specific change to the baseline approval/corrective SLAs.
- Any tenant-specific change to the seven-year retention baseline and external audit format.

The product now stores and enforces these choices per tenant. Pilot activation and schedule creation still require an administrator to select real sites/assets; the system never infers them from submission counts or rewrites historical evidence.

## Implemented foundation

Evidence history and compliance are implemented in `20260921075921_checklist_enterprise_evidence_and_compliance.sql`. Tenant governance is implemented in `20260921113000_checklist_governance_policy.sql`, with focused database coverage in `checklist_governance_policy.test.mjs`. The web schedule workspace exposes the policy controls, rejects unscoped schedules, and reports approval SLA breaches. Existing submissions remain `legacy_unavailable`; no historical evidence is reconstructed.
