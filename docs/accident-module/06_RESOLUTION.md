# 06 — Accident Module Design Review: Resolution Log

> Resolves the nine must-fix items (three Critical + six High) raised in
> `06_DESIGN_REVIEW.md`. Every change lands **in `docs/accident-module/02_DATA_MODEL.sql`**
> (the `V417` migration artifact); no other file was changed and the SQL was **not applied**.
>
> **Single source of truth:** the committed pure engine `src/lib/accidentCase.js`
> (10 `WORKSTREAMS`, 30 `CASE_STATUSES`, `WORKSTREAM_STATUS`, `closureLevel()` tokens,
> `TRANSITIONS`). Where a doc disagreed with the engine, the engine wins and the SQL
> was reconciled to it — because the engine is the spec the SQL mirrors (the same
> `accident_stage_order ↔ STAGE_FLOW` discipline the repo already enforces).

---

## Must-fix resolution table

| # | Item | Severity | Resolution in `02_DATA_MODEL.sql` |
|---|---|---|---|
| C1 | Closure gate not enforced by the migration that ships the closure columns | Critical | **RESOLVED.** New **PART G** ships a `BEFORE UPDATE` guard `enforce_accident_closure` **in the same migration** as `closure_level`/`case_status`. A case may enter `closure_level='fully_closed'` (or `case_status='closed'`) only when an **approved `fully_closed` `accident_closure_reviews` row exists**; otherwise it raises `42501`. The guard fires only on a transition *into* a closed state (`is distinct from` guarded), and is created **after** the Part-A backfill so the migration's own `legacy_closed` writes are never blocked. No admin bypass — even an admin closes through the gate. |
| C2 | Flat `app_is_elevated()` write = no SoD **and** locks every team role out | Critical | **RESOLVED.** **PART E** replaces the uniform elevated-only write with a per-table **owning-capability** policy: `USING/WITH CHECK (app_is_elevated() OR app_user_can('accidents', <cap>))`. A `cap_map` binds each child table to its workstream capability (e.g. `accident_insurance_claims → edit_insurance`, `accident_damage_assessments → assess`, `accident_financial_transactions → post_cost`, `accident_handover_inspections → accept_handover`). Team roles now write their own tables; admin/manager/director keep full write. The finer per-row + SoD guard (`enforce_accident_action_capability`, 03 §6.3) is the documented phase-later superset. |
| C3 | Permission matrix inert — `app_user_can` returns false for all 16 caps | Critical | **RESOLVED.** **PART F** seeds the 03 §6.2 role×action matrix into the V229 `app_settings.permission_overrides` envelope, shaped exactly as `app_user_can` reads it (`overrides → <Role> → 'accidents' → <cap> = true`). Idempotent deep-merge (preserves other modules/roles; re-run safe). The envelope is a single **global** row by V229's own design — documented; it only grants accident caps to accident role names and `view` is untouched. |
| H1 | 02 vs 03 disagree on workstream vocabulary → completeness engine can't intersect | High | **RESOLVED.** `accident_case_workstreams.workstream_key` CHECK reduced from 12 keys to the **10 canonical** `accidentCase.WORKSTREAM_KEYS` (`incident_evidence, fleet_validation, liability, insurance, assessment, repair, workshop_qc, handover, finance, corrective`); status enum token `waiting_information → waiting_info`. The Part-F `accident_route_profiles.required_workstreams` seeds **and** the `accident_sla_definitions.workstream_key` seeds were remapped to the same 10 keys, so `route.required_workstreams` now intersects the CHECK and the engine. |
| H2 | `case_status` (30-value headline) required by 03/04, never created by 02 | High | **RESOLVED.** Part A adds `accidents.case_status text` with a **widen-guarded 30-value CHECK** mirroring `accidentCase.CASE_STATUS_TOKENS`. Backfill sets only the **unambiguous terminal** rows (`closed`, `cancelled_duplicate`) and leaves every non-terminal legacy row `NULL` for the phase-later derive trigger — no fine status is invented for legacy data. |
| H3 | `closure_level` tokens contradict the engine | High | **RESOLVED.** `chk_accident_closure_level` now allows `open / operationally_completed / financially_open / fully_closed` (+ `legacy_closed`, see M4) — matching `accidentCase.closureLevel()` exactly. `financially_pending` dropped. `accident_closure_reviews.level` CHECK aligned to `operationally_completed / financially_open / fully_closed`. |
| H4 | Pervasive table-name divergence; ~20 tables 03/04 reference but 02 never creates | High | **RESOLVED (naming) + SCOPED (missing tables).** 02's `accident_*` names are declared **canonical**; the doc-name → canonical mapping is the table below. Every table the **closure gate + completeness engine + transition machine** need already exists in 02 (`accident_case_workstreams`, `accident_closure_requirements`, `accident_closure_reviews`, `accident_route_profiles`, `accident_case_communications`, the SLA definition/instance/pause tables). The remainder are explicitly **phase-later** with the reason recorded in 02's header (they belong to features that are themselves phase-later). |
| H5 | Injury/total-loss/third-party routes reference workstream keys not in the CHECK | High | **RESOLVED.** Per the committed engine, those "steps" are **records, not workstream keys**: authority report → `accident_authority_reports`; medical/management review + total-loss approval → `accident_case_approvals`; corrective/HSE → the `corrective` workstream + `accident_corrective_actions`; asset-register/disposal → `accident_repair_orders`/`accident_vehicle_downtime`; third-party recovery → `accident_claim_recoveries.source='third_party'`. The 10-key CHECK is therefore complete and the injury/total-loss route seeds use only valid keys. |
| H6 | `deriveCaseStatus` pins reopened / total-loss cases forever | High | **RESOLVED.** Part A adds **transient** `reopened_flag` and `total_loss_route` columns (the exact flags `accidentCase.deriveCaseStatus` reads), kept **separate** from the permanent audit `is_reopened` / `reopen_count`. The phase-later derive trigger sets them on reopen / total-loss and **clears** them on re-triage / total-loss completion — so a reopened case progresses again and a total-loss case can reach `closure_review`/`closed`. Documented inline in Part A. |

**Verdict on the 9 must-fix items: all resolved in the migration.**

---

## Doc-name → canonical (`accident_*`) mapping (H4)

The other design docs (03/04/05) use unprefixed names for historical reasons; 02's prefixed names are canonical. Read cross-doc references through this table. (Names that resolve to a **different existing generic table** are the dangerous ones — 02 deliberately prefixed to avoid them.)

| Doc name (03/04/05) | Canonical table (02) | Note |
|---|---|---|
| `insurance_claims` | `accident_insurance_claims` | the generic `insurance_claims` is an **unrelated** 0-row ledger — never write it |
| `corrective_actions` | `accident_corrective_actions` | generic `corrective_actions` is unrelated |
| `sla_definitions` / `sla_instances` / `sla_pause_events` | `accident_sla_definitions` / `accident_sla_instances` / `accident_sla_pause_events` | the generic ledger `sla_records` is unrelated |
| `case_tasks` / `case_approvals` / `case_communications` | `accident_case_tasks` / `accident_case_approvals` / `accident_case_communications` | — |
| `damage_assessments` / `repair_orders` / `repair_tasks` | `accident_damage_assessments` / `accident_repair_orders` / `accident_repair_tasks` | — |
| `financial_transactions` / `claim_recoveries` | `accident_financial_transactions` / `accident_claim_recoveries` | — |
| `liability_assessments` / `insurance_decisions` / `insurance_settlements` | `accident_liability_assessments` / `accident_insurance_decisions` / `accident_insurance_settlements` | — |
| `fleet_handover_inspections` / `vehicle_downtime` | `accident_handover_inspections` / `accident_vehicle_downtime` | — |
| `accident_cases` (04 §2.1/§5) | `accidents` (extended) | the case root is `accidents`, not a new table |

**Tables 03/04/05 reference that 02 does NOT create — SCOPED phase-later** (recorded in 02's header, none needed by the closure gate / completeness engine): `insurance_policies`, `insurance_claim_documents`†, `damage_items`, `repair_decisions`, `quotations`/`quotation_items`, `external_workshops`, `parts_request_items`, `purchase_requests`, `replacement_vehicle_allocations`, `witness_statements`, `driver_statements`, `accident_case_parties`, `accident_case_vehicles`, `safety_investigations`, `root_causes`, `surveyors`, `case_task_dependencies`; and the SLA/audit/portal family `accident_working_calendars`, `accident_country_holidays`, `accident_audit_logs`, `accident_external_grants`, `sla_activity_bindings`. Each belongs to a feature that is itself phase-later (SLA **clock** cron, field-level audit, external portal, email inbound). †`accident_claim_documents` **does** exist in 02 under that name.

---

## Related Medium items resolved opportunistically (not blocking, fixed because they were coupled)

- **M1 (cross-country/site writes):** the PART E write policy now carries `WITH CHECK (… AND app_can_see_country(country) AND app_can_see_site(site))`, so a scoped user cannot write another country/site's case row. (Coupled to the C2 policy rewrite.)
- **M4 (backfill honesty):** legacy closed rows backfill to `closure_level='legacy_closed'` + `case_flags.closure_basis='backfilled'` — never asserted as a verified `fully_closed`. Also lets the C1 guard run without blocking the migration's own backfill.
- **M5 (dual identity):** `case_no` is now **derived from the existing `reference_no`** (`TP-ACC-<COUNTRY>-` + the `reference_no` sequence tail), so the two identifiers share one sequence and cannot disagree. `reference_no` remains canonical; `case_no` is its country-prefixed display form.

## Medium/Low items deliberately deferred (documented, not silently dropped)

Scheduled into the implementation-order plan, not blocking the DB-layer start:

- **M2** missing SLA calendar / audit / portal tables + `reply_token` UNIQUE → sequenced with the SLA-clock, audit, and portal migrations (per 05).
- **M3** currency default/NOT-NULL on money tables → the currency-default + `governedCost` grouping migration (the "never blend SAR/AED/EGP" rule).
- **M6** single authoritative NA representation + CHECK/trigger for `na_reason`/`na_by`/`na_at` → with the workstream-write RPC.
- **M7** RPC-only writes for SLA-pause / closure-review / audit (revoke direct `authenticated` write) → with the DEFINER RPC layer; the C1 guard already requires an **approved** review so a forged review needs `close_case`.
- **M8** one closure authority → decision recorded: **code** (`accidentCase.canFullyClose`) is the single closure gate; the seed `closure_requirements` stays a display checklist, not a second authority.
- **L1** `set_updated_at()` is a live-DB-only function (add its definition to the repo for reproducibility). **L2** dangling FKs. **L5** field-level audit (`accident_audit_logs`) sequenced with the audit migration.

---

## Re-verdict: is it safe to start coding the DB layer?

**Yes — conditional GO is now an unconditional GO for the migration.** The three Critical holes are closed **in the migration that ships the columns**: the closure gate enforces at the DB layer (C1), team roles can write their own workstreams while managers keep full control (C2), and the intended roles can actually act out of the box (C3). The completeness engine's vocabulary now matches the CHECK and the route seeds (H1/H4/H5), `case_status` exists and is constrained (H2), the closure tokens agree across the CHECK, engine and reviews table (H3), and reopened/total-loss cases can progress and close (H6). The migration stays additive, non-destructive, idempotent, and reversible (rollback updated), and the 38 live rows are preserved with an honest `legacy_closed` basis.

The remaining Medium/Low items are real but non-blocking and are each assigned to a named follow-on migration above — none is silently dropped. Coding the DB layer (the phase-later derive/route/SLA/audit triggers and their JS mirrors) can begin against this schema.
