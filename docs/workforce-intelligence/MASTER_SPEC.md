# Tyre Pulse Workforce Operations & Intelligent Productivity
**Implementation specification | October 22, 2026**
**Delivery status:** phased implementation, not yet a live finished module.

## 1. Product objective
Build company-wide work planning, assignment, execution, full-shift activity accountability, daily submissions, deliverable verification, evidence, and fairness-aware time estimation. Use existing Tyre Pulse theme, PageHeader, chart styles, EnterpriseTable, filters, status colors, module banners, country/site selectors and permissions. Do not create a separate design system or copied tasks.

## 2. Roles and coverage
Roles: company administrators, functional managers, site supervisors, inspectors, mechanics, tyre teams, drivers, warehouse/storekeepers, procurement, administration, HR, HSE, executives. Scope: organization > country > project/site > department/team > employee. Delegated managers may oversee multiple sites. Server RLS must enforce authority.
Employee views: My Work, My Day, My Deliverables, Daily Submission, Past Work and Corrections.
Manager views: Team Plan, Work Board, Live Work, Submission Review, Workload, Productivity Intelligence, Standards Review and Reports.

## 3. Daily lifecycle
1. Supervisor assigns task with accountable owner, helpers, site, source record, scope, due time, priority, checklist, measurable output and optional approved standard.
2. Employee acknowledges assignment; reminders and notification delivery are recorded distinctly.
3. Work starts; timeline records start/end, interruptions, breaks, blocked reasons, overtime and unplanned work. App-captured events are distinguished from employee declarations.
4. Deliverables are submitted, including quantities, work-order identifiers, tyre/vehicle IDs, documents, photos, comments and signatures where required. Avoid duplicate typing by linking inspection and ERP records.
5. End of shift, employee reviews the entire day, fills gaps and submits the daily report. Missing submissions must never become zero productivity.
6. Supervisor accepts, returns, rejects, requests evidence, confirms delays or verifies completed work, preserving immutable history.
7. Pending and rejected work enters the next plan with clear owner and status. All links preserve provenance.

## 4. Work planning boards
Views: configurable group/table, Kanban by status, calendar, timeline/Gantt, workload, department, employee, site and project. Support bulk assign, subtasks, dependencies, repeat schedules, project milestones, saved filters, export, search, comments, mentions, audit history and approvals. Status: planned, assigned, acknowledged, in_progress, blocked, submitted, in_review, returned, verified, cancelled. Changes are transitions, not arbitrary edits. Historical work must be queryable.

## 5. Workday and fair productivity
Capture actual time segments categorized as direct work, coordination, reporting, training, break, blocked, and explicitly unassigned. Unknown time remains UNKNOWN; do not label it idle. Detect overlap, impossible intervals, timezone errors, partial reports, offline duplicates and shifts crossing midnight. Store which facts are employee-entered, measured or supervisor-verified.
Separate metrics: on-time verified output, effort utilization, quality/first-pass acceptance, workload capacity, reporting compliance, blocked time, rework, delivery against plan and evidence completeness. Role-specific metrics required. Never rank different jobs simply by task count.

## 6. Work estimation intelligence
Base estimates on approved work standards and task steps; measure quantity, setup, condition, access, asset type, skill, tools, staff, travel, safety measures and known waits. Store estimate version, data provenance, confidence calibration and explanation. Return an interval where historical data supports it; otherwise use a clearly labeled provisional standard without invented certainty. A job overrun is a prompt to investigate, not a negative personnel judgment. Verified resource delays should adjust elapsed expectations without inflating productive effort.
Learning pipeline: classify jobs > clean and verify history > compare like-for-like work > evaluate accuracy against held-out data > review revised standards > publish approved versions. Watch for unsafe shortcut incentives, biased comparisons, selection bias and missing event records.

## 7. Delay attribution and proactive actions
Prompt progress updates and offer support when a credible forecast identifies lateness. Capture blockers: parts, tools, access, vehicle unavailable, approval, safety, staffing, dependency, complexity, external vendor. Route action to responsible team. Recommend assistance, replan, additional resource, retraining or standard revision, with explanation and human review. No automated punishment, salary, employment or disciplinary decisions.

## 8. Integrations and authoritative records
Reuse `profiles`, `shifts`, `work_orders`, `wo_tasks`, `wo_assignments`, `tech_activity_events`, `action_items`, inspection plans, checklists, corrective actions, approval routing and mobile My Work. Use canonical source references and event adapters, not another independent copy of every operational task. Preserve org/country/site constraints and partial-read failure visibility. Do not silently degrade a failed source to zero in management metrics.

## 9. Candidate Supabase model (audit before creating)
`work_items` (canonical assignment references and lifecycle); `work_assignments`; `employee_workdays`; `employee_activity_segments`; `daily_work_reports`; `daily_work_report_items`; `work_deliverables`; `work_reviews`; `work_dependencies`; `work_comments`; `work_estimate_versions`; `work_standard_catalog`; `delay_attributions`; `work_activity_audit`; `productivity_snapshots`. Prefer reuse when equivalents already exist.
Use RLS, audit triggers, idempotency keys, transactional RPCs for submit/review, private evidence storage with scoped signed URLs, immutable submitted revision history, server-side workflow checks, retention policy and transparent correction flows.

## 10. UX requirements
Use existing branded module hero/banners, design tokens, filters, responsive forms, EnterpriseTable with export and server pagination, Chart.js trends and consistent empty/loading/error states. No sidebar redesign. Use role-based views with consistent web and Flutter flows, keyboard/screen-reader accessibility, bilingual readiness and correct light/dark themes. Never display illustrative records as actual.

## 11. Delivery order
**Phase 0:** inventory and cross-module schema/RLS audit, live baseline and operational permissions.
**Phase 1:** canonical workday/activity foundation, time accounting, submissions, reviews, immutable audit and evidence.
**Phase 2:** My Day employee web page, manager review queue, company workboards, workload.
**Phase 3:** mobile Flutter offline execution, notification links and push receipts, supervisor review.
**Phase 4:** standard catalog, versioned duration estimates, calibrations and explanations, shadow predictions.
**Phase 5:** production dashboards, verified KPIs, scheduled reporting, corrective recommendations and end-to-end verification.

## 12. Acceptance tests
- Manager assigns to real authorized employee and site; employee receives/acknowledges.
- Employee's activity timeline reconciles actual full-shift intervals with unknown gaps explicit.
- Real task results and files link back to source asset/inspection/work order without duplication.
- Shift-end missing report, submission, returned report and verified report are distinct.
- Manager review requires permission; rejected work returns to employee without losing history.
- Overlaps, cross-midnight work, DST/timezone, offline retries and duplicates are handled deterministically.
- Estimate explains its basis, never invents confidence, and separates external delay from worker-controlled effort.
- Company/site permission matrix prevents cross-tenant data disclosure.
- Metrics match source transactions with no pagination truncation or fabricated coverage.
- Run lint, unit tests, build, database policy tests and production-authenticated E2E before activating.
