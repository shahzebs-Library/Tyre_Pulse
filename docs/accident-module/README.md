# Accident & Insurance Management Module — Design Set

The complete design + implementation package for the Tyre Pulse accident-module upgrade
(`ACCIDENT_MODULE_BRIEF.md` at the repo root is the acceptance bar). This folder is the Phase 1–4
deliverables; **`00_MASTER_PLAN.md` is the executable Phase-5 roadmap.**

## Start here

1. **`00_MASTER_PLAN.md`** — the one roadmap to follow. Phase 0 must-fix gate (the 9 blockers), then
   20 phased PRs (`V417` → `V436`) with exact files, dependencies, size, acceptance criteria, and
   rollback per phase; the migration-numbering plan; the JS↔SQL mirror map; the risk register; and the
   Definition of Done. **Read this first, then execute phase by phase.**
2. `ACCIDENT_MODULE_BRIEF.md` (repo root) — the specification and the 25 acceptance criteria (§32).
3. `PROJECT_MEMORY.md` (repo root) — the binding repo constraints (next migration `V417`, one-org,
   additive-only, RLS model, JS↔SQL mirror rule, git hygiene).

## The documents

| File | Phase | What it is |
|---|---|---|
| `00_MASTER_PLAN.md` | 5 | **The executable roadmap** — start here. |
| `01_AUDIT.md` | 1 | Audit & gap analysis: current stack, the 92-column `accidents` table, the reuse map (what already ships), the 6-workstream gap table, migration-safety notes, recommended order. |
| `02_DATA_MODEL.md` | 3 | Data-model narrative: design decisions, ERD, the `accidents`-as-case-root model, reuse map, what's created vs phase-later. |
| `02_DATA_MODEL.sql` | 3 | The `MIGRATIONS_V417_ACCIDENT_CASE_MODEL.sql` artifact — 30 `accident_*` tables + case columns + RLS + seeds. **Not applied; must be reconciled to `06`'s resolutions before running.** |
| `03_WORKFLOW_ENGINE.md` | 2/3 | Workstreams, the 30-token case-status ladder, workstream statuses, route-based completeness, closure model, the role×capability matrix, SoD. |
| `04_UX_CASE_SCREEN_AND_MOBILE.md` | 4 | Case screen (fixed header + tabs + team inbox), the mobile capture wizard, empty/error states, responsive behaviour. |
| `05_SLA_NOTIFICATIONS_ANALYTICS_QA.md` | 3/6 | SLA business-minute engine, notification/email design + external portal, analytics/KPIs, and the QA/test matrix (incl. the closure-bypass-via-API suite). |
| `06_DESIGN_REVIEW.md` | — | Adversarial pre-implementation review: **9 must-fix blockers** (3 Critical + 6 High) + 8 Mediums. The gate before any DB code. |
| `06_RESOLUTION.md` | — | **Not written yet.** Phase 0 deliverable: records the resolution of each `06` blocker (mostly: reconcile `02.sql` to `accidentCase.js`). `V417` cannot be finalized until this exists. |
| `07_SEED_CONFIG.md` | 2 | Seed configuration narrative: route/type/country profiles, evidence requirements, SLA definitions, notification routing. |
| `07_SEED_CONFIG.sql` | 2 | The seed artifact. **Missing the `permission_overrides` capability seed (blocker C3) — add before Phase 1.** |

## Recommended reading order

`00_MASTER_PLAN` → `01_AUDIT` → `06_DESIGN_REVIEW` (know the blockers) → `02_DATA_MODEL(.md/.sql)` →
`03_WORKFLOW_ENGINE` → `04_UX` → `05_SLA_…` → `07_SEED_CONFIG`.

## Current build status

| Item | Status |
|---|---|
| **Design (Phases 1–4)** | ✅ Complete — all docs above written. |
| **`src/lib/accidentCase.js` pure engine** | ✅ **Built & committed** (61 tests, `src/test/accidentCase.test.js`). Defines the reconciled 10-key workstream vocab, 30-token `CASE_STATUSES`, `closureLevel`, `deriveCaseStatus`, `completeness`, `closureBlockers`, `canFullyClose`, routes, transitions. **This engine is the source of truth the SQL must be reconciled to.** |
| **Phase 0 must-fix / `06_RESOLUTION.md`** | ⬜ **Not started** — the 9 blockers are open; `02.sql` still disagrees with the engine (workstream keys 12-vs-10, missing `case_status`, `financially_pending`-vs-`financially_open`, table-name divergence, no capability seed, closure gate deferred). |
| **`V417` data-model migration** | ⬜ Not applied — pending Phase 0 reconciliation. |
| **Phases 1–20 (DB triggers/RPCs, services, pages, mobile)** | ⬜ Not built — see `00_MASTER_PLAN.md` for the PR sequence. |

**In short:** the design is done and the pure decision engine is coded and tested; nothing is in the
database yet. The immediate next action is Phase 0 — write `06_RESOLUTION.md` and reconcile
`02_DATA_MODEL.sql` to `src/lib/accidentCase.js` — then apply `V417`.
