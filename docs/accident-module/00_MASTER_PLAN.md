# 00 — Accident Module Master Implementation Plan

> **The single executable roadmap.** Consolidates the whole design set
> (`01_AUDIT` → `07_SEED_CONFIG`) into a phased, PR-by-PR build order that a team or a future
> agent can follow. Every phase names the exact files, its dependency on prior phases, a size
> estimate, acceptance criteria mapped to the brief, and a rollback.
>
> **Grounded in:** `ACCIDENT_MODULE_BRIEF.md` (the acceptance bar, §32 = 25 criteria, §33 Phase-5
> order), `01_AUDIT.md` (reuse map + gaps), `02_DATA_MODEL.md`/`.sql` (the `V417` migration artifact),
> `03_WORKFLOW_ENGINE.md`, `04_UX_CASE_SCREEN_AND_MOBILE.md`, `05_SLA_NOTIFICATIONS_ANALYTICS_QA.md`,
> `06_DESIGN_REVIEW.md` (the 9 must-fix blockers), `07_SEED_CONFIG.md`/`.sql`, and `PROJECT_MEMORY.md`.
>
> **Starting reality (do not re-derive):** the pure engine **`src/lib/accidentCase.js` is already built
> and committed** (61 tests, `src/test/accidentCase.test.js`). It defines the reconciled 10-key
> workstream vocabulary, the 30-token `CASE_STATUSES`, `closureLevel()`, `deriveCaseStatus()`,
> `completeness()`, `closureBlockers()`, `canFullyClose()`, route resolution and transition maps. **The
> engine is the source of truth the SQL must be reconciled *to*.** No migration has been applied.

---

## 0. Constraints that bind every phase (from PROJECT_MEMORY.md)

| Constraint | Consequence for this plan |
|---|---|
| **Next free migration = `V417`.** | Data model is `V417`; every later migration is the next sequential `V###`. Apply live via Supabase MCP (project `jhssdmeruxtrlqnwfksc`), commit the `MIGRATIONS_V###_*.sql` file, bump the number in `PROJECT_MEMORY.md`. |
| **One org (Company A `00000000-…-0001`), 3 countries kept apart by `country`.** | All seeds are org-scoped and idempotent (`ON CONFLICT DO NOTHING`). Every case-scoped child carries `organisation_id` + `country` + `site` and the RESTRICTIVE org/country/site policies. |
| **Additive / non-destructive only.** | Never drop or repurpose an `accidents` column; the 12-value `chk_accident_workflow_stage` stays; 38 live accident rows + 38 stage events + 138 audit rows are preserved. New behaviour is inert until the app writes to it. |
| **JS ↔ SQL mirror rule.** | Any SQL function that derives status / closure / completeness has a pure JS twin (`accidentCase.js` and friends). Change both together; pin with a mirror test. |
| **RLS is the real boundary.** | Hiding a button is not security. Every gate is enforced at the DB (RLS / DEFINER RPC / BEFORE trigger), not only client-side. |
| **Email OFF by default.** | `system_config.accident_emails_enabled` defaults `false`. In-app notifications fire regardless; email stays gated. |
| **Git hygiene.** | Small reviewable PRs, one phase each. Branch from latest `main`; never stack on a merged squash. Commits authored `Claude <noreply@anthropic.com>`, unsigned is expected — never amend GitHub's squash-merge commit. |

---

## Phase 0 — MUST-FIX GATE (resolve before any DB code)

`06_DESIGN_REVIEW.md` blocks the start with **9 must-fix items** (3 Critical + 6 High). These are
cross-document contradictions where **`02_DATA_MODEL.sql` (the migration that runs) disagrees with
`03/04/05` and with the already-committed `accidentCase.js`**. They must be reconciled into a single
resolution pass **before** `V417` is finalized.

> **Dependency:** the resolution belongs in a doc **`06_RESOLUTION.md` — which does not exist yet.**
> Phase 0's deliverable is to write it: for each of the 9 blockers, record the chosen resolution and
> which artifact changes (almost always: **reconcile `02_DATA_MODEL.sql` to `accidentCase.js`**, since
> the engine is committed and tested). `V417` cannot be finalized until `06_RESOLUTION.md` is written
> and the SQL is reconciled to it.

| # | Blocker (from 06) | Root state today | Resolution to record in `06_RESOLUTION.md` |
|---|---|---|---|
| **C1** | **Closure bypass.** `V417` adds writable `closure_level` but the closure guard is deferred → any user who can `UPDATE accidents` can PATCH `closure_level='fully_closed'`. | Guard is "phase-later"; V398 exposed exactly this class. | **Ship the closure gate in `V417`.** Add a BEFORE-UPDATE guard on `accidents` calling server-side `accident_can_close(id)` (mirror of `canFullyClose()`), forbidding a direct jump to `fully_closed`. If enforcement truly must wait, do **not** add `closure_level` to the writable set yet. |
| **C2** | **RLS write roles.** Group-A `_write = app_is_elevated()` (admin/manager/director only) → team roles (Insurance Officer, Workshop Inspector, Storekeeper, Finance Officer, HSE Officer) **cannot write**, and the 3 elevated roles bypass all segregation of duties. | Flat elevated-write model; per-team ownership inoperative. | **Replace with the per-capability model, shipped with the tables:** each child table's INSERT/UPDATE gated by `app_user_can('accidents','<cap>')` (V238/V241 PERMISSIVE pattern) ORed with role policies. Add the `accident_sod_ok` SoD guard in the same migration. |
| **C3** | **Inert permission matrix.** `app_user_can` returns **false** for all 16 new caps (`submit`, `validate`, `approve_liability`, `edit_insurance`, `assess`, `approve_repair`, `request_parts`, `execute_repair`, `qc_repair`, `accept_handover`, `post_cost`, `close_case`, `reopen_case`, `cancel_case`, `legal_hold`) unless seeded → only Admin/super can act on day one. | Matrix specified (03 §6.2) but no seed. `07_SEED_CONFIG.sql` has **no** `permission_overrides` seed. | **Add an idempotent org-scoped seed** writing the 03 §6.2 role→capability defaults into the `permission_overrides` envelope `app_user_can` reads. Pin with a test that `app_user_can` returns the matrix per role. |
| **H1** | **Workstream-vocab mismatch.** `02.sql` CHECK uses 12 keys (`liability_safety, insurance_claim, technical_assessment, repair_decision, repair_planning, fleet_offroad, repair_execution, workshop_qc, fleet_handover, finance_settlement`) + status `waiting_information`. `accidentCase.js` (committed) uses **10 keys** (`incident_evidence, fleet_validation, liability, insurance, assessment, repair, workshop_qc, handover, finance, corrective`) + `waiting_info`. Sets never intersect → completeness engine returns all-null. | Engine already chose 03's vocab; SQL still on 02's. | **Adopt the engine's 10-key + `waiting_info` vocabulary as canonical.** Rewrite the `02.sql` `workstream_key` and `status` CHECKs, the Part-F `required_workstreams` seeds, and any doc using the 12-key set to match `WORKSTREAM_KEYS` / `WORKSTREAM_STATUS_TOKENS`. |
| **H2** | **Missing `case_status`.** `03/04` require `accidents.case_status` (30 tokens, guard keys on it, header renders it); `02.sql` never creates it. | Engine defines `CASE_STATUSES` (30) + `CASE_STATUS_STAGE`; column absent. | **`ADD COLUMN case_status text` in `V417`** with a widen-guarded 30-token CHECK matching `CASE_STATUS_TOKENS`; keep it in lockstep with `accidentCase.js`. (It is a stored projection recomputed by the derivation trigger — Phase 3.) |
| **H3** | **Closure-token mismatch.** `02.sql` CHECK = `open / operationally_completed / financially_pending / fully_closed`; `closureLevel()` returns `financially_open` (+ `null`). Writing `financially_open` → CHECK violation. | Engine returns `financially_open`; SQL says `financially_pending`. | **Align to the engine:** change the `chk_accident_closure_level` and `accident_closure_reviews.level` CHECKs to `open / operationally_completed / financially_open / fully_closed`. |
| **H4** | **Table-name divergence.** `02` prefixes every table `accident_*`; `03/04/05` reference dozens of unprefixed / nonexistent names (`insurance_claims`, `case_tasks`, `sla_instances`, `damage_assessments`, `repair_orders`, plus ~20 tables `02` never builds). | Docs disagree on names; some resolve to the wrong existing generic table. | **`02`'s `accident_*` names are canonical.** Grep-fix `03/04/05` to the prefixed names. For the ~20 referenced-but-uncreated tables, decide per-phase: create in the owning phase's migration or stop reading them. `04` also mislabels the case table `accident_cases` → it is `accidents` (L3). |
| **H5** | **Route keys violate the CHECK.** `03` routes (`injury`, `total_loss`, `third_party`, `hit_and_run`) require workstream keys (`authority_report, medical_injury, management_review, legal, total_loss_approval, asset_register, third_party_recovery`) not in the CHECK. | Instantiating those routes would CHECK-violate. | **Decide before the route engine (Phase 3):** either add these keys to the workstream vocab + `DIMENSION_OF`, **or** model authority-report / medical / total-loss-approval / third-party-recovery as their own records (recommended — they are not team workstreams). Reconcile the seeded route profiles either way. |
| **H6** | **Dead-end statuses.** `deriveCaseStatus` returns `'reopened'` forever once `is_reopened=true`, and `'total_loss_processing'` forever for total-loss routes → a reopened or total-loss case can never derive to `closed`. | `02` stores only the permanent `is_reopened` / `route_key`. | **Add a transient signal** (`reopen_pending_triage boolean`, cleared once re-triaged) distinct from the permanent `is_reopened`/`reopen_count`; make `total_loss_processing` an overlay that still lets the pipeline derive an underlying status. Add both to the derivation test matrix. |

**Also fold these Mediums into `V417` (they are cheap and belong with the schema):** M3 currency
default-from-country + NOT-NULL-when-amount + group-by-currency KPI rule; M4 backfill legacy closed
rows to `legacy_closed` (or `fully_closed` + `closure_basis='backfilled'`), never a verified full
closure; M6 single authoritative NA representation + CHECK requiring `na_reason/na_by/na_at`; M1/M7
`WITH CHECK` country/site on money/liability/closure child writes and DEFINER-only writes for RPC-guarded
tables (`accident_sla_pause_events`, `accident_closure_reviews`, `accident_closure_requirements`).
M2/M5/L1/L2/L4/L5 are scheduled into their owning phases below.

**Phase 0 exit criteria:** `06_RESOLUTION.md` exists and records all 9 resolutions; `02_DATA_MODEL.sql`
is reconciled to `accidentCase.js` (vocab, `case_status`, closure tokens, table names); the capability
seed and closure/SoD enforcement are written into the `V417` artifact. Only then does Phase 1 apply it.

---

## Phased delivery (maps to brief §33 Phase-5 order)

Each phase = one reviewable PR. **Size:** S ≈ ½ day, M ≈ 1–2 days, L ≈ 3–5 days. Every phase is
additive; every migration carries a ROLLBACK block. "AC" = brief §32 acceptance criteria numbers.

### Phase 1 — Data model (`V417`) · **L**
- **Scope:** apply the reconciled `V417` = 30 `accident_*` tables (workstreams, evidence, authority
  reports, liability, insurance claim + documents/decisions/settlements, damage assessments, repair
  orders/tasks/QC, parts requests, vehicle downtime, handover, financial transactions, claim
  recoveries, corrective actions, case tasks/approvals/communications, SLA definitions/instances/pause,
  closure requirements/reviews) + route/type/country config profiles + the extended `accidents` case
  columns (`case_no`, `case_status`, `closure_level`, `is_reopened`, `reopen_count`,
  `reopen_pending_triage`, `legal_hold`, `cancelled_duplicate_of`). **Includes Phase-0 fixes:** the
  capability seed (C3), per-capability + SoD write policies (C2), the `accident_can_close` guard (C1),
  currency defaults (M3), NA CHECK (M6), backfill honesty (M4), country/site `WITH CHECK` on money
  tables (M1).
- **Files:** `MIGRATIONS_V417_ACCIDENT_CASE_MODEL.sql` (from `02_DATA_MODEL.sql`, reconciled) ·
  `06_RESOLUTION.md` (Phase 0) · reconcile `03/04/05` table names in-doc. Engine already exists
  (`src/lib/accidentCase.js`). **Add** a mirror test `src/test/accidentCaseSqlMirror.test.js` asserting
  the JS `WORKSTREAM_KEYS` / `CASE_STATUS_TOKENS` / closure tokens equal the SQL CHECK sets.
- **Depends on:** Phase 0.
- **AC:** 21 (safe migration), 22 (no regression), 24 (server-enforced perms — foundation).
- **Rollback:** the migration's ROLLBACK block drops every new table (CASCADE) + the added columns,
  restoring the pre-V417 shape; backfilled values live only in new columns.

### Phase 2 — Role permissions & RLS (`V418`) · **M**
- **Scope:** finalize the accident role set + capability matrix beyond the seed (custom roles: Fleet
  Incident Officer, Insurance Claims Officer, Workshop Inspector/Planner, Storekeeper, Finance Officer,
  HSE Officer, Fleet Inspector). Promote the client-side `saveStageFields` column-ownership guard to
  server RLS. Wire `hasCapability` client reader to the 16 caps.
- **Files:** `MIGRATIONS_V418_ACCIDENT_ROLE_PERMISSIONS.sql` · `07_SEED_CONFIG.sql` (extend) ·
  `src/lib/api/accidentAccess.js` (or extend `adminAccess.js`) · client `AuthContext` capability wiring
  · `src/test/accidentPermissions.test.js`.
- **Depends on:** Phase 1.
- **AC:** 4 (each workstream a separate owner), 15 (Insurance ≠ Workshop edit), 24 (server-validated).
- **Rollback:** revert policies to Phase-1 state; capability seed rows removed by keyed delete.

### Phase 3 — Case core + status derivation (`V419`) · **L**
- **Scope:** the derivation trigger that recomputes `accidents.case_status` (mirror of
  `deriveCaseStatus`) + the route-instantiation trigger (seeds `accident_case_workstreams` +
  `accident_closure_requirements` rows when `route_key` is chosen), reconcile `case_no` to the existing
  `reference_no` sequence (M5), H6 transient reopen signal. Case header + Overview + tabs UI over the
  new children (extends `AccidentDetailModal.jsx`).
- **Files:** `MIGRATIONS_V419_ACCIDENT_CASE_CORE.sql` (`accident_derive_case_status`,
  `accident_instantiate_route`) · engine `src/lib/accidentCase.js` (already has `deriveCaseStatus`,
  `buildCaseRoute`, `requiredWorkstreams`) · `src/lib/api/accidentCase.js` (new service) ·
  `src/components/AccidentDetailModal.jsx` (case header + Overview) · `src/test/accidentCaseCore.test.js`.
- **Depends on:** Phases 1–2. **Respects** `accident_derive_fields` (BEFORE) — never `UPDATE OF` a
  column a BEFORE trigger sets (V398b lesson).
- **AC:** 5 (shows current owner + next action), 3 (incomplete cases returned with missing items — via
  completeness), 23 (desktop + mobile).
- **Rollback:** drop the two triggers; `case_status` recompute is idempotent; case columns from V417.

### Phase 4 — Evidence + photo checklist (`V420`) · **M**
- **Scope:** structured evidence-requirement checklist (front/rear/corners/plate/VIN/odometer per case
  type), evidence-completeness tracking, witness/driver statements as records, multiple third parties
  (`accident_parties`). MIME/size/scan enforcement in the upload RPC (L4).
- **Files:** `MIGRATIONS_V420_ACCIDENT_EVIDENCE.sql` (evidence-requirement seed per type + upload RPC) ·
  `src/lib/accidentEvidence.js` (pure: requirement resolution, "11 of 13" completeness) ·
  `src/lib/api/accidentEvidence.js` · evidence tab component · `src/test/accidentEvidence.test.js`.
- **Depends on:** Phases 1–3.
- **AC:** 1 (mobile registration), 2 (mandatory evidence changes by type), 3 (missing items surfaced).
- **Rollback:** drop evidence-requirement seeds + RPC; evidence tables from V417.

### Phase 5 — Workstream / task engine (`V421`) · **L**
- **Scope:** completion-% recompute per workstream + per dimension (mirror of `completeness()`),
  `accident_case_tasks` engine (assign / status / due / dependency), team-inbox surfaces (my-tasks /
  overdue / waiting-for-approval) reusing `teamPerformance`/`longestWaiting`.
- **Files:** `MIGRATIONS_V421_ACCIDENT_WORKSTREAM_TASKS.sql` (`accident_recompute_completeness`,
  task RPCs) · `src/lib/accidentCase.js` (`completeness`, `workstreamStatus` — exist) ·
  `src/lib/api/accidentTasks.js` · `src/pages/AccidentInbox.jsx` (per-role inbox) ·
  `src/test/accidentTasks.test.js`.
- **Depends on:** Phases 1–4.
- **AC:** 4 (owner + status per workstream), 5 (current owner/next action), 20 (dashboards identify
  delays).
- **Rollback:** drop recompute trigger + task RPCs; inbox page unrouted.

### Phase 6 — Liability & Safety (`V422`) · **M**
- **Scope:** 9-value liability enum + per-party %, preventable flag, immediate-vs-root cause,
  unsafe-act/condition, corrective actions as tracked records (owner/due/evidence), liability **lock +
  reason-required change**.
- **Files:** `MIGRATIONS_V422_ACCIDENT_LIABILITY.sql` (liability RPC with lock/approval) ·
  `src/lib/accidentVocab.js` (extend liability enum — never inline) · `src/lib/api/accidentLiability.js`
  · liability tab · `src/test/accidentLiability.test.js`.
- **Depends on:** Phases 1–3, 5.
- **AC:** 4, 16 (audited), 24. Also brief §5.3 liability lock.
- **Rollback:** drop liability RPC; enum widening reverts via `accidentVocab.js`.

### Phase 7 — Insurance claims (`V423`) · **L**
- **Scope:** 14-value insurance decision lifecycle, `accident_insurance_claims` (wire the child, not the
  dormant generic table), policy-validity-on-date check (needs a policy master — M2), claim documents /
  missing-doc tracking, surveyor, decision events, settlements, multiple claims per case.
- **Files:** `MIGRATIONS_V423_ACCIDENT_INSURANCE.sql` (+ `accident_insurance_policies` master, L2 FK) ·
  `src/lib/claimsAnalytics.js` (reuse — do NOT duplicate claim maths) · `src/lib/api/accidentInsurance.js`
  · insurance dashboard · `src/test/accidentInsurance.test.js`.
- **Depends on:** Phases 1–3, 5.
- **AC:** 6 (insurance manages claims independently), 12 (financial stays open), 16.
- **Rollback:** drop insurance RPCs + policy master; claim children from V417.

### Phase 8 — Technical assessment (`V424`) · **M**
- **Scope:** `accident_damage_assessments` + damage items, internal/external repair decision, labour-hour
  estimate, before/assessment photos.
- **Files:** `MIGRATIONS_V424_ACCIDENT_ASSESSMENT.sql` · `src/lib/api/accidentAssessment.js` ·
  assessment tab · `src/test/accidentAssessment.test.js`.
- **Depends on:** Phases 1–3, 5.
- **AC:** 7 (workshop assess/plan/execute).
- **Rollback:** drop assessment RPCs; tables from V417.

### Phase 9 — Repair planning (`V425`) · **M**
- **Scope:** `accident_repair_orders` / `accident_repair_tasks`, quotation comparison, schedule, external
  workshop record (M2), progress updates.
- **Files:** `MIGRATIONS_V425_ACCIDENT_REPAIR_PLANNING.sql` · `src/lib/api/accidentRepair.js` ·
  workshop dashboard · `src/test/accidentRepair.test.js`.
- **Depends on:** Phase 8.
- **AC:** 7.
- **Rollback:** drop repair-planning RPCs; tables from V417.

### Phase 10 — Parts & PO integration (`V426`) · **M**
- **Scope:** `accident_parts_requests` linked to **existing** procurement/inventory (reuse, don't rebuild
  — brief §21), quotation→PO→invoice linkage.
- **Files:** `MIGRATIONS_V426_ACCIDENT_PARTS_PO.sql` · `src/lib/api/accidentParts.js` (reuse existing
  procurement services) · parts tab · `src/test/accidentParts.test.js`.
- **Depends on:** Phase 9.
- **AC:** 8 (Store/Procurement process parts + POs).
- **Rollback:** drop parts RPCs; tables from V417.

### Phase 11 — Repair execution (`V427`) · **M**
- **Scope:** repair-task execution + during/after photo categories, actual labour/parts capture.
- **Files:** `MIGRATIONS_V427_ACCIDENT_REPAIR_EXECUTION.sql` · `src/lib/api/accidentRepair.js` (extend)
  · execution UI · `src/test/accidentRepairExecution.test.js`.
- **Depends on:** Phases 9–10.
- **AC:** 7.
- **Rollback:** drop execution RPCs.

### Phase 12 — Workshop QC (`V428`) · **M**
- **Scope:** `accident_repair_quality_checks` checklist + pass/reject; QC required before handover.
- **Files:** `MIGRATIONS_V428_ACCIDENT_QC.sql` · `src/lib/api/accidentQc.js` · QC tab ·
  `src/test/accidentQc.test.js`.
- **Depends on:** Phase 11.
- **AC:** 10 (workshop completion requires Fleet acceptance — QC precedes it).
- **Rollback:** drop QC RPC + gate.

### Phase 13 — Fleet handover (`V429`) · **M**
- **Scope:** `accident_handover_inspections` (Fleet accept/reject **distinct** from workshop completion),
  rectification loop on reject, replacement-vehicle allocation, actual downtime computation,
  `vehicle_fleet` operational-status sync from VOR.
- **Files:** `MIGRATIONS_V429_ACCIDENT_HANDOVER.sql` (accept/reject RPC + rectification-task creation) ·
  `src/lib/api/accidentHandover.js` · fleet dashboard · `src/test/accidentHandover.test.js`.
- **Depends on:** Phase 12.
- **AC:** 9 (Fleet controls off-road/return), 10 (completion requires Fleet acceptance), 11 (reject →
  rectification loop).
- **Rollback:** drop handover RPCs; downtime/allocation tables from V417.

### Phase 14 — Finance & settlement (`V430`) · **M**
- **Scope:** `accident_financial_transactions` (towing/storage/third-party lines, internal labour vs
  parts split), invoice/PO match, `accident_claim_recoveries`, **financial-closure gate distinct from
  operational** (the `financially_open` level). Reuse `governedCost.js`; group-by-currency KPI (M3).
- **Files:** `MIGRATIONS_V430_ACCIDENT_FINANCE.sql` (post-cost RPC, DEFINER, currency-safe) ·
  `src/lib/accidentFinance.js` (pure, per-currency) · `src/lib/api/accidentFinance.js` · finance
  dashboard · `src/test/accidentFinance.test.js`.
- **Depends on:** Phases 7, 13.
- **AC:** 12 (financial stays open after operational completion), 16.
- **Rollback:** drop finance RPCs; tables from V417.

### Phase 15 — Closure engine (`V431`) · **M**
- **Scope:** wire the **config-driven** closure gate (single authority — resolve M8) reading
  `accident_closure_requirements` + `closure_reviews`; `close_case` / `reopen_case` (approval-required,
  M-fix) / `cancel_case` DEFINER RPCs; the 3-level model surfaced in the closure screen. The
  `accident_can_close` guard already shipped in V417 (C1) — this phase adds the config source + reopen +
  UI.
- **Files:** `MIGRATIONS_V431_ACCIDENT_CLOSURE.sql` (`accident_close_case`, `accident_reopen_case`,
  `accident_cancel_case`) · `src/lib/accidentCase.js` (`canFullyClose`, `closureBlockers`,
  `closureLevel` — exist) · `src/lib/api/accidentClosure.js` · closure screen ·
  `src/test/accidentClosure.test.js` **(must include the closure-bypass-via-API suite from 05 F.2).**
- **Depends on:** Phases 5, 7, 13, 14.
- **AC:** 12, 13 (cannot fully close with missing requirements), 14 (NA requires reason), 15 (reopen
  requires approval).
- **Rollback:** drop closure/reopen RPCs; the V417 guard remains (safe — blocks bad closes).

### Phase 16 — Email & notifications (`V432`) · **M**
- **Scope:** extend the **existing** bus (`domain_events` → `consume_event_accident_notify` →
  `workflow_notifications` → `workflow-notify`): subject format, action-required-only filtering, digest
  grouping. Reply-token capture groundwork. Keep email OFF by default.
- **Files:** `MIGRATIONS_V432_ACCIDENT_NOTIFY.sql` (consumer + template extensions; `accident_digest_queue`
  or `digest_group`) · `src/lib/api/accidentWorkflow.js` (extend) · edge fn `workflow-notify` (extend,
  redeploy) · `src/test/accidentNotify.test.js`.
- **Depends on:** Phases 3, 5.
- **AC:** 17 (notifications linked to correct case), 26.
- **Rollback:** revert consumer/template rows; edge fn redeploy to prior version.

### Phase 17 — External portal (`V433`) · **L**
- **Scope:** expiring external-access grants (reuse the `report_shares` token pattern) for
  insurers/brokers/surveyors/workshops: view assigned request, upload docs/quote/invoice, confirm dates;
  inbound email reply-token ingestion (UNIQUE reply_token — M2). MIME/size/scan on external uploads (L4).
- **Files:** `MIGRATIONS_V433_ACCIDENT_EXTERNAL_PORTAL.sql` (`accident_external_grants`, mint/revoke +
  DEFINER upload RPC) · `src/pages/AccidentExternalUpload.jsx` (anon route) ·
  `src/lib/api/accidentExternal.js` · edge fn for inbound email · `src/test/accidentExternal.test.js`.
- **Depends on:** Phases 7, 9, 16.
- **AC:** 18 (external users get restricted access only).
- **Rollback:** drop grant table + RPCs; anon route unregistered; tokens invalidated.

### Phase 18 — SLA engine (`V434`) · **L**
- **Scope:** `accident_sla_definitions` / `accident_sla_instances` / `accident_sla_pause_events` +
  working-calendar / country-holiday model + pause-with-reason (long-pause approval) + escalation,
  measured off `accident_stage_events`. Business-minute clock. Reconcile with the existing V305 VOR/overdue
  cron (extend, don't fork).
- **Files:** `MIGRATIONS_V434_ACCIDENT_SLA.sql` (`accident_working_calendars`,
  `accident_country_holidays`, `sla_activity_bindings`, clock cron, `accident_sla_pause` RPC — DEFINER,
  M7) · `src/lib/sla/businessTime.js` (pure business-minute engine) · `src/lib/api/accidentSla.js` ·
  SLA panel · `src/test/slaBusinessTime.test.js`.
- **Depends on:** Phases 3, 5.
- **AC:** 19 (SLA timers + escalation function correctly).
- **Rollback:** drop SLA tables/cron/RPC; existing V305 cron unchanged.

### Phase 19 — Analytics (`V435` or code-only) · **M**
- **Scope:** process-analytics (time-in-team from the ledger), route-aware KPIs, closure/settlement
  cycle-time, team-delay identification. Reuse `accidentReport.js` catalog + `buildAccidentKpis`;
  currency-grouped financial KPIs.
- **Files:** `src/lib/accidentProcessAnalytics.js` (pure) · `src/lib/accidentReport.js` (extend catalog)
  · `src/components/accidents/*` (dashboards) · `src/test/accidentProcessAnalytics.test.js`. Migration
  only if a materialized aggregate is added.
- **Depends on:** Phases 5, 13, 14, 18.
- **AC:** 20 (dashboards identify team delays).
- **Rollback:** unmount new dashboard panels; no schema change (or drop the aggregate).

### Phase 20 — Data migration (`V436`) · **L**
- **Scope:** migrate the 38 live `accidents` scalar values into the new children (evidence, liability,
  insurance, repair, finance rows), instantiate a route + workstreams per legacy case, **without marking
  them complete** (`basis='backfilled'`, M4). Logged, reversible.
- **Files:** `MIGRATIONS_V436_ACCIDENT_DATA_MIGRATION.sql` (idempotent, `_bak.accident_migration_v436`
  snapshot, honesty flags) · `src/test/accidentDataMigration.test.js`.
- **Depends on:** all prior phases.
- **AC:** 21 (existing data safely migrated), 22 (existing functionality operational).
- **Rollback:** the snapshot table + a delete-by-`import` tag; legacy scalar columns are untouched, so
  reverting removes only the derived children.

---

## Migration numbering plan

| Migration | Phase | Contents |
|---|---|---|
| **V417** | 1 (+0) | Data model: 30 `accident_*` tables + case columns + capability seed + per-cap/SoD RLS + `accident_can_close` guard + currency/NA/backfill fixes |
| **V418** | 2 | Role permissions + capability matrix + RLS column-ownership |
| **V419** | 3 | Case-status derivation + route-instantiation triggers + `case_no` reconcile + reopen transient |
| **V420** | 4 | Evidence requirements + upload RPC |
| **V421** | 5 | Completeness recompute + task engine RPCs |
| **V422** | 6 | Liability enum + lock/approval RPC |
| **V423** | 7 | Insurance lifecycle + policy master |
| **V424** | 8 | Damage assessment + items |
| **V425** | 9 | Repair orders/tasks + quotation |
| **V426** | 10 | Parts requests + PO linkage |
| **V427** | 11 | Repair execution |
| **V428** | 12 | Workshop QC |
| **V429** | 13 | Fleet handover + rectification + downtime + fleet sync |
| **V430** | 14 | Finance transactions + recoveries + financial-closure gate |
| **V431** | 15 | Closure/reopen/cancel RPCs + config-driven gate |
| **V432** | 16 | Notification consumer + template/digest extensions |
| **V433** | 17 | External portal grants + inbound reply |
| **V434** | 18 | SLA definitions/instances/pause + calendar/holiday + clock cron |
| **V435** | 19 | (optional) analytics aggregate — else code-only |
| **V436** | 20 | Data migration of the 38 legacy rows |

Reserve numbers sequentially even where a phase turns out code-only, to keep the repo `V###` convention
monotonic (skip-and-note in `PROJECT_MEMORY.md` if a reserved number ships no SQL).

---

## The JS ↔ SQL mirror map

The repo rule: every SQL function that derives status/closure/completeness has a pure JS twin; change
both together and pin with a mirror test.

| Pure JS engine (source of truth) | Key exports | SQL mirror (migration) | Status |
|---|---|---|---|
| **`src/lib/accidentCase.js`** *(built, 61 tests)* | `WORKSTREAM_KEYS`, `WORKSTREAM_STATUS_TOKENS`, `CASE_STATUS_TOKENS`, `deriveCaseStatus`, `completeness`, `closureLevel`, `closureBlockers`, `canFullyClose`, `buildCaseRoute`, `requiredWorkstreams`, `TRANSITIONS` | `accident_derive_case_status`, `accident_instantiate_route`, `accident_recompute_completeness`, `accident_can_close` (V419/V421/V417) — **not built yet**; and the `V417` CHECK sets (`workstream_key`, `case_status`, `closure_level`) must equal the JS token arrays | **JS done; SQL pending + must reconcile (H1/H2/H3)** |
| `src/lib/accidentVocab.js` *(exists)* | `toDb*`, `canon*`, liability/payer/najm/taqdeer lists | `chk_severity`, `chk_accident_type`, liability enum CHECK (V422) | Extend both together |
| `src/lib/accidentStages.js` *(exists, 30 tests)* | `stageCompletion`, `teamPerformance`, `caseProgress`, `buildStageIntelligence` | `accident_stage_events` ledger (V398, live) | Live; reused |
| `src/lib/claimsAnalytics.js` *(exists)* | `analyzeClaims`, `claimNet`, `netExposure` | none (read-model) | Reuse; don't fork |
| `src/lib/sla/businessTime.js` *(to build, Phase 18)* | business-minute clock, pause math | `accident_sla` clock cron + pause RPC (V434) | Both new, mirror at Phase 18 |
| `src/lib/accidentProcessAnalytics.js` *(to build, Phase 19)* | time-in-team, cycle-time | read-model over ledger | Code-mostly |
| `src/lib/accidentEvidence.js` *(to build, Phase 4)* | evidence-requirement resolution, "N of M" | evidence-requirement seed + upload RPC (V420) | Both new |

---

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| **Closure bypass** — a writable `closure_level`/status jump with no server gate (V398's exact class). | **Critical** | Ship `accident_can_close` BEFORE-UPDATE guard **in `V417`** (C1). Route all closes through the DEFINER RPC (Phase 15). Test the API-bypass suite (05 F.2). |
| **RLS write holes** — team roles locked out; elevated roles bypass SoD; cross-country money/liability writes. | **Critical** | Per-capability write policies + `accident_sod_ok` in `V417` (C2). `WITH CHECK` country/site on money tables (M1). DEFINER-only writes for RPC-guarded tables (M7). |
| **Inert permissions** — module unusable by intended roles until the matrix is seeded. | **High** | Idempotent capability seed in `V417` (C3); test `app_user_can` per role. |
| **Financial data corruption / currency blend** — SAR+AED+EGP summed (the recurring repo bug). | **High** | Default currency from country, NOT-NULL-when-amount (M3); all rollups group by currency, reuse `governedCost.js`; test no blended total. |
| **Migration on 38 live rows** — losing or falsely completing legacy cases. | **High** | Additive-only; `IS NULL`-guarded backfill; `basis='backfilled'`/`legacy_closed` honesty (M4); snapshot + reversible Phase-20 migration; the 38 rows keep working on scalar columns throughout. |
| **Vocab drift JS↔SQL** — completeness engine returns all-null. | **High** | Reconcile `02.sql` to `accidentCase.js` in Phase 0 (H1/H2/H3); mirror test in `V417`. |
| **Notification spam** — over-emailing on every event. | **Medium** | Email OFF by default; action-required-only + digest (Phase 16); in-app only until deliberately enabled. |
| **Dead-end statuses** — reopened/total-loss cases pinned forever. | **Medium** | Transient reopen signal + total-loss overlay (H6); derivation test matrix. |
| **Scope creep** — ~20 tables referenced in 03/04 but not in `V417`. | **Medium** | Each phase creates only its own tables (H4/M2); the mirror test fails on a reference to a nonexistent table. |
| **Regression to the rest of Tyre Pulse** — shared triggers/bus. | **Medium** | Extend, never fork, the notification bus and stage ledger; respect `accident_derive_fields` ordering (no `UPDATE OF` on a BEFORE-set column); full suite green each PR. |

---

## Definition of Done

Per the brief's Final Review (§37) and Acceptance Criteria (§32), the module is done when:

- **All 25 acceptance criteria pass** (each mapped to a phase above), verified by the test suites named
  per phase plus the closure-bypass-via-API suite (05 F.2) and the permission-matrix suite (C3).
- **Every route, handoff, closure blocker, permission, SLA calculation, and email route reviewed**
  end-to-end (§37 checklist), including Arabic/English display and mobile usability.
- **No regression** in existing Tyre Pulse modules; full test suite green on each PR; the 38 live
  accident rows and existing scalar workflow keep functioning throughout.
- **Every gate enforced at the DB** (RLS / DEFINER RPC / BEFORE trigger), never client-only (AC 24, §31
  "user cannot bypass through API calls").
- **Documentation complete** (§33 Phase 7): architecture, DB, API, role guide, workflow/insurance/
  workshop/handover/closure guides, admin + country-rule + email config, deployment + rollback notes,
  changelog — kept current *during* implementation, not only at the end.
- **A completion report** (§37) covering: what changed, what was reused, DB changes, new screens/roles/
  workflows/automation, migration outcome, tests completed, known limitations, future improvements, and
  deployment/rollback instructions.
- **Full lifecycle supported:** Registration → Evidence → Liability → Insurance → Technical Assessment →
  Repair Decision → Repair Planning → Vehicle Off-Road Control → Repair Execution → Workshop QC → Fleet
  Inspection → Return to Service → Insurance Settlement → Financial Closure → Final Case Closure.
