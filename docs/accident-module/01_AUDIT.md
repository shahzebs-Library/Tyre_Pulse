# Accident Module — Phase 1: Audit & Gap Analysis

> Deliverable for Phase 1 of the Accident & Insurance Management upgrade (`ACCIDENT_MODULE_BRIEF.md`).
> Grounded in the live repository (`src/pages/Accidents.jsx`, `src/lib/accident*.js`,
> `src/lib/api/accident*.js`, `src/components/accidents/*`, `src/components/AccidentDetailModal.jsx`) and
> the live Supabase schema (project `jhssdmeruxtrlqnwfksc`), inspected read-only on 2026-07-28.
> No code was changed and no migration was applied to produce this document.

---

## 1. Current technology stack

| Layer | What is in use |
|---|---|
| Frontend | React + Vite SPA (`BrowserRouter`), lazy routes wrapped in `<Safe>` error boundary + `RoleRoute`/`ModuleRoute`. Chart.js + ECharts for analytics; jsPDF / pptxgenjs / SheetJS for exports (lazy-loaded). |
| State / data access | Supabase JS client through a single service layer (`src/lib/api/_client.js`: `unwrap`, `applyCountry`, `fetchAllPages`, `ServiceError`). Explicit column lists, never `SELECT *`. |
| Database | Supabase Postgres. Multi-tenant, single production org today (Company A `00000000-0000-0000-0000-000000000001`), 3 countries (KSA / UAE / Egypt) kept apart by a `country` column. |
| Security | Row-Level Security is the real boundary: RESTRICTIVE `*_org_isolation` (org), `*_country_isolation` (`app_can_see_country`), `*_site_isolation` (`app_can_see_site`, V269 ABAC). Zero-arg RLS helpers wrapped in `(select …)` InitPlans (V396) for performance. Role gates via `get_my_role()` / `app_role()` / `app_is_elevated()`. |
| Automation | pg_cron jobs; a domain-event bus (`domain_events` + `event_consumers` + `deliver_workflow_notifications`); Supabase Edge Functions (`workflow-notify` v5 for accident email/push, `send-scheduled-reports`, `send-email` Resend transport). |
| Mobile | Expo / React Native inspector app (`mobile/`) writes accidents through an offline queue (`REPORT_ACCIDENT`); mirrors the web `toDb*`/`canon*` vocab maps inline. |
| Migration convention | Repo files `MIGRATIONS_V*.sql` (hand-numbered `V###`) applied live via the Supabase MCP. The live `supabase_migrations.schema_migrations` table stores timestamp versions (latest `20260728175707`), so the `V###` sequence is a **repo-side** convention tracked in `PROJECT_MEMORY.md`. |

The accident module today is **one `accidents` table + one owner page + one detail modal + a routing/email engine**. There is no relational sub-record model (no `accident_parties`, `insurance_claims` in use, `repair_orders`, `sla_instances`, etc.).

---

## 2. Current `accidents` table — full column inventory

The live `accidents` table has **92 columns** (verified against `information_schema`). It is already the "one large table" the brief warns against. Grouped, with the brief workstream each maps to:

### Identity / incident (Workstream A — Incident & Evidence)
`id` (uuid pk), `organisation_id` (NOT NULL, `app_current_org()`), `reference_no` (`ACC-YYYY-####`, per-org per-year), `client_uuid` (offline dedupe), `site` (NOT NULL), `asset_no` (NOT NULL), `vehicle_id`, `plate_number` (V243), `vehicle_type` (V243), `country`, `project` (V300), `department` (V300), `reported_by`, `reporter_name`, `incident_date` (NOT NULL), `incident_time`, `location`, `latitude` / `longitude` (V300 GPS), `accident_type` (NOT NULL, CHECK token — V222), `description`, `damage_description`, `injuries` (bool), `injury_count`, `third_party_involved` (bool), `police_report_no`, `photos` (jsonb), `documents` (jsonb, V300), `videos` (jsonb, V300), `custom_data` (jsonb), `notes`, `created_at`, `updated_at`

### Classification (Workstream B — Safety & Liability)
`severity` (NOT NULL, CHECK token minor/moderate/severe/fatal — V222), `damage_class` (V219), `damage_condition` (V219), `fault_status` (V219)

### Liability / safety (Workstream B)
`liable_party`, `responsible_party`, `payer`, `gcc_liability_ratio` (int, V219), `najm_status`, `najm_fault`, `taqdeer_status`, `taqdeer_no` (V250), `root_cause` (V300), `corrective_action` (V300), `preventive_action` (V300), `hse_investigation` (V300), `departments_involved` (text[], V300), `responsible_owner_id` (uuid, V300), `responsible_owner` (free text)

### Insurance / claim (Workstream C)
`insurer`, `policy_no`, `insurance_claim_no`, `claim_status` (default `none`), `claim_amount`, `claim_approved_amount`, `deductible`

### Repair / workshop (Workstreams D + E of brief §5)
`estimated_damage_cost`, `repair_type` (Internal/External), `workshop_name`, `workshop_location` (V250), `workshop_quotation`, `discount_pct`, `final_amount`, `repair_cost`, `parts_cost` (default 0), `approved_repair_amount` (V300), `estimate_approved_by` (uuid, V300), `estimate_approved_at` (V300), `expected_release_date`, `inspector`

### Vehicle control / lifecycle / handover (Workstream E)
`workflow_stage` (unified 12-value ladder, CHECK `chk_accident_workflow_stage`, default `reported` — V300), `status` (legacy CHECK token), `current_status` (free text), `case_stage` (V219), `vor` (bool, V300), `vor_since` (V300), `release_date`, `closure_evidence` (V300), `action_to_be_taken`, `required_action`, `next_step`, `status_update_date`, `status_update_note`, `target_date` (V300), `sla_due_at` (V300, empty on all rows)

### Recovery / finance (Workstream F)
`recovered_amount`, `recovery_date`, `recovery_source`, `recovery_status` (default `pending`), `recovery_reference`, `amount_transfer` (V250)

### Closure / review / audit
`closure_status` (default `open`), `close_requested_by`, `close_requested_at`, `close_request_note`, `closure_approved_by`, `closure_approved_at`, `closure_rejected_reason`, `reviewed_by`, `reviewed_at`, `stage_waivers` (jsonb, V399), `vor_sla_notified_at`, `overdue_notified_at` (V305 SLA-scan dedupe)

**Live data:** **38 accident rows** (project-memory notes historically say 35; the live count is 38 as of this audit). Stage distribution: `reported` 17, `closed` 12, `repair_in_progress` 5, `repair_approval` 1, `insurance_claim` 1, `final_inspection` 1, `initial_review` 1.

---

## 3. What already exists and is REUSABLE

The upgrade is **not** greenfield. A large fraction of the brief's spine already ships and must be reused, not rebuilt.

| Existing asset | Where | Reuse for brief section |
|---|---|---|
| **Unified 12-stage lifecycle ladder** (`reported → initial_review → hse_investigation → workshop_assessment → insurance_claim → repair_approval → repair_in_progress → final_inspection → vehicle_release → cost_recovery → closed / cancelled`) | `src/lib/accidentWorkflow.js` `WORKFLOW_STAGES`; DB `chk_accident_workflow_stage`; `accident_stage_from_status` / `accident_status_from_stage` (V300/V301) | §5 workstreams, §6 main-status ladder. The brief's 30-status list is a **superset** of this 12-stage ladder — extend, don't replace. |
| **Stage ↔ legacy status sync trigger** + reference-number generation + VOR-since management | `accident_derive_fields()` BEFORE trigger (V301) | Auto-derived status (brief "status moves from actions, not a dropdown"). |
| **Stage event ledger** — `accident_stage_events` (entered_at/exited_at/entered_by/department/`skipped`/`basis`) written **only** by DEFINER trigger `trg_accident_log_stage_event`; no client insert path | V398; `src/lib/api/accidentStages.js` | §13 process analytics ("time spent with each team"), §10 SLA timing base, §18 audit. **38 rows live.** This is the seed of the brief's `sla_events` / time-in-stage requirement. |
| **Per-team field-ownership map + completion engine** — each stage owns specific `accidents` columns; `stageCompletion`, `caseProgress` (done/skipped/current/pending), `teamPerformance`, `longestWaiting`, `skippedStageReport`, `buildStageIntelligence` | `src/lib/accidentStages.js` (pure, 30 tests) | §5 workstream ownership, §4 route completeness (partial — see gaps), §13 "which team delayed the case". |
| **Stage waivers** — `accidents.stage_waivers` jsonb `{stage:{required:false,by,at,remark}}`; absent key = applies; waive/reinstate audited | V399; `stageApplies` / `waivedStages` | §3 "Not Applicable requires a reason", §4 route-based mandatory stages. |
| **Department + routing-rule engine** — `departments` (12 seeded), `accident_routing_rules` (7 live: severity/type/site/country/min_cost/injury/vor/third_party → departments + to/cc/escalate roles) | V302/V303; `src/lib/api/accidentWorkflow.js`; `evaluateRouting` / `resolveRecipients` in `accidentWorkflow.js` | §9 notification matrix, §16 permissions/routing, §27 business-rule engine (partial). |
| **Approved email templates** — `accident_email_templates` (15 live, `{{token}}` bodies), `accident_apply_tokens` renderer | V303 | §9 email templates + subject format. Token set already covers reference_no/asset/plate/site/severity/stage/pending_action/due_date/link. |
| **Notification engine over the domain-event bus** — `emit_accident_domain_events` (reported / stage_changed / claim_changed / vor_changed) → `consume_event_accident_notify` → in-app `notifications` always, email only when `system_config.accident_emails_enabled = true` → `workflow_notifications` → pg_cron `deliver_workflow_notifications` → `workflow-notify` edge fn (v5) | V300 part 5, V304/V305 | §9, §13, §26 escalation. Email is **gated OFF by default** (deliberate). SLA-scan cron `accident-sla-scan` (V305) already emits `vor_sla_breach` + `overdue` with dedupe columns. |
| **Report builder + analytics** — block-based `AccidentReportBuilder`, `accidentReport.js` catalog (12 charts / 12 KPIs), `accident_report_templates` (10 live, schedulable as `builder:<id>`), `AccidentIntelligencePanel` (basis-aware), `ClaimProgressBoard`, `CaseProgressPanel` | `src/components/accidents/*`; `src/lib/accidentReport.js`; `accidentReportPdf.js`/`Pptx.js` | §13/§24 analytics, §25 reporting/exports. |
| **Claims calc single source** | `src/lib/claimsAnalytics.js` (`analyzeClaims`, `hasClaim`, `isClosed`, `isDelayed`, `claimNet`) | §24.2 insurance KPIs, §24.3 financial KPIs. Do NOT duplicate claim maths. |
| **Vocabulary single source** — CHECK-token converters | `src/lib/accidentVocab.js` (`toDbSeverity`/`Status`/`AccidentType`, `canon*`, liability/payer/najm/taqdeer/recovery/damage lists, `isIncidentClosed`, `isCaseSettled`) | §4 classification vocab, §5.3 liability options. Extend these lists — never inline a new vocab in a component. |
| **RLS helpers + audit infrastructure** — org/country/site isolation applied to `accidents`; `accident_audit_log` (138 rows; AFTER-trigger, status old/new) + `accident_remarks` (case log) + `accident_parts` (0 rows) | schema | §15/§16 permissions, §18 audit, §30 security. |
| **Case detail UI shell** — `/accidents/:id` modal with tabs Overview, **Teams & Progress**, Tracker, Repair & Insurance, Claim & Recovery, Parts & Repairs, Case Log, Activity, Closure; sticky header; `CaseTimelineSection`; edit-lock on closed cases | `src/components/AccidentDetailModal.jsx` | §6/§12 tabbed case screen + fixed header. The tab skeleton already resembles the brief §12.2 layout. |
| **Detail service guard** — `saveStageFields` writes ONLY columns the named stage owns (rejects the rest) | `src/lib/api/accidentStages.js` | §15 "Insurance cannot edit workshop findings" — the enforcement primitive exists (client-side today). |

---

## 4. Gap table — 6 workstreams + cross-cutting engines

Legend: **Exists** (production-ready) · **Partial** (present but incomplete vs brief) · **Missing**.

| # | Brief workstream / capability | Status | Specific gap |
|---|---|---|---|
| **A** | **Incident & Evidence** (register asset/driver/site, movable/recovery flag, description, authority report, mandatory photos, third-party, injuries) | **Partial** | Core fields exist (`asset_no`, `driver_name`, `site`, `description`, `photos`, `police_report_no`, `injuries`, `third_party_involved`, GPS, `documents`/`videos`). Missing: **structured photo checklist** (front/rear/corners/plate/VIN/odometer — brief §7/§10 "11 of 13 uploaded"), **evidence-requirement tracking**, **witness statements**, **driver statement as a first-class record**, **multiple third parties** (`third_party_involved` is a single bool; no `accident_parties`). Authority = Najm/Taqdeer scalar columns only, not configurable per-country authority types. |
| **B** | **Safety & Liability** (severity, preventability, root cause, official liability %, safety violations, corrective/preventive actions, escalation) | **Partial** | `severity`, `root_cause`, `corrective_action`, `preventive_action`, `hse_investigation`, `gcc_liability_ratio`, `fault_status`, `liable_party` all exist. Missing: the brief's **9-value liability enum** (Our-driver-100% / partial / third-party-100% / shared / under-investigation / disputed / hit-and-run / no-third-party / N/A) — current `liable_party` is `GCC / Other Party` only; **separate liability % per party**; **preventable flag**; **immediate vs root cause split**; **unsafe act / unsafe condition**; **corrective actions as tracked records with owners + due dates + evidence** (they are single text columns, not a `corrective_actions` table); **liability lock + reason-required change** (§5.3). |
| **C** | **Insurance & Claim** (policy validity, claim registration, missing-doc tracking, surveyor, decision, deductible/approved/exclusions, settlement, recovery) | **Partial / Missing** | Scalar columns exist (`insurer`, `policy_no`, `insurance_claim_no`, `claim_status`, `claim_amount`, `claim_approved_amount`, `deductible`, recovery block) and `claimsAnalytics` computes KPIs. Missing: the **14-value insurance decision lifecycle** (docs-incomplete → registered → awaiting-ack → awaiting-surveyor → survey-done → awaiting-decision → approved/partial/rejected/withdrawn/settled/disputed/legal); **`insurance_policies` master with validity-on-date check**; **claim documents / missing-doc tracking**; **surveyor record**; **broker**; **claim events log**; **multiple claims per case**. `insurance_claims` table exists but is **0 rows / unused** (separate `/insurance-claims` CRUD ledger, not wired to accidents). |
| **D** | **Repair planning & execution** (technical assessment, damage items, internal/external decision, labour hrs, parts request, quotation comparison, PO, schedule, before/during/after photos, workshop QC) | **Missing (mostly)** | Only outcome scalars exist (`repair_type`, `workshop_name`, `repair_cost`, `parts_cost`, `approved_repair_amount`, `workshop_quotation`, `final_amount`). Missing: **`damage_assessments` / `damage_items`**, **`repair_orders` / `repair_tasks` / progress updates**, **labour-hour estimate**, **`parts_requests` linked to Store/inventory**, **quotation comparison**, **PO linkage** (brief §21 — reuse existing procurement, don't rebuild), **workshop QC checklist + pass/reject**, **before/during/after photo categories**, **repair rectification loop** (§20). `accident_parts` table exists but is **0 rows / not surfaced**. |
| **E** | **Vehicle control & handover** (approve off-road period, replacement vehicle, stop/release asset, Fleet inspection accept/reject, rectification, actual downtime) | **Partial / Missing** | VOR is real (`vor`, `vor_since`, VOR-SLA cron). `release_date`, `expected_release_date`, `closure_evidence` exist and `vehicle_release` is a stage. Missing: **replacement-vehicle allocation**, **structured Fleet handover inspection (accept/reject with rectification task)** separate from workshop completion (brief insists these are distinct), **actual-downtime computation**, **vehicle master operational-status sync** (`vehicle_fleet` is not updated from accident VOR). |
| **F** | **Finance & Settlement** (PO value, quotation/PO/invoice match, internal/external/towing/storage cost, insurer-approved, deductible, amount received, third-party recovery, uninsured/unrecovered, financial closure) | **Partial** | `repair_cost`, `parts_cost`, `deductible`, `claim_approved_amount`, `recovered_amount`, `amount_transfer`, `recovery_*` exist; `claimsAnalytics.netExposure` derives unrecovered. Missing: **towing / storage / third-party cost lines**, **invoice vs PO match**, **`financial_transactions` / `claim_recoveries` records**, **separate labour vs parts internal cost**, **explicit "financial closure" gate distinct from operational**. |
| **SLA** | **Configurable SLA engine** (per-task start/due/remaining/team/owner/pause-reason/restart/escalation, working calendar, country holidays) | **Missing** | `sla_due_at` column exists but is **empty on all rows**; VOR-SLA + overdue cron (V305) is a fixed single timer, not configurable per activity. No `sla_definitions` / `sla_instances` / `sla_pause_events`, no working-calendar/holiday model, no pause-with-reason. Time-in-stage data **does** exist in `accident_stage_events` (reusable measurement base). |
| **Route completeness** | **Route-based mandatory workstreams** (mandatory set derived from case route, not field count; per-area % — incident/insurance/repair/financial/overall) | **Partial** | `accidentStages.js` computes completion against **required fields per stage reached** and `stage_waivers` can switch a stage off — this is the right shape. Missing: **route profiles** (Minor-no-insurance / External-with-insurance / Total-loss / Injury) that auto-select which stages are mandatory; **per-area percentages**; **conditional toggles driving requirements** (brief §8/§11). |
| **Closure gate** | **Three-level closure** (Operationally completed / Financially open / Fully closed) with AND-gated mandatory controls; N/A requires reason; reopen requires approval | **Partial** | A close-request/approve flow exists (`closure_status`, `close_requested_*`, `closure_approved_*`, `closure_rejected_reason`) and closed cases are edit-locked in the modal. Missing: the **3-level model**, the **server-enforced AND-gate** ("no full close while insurance/finance/CA/handover incomplete"), **N/A-requires-reason enforcement**, **structured reopen** (reason + approver + new owner + due date). Today `status`→`closed` on the dropdown closes a case in one write (the "goes to closed on its own" problem V398 was built to *expose*, not prevent). |
| **External portal** | **Restricted external access** for insurers / brokers / surveyors / workshops (view assigned request, upload docs/quote/invoice, confirm dates) via expiring links or restricted accounts | **Missing** | No external-party access model. `report_shares`/`get_report_snapshot` (read-only public report tokens) is a **pattern to reuse** for expiring-link mechanics, but nothing lets an external party upload or respond. Email reply-token capture (§9/§23 inbound) does not exist. |
| **Team inboxes** | **Role-based home screens / task inboxes** (Fleet / Insurance / Workshop / Procurement+Store / Fleet-manager / Finance views) with filters | **Missing** | Routing resolves recipients and `teamPerformance`/`longestWaiting` compute per-team holding, but there is **no per-role inbox surface** and **no `case_tasks` model** (my-tasks / overdue / waiting-for-approval). The whole module is one register + one detail modal for every role. |
| **Data model** | **Normalized relational sub-records** (parties, evidence, policies, claims, repair orders, tasks, approvals, communications, sla, closure requirements) | **Missing** | One wide `accidents` table (92 cols) is exactly the anti-pattern the brief calls out (§12/§17). Only `accident_stage_events`, `accident_audit_log`, `accident_remarks`, `accident_parts` (unused) exist as children. |
| **Audit** | **Full field-level audit** (old/new/user/reason/source) on every important action | **Partial** | `accident_audit_log` (138 rows) captures status changes + part/stage-waiver events via AFTER triggers; `Activity` tab + `describeAuditRow`. Missing: **reason-on-change**, **source (web/mobile/api/email)**, coverage of liability/cost/claim-decision changes, and immutability guarantees beyond current policies. |

---

## 5. Migration-safety notes

- **Next free migration number: `V417`** (per `PROJECT_MEMORY.md`; V416 = `MIGRATIONS_V416_MATERIAL_MASTER_BULK_CONFIRM.sql`, applied live). The live `schema_migrations` table uses timestamp versions, so continue the repo-side `V###` convention and apply via the Supabase MCP against project `jhssdmeruxtrlqnwfksc`.
- **One-org assumption.** All production data + users live in Company A (`00000000-0000-0000-0000-000000000001`). Seeds (departments, routing rules, templates, and any new route/SLA/closure profiles) are seeded for that org. Every new table must default `organisation_id` to `app_current_org()` and carry the standard RESTRICTIVE `*_org_isolation` + (where the data is site/country scoped) `*_country_isolation` / `*_site_isolation` policies, matching V300/V269 patterns.
- **Additive / non-destructive only.** The **38 live accident rows** (and 38 stage events, 138 audit rows) must be preserved. Do not drop or repurpose any existing `accidents` column — legacy status columns (`status`, `current_status`, `case_stage`, `closure_status`) are still read and are mapped, not removed (this is the standing rule from V300). New relational sub-tables must be **INSERT-additive**: existing accidents keep working with their scalar columns until data is migrated into children.
- **Backfill honesty.** Do not mark migrated historical rows as "complete" (brief §28/§35). `accident_stage_events` already models this with `basis='backfilled'` + `estimated` flags — reuse that discipline for any new state derived from old data.
- **Trigger interactions to respect.** `accident_derive_fields` (BEFORE) sets `workflow_stage`/`status`/`reference_no`/`vor_since`; `emit_accident_domain_events` (AFTER) fires the notification bus; `trg_accident_log_stage_event` (DEFINER) writes the ledger. Any new stage/status logic must slot around these, not duplicate them. `UPDATE OF <col>` must not be used for a column a BEFORE trigger sets (documented V398b lesson).
- **CHECK constraints.** `chk_accident_workflow_stage`, `chk_accident_type` (V222), `chk_severity` are enforced — widen them in-migration before writing new tokens, and keep the JS `toDb*` maps in `accidentVocab.js` in lockstep.
- **Email stays gated.** `system_config.accident_emails_enabled` defaults `false`; keep new notification work behind it. In-app notifications fire regardless.

---

## 6. Recommended implementation order (mapped to brief §33 Phase 5)

Reuse-first, small reviewable migrations, additive at every step:

1. **Data model foundations (V417+).** Add the relational children that have no home today, keeping `accidents` as the case header: `accident_parties`, `accident_evidence` (+ `evidence_requirements`), `damage_assessments`/`damage_items`, `repair_orders`/`repair_tasks`, `parts_requests` (link to existing procurement, brief §21), `case_tasks`, `case_approvals`, `insurance_claims`-backed claim + `claim_documents`/`claim_events`, `financial_transactions`/`claim_recoveries`. (Maps to Phase-5 steps 1, 4, 5, 7, 9, 14.)
2. **Route + closure engine.** `workflow_route_profiles` + route-derived mandatory stages layered on the existing `stage_waivers`/`accidentStages.js`; the 3-level closure gate as a server-enforced function reading required workstream completion; N/A-requires-reason; structured reopen. (Phase-5 15.)
3. **Role permissions + team inboxes.** Extend `accident_routing_rules` / RLS with the brief's role set; build per-role inbox surfaces over `case_tasks` + `teamPerformance`. Reuse `saveStageFields` column-ownership guard, promote it to RLS (Phase-5 2).
4. **Liability & Safety depth.** 9-value liability enum + per-party %, preventability, unsafe-act/condition, corrective-action records with owners/due/evidence, liability lock. (Phase-5 6.)
5. **Insurance claim lifecycle.** 14-value decision ladder, policy master + validity check, surveyor, missing-doc tracking, settlement/recovery records; wire the dormant `insurance_claims` table. (Phase-5 7.)
6. **Technical assessment → repair planning → execution → QC → Fleet handover.** Damage items, repair orders/tasks, parts/PO, workshop QC, Fleet inspection (accept/reject + rectification loop), replacement vehicle, actual downtime, `vehicle_fleet` operational-status sync. (Phase-5 8–13.)
7. **Finance & settlement.** Towing/storage/third-party cost lines, invoice/PO match, financial-closure gate distinct from operational. (Phase-5 14.)
8. **SLA engine.** `sla_definitions` / `sla_instances` / `sla_pause_events` + working-calendar/holiday + pause-with-reason + escalation, measured off `accident_stage_events`. (Phase-5 18.)
9. **Email/notifications depth + external portal.** Extend the existing template/routing engine (subject format, action-required-only, digest); inbound reply-token capture; expiring external-upload links reusing the `report_shares` token pattern. (Phase-5 16, 17.)
10. **Analytics + mobile wizard + data migration.** Process-analytics (time-in-team from the ledger), route-aware KPIs; the mobile capture wizard with photo checklist; migrate scalar `accidents` data into the new children with a logged, reversible, honesty-preserving migration. (Phase-5 19, 20.)

---

### Sources inspected
- Code: `src/pages/Accidents.jsx` (3 tabs: Register / Analytics / Report Builder), `src/components/AccidentDetailModal.jsx` (9 tabs), `src/components/accidents/{AccidentIntelligencePanel,AccidentReportBuilder,CaseProgressPanel,ClaimProgressBoard}.jsx`, `src/lib/{accidentWorkflow,accidentStages,accidentVocab,accidentReport}.js`, `src/lib/api/{accidents,accidentWorkflow,accidentStages}.js`.
- Migrations: `MIGRATIONS_V219_ACCIDENT_CASE_FIELDS.sql`, `V221_ACCIDENT_REPORT_TEMPLATES`, `V243`, `V250`, `V300_ACCIDENT_WORKFLOW` (V300–V305), `V397_NORMALISE_ACCIDENT_ASSET_NO`, `V398_ACCIDENT_STAGE_LEDGER`, `V399_ACCIDENT_STAGE_APPLICABILITY`.
- Live schema (project `jhssdmeruxtrlqnwfksc`, read-only): `accidents` 92 cols / 38 rows; `accident_stage_events` 38; `accident_routing_rules` 7; `accident_email_templates` 15; `departments` 12; `accident_report_templates` 10; `accident_audit_log` 138; `accident_remarks` 1; `accident_parts` 0; `insurance_claims` 0; `incident_reports` 0.
