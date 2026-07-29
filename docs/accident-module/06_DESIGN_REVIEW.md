# 06 — Accident Module Design Review (adversarial, pre-implementation)

> Skeptical review by a Security Engineer + Data Architect + QA lead, run **before** any code or
> migration is written, to catch defects while they are still cheap. No migration was applied and no
> file other than this one was changed.
>
> **Reviewed:** `docs/accident-module/01_AUDIT.md`, `02_DATA_MODEL.sql` (the actual `V417` migration
> artifact — the design doc `02_DATA_MODEL.md` it references does **not exist** in the folder),
> `03_WORKFLOW_ENGINE.md`, `04_UX_CASE_SCREEN_AND_MOBILE.md`, `05_SLA_NOTIFICATIONS_ANALYTICS_QA.md`,
> plus `ACCIDENT_MODULE_BRIEF.md` (acceptance bar) and `PROJECT_MEMORY.md` (repo rules).
>
> **Grounded against the live repo** (read-only): `app_is_elevated()` = `app_role() in
> ('admin','manager','director')` (`MIGRATIONS_V41`); `app_user_can(key,cap)` defaults every non-`view`
> capability to **false** unless a `permission_overrides` envelope entry or a `user_access_grants` row
> exists (`MIGRATIONS_V229`); `public.set_updated_at()` is **used** by ~15 migrations (incl. `V221`) but
> has **no `CREATE FUNCTION` in any repo `.sql`** (it lives only in the live DB).

---

## Verdict

**Proceed only after the Critical + High must-fix list is resolved.** The design is unusually strong on
reuse discipline, honest-null accounting, additive/non-destructive migration mechanics, and notification-bus
reuse. But three Critical issues would ship a **closure gate and permission model that do not actually
enforce anything at the database layer**, and six High issues are **cross-document contradictions** (workstream
vocabulary, table names, `case_status`, closure-level tokens) that would produce a broken completeness engine
and API calls against tables that do not exist. These are exactly the class of defect this review exists to
catch: individually each doc is coherent, but **02 (the migration that will run) and 03/04/05 (the engine/UX/SLA
specs the JS will follow) disagree on the fundamentals.**

---

## Critical

### C1 — The closure gate is not enforced by the migration that ships the closure columns
- **Where:** `02_DATA_MODEL.sql` Part A (adds `accidents.closure_level`, `is_reopened`, `legal_hold`,
  `cancelled_duplicate_of`); `03_WORKFLOW_ENGINE.md` §6.3 (the `enforce_accident_action_capability` guard is
  explicitly **PHASE-LATER**, and `02` header "WHAT IS CREATED vs PHASE-LATER" confirms all triggers are deferred).
- **Failure scenario:** `V417` adds `closure_level` as a plain, writable column on `accidents`. No new guard is
  added to `accidents` in this migration, and the guard that 03 specifies keys on `case_status` — a column
  `02` never creates (see H2). So between `V417` and some unbuilt later migration, **any user who can already
  `UPDATE accidents` can `PATCH /accidents?id=… { "closure_level": "fully_closed" }`** with zero requirement
  check. This is the exact "a case goes to closed in one write" defect that V398 was built to *expose* — silently
  reintroduced on a new column. Brief acceptance criteria 13 ("cannot fully close with missing requirements")
  and 24 ("permissions validated on the server") both fail.
- **Fix:** Ship the closure enforcement **in the same migration as the closure columns**, never later. The
  `close_case`/`closure_level` BEFORE-UPDATE guard (calling a server-side `accident_can_close(id)`) and a
  policy/CHECK preventing a direct jump to `fully_closed` must land in `V417`. If enforcement genuinely must
  phase later, do **not** add `closure_level` to the writable column set yet — a live writable field with no
  gate is worse than no field.

### C2 — Group-A `_write` = `app_is_elevated()` gives zero segregation of duties AND locks every team role out of its own workstream
- **Where:** `02_DATA_MODEL.sql` Part E, Group A `_write` policy: `FOR ALL USING (app_is_elevated())`. Grounded:
  `app_is_elevated()` = `app_role() in ('admin','manager','director')`.
- **Failure scenario (two opposite failures from one policy):**
  1. **Team roles cannot write.** The brief's operating model (03 §6.1, 04 §3.2) is that an *Insurance Claims
     Officer* edits `accident_insurance_claims`, a *Workshop Inspector* edits `accident_damage_assessments`, a
     *Fleet Inspector* accepts on `accident_handover_inspections`, a *Storekeeper* edits
     `accident_parts_requests`, a *Finance Officer* posts to `accident_financial_transactions`, an *HSE Officer*
     approves on `accident_liability_assessments`. **None of those roles are `admin/manager/director`**, so under
     `app_is_elevated()` they are **denied every write.** The entire per-team ownership design is inoperative at
     the RLS layer.
  2. **No segregation of duties.** The three roles that *are* elevated can write **every** child table — a
     Manager can approve+lock liability, accept the vehicle handover, post costs, and approve the closure review
     on the same case. Brief §15/§16 ("Insurance cannot edit workshop findings," "only Fleet Inspector accepts
     the vehicle," SoD) and acceptance criterion 24 are unmet. 03 §6.2's rich role×action matrix and 03 §6.4 SoD
     have **no representation in the shipped RLS** — they are documented as PHASE-LATER, but the tables are live
     and writable meanwhile.
- **Fix:** Replace the uniform `app_is_elevated()` write policy with the per-capability model 03 §6.3 already
  specifies, and ship it **with** the tables: each child table's INSERT/UPDATE gated by
  `app_user_can('accidents','<cap>')` (the V238/V241 PERMISSIVE pattern), ORed with role policies, so a
  non-elevated *Insurance Claims Officer* granted `edit_claim` can write claims but not handovers. The SoD guard
  (`accident_sod_ok`) must be in the same migration. Do not leave a flat elevated-write model as the interim
  security boundary.

### C3 — The accident permission matrix is inert by default: `app_user_can` returns false for all 16 new capabilities
- **Where:** `03_WORKFLOW_ENGINE.md` §6.2 (16 capability tokens: `submit`, `validate`, `approve_liability`,
  `edit_insurance`, `assess`, `approve_repair`, `request_parts`, `execute_repair`, `qc_repair`,
  `accept_handover`, `post_cost`, `close_case`, `reopen_case`, `cancel_case`, `legal_hold`) and §6.3 note 1.
  Grounded: `app_user_can` (V229) — "For any other capability the default comes from the `app_settings`
  `permission_overrides` envelope … **else false.**"
- **Failure scenario:** None of the 16 accident caps are `view/create/edit/delete/export/approve`, so unless a
  `permission_overrides` entry is seeded for **every role × module × cap**, `app_user_can('accidents',
  'approve_liability')` (and all 15 others) resolves to **false for every non-admin.** Combined with the C2
  guard (once built) this means **only Admin/super can perform any accident action** — submit, validate,
  approve, close — until a large override matrix is seeded. The design specifies the matrix (03 §6.2) but not
  the seed that makes `app_user_can` return it, so the module is unusable by the intended roles on day one.
- **Fix:** Add a seed step (idempotent, org-scoped) that writes the 03 §6.2 role→capability defaults into the
  `permission_overrides` envelope `app_user_can` reads, and pin it with a test that
  `app_user_can` returns the matrix for each seeded role. Confirm `app_user_can` supports arbitrary cap tokens
  end-to-end (it accepts them, but every consumer — client `hasCapability`, the guard trigger — must too).

---

## High

### H1 — 02 and 03 disagree on the canonical workstream vocabulary → completeness engine cannot work
- **Where:** `02` `accident_case_workstreams.workstream_key` CHECK (12 keys:
  `incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision,
  repair_planning, fleet_offroad, repair_execution, workshop_qc, fleet_handover, finance_settlement`) and the
  Part-F seeded `accident_route_profiles.required_workstreams` (which use those 12 keys). Versus
  `03` §2.1/§2.3/§4.2/§4.3 (10 keys: `incident_evidence, fleet_validation, liability, insurance, assessment,
  repair, workshop_qc, handover, finance, corrective`).
- **Failure scenario:** `completeness()` (03 §4.3) reads `route.required_workstreams` (02's keys, e.g.
  `liability_safety`, `insurance_claim`, `finance_settlement`) but computes `workstreamStatus` for 03's keys
  (`liability`, `insurance`, `finance`). The sets **never intersect**, so `PIPELINE_ORDER ∩ required` is empty,
  every dimension reports `null`, and the case can never advance or close. 03's `DIMENSION_OF`,
  `WORKSTREAM_STAGE`, `CASE_STATUS_FOR`, `requiredWorkstreams` are all keyed to a vocabulary the migration
  rejects. The workstream-status enum also drifts: `02` uses `waiting_information`, `03` §2.2 uses
  `waiting_info`.
- **Fix:** Pick **one** canonical workstream key set and one status-token set, define them once (a shared vocab
  module mirrored to the SQL CHECK), and rewrite the other doc to match. Reconcile the granularity decision too:
  02 splits repair into `repair_decision/repair_planning/repair_execution`; 03 collapses to one `repair`. The
  route seeds, `DIMENSION_OF`, `CASE_STATUS_FOR`, and the CHECK must all use the chosen set.

### H2 — `case_status` (the 30-value headline) is required by 03/04 but never created or constrained by 02
- **Where:** `03` §0/§1 introduces `accidents.case_status` (derived, stored, 30 tokens), §6.3's guard keys on
  `NEW.case_status`, `04` §2.1 header renders it. `02` Part A adds many columns but **not `case_status`** and
  adds **no CHECK** for the 30 tokens (it leaves the 12-value `chk_accident_workflow_stage` unchanged, correctly).
- **Failure scenario:** The engine writes/reads a column that does not exist; the guard trigger keys on a
  missing column; the UX header binds to nothing. Any code built to 03/04 fails at runtime.
- **Fix:** If `case_status` is a stored projection, `02` must `ADD COLUMN case_status text` with a widen-guarded
  CHECK for the 30 tokens and keep the JS `CASE_STATUS_STAGE` in lockstep (per the mirror rule). If it is meant
  to be computed on read only, remove the "stored" language and the guard's dependence on it, and derive it in
  the engine/view — but then the §6.3 status-change guard needs a different trigger key.

### H3 — `closure_level` token values contradict between the CHECK and the engine
- **Where:** `02` `chk_accident_closure_level` allows `open / operationally_completed / financially_pending /
  fully_closed`. `03` §4.4/§5.1 `closureLevel()` returns `operationally_completed / financially_open /
  fully_closed / open` **and** `fully_closed_pending_review`.
- **Failure scenario:** The engine writes `financially_open` or `fully_closed_pending_review` to
  `accidents.closure_level` → **CHECK constraint violation**, the write fails, the case cannot advance. `02`'s
  `accident_closure_reviews.level` CHECK (`operationally_completed/financially_pending/fully_closed`) has the
  same divergence from 03.
- **Fix:** Align on one token set in the migration and the engine (and the reviews table). `financially_pending`
  vs `financially_open` and the existence of `fully_closed_pending_review` must be decided once.

### H4 — Pervasive table-name divergence: 02 creates `accident_*` tables; 03/04/05 reference dozens of unprefixed / nonexistent tables
- **Where:** `02` deliberately prefixes every case table `accident_` (and documents *why*: to avoid colliding
  with the unrelated generic `insurance_claims`, `corrective_actions`, `sla_records`). But `03`/`04`/`05` refer
  throughout to unprefixed names — `insurance_claims`, `corrective_actions`, `sla_instances`, `sla_definitions`,
  `sla_pause_events`, `case_tasks`, `case_communications`, `case_approvals`, `damage_assessments`,
  `repair_orders`, `repair_tasks`, `financial_transactions`, `claim_recoveries`, `liability_assessments` — and
  to ~20 tables `02` never creates at all: `insurance_policies`, `insurance_claim_documents`,
  `insurance_claim_events`, `insurance_decisions`, `insurance_settlements`, `damage_items`, `repair_decisions`,
  `quotations`, `quotation_items`, `external_workshops`, `repair_progress_updates`, `parts_request_items`,
  `purchase_requests`, `replacement_vehicle_allocations`, `witness_statements`, `driver_statements`,
  `accident_case_parties`, `accident_case_vehicles`, `safety_investigations`, `root_causes`, `surveyors`,
  `case_task_dependencies`, `email_events`, `accident_case_routes`.
- **Failure scenario:** UI/API built from 03/04/05 queries `insurance_claims` (the **existing, unrelated**
  generic 0-row table `02` explicitly avoided) instead of `accident_insurance_claims`; queries `sla_instances`
  (nonexistent — the generic ledger is `sla_records`) instead of `accident_sla_instances`; queries `case_tasks`
  (nonexistent) instead of `accident_case_tasks`. Some fail with "relation does not exist"; worse, the ones that
  resolve to a real generic table silently read/write the **wrong** table. The "SQL↔JS mirror" discipline the
  docs repeatedly invoke is defeated by the docs not agreeing on the names.
- **Fix:** Make `02`'s `accident_*` names canonical across every doc, or decide the naming and rewrite `02`. Also
  reconcile the *scope* mismatch: 03/04 reference ~20 child tables that `02` does not build (parties, witnesses,
  driver statements, policy master, damage items, quotations, external workshops, PO/quotation children,
  replacement allocations, progress updates). Either `02` must create them or the specs must stop reading them.

### H5 — Route definitions in 03 reference workstream keys that violate the CHECK
- **Where:** `03` §4.1 route table: `injury` requires `authority_report, medical_injury, management_review,
  legal`; `total_loss` requires `total_loss_approval, asset_register`; `third_party` adds
  `third_party_recovery`; `hit_and_run`/`glass_only` etc. reference `authority_report`. **None** of these are in
  `02`'s 12-value `workstream_key` CHECK.
- **Failure scenario:** Instantiating an injury or total-loss route (the route-instantiation trigger 02 defers)
  would `INSERT accident_case_workstreams(workstream_key='authority_report')` → CHECK violation. The injury and
  total-loss routes cannot record the very workstreams that define them. (Note: `02`'s *seeded* injury/total_loss
  route profiles avoid this by using only valid keys — which means they silently **omit** the injury/total-loss
  specific steps, an honesty gap of its own.)
- **Fix:** Either add these keys to the workstream CHECK (and the vocab module + dimension map), or model
  authority report / medical / management review / total-loss approval / asset-register / third-party-recovery
  as their own records rather than workstream keys. Decide before coding the route engine.

### H6 — `deriveCaseStatus` pins the headline permanently for reopened and total-loss cases
- **Where:** `03` §3 step 0: `if record.reopened_flag: return 'reopened'` and `if record.total_loss_route:
  return 'total_loss_processing'`. `02` stores only the **permanent** `is_reopened boolean` / `reopen_count` and
  the **persistent** `route_key`.
- **Failure scenario:** `is_reopened` is set true on reopen and never reset (it is history), so once a case has
  ever been reopened, `deriveCaseStatus` returns `'reopened'` **forever**, masking its real progress — the case
  can never show `repair_in_progress` or `closed` again. Likewise any case whose `route_key='total_loss'`
  returns `'total_loss_processing'` permanently and can never derive to `closure_review`/`closed`, so a
  total-loss case cannot close. 03 §5.4 says reopen should map to "then the previous blocking status," which
  requires a **transient** signal the schema does not provide.
- **Fix:** Separate the permanent audit flag (`is_reopened`, `reopen_count`) from a transient "awaiting re-triage
  after reopen" state, and make `total_loss_processing` an overlay that still lets the pipeline derive an
  underlying status (or gate it so it clears when the total-loss workstreams complete). Add these to the F.2
  test matrix (reopened-then-progresses; total-loss-closes).

---

## Medium

### M1 — Cross-country / cross-site writes are not prevented on the child tables
- **Where:** `02` Part E — `_country_isolation` / `_site_isolation` are RESTRICTIVE **FOR SELECT only**; the
  only write policy is `_write FOR ALL USING (app_is_elevated())`, and `_org_isolation` checks org only.
- **Failure scenario:** An elevated user scoped to KSA can `INSERT`/`UPDATE` an Egypt case's
  `accident_financial_transactions` / `accident_liability_assessments` rows — the SELECT-only country/site
  policies never constrain the write, and the parent's isolation is not re-checked on the child. Money and
  liability records can be written across the country boundary within the org. (This mirrors the deliberate V269
  "visibility first, writes SELECT-only" precedent, so it is consistent — but for financial/liability/closure
  child records it is a real integrity hole.)
- **Fix:** Add `WITH CHECK (app_can_see_country(country) AND app_can_see_site(site))` to the write policy for
  the money/liability/closure child tables at minimum, or enforce parent-scope on child writes via the guard.

### M2 — Tables/objects specified in 03/05 are missing from the 02 migration
- **Where:** `05` names `sla_activity_bindings`, `accident_working_calendars`, `accident_country_holidays`,
  `accident_audit_logs`, `accident_external_grants`, and the digest infra (`workflow_notifications.digest_group`
  or `accident_digest_queue`); `03` names an `insurance_policies` master (for the "policy valid on date" check).
  `02` creates none of these. `02`'s `accident_insurance_claims.policy_id` is a dangling uuid with no policy
  table; `accident_sla_instances.sla_definition_id` has no FK.
- **Failure scenario:** The SLA business-minute engine (05 A.5) has no calendar/holiday tables to resolve
  against; the external portal (05 E) has no grant table to mint tokens from; the full field-level audit (05
  D.5) has no table; policy validity cannot be checked. Whole feature areas are specified but uncreated.
- **Fix:** Either fold these into `V417` or sequence explicit follow-on migrations, and make each doc state which
  migration creates each table so nothing is orphaned. Also: `02`'s `accident_case_communications.reply_token`
  is a **non-unique** partial index, but `05` §C.4 requires it `UNIQUE` — an inbound email reply keyed on a
  non-unique token can mis-route to the wrong case or be replayed. Add the unique constraint.

### M3 — Currency columns are nullable with no default → money-blend risk
- **Where:** `02` `accident_financial_transactions.currency`, `accident_insurance_settlements.currency`,
  `accident_claim_recoveries.currency` — all nullable `text`, no default, no derivation from the case country.
- **Failure scenario:** Rows land with `currency = NULL`; a cost/recovery rollup (05 D.2 financial KPIs) sums
  amounts across rows and blends SAR/AED/EGP — the exact recurring bug PROJECT_MEMORY and the brief call out
  ("the SAR+AED+EGP blend must not recur"). "Never blend currencies" is stated as intent in 05 but the schema
  does not default or enforce it.
- **Fix:** Default `currency` from the case country via `country_currency` / `accident_country_rule_profiles`,
  make it NOT NULL where an amount is present, and require KPI rollups to group by currency (reuse
  `governedCost.js`). Pin with a test that no rollup produces a single blended total.

### M4 — Backfill marks legacy closed cases `fully_closed` with no requirement check and no honesty flag
- **Where:** `02` Part A backfill: `set closure_level = 'fully_closed'` when `closure_status='closed' or
  status='closed' or workflow_stage='closed'`.
- **Failure scenario:** The 12 historical closed rows are asserted as `fully_closed` — i.e. "all closure
  requirements met" — though no requirement was ever verified for legacy data. This contradicts the audit doc's
  own §5 "Backfill honesty — do not mark migrated historical rows as complete" and the brief §28/§35, and
  contradicts the `basis='backfilled'` discipline the audit cites.
- **Fix:** Backfill legacy closed cases to a distinct `legacy_closed` level (or `fully_closed` carrying a
  `case_flags.closure_basis='backfilled'`), never presented as a verified full closure; the closure analytics
  must exclude/label them.

### M5 — Dual case identity: `reference_no` (existing) + new `case_no` with country baked in, contradicting 05
- **Where:** `02` Part A stores `case_no = 'TP-ACC-'||country||'-'||year||'-'||seq`, generated by an
  **independent** `row_number()` sequence. `05` §C.1 says the opposite: "the stored `reference_no` carries the
  sequence, the country is prefixed **at render**" — i.e. do not store a country-prefixed number.
- **Failure scenario:** Every case now has two identifiers with **different sequence numbers** (`reference_no`
  `ACC-2026-0007` vs `case_no TP-ACC-KSA-2026-000003`), and the docs disagree on whether the country-prefixed
  form is stored (02) or rendered (05). Users see two case numbers; emails (05 subject format) and the case
  header (04) may show a different number than the register.
- **Fix:** Decide one identifier. Either keep `reference_no` and render the display prefix (drop `case_no`), or
  derive `case_no` from the existing `reference_no` sequence so the numbers agree. Reconcile 02 and 05.

### M6 — "Not Applicable" is modelled three ways with no single authority and no DB-level reason enforcement
- **Where:** `02` `accident_case_workstreams` carries `required boolean`, `not_applicable boolean`, **and**
  `status='not_required'` — three overlapping representations — plus `na_reason/na_by/na_at`. 03 §5.2 says NA is
  satisfied only when reason+by+at (+approval where required) are present, but that envelope is enforced only in
  the engine, not by a CHECK/trigger.
- **Failure scenario:** The closure gate must decide which of the three fields is authoritative; they can
  disagree (`not_applicable=true` but `status='in_progress'`). A direct write can set `not_applicable=true` with
  `na_reason=NULL` (the `_write` policy allows it), so a workstream is switched out of scope with no reason —
  brief §3 and acceptance criterion 14 ("NA requires a reason") fail against a direct API call.
- **Fix:** Pick one authoritative NA representation; add a CHECK/trigger that `not_applicable=true` requires
  non-null `na_reason` + `na_by` + `na_at`; and route NA through an RPC that also enforces `na_requires_approval`.

### M7 — RPC-only guards (SLA pause approval, closure, audit immutability) are bypassable while the tables are directly writable
- **Where:** `05` A.7 enforces pause reason/date/long-pause-approval in the `sla_pause` RPC; `05` D.5 enforces
  audit immutability + mandatory reason in DEFINER RPCs; `03` §5.3 enforces closure in `accident_can_close`. But
  `02`'s Group-A `_write` grants elevated users direct INSERT/UPDATE on `accident_sla_pause_events`,
  `accident_sla_instances`, `accident_closure_reviews`, `accident_closure_requirements`.
- **Failure scenario:** A user bypasses the RPC and directly inserts a pause with no approval, flips an
  `sla_instances.status='met'`, inserts a `closure_review` with `decision='approved'`, or sets a
  `closure_requirements.satisfied=true` — none go through the RPC guard. Brief §31 "user cannot bypass … through
  API calls" fails. (This is the child-table sibling of C1.)
- **Fix:** For any table whose integrity depends on an RPC, revoke direct `authenticated` write and route all
  writes through DEFINER RPCs (the V398c `accident_stage_events` pattern the docs themselves cite), or make the
  guard a BEFORE trigger on the table rather than only in the RPC.

### M8 — Config-driven closure requirements are empty in the seeds, and two closure definitions coexist
- **Where:** `02` Part F seeds `accident_route_profiles` with `required_workstreams` populated but
  `closure_requirements` left at its `'{}'` default for every route. `03` §8.2 says the closure gate reads
  `profile.closure_requirements` + `required_documents`, while `03` §5.3 defines closure as a **hardcoded**
  boolean conjunction.
- **Failure scenario:** If the closure gate is config-driven, it finds an empty requirement list and closes
  trivially; if it is the §5.3 hardcoded conjunction, the seeded `closure_requirements`/`required_documents`
  arrays are dead config. The two definitions can disagree.
- **Fix:** Choose one closure-requirement source (config or code), populate it consistently in the seeds if
  config, and delete the other so there is a single closure authority (the repo's "one calc service" rule).

---

## Low

- **L1 — `set_updated_at()` is a live-DB-only dependency.** `02` creates 30 `set_updated_at_<t>` triggers
  calling `public.set_updated_at()`, which has **no `CREATE FUNCTION` in any repo `.sql`** (used by V221 etc., so
  it exists live). The migration will succeed against the live DB but is **not reproducible from the repo**;
  verify the function exists before applying and consider adding its definition to the repo for reproducibility.
- **L2 — Dangling uuids without FKs.** `accident_sla_instances.sla_definition_id`, `accident_insurance_claims.
  policy_id` (no policy table), and `accident_vehicle_downtime.replacement_asset_no` (a **per-country** asset
  code — V376: never key on an asset code alone if it is ever joined to `vehicle_fleet`). Add FKs where the
  target exists; document the intentional soft-links; carry country context on `replacement_asset_no`.
- **L3 — `04` names the case table `accident_cases`.** The case table is `accidents` (02 extends it). `04`
  §2.1/§5 repeatedly say `accident_cases`. Rename in the UX doc.
- **L4 — Evidence/external uploads have no schema-level MIME/size/scan.** `accident_evidence.storage_ref` and
  the 05 E external upload RPCs rely on prose ("virus-scanned, MIME-whitelisted, signed URLs"). Enforce in the
  DEFINER RPC / edge function and state the allowed MIME set + max size explicitly.
- **L5 — Field-level audit + immutability is unbuilt in V417.** `05` D.5's `accident_audit_logs` (reason,
  source, old/new, DEFINER-only, BEFORE-UPDATE/DELETE reject) is not in `02`; the existing `accident_audit_log`
  lacks reason/source. Brief §18 + acceptance criterion 16 ("all important actions audited") are unmet until it
  ships. Sequence it explicitly.

---

## What is genuinely solid (keep it)

- Reuse discipline is real and correct: the notification bus (`domain_events` → `consume_event_accident_notify`
  → `workflow_notifications` → `deliver_workflow_notifications` → `workflow-notify`), the `report_shares` token
  pattern for the external portal, `accident_stage_events` for timing, `claimsAnalytics`/`buildAccidentKpis`,
  and the DEFINER-only-writes precedent are all reused rather than forked. 05's "do not build a second pipeline"
  is followed.
- Honest-null accounting (05/03: no-scope dimension → `null` not 100; `basis='backfilled'`; median+worst for
  team hold; "held/waited" never "caused the delay") is faithful to the repo's rules.
- The migration mechanics are additive/non-destructive and idempotent: `ADD COLUMN IF NOT EXISTS`, guarded
  constraints, `IS NULL` backfill, `ON CONFLICT DO NOTHING` seeds, a complete ROLLBACK block. The 38 live rows
  and legacy status columns are preserved (subject to M4's honesty fix).
- RLS wiring is the right shape (RESTRICTIVE org + country + site, InitPlan-wrapped zero-arg helpers, anon
  revoked) — the defects are in the *write* policy scope (C2/M1), not the isolation pattern.
- The email-OFF-by-default gate, config-not-code routing/SLA/route profiles, and the F.2/F.3 test matrix
  (including the closure-bypass-via-API suite) are the right acceptance discipline.

---

## Must-fix before coding (Critical + High only)

1. **C1** — Ship closure enforcement in the same migration as `closure_level`; a live writable close field with
   no server gate is a closure bypass.
2. **C2** — Replace the flat `app_is_elevated()` write policy with the per-capability + SoD model, shipped with
   the tables; otherwise team roles cannot write and the three elevated roles bypass all role boundaries.
3. **C3** — Seed the 16 accident capabilities into the `permission_overrides` envelope `app_user_can` reads, or
   nobody but Admin/super can act.
4. **H1** — Reconcile to one canonical workstream key + status-token vocabulary across 02/03 (and the route
   seeds); today the completeness engine's keys never match the CHECK/seeds.
5. **H2** — Create `case_status` (+ a widen-guarded 30-value CHECK) in 02, or remove the engine/guard/UX
   dependence on a stored `case_status`.
6. **H3** — Align `closure_level` tokens between the CHECK, `closureLevel()`, and `accident_closure_reviews`
   (`financially_pending` vs `financially_open`; `fully_closed_pending_review`).
7. **H4** — Make `02`'s `accident_*` table names canonical in every doc, and resolve the ~20 child tables 03/04
   reference but 02 never creates (parties, policies, damage items, quotations, external workshops, etc.).
8. **H5** — Add the injury/total-loss/third-party route workstream keys to the CHECK+vocab (or remodel them), so
   those routes can record their defining steps.
9. **H6** — Give reopened and total-loss cases a transient signal so `deriveCaseStatus` does not pin them
   forever (a reopened case must progress again; a total-loss case must be able to close).

## Safe-to-proceed verdict

**Not yet — conditional GO.** The architecture and reuse strategy are sound and worth building on, but the
design as written would ship a closure gate and permission model that enforce nothing at the DB layer (C1–C3)
and a completeness engine wired to a workstream vocabulary the migration rejects (H1/H4). Resolve the nine
must-fix items — most are one-doc-vs-another reconciliations plus moving the closure/capability enforcement into
the migration that ships the columns — then proceed. The Medium items (cross-country writes, missing SLA/audit/
portal tables, currency defaults, backfill honesty, dual identity, NA modelling, RPC-bypass, dead closure
config) should be scheduled into the implementation-order plan (audit §6) rather than blocking the start, but
none should be silently dropped.

---

*Reviewer note: findings are grounded in the five design docs as written on 2026-07-28 plus the live repo
(`MIGRATIONS_V41`, `V229`, and the `set_updated_at` usage audit). Where a doc was internally coherent but
disagreed with another doc, the disagreement is the finding — that is the class of defect a pre-implementation
review is for.*
