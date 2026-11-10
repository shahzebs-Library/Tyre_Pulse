# Tyre Pulse Enterprise Deliverables Pack

| Field | Value |
|---|---|
| Source spec | `Tyre pulse enterprise.md`, section 22 "Required Deliverables" |
| Date | 2026-11-10 |
| Status | First complete draft of all 29 deliverables. Audit-and-document only: no code, database or configuration was changed to produce it. |
| Evidence | Each document states what was verified in code, what was checked live (read-only SQL on 2026-11-10), and what was taken from `PROJECT_MEMORY.md`. |
| Supersedes | Stale parts of `docs/ARCHITECTURE_CURRENT_STATE.md` (June 2026). See 01 section 9. |

## The 29 deliverables

| # | Deliverable | Spec phase |
|---|---|---|
| 01 | [Current system architecture](01-current-system-architecture.md) | 1 |
| 02 | [Complete module inventory](02-module-inventory.md) | 1 |
| 03 | [Duplicate module report](03-duplicate-module-report.md) | 1 |
| 04 | [Merge and retirement recommendations](04-merge-and-retirement-recommendations.md) | 2 |
| 05 | [Navigation redesign](05-navigation-redesign.md) | 2 |
| 06 | [Organization hierarchy model](06-organization-hierarchy-model.md) | 3 |
| 07 | [Master Access Control design](07-master-access-control.md) | 2-3 |
| 08 | [Country and site approval matrix design](08-country-site-approval-matrix.md) | 3 |
| 09 | [Admin Console structure](09-admin-console-structure.md) | 3 |
| 10 | [Data model recommendations](10-data-model-recommendations.md) | 1-3 |
| 11 | [Fleet, tyre and maintenance logic audit](11-fleet-tyre-maintenance-logic-audit.md) | 1-2 |
| 12 | [Data Intake Centre design](12-data-intake-centre-design.md) | 4 |
| 13 | [Reporting architecture](13-reporting-architecture.md) | 4 |
| 14 | [PDF, PPTX and Excel solution](14-pdf-pptx-excel-solution.md) | 4 |
| 15 | [Executive dashboard design](15-executive-dashboard-design.md) | 4 |
| 16 | [API audit](16-api-audit.md) | 1 |
| 17 | [Security audit](17-security-audit.md) | 1 |
| 18 | [Tenant-isolation review](18-tenant-isolation-review.md) | 1 |
| 19 | [Data-governance plan](19-data-governance-plan.md) | 3 |
| 20 | [AI and automation architecture](20-ai-and-automation-architecture.md) | 5 |
| 21 | [Monitoring and support design](21-monitoring-and-support-design.md) | 5 |
| 22 | [Commercial SaaS readiness review](22-commercial-saas-readiness-review.md) | 5 |
| 23 | [Migration plan](23-migration-plan.md) | all |
| 24 | [Rollback plan](24-rollback-plan.md) | all |
| 25 | [Test plan](25-test-plan.md) | all |
| 26 | [Priority roadmap](26-priority-roadmap.md) (items R-001 to R-123) | all |
| 27 | [Cost and complexity estimate](27-cost-and-complexity-estimate.md) | all |
| 28 | [Risks and dependencies](28-risks-and-dependencies.md) | all |
| 29 | [Change register](29-change-register.md) | all |

Roadmap ids (R-nnn) are shared by 26, 27, 28 and 29.

## Top findings from this pass (live-verified 2026-11-10) and what happened to them

All fixed on 2026-11-11 (owner instruction), verified live:
- Stock save/transfer raised 40001 (infinite PostgREST retry): now PT409. `20261111100000`.
- `tyre_one_price_per_tyre` and `reset_login_attempts` were callable signed-out: revoked. `20261111100000`.
- Live Fleet Status, Compliance Dashboard, Tyre Specifications and the AI asset lookup read the empty
  `fleet_master`: now read `vehicle_fleet` (Active vehicles for the two status pages).
- Tyre "due" rule: the server now uses the app's rule (soon limit = smaller of 10,000 km / 500 h or
  10% of expected life). Server due list 655 to 597; full payload otherwise byte-identical. `20261111101000`.
- Board Overview: real zeros show 0, the tyre-spend trend uses the same expense-grid source as the
  headline, and Cancelled work orders are no longer counted as open.
- Duplicate migration timestamps: 8 pairs (not 2) renamed to +1 second; a test now blocks new ones.

Owner answers, acted on:
- `anum_integration` is the owner's read-only reporting bot. Kept. 33 newer tables lacked its reader
  rules; re-applied (480 tables covered). Rule: a migration that creates a table ends with
  `select anum_integration.apply_reader_policies();`. `20261111102000`.
- Accident emails: the chain works (mailbox set 21 Sep, the one accident since then was emailed,
  HTTP 200). A latent numbering bug was found and fixed: case numbers were count+1, so a deletion or
  two simultaneous saves could reuse a number; now max+1 under a lock plus a unique index. `20261111103000`.
- Two approval engines: `approval_policies` (governed, versioned, audited) is kept; the flat
  `approval_matrix` + `resolve_approvers` (0 rows, no callers) are retired read-only. `20261111104000`.
- Built-but-empty foundations remain: org units, subscriptions, FX rates, vehicle expiry dates, AI budgets,
  and the 3 draft approval policies still need publishing. (02, 06, 08, 22)

Corrections to project memory are recorded inside the relevant documents (fingerprint warning now wired, push tokens now exist, V579 applied in reduced form, Admin Roles page retired, and others).

## Completion criteria (spec section 22)

The spec says work is not complete on compilation alone. Current position, detail in 25 and 26:

| Criterion | Position |
|---|---|
| Data migration verified | Partly: per-migration rolled-back checks, no full rehearsal |
| Existing workflows preserved | Partly: guard tests, no end-to-end suite |
| Permission and RLS tests passed | Partly: impersonation checks per change, no automated RLS suite |
| Approval routing verified | Not yet: routing tables empty |
| Reports match on-screen data | Partly: shared engines, no comparison tests |
| PDF and PPTX exports validated | Partly: real-library test for tables, Arabic PDF not supported |
| Duplicate modules retired | Not yet: see 03 and 04 |
| Admin Console fully connected | Partly: see 09 |
| All roles tested | Not yet |
| Arabic and English tested | Partly: key-coverage tests, RTL never checked on device |
| Mobile, PWA and Web tested | Partly |
| Monitoring active | Yes: Sentry, system_logs, cron health, trust alerts |
| Rollback available | Partly: snapshots and undo RPCs; restore test never recorded |
| Documentation updated | This pack |

## How to keep it current

- Update the document that owns a topic, not a new file.
- When a roadmap item closes, mark it in 26 and remove its rows from 29.
- Keep the plain-ASCII rule (no long dashes, arrows or curly quotes).
