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

## Top findings from this pass (live-verified 2026-11-10)

Defects to fix first:
- `save_stock_entry` / `transfer_stock_entry` raise SQLSTATE 40001, which PostgREST retries forever (the September log-flood bug class). Switch to PT409. (16, 23)
- Two functions are callable without sign-in that should not be: `tyre_one_price_per_tyre` (trigger fn) and `reset_login_attempts`. (16, 17)
- Four readers query the empty `fleet_master` table instead of `vehicle_fleet`: Live Fleet Status and Compliance Dashboard show an empty fleet. (01, 03)
- Tyre "due" rule differs between JS (`bandFor`) and SQL `is_due`, so short-life tyres disagree across pages. (11)
- Board Overview: real zeros render as N/A, trend and headline use different cost sources, Cancelled counted as open. (15)
- Two migration timestamps are duplicated (20261109160000, 20261109170000); `supabase db push` is unsafe until renamed. (23, 29)

Needs the owner:
- Unknown live schema `anum_integration` adds blocking policies to 447 tables and has no migration or memory record. (17, 18)
- `accident_emails_enabled` is ON in production; memory says it shipped OFF. Confirm intent. (20, 26)
- A second approval engine (`approval_policies`, 3 draft policies) exists beside `approval_matrix` (0 rows). Pick one. (08)
- Built-but-empty foundations: org units, approval matrix, subscriptions, FX rates, vehicle expiry dates, AI budgets. (02, 06, 22)

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
