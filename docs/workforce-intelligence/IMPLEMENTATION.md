# Workforce Operations & Intelligence: implementation foundation
**Status:** First code slice. **Source of truth:** TYRE_PULSE_WORKFORCE_INTELLIGENCE_MASTER_SPEC.md (master artifact).
## Objective
Manage company-wide assignments and employee workdays, including assigned and unplanned tasks, activity timing, tangible deliverables, end-of-shift submission, supervisor verification, workload, fair estimation and explainable corrective recommendations.
## Repository reuse
Use existing web PageHeader, EnterpriseTable, Chart.js, card and design tokens. Existing work_orders, wo_tasks, wo_assignments, tech_activity_events, shifts, action_items and mobile My Work must remain authoritative. Audit live policies before proposing migrations. No fabricated production data or silently empty boards.
## First implemented slice
src/lib/workforceIntelligence.js implements validated workday activity accounting, explicit gap/overlap checks, approved-standard estimates with attributed external delays, and separate report-submission states. Tests are in src/test/workforceIntelligence.test.js. These are pure utilities, not live Supabase integrations.
## Next code slices
1. Audit current SQL, roles, module catalog, event normalization and RLS. Design canonical employee workday/report tables with org/country/site visibility.
2. Add Supabase migrations and transactional RPCs for shift/activity submission, evidence, return/review and immutable audit.
3. Build My Day with existing PageHeader, EnterpriseTable, status badges, existing chart tokens and existing page illustration. Build manager Review Queue.
4. Connect notifications and Flutter offline queue idempotently, then integrate source tasks without cloning existing records.
5. Build standards catalog, versioned estimation, complexity, blocked-time attribution, confidence evaluation and calibrations.
6. Introduce management productivity dashboards without personnel decisions automated from a timer or AI suggestion.
## Release gates
Run npm run lint, npm run test:run, npm run build, npm run test:database and scoped E2E. Verify org isolation, site-scoped RLS, cross-midnight shifts, timezones, duplicate events, no silent data truncation, evidence and explicit reviewer authority. Missing submissions must not be recorded as zero productivity. Do not merge operational UI until live end-to-end verified.
