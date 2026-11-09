# Team Operations and Workforce: Phase 1 audit (2026-11-09)

Live database facts (project jhssdmeruxtrlqnwfksc, measured 2026-11-09): `workforce_assignments` 0 rows,
`workforce_assignment_events` 0, `workforce_daily_reports` 0, `workforce_daily_entries` 0,
`workforce_work_standards` 0, `technician_skills` 0, `certifications` 0, 768 approved active profiles.
The module has never been used in production, so schema tightening has no data to migrate.

Code existing on `main` is not proof of deployment. Migration `20261023091000` IS live (its estimate
function exists); `20261109160000` and later are authored in this branch and not applied.

## Classification of what existed before this work

| Capability | Where | State |
|---|---|---|
| Daily activity log, submit, manager verify/return | `workforce_daily_*`, `WorkforceDailyWork.jsx` My Day / Manager Review | Implemented and verified (PGlite tests) |
| Assignment create + audited transitions + idempotency | `workforce_assignments`, `workforce_assignment_transition` | Implemented and verified |
| Duration estimate from history | `workforce_duration_estimate`, `EstimatePanel` | Implemented and verified; no data yet |
| Evidence on daily reports | `workforce_evidence` | Implemented and verified |
| Flutter My Work with offline transition queue | `tyre_pulse_flutter/lib/features/my_work` | Implemented; device behaviour unverified |
| Designation | `profiles.role` used as designation | **Broken concept**: an access role is not a job |
| Supervisor / reporting line, department, team, shift, availability | none | **Missing** |
| Skills / certificates used in assignment | `technician_skills` exists, unused by workforce; `certifications` keyed by free text name | **Missing** |
| Status changes without an audit row | web legacy fallback + Flutter `advance()` direct update; RLS let managers UPDATE status directly | **Broken** (untraceable work) |
| Board KPIs | client tally of the newest 300 rows | **Broken** (silently partial) |
| Blocker causes | free-text note only | Partial |
| Link to tyre replacement / job card / inspection | `source_module/source_record_id` text, unvalidated | Partial |
| Reassignment / handover | assignee immutable, no path | **Missing** |
| Supporting employees | none | Missing |
| Technical review / evidence before verify | none | Missing |
| Team analytics, per-site comparison, rework | none server-side | Missing |

## Defects fixed in this branch

1. Status could change with no event (web fallback, Flutter direct update, manager UPDATE). Now refused by
   the guard unless set by the audited function.
2. Board KPIs from the first 300 rows. Now from `workforce_board_summary` (whole visible dataset) with a
   "loaded N of M" banner on the list.
3. Designation conflated with access role. New `workforce_employees`.
4. No qualification check. Safety-critical gaps are refused (no override); soft gaps need a recorded
   override reason and the overriding manager is stamped.

## Rules that hold everywhere

- A task never creates a tyre replacement. The tyre change is recorded in its own module; the task links
  the canonical record (`workforce_link_operational_record`), which must be in the same organisation,
  on the same asset, and not already claimed by another task.
- Missing activity is "not recorded", never idle.
- Recommendations never assign. A person is chosen by a manager.
- Every count is computed on the server over what RLS lets the caller see.
