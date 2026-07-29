# 07 — Accident Module Seed Configuration (Business-Rule Engine as DATA)

> **Phase 3 config artifact** — the concrete rows that make the accident module's business-rule
> engine real for **KSA + UAE + Egypt** without hardcoding a single route, authority, currency or
> regulatory window into code. Everything here is **DATA** in the six config tables shipped by the
> V417 data-model migration, driven by the brief's "config not code" mandate (§3 design principles,
> §4, §9, §10, §15, §16, §27) and the engine spec in `03_WORKFLOW_ENGINE.md` §8.
>
> **Companion SQL:** `07_SEED_CONFIG.sql` (idempotent seed, **NOT APPLIED** — review artifact only).
>
> **Sources:** `ACCIDENT_MODULE_BRIEF.md` §4 (classification), §9/§13 (emails), §10/§15 (SLA + mobile
> photo checklist), §5C/§8 (regulatory controls), §16/§26 (roles + escalation), §27 (rule engine);
> `docs/accident-module/02_DATA_MODEL.sql` (V417 target tables + column names + CHECK vocabularies);
> `docs/accident-module/03_WORKFLOW_ENGINE.md` (routes, statuses, workstream keys, permission model);
> `docs/accident-module/01_AUDIT.md` (what already ships).

---

## 0. Scope, dependencies and decisions (read before the tables)

### 0.1 What this seeds

| # | Config table (V417) | Rows seeded | Purpose |
|---|---|---|---|
| 1 | `accident_country_rule_profiles` | 3 (KSA, UAE, Egypt) | authority lists, currency, regulatory windows, working calendar, doc requirements — **per country, as data** |
| 2 | `accident_route_profiles` | 10 routes | required workstreams / evidence / documents / approvals / closure requirements per case route (route-based completeness, brief §4/§9) |
| 3 | `accident_type_profiles` | 31 accident/incident types | each type → default route + required teams + email recipients + SLA overrides + reporting category (brief §4) |
| 4 | `accident_evidence_requirements` | 13 global mandatory photos + 8 scoped + 3 docs/video | the mobile photo/document checklist (brief §7 step 4 / §10 step 4) |
| 5 | `accident_sla_definitions` | 11 internal timers | the internal SLA targets (brief §10 / §15) — much shorter than any regulatory maximum |
| 6 | `accident_email_templates` | **7 new** (`+15` existing kept) | new `[TP-ACC-…]` trigger templates (workstream assigned, approval required, claim registered, vehicle ready, handover rejected, settlement overdue, ready for closure) |

Everything is scoped to **Company A** (`00000000-0000-0000-0000-000000000001`) — the single live tenant
(all fleet, users and the existing 12 departments / 7 routing rules / 15 email templates are Company A).
A second GCC country/tenant becomes **more rows**, never a code branch (brief §3, §27).

### 0.2 Hard dependencies (the SQL is safe to run **only after** these)

1. **V417 must be applied first.** `accident_country_rule_profiles`, `accident_route_profiles`,
   `accident_type_profiles`, `accident_evidence_requirements`, `accident_sla_definitions` are created by
   V417 (`02_DATA_MODEL.sql`). `accident_email_templates` already exists (V302). Running the seed against
   a pre-V417 database errors on the missing config tables.
2. **Token resolver extension** (phase-later, one function): the 7 new email templates use **five tokens
   the current `accident_apply_tokens(text, accidents, text)` resolver does not yet emit** —
   `{{case_no}}`, `{{liability}}`, `{{owner}}`, `{{missing_docs}}`, `{{latest_decision}}`. The resolver
   already emits the other 18 tokens the templates use. Until it is extended, an unresolved `{{case_no}}`
   would render literally in a subject — so **do not wire a trigger to these template keys until the
   resolver emits those five tokens** (`{{case_no}}` = `accidents.case_no` from V417; `{{liability}}` =
   `accidents.fault_status` / `gcc_liability_ratio` label; `{{owner}}` = current workstream owner name;
   `{{missing_docs}}` = computed missing required documents; `{{latest_decision}}` = latest audit
   decision). The templates are inserted `active=true` to match their 15 siblings, but no trigger
   references their keys today, so they cannot send until deliberately wired.
3. **Accident-type vocabulary** — `accident_type_profiles.accident_type` is `text` with `unique(org,
   accident_type)` and **no CHECK**, so all 31 rows insert cleanly. But for a *case* to resolve its
   profile, `accidents.accident_type` must carry one of these tokens. The live `accidents.accident_type`
   CHECK (V222) is a narrower 13-token set. **Widening that CHECK to the 31 tokens here (or mapping the
   app's display types onto them) is a phase-later migration** — flagged, not done in this seed.

### 0.3 Decisions taken (and why)

- **`required_workstreams[]` uses the 12-key `accident_case_workstreams.workstream_key` CHECK vocabulary,
  not the 10-key logical grouping in `03_WORKFLOW_ENGINE.md` §2.1.** The route-instantiation trigger
  (phase-later) seeds one `accident_case_workstreams` row per required workstream, and each row's
  `workstream_key` is CHECK-constrained to:
  `incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment,
  repair_decision, repair_planning, fleet_offroad, repair_execution, workshop_qc, fleet_handover,
  finance_settlement`. Seeding `liability`/`insurance`/`assessment`/`repair`/`handover`/`finance`
  (the doc's short names) would create workstream rows that **violate the CHECK**. So the seed uses the
  DB-enforced keys; the workflow doc's 10-key grouping stays the *logical* view. The doc's `corrective`
  workstream has **no** `workstream_key` — corrective actions are tracked in `accident_corrective_actions`
  and surfaced as a **closure requirement** (`corrective_actions`), not a workstream row.
- **Regulatory windows are grounded, never invented.** Only **KSA** carries numeric regulatory windows
  (9 / 5 / 45 working days — brief §5C, the unified compulsory motor policy for a juristic person). The
  brief gives **no** regulatory day counts for UAE or Egypt, so those columns are left **NULL** (configure
  locally) rather than guessed.
- **Authorities are grounded.** KSA authority list = Najm, Traffic Police, Police, Absher e-Report, Civil
  Defence, Site Security, Other (all named in brief §1A / §7 / §10). UAE and Egypt get only the brief's
  **generic, country-neutral** authority categories (Traffic Police, Police, Civil Defence, Site Security,
  Other) — **`Najm` is KSA-specific and is NOT placed on UAE/Egypt.**
- **Currencies** — KSA `SAR`, UAE `AED`, Egypt `EGP` (the operating currencies; stored as **config data**
  in `currency`, which is exactly the brief's "use company currency configuration, do not hardcode"
  intent — the value is a row, not a literal in code).
- **Working days / holidays are configurable defaults.** The brief mandates a configurable working
  calendar + country holidays (§15) but states no specific working week or holiday dates. `working_days`
  is seeded with a sensible regional default **flagged for local confirmation**; `holidays` is left `[]`
  (load per country — no dates invented).
- **SLA `target_minutes` are internal targets, deliberately much shorter than any regulatory maximum**
  (brief §10 "Your internal targets should be much shorter than the regulatory maximum"). Business day =
  480 min (8 working hours); "4 working hours" = 240; the "within 2 hours" registration timer is
  wall-clock (`business_hours=false`).

### 0.4 Existing config this extends (does **not** duplicate)

Verified live on Company A:
- **12 departments** (V302/V303): `Finance, Fleet / PMV, HR, HSE / Safety, Insurance, Legal, Operations,
  Procurement, Security, Senior Management, Site Management, Workshop`. Seed rows reference these **by
  name** in `responsible_team` / `required_teams` (the V417 convention — team = department name).
- **7 routing rules** (`accident_routing_rules`): core team, critical/severe/fatal, high-cost ≥20k,
  injury, insurance/claim events, third-party, VOR. **Left untouched** — this seed adds no routing rules;
  route-based recipients ride these existing rules plus `accident_type_profiles.email_recipient_roles`.
- **15 email templates** (`accident_email_templates`): `claim_approved, claim_delayed, claim_rejected,
  claim_submitted, closed, critical, final_inspection_pending, missing_docs, overdue, released,
  repair_approval, repair_completed, reported, vor_sla_breach, workshop_assessed`. The 7 new keys below
  are **all new** (no collision).

---

## 1. `accident_country_rule_profiles` — regulatory controls per country (brief §5C, §8, §27)

One row per operating country. Nothing regulatory is in code; every value is a column here.

| country | currency | authority_types | required_documents | missing_docs_days | decision_days | settlement_days | working_days (default*) |
|---|---|---|---|:--:|:--:|:--:|---|
| **KSA** | `SAR` | Najm, Traffic Police, Police, Absher e-Report, Civil Defence, Site Security, Other | authority_report, najm_report, driving_license, vehicle_registration, insurance_policy, driver_statement | **9** | **5** | **45** | Sun–Thu |
| **UAE** | `AED` | Traffic Police, Police, Civil Defence, Site Security, Other | authority_report, police_report, driving_license, vehicle_registration, insurance_policy, driver_statement | *(null)* | *(null)* | *(null)* | Mon–Fri |
| **Egypt** | `EGP` | Traffic Police, Police, Civil Defence, Site Security, Other | authority_report, police_report, driving_license, vehicle_registration, insurance_policy, driver_statement | *(null)* | *(null)* | *(null)* | Sun–Thu |

\* `working_days` and `holidays` are **configurable defaults**, not brief-stated facts — confirm locally.
`holidays` is seeded `[]` (no dates invented).

**Rationale / grounding**
- **KSA windows 9 / 5 / 45** are the brief's exact figures (§5C): up to **9** working days to notify a
  juristic person of missing documents, up to **5** working days to notify acceptance/rejection after a
  complete claim, up to **45** working days for settlement of a complete juristic-person claim. Stored as
  configurable maxima — comprehensive/contractual policies may differ (brief), and the Insurance Authority
  has been the KSA insurance regulator since Nov 2023 (brief §5C). Recorded in the row's `notes`.
- **KSA authorities** — Najm (official accident reporting) + traffic report + Absher electronic minor-
  accident reporting are all named in brief §1A; the mobile authority list (§10) adds Police, Site
  Security, Civil Defence, Other.
- **UAE / Egypt** — regulatory windows are **NULL** (brief provides none; do not invent). Authority lists
  use only the brief's generic categories — **Najm deliberately excluded** (KSA-specific). To be confirmed
  against local regulators before go-live; noted in each row's `notes`.
- These feed the SLA engine's working-calendar and the missing-document/decision/settlement escalation
  clocks (`03_WORKFLOW_ENGINE.md` §8.3). Internal SLA targets (§4 below) are always shorter than these.

---

## 2. `accident_route_profiles` — route-based completeness (brief §4, §9; engine §4/§8)

A **route** determines which workstreams, evidence, documents, approvals and closure requirements are
**mandatory** for a case — so completeness is computed from *required items for that route*, never from a
raw field count (the brief's most-emphasised rule). `is_default` = the safe fallback when no route matches.
`required_workstreams` uses the **12-key CHECK vocabulary** (decision §0.3).

| route_key | is_default | required_workstreams (12-key) | key required_documents | closure_requirements (adds) |
|---|:--:|---|---|---|
| `minor_no_insurance` | **✔** | incident_evidence, fleet_validation, liability_safety, technical_assessment, repair_decision, repair_planning, repair_execution, fleet_handover, finance_settlement | driver_statement | corrective_actions (if required), closure_review |
| `internal_repair_insurance` | — | + insurance_claim, workshop_qc (full internal set) | insurance_policy, insurer_ack | insurance_settlement, closure_review |
| `external_repair_insurance` | — | + insurance_claim, fleet_offroad, workshop_qc (full external set) | insurance_policy, insurer_ack, quotation, purchase_order, invoice | insurance_settlement, closure_review |
| `total_loss` | — | incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision, finance_settlement | insurance_policy, survey_report, insurer_ack | total_loss_approval, asset_register_update, insurance_settlement, closure_review |
| `injury` | — | incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision, repair_planning, repair_execution, workshop_qc, fleet_handover, finance_settlement | authority_report, medical_report, driver_statement | hse_investigation, injury_details, corrective_actions, management_review, legal_review (if required), closure_review |
| `third_party` | — | incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision, repair_planning, fleet_offroad, repair_execution, workshop_qc, fleet_handover, finance_settlement | authority_report, insurance_policy | third_party_recovery, closure_review |
| `hit_and_run` | — | incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision, repair_planning, repair_execution, workshop_qc, fleet_handover, finance_settlement | authority_report, police_report | closure_review |
| `glass_only` | — | incident_evidence, liability_safety, repair_decision, repair_execution, finance_settlement | *(none)* | closure_review |
| `no_damage` | — | incident_evidence, liability_safety | *(none)* | corrective_actions (if required), closure_review |
| `theft_fire_weather` | — | incident_evidence, fleet_validation, liability_safety, insurance_claim, technical_assessment, repair_decision, finance_settlement | authority_report, police_report, insurance_policy | insurance_settlement, closure_review |

**Rationale**
- Mirrors the brief's four worked example routes (§4/§9): **minor without insurance**, **external repair
  with insurance**, **total loss**, **injury** — plus the additional cases the module must support (§14:
  third-party, hit-and-run, glass-only, no-damage/near-miss, theft/fire/weather).
- `required_workstreams` stays inside the CHECK vocabulary; brief route items with **no** workstream key
  (authority report, HSE investigation, corrective actions, total-loss approval, asset-register update,
  medical/injury details) are carried as **required_documents** and/or **closure_requirements** so nothing
  is lost. Example: `injury` has no `hse_investigation` workstream key, so `hse_investigation` +
  `injury_details` are **closure requirements** owned by HSE via the `liability_safety` workstream.
- `workshop_qc` appears only where a repair actually occurs; for `minor_no_insurance` it is left out of
  `required_workstreams` and QC-where-repaired is enforced by the engine's conditional resolution
  (`03_WORKFLOW_ENGINE.md` §4.1, "workshop quality control complete where repair occurred").
- `match_types[]` is seeded lightly; the **primary** type→route mapping is
  `accident_type_profiles.default_route_key` (§3), and the finer insurance/severity/third-party matching is
  the engine's fallback classifier + `accident_routing_rules` (engine §8.1) — this table only carries the
  coarse route template.

---

## 3. `accident_type_profiles` — the ~30 accident/incident types (brief §4)

Every type from brief §4 as a snake_case token → default route + required teams (department names) + email
recipient roles + SLA overrides + reporting category. `sla_overrides` is `{}` for all (the SLA defaults in
§4 apply); the column exists so a type can tighten a specific timer later without code.

| accident_type | default_route_key | required_teams (departments) | email_recipient_roles | reporting_category |
|---|---|---|---|---|
| `minor_road` | minor_no_insurance | Fleet / PMV, Workshop | Fleet Supervisor | road_traffic |
| `major_road` | external_repair_insurance | Fleet / PMV, Workshop, Insurance | Fleet Supervisor, HSE Officer, Insurance Claims Officer | road_traffic |
| `site_collision` | internal_repair_insurance | Fleet / PMV, Workshop, Site Management | Fleet Supervisor, Site Management | site_incident |
| `vehicle_to_vehicle` | third_party | Fleet / PMV, Workshop, Insurance | Fleet Supervisor, Insurance Claims Officer | third_party |
| `equipment_to_vehicle` | internal_repair_insurance | Fleet / PMV, Workshop, Operations | Fleet Supervisor, HSE Officer | site_incident |
| `equipment_to_equipment` | internal_repair_insurance | Fleet / PMV, Workshop, Operations | Fleet Supervisor, HSE Officer | site_incident |
| `third_party_property` | third_party | Fleet / PMV, Insurance, Legal | Fleet Supervisor, Insurance Claims Officer | third_party |
| `customer_property` | third_party | Fleet / PMV, Insurance, Legal | Fleet Manager, Insurance Claims Officer | third_party |
| `own_damage` | minor_no_insurance | Fleet / PMV, Workshop | Fleet Supervisor | own_damage |
| `injury` | injury | HSE / Safety, Fleet / PMV, Insurance, Senior Management | HSE Manager, Fleet Manager, Insurance Manager | injury_fatality |
| `fatal` | injury | HSE / Safety, Fleet / PMV, Insurance, Legal, Senior Management | HSE Manager, Fleet Manager, Insurance Manager | injury_fatality |
| `hit_and_run` | hit_and_run | Fleet / PMV, Insurance, HSE / Safety | Fleet Supervisor, Insurance Claims Officer | road_traffic |
| `theft` | theft_fire_weather | Fleet / PMV, Insurance, Security | Fleet Manager, Insurance Claims Officer | theft_fire |
| `fire` | theft_fire_weather | Fleet / PMV, Workshop, HSE / Safety, Insurance | Fleet Manager, HSE Manager, Insurance Claims Officer | theft_fire |
| `weather` | theft_fire_weather | Fleet / PMV, Workshop, Insurance | Fleet Supervisor, Insurance Claims Officer | weather |
| `glass_only` | glass_only | Fleet / PMV, Workshop | Fleet Supervisor | own_damage |
| `tyre_wheel` | minor_no_insurance | Fleet / PMV, Workshop | Fleet Supervisor | own_damage |
| `rollover` | external_repair_insurance | Fleet / PMV, Workshop, HSE / Safety, Insurance | Fleet Manager, HSE Officer, Insurance Claims Officer | road_traffic |
| `loading_unloading` | internal_repair_insurance | Fleet / PMV, Workshop, Operations | Fleet Supervisor, HSE Officer | site_incident |
| `falling_object` | internal_repair_insurance | Fleet / PMV, Workshop, HSE / Safety | Fleet Supervisor, HSE Officer | site_incident |
| `uninsured` | minor_no_insurance | Fleet / PMV, Workshop, Finance | Fleet Manager, Finance Officer | own_damage |
| `expired_policy` | minor_no_insurance | Fleet / PMV, Insurance, Finance | Fleet Manager, Insurance Manager | own_damage |
| `rental_vehicle` | external_repair_insurance | Fleet / PMV, Insurance, Procurement | Fleet Supervisor, Insurance Claims Officer | road_traffic |
| `leased_vehicle` | external_repair_insurance | Fleet / PMV, Insurance, Finance | Fleet Supervisor, Insurance Claims Officer | road_traffic |
| `subcontractor_vehicle` | third_party | Fleet / PMV, Insurance, Legal | Fleet Supervisor, Insurance Claims Officer | third_party |
| `no_damage` | no_damage | Fleet / PMV, HSE / Safety | Fleet Supervisor | near_miss |
| `near_miss` | no_damage | HSE / Safety, Fleet / PMV | HSE Officer, Fleet Supervisor | near_miss |
| `total_loss` | total_loss | Fleet / PMV, Insurance, Finance, Senior Management | Fleet Manager, Insurance Manager | total_loss |
| `duplicate` | *(null)* | Fleet / PMV | Fleet Supervisor | administrative |
| `reopened` | *(null)* | Fleet / PMV | Fleet Manager | administrative |
| `legal_dispute` | *(null)* | Legal, Insurance, Fleet / PMV | Fleet Manager, Insurance Manager | legal |

**Rationale**
- Full brief §4 list (31 tokens). `duplicate`/`reopened`/`legal_dispute` are **case modifiers**, not linear
  routes — `default_route_key` is `null` (the case keeps whatever base route it already had; the modifier
  overlays the workflow, engine §1.2 `cancelled_duplicate` / `reopened` / `legal_hold`).
- `required_teams` and `email_recipient_roles` route the *right* teams to the *right* case type at submit
  (brief §9 "Do not send every update to every person"), reusing department names and brief §16 role names.
  Escalation (injury/fatal/total-loss → Senior Management) is layered by the existing `accident_routing_rules`
  (critical, injury, high-cost) + `escalate_roles` — this table names the first-line recipients.
- `accident_type` tokens overlap the live V222 CHECK where they can (`fire`, `rollover`, `near_miss`), and
  extend it for the richer set — **widening the `accidents.accident_type` CHECK is a flagged phase-later
  migration (§0.2.3)**; the profile rows themselves have no CHECK and insert cleanly.

---

## 4. `accident_sla_definitions` — internal SLA timers (brief §10 / §15)

The brief's suggested internal targets, as configurable rows. `business_hours=true` = counted against the
country working calendar; the registration timer is wall-clock (accidents happen anytime).
`warning_pct`/`escalation_pct` default 80/100. `country` is left NULL (org-wide defaults; the working
calendar comes from `accident_country_rule_profiles.working_days`).

| sla_key | activity | workstream_key | target | minutes | business_hours | responsible_role | responsible_team |
|---|---|---|---|:--:|:--:|---|---|
| `initial_registration` | Initial accident registration | incident_evidence | 2 hours (wall-clock) | 120 | **false** | Fleet Incident Officer | Fleet / PMV |
| `fleet_validation` | Fleet validation | fleet_validation | 4 working hours | 240 | true | Fleet Supervisor | Fleet / PMV |
| `insurance_review` | Insurance review | insurance_claim | 4 working hours | 240 | true | Insurance Claims Officer | Insurance |
| `claim_submission` | Submit complete claim | insurance_claim | 1 business day | 480 | true | Insurance Claims Officer | Insurance |
| `workshop_inspection` | Workshop inspection | technical_assessment | 1 business day | 480 | true | Workshop Planner | Workshop |
| `repair_estimate` | Initial repair estimate | technical_assessment | 2 business days | 960 | true | Workshop Planner | Workshop |
| `repair_decision` | Repair-route approval | repair_decision | 1 business day | 480 | true | Fleet Manager | Fleet / PMV |
| `po_after_approval` | PO after approval | repair_planning | 1 business day | 480 | true | Procurement Officer | Procurement |
| `fleet_inspection` | Fleet inspection after repair | fleet_handover | 4 working hours | 240 | true | Fleet Inspector | Fleet / PMV |
| `rectification_plan` | Rejected-repair rectification plan | repair_execution | 1 business day | 480 | true | Workshop Supervisor | Workshop |
| `closure_review` | Final closure review | *(null)* | 2 business days | 960 | true | Fleet Manager | Fleet / PMV |

**Rationale**
- One-for-one with the brief's suggested internal targets (§10 table + §15 list). All are **internal**
  targets — the brief is explicit they must be *much shorter* than the regulatory maxima in §1
  (KSA 9/5/45 working **days**, held in `accident_country_rule_profiles`).
- `business_hours=false` only on registration ("within 2 hours" is wall-clock); every "working hour" /
  "business day" target is `business_hours=true` and evaluated against the country calendar. Business day =
  480 min (8 working hours) so "2 business days" = 960, "4 working hours" = 240.
- `responsible_team` = department name (V417 convention); `responsible_role` = brief §16 role. Each timer
  carries the start/due/remaining/owner/pause-reason/resume/escalation fields the brief §15 requires — those
  live per-case on `accident_sla_instances` / `accident_sla_pause_events` (V417), instantiated from these
  definitions. Valid pause reasons (brief §15) are an app-level enum, not seeded here.

---

## 5. `accident_evidence_requirements` — the photo/document checklist (brief §7 step 4 / §10 step 4)

13 **global mandatory** photos (route_key / accident_type NULL = every case), 8 **scoped** requirements
(route- or type-specific), and 3 document/video rows. `mandatory=true` items gate mobile submission.

### 5.1 Global mandatory photos (13 — the "13 required photographs" in brief §7)

| requirement_key | label | category | sort |
|---|---|---|:--:|
| `photo_full_front` | Full front view | exterior | 10 |
| `photo_full_rear` | Full rear view | exterior | 20 |
| `photo_left_side` | Left side | exterior | 30 |
| `photo_right_side` | Right side | exterior | 40 |
| `photo_front_left_corner` | Front-left corner | corner | 50 |
| `photo_front_right_corner` | Front-right corner | corner | 60 |
| `photo_rear_left_corner` | Rear-left corner | corner | 70 |
| `photo_rear_right_corner` | Rear-right corner | corner | 80 |
| `photo_damage_closeup` | Close-up damage | damage | 90 |
| `photo_scene` | Accident scene | scene | 100 |
| `photo_plate` | Vehicle plate | identity | 110 |
| `photo_odometer` | Odometer / hour meter | identity | 120 |
| `photo_dashboard_lights` | Dashboard warning lights | condition | 130 |

### 5.2 Scoped requirements (route- or type-specific)

| requirement_key | label | kind | mandatory | scope | sort |
|---|---|---|:--:|---|:--:|
| `photo_other_party_vehicle` | Other-party vehicle | photo | ✔ | route `third_party` | 140 |
| `photo_other_party_plate` | Other-party plate | photo | ✔ | route `third_party` | 150 |
| `photo_road_condition` | Road / site condition | photo | ✔ | route `injury` | 160 |
| `photo_tyres_wheels` | Tyres and wheels | photo | ✔ | type `tyre_wheel` | 170 |
| `photo_chassis_vin` | Chassis / VIN | photo | ✔ | type `total_loss` | 180 |
| `photo_property_damage` | Property damage | photo | ✔ | type `third_party_property` | 190 |
| `photo_equipment_attachment` | Equipment attachment | photo | ✔ | type `equipment_to_vehicle` | 200 |
| `photo_chassis_vin_theft` | Chassis / VIN | photo | ✔ | type `theft` | 210 |

### 5.3 Document / video requirements (global)

| requirement_key | label | kind | mandatory | sort |
|---|---|---|:--:|:--:|
| `doc_authority_report` | Authority / police report | document | ✖ (mandatory per country/route) | 300 |
| `doc_driver_statement` | Driver statement | document | ✖ | 310 |
| `video_walkaround` | Vehicle walk-around video | video | ✖ | 320 |

**Rationale**
- Global 13 = the brief's exact "11 of 13 required photographs" checklist (§7 step 4 / §10 step 4).
- Scoped rows attach extra mandatory evidence to the routes/types that need it: other-party photos on the
  `third_party` route, road-condition on `injury`, tyre/wheel close-up on `tyre_wheel`, chassis/VIN on
  `total_loss` and `theft`, property damage on `third_party_property`, equipment attachment on equipment
  collisions — all drawn from the brief's own extended photo list (§10 step 4).
- **Documents** (authority report, driver statement) sit here at `mandatory=false` **globally** because
  their mandatory-ness is **country/route conditional** — enforced through
  `accident_country_rule_profiles.required_documents` and `accident_route_profiles.required_documents` — so
  a minor own-damage case with no authority involved is not blocked on an authority report it never had.
- **Supervisor exception** (brief §7): the checklist blocks final mobile submission until every
  `mandatory=true` item is uploaded, *unless an authorised supervisor records an exception*. There is no
  column for this on `accident_evidence_requirements` — it is a **workflow behaviour**: an exception
  requires the supervisor `submit`/`validate` capability and writes an **audit entry** (missing-photo
  reason + supervisor + timestamp) to `accident_audit_log`. Represented as behaviour, not a seed row.

---

## 6. `accident_email_templates` — 7 new `[TP-ACC-…]` trigger templates (brief §9 / §13)

Extends the 15 existing templates (kept as-is) with the triggers the multi-team workflow adds. Subjects
follow the brief's exact convention: `[TP-ACC-…] [Tag] <action> | Asset <asset>`. `approved=true`,
`active=true` (matching siblings) — but **inert until a trigger is wired to the key AND the resolver emits
the new tokens** (§0.2.2).

| key (new) | name | subject template |
|---|---|---|
| `workstream_assigned` | Workstream assigned | `[{{case_no}}] [Assigned] {{pending_action}} \| Asset {{asset_no}}` |
| `approval_required` | Approval required | `[{{case_no}}] [Approval Required] {{pending_action}} \| Asset {{asset_no}}` |
| `claim_registered` | Insurance claim registered | `[{{case_no}}] [Claim Registered] Insurance claim {{claim_status}} \| Asset {{asset_no}}` |
| `vehicle_ready` | Vehicle ready for Fleet inspection | `[{{case_no}}] [Vehicle Ready] Fleet inspection required \| Asset {{asset_no}}` |
| `handover_rejected` | Repair rejected by Fleet | `[{{case_no}}] [Repair Rejected] Rectification required \| Asset {{asset_no}}` |
| `settlement_overdue` | Settlement overdue | `[{{case_no}}] [Settlement Overdue] Insurance settlement pending \| Asset {{asset_no}}` |
| `ready_for_closure` | Case ready for closure | `[{{case_no}}] [Ready for Closure] Final approval required \| Asset {{asset_no}}` |

**Trigger → recipient mapping (brief §9 table), for wiring the phase-later notify consumer:**

| key | Fires when | Recipients (brief §9) |
|---|---|---|
| `workstream_assigned` | a workstream row is assigned to an owner/team | assigned owner + team lead |
| `approval_required` | a case reaches a step needing an approval (liability, repair route, PO, closure) | the approver role for that step |
| `claim_registered` | insurance claim number recorded | Fleet, Workshop Planner, Insurance Manager |
| `vehicle_ready` | Workshop QC passes / vehicle ready | Fleet Inspector |
| `handover_rejected` | Fleet rejects the repair at handover | Workshop Supervisor |
| `settlement_overdue` | settlement SLA breached | Insurance Manager, Fleet Manager |
| `ready_for_closure` | all required workstreams satisfied, closure review requested | Final approver (Fleet Manager) |

**Body content (brief §9 / §13).** Every new template's `body_html` carries: case number, asset + plate,
project/site, accident date, current stage, liability, vehicle condition, required action, responsible
person, due date, missing documents, latest decision, and the secure case link — using the resolver tokens.

**Tokens used**
- **Already emitted by `accident_apply_tokens` (render today):** `{{asset_no}}`, `{{plate_number}}`,
  `{{site}}`, `{{incident_date}}`, `{{stage_label}}`, `{{vor_label}}`, `{{pending_action}}`,
  `{{claim_status}}`, `{{due_date}}`, `{{department}}`, `{{severity}}`, `{{reference_no}}`, `{{link}}`.
- **New — resolver must be extended before wiring (§0.2.2):** `{{case_no}}` (`accidents.case_no`),
  `{{liability}}` (`fault_status` / `gcc_liability_ratio` label), `{{owner}}` (workstream owner name),
  `{{missing_docs}}` (computed missing required documents), `{{latest_decision}}` (latest audit decision).

---

## 7. Idempotency, rollback and verification

- **Idempotency:** tables with a natural unique key use `on conflict (…) do nothing`
  (`country_rule_profiles(org,country)`, `route_profiles(org,route_key)`, `type_profiles(org,accident_type)`,
  `sla_definitions(org,sla_key)`, `email_templates(org,key)`). `accident_evidence_requirements` has **no**
  unique constraint in V417, so its rows use `insert … select … where not exists` keyed on
  `(org, requirement_key, route_key, accident_type)`. Re-running the whole seed inserts nothing new.
- **Non-destructive:** the seed touches **only** the six config tables, only for Company A, and only adds
  rows. It never updates or deletes existing config (the 15 email templates, 7 routing rules, 12
  departments are untouched).
- **Rollback:** a commented `ROLLBACK` block at the foot of the SQL deletes exactly the seeded rows by org
  + the exact key sets. Because these are config rows referenced only by phase-later behaviour (not yet
  wired), deleting them is clean.
- **Verify after apply** (examples): row counts per table for Company A; every
  `accident_type_profiles.default_route_key` resolves to a seeded `accident_route_profiles.route_key`
  (except the 3 administrative NULLs); every `required_workstreams[]` element is in the 12-key CHECK set;
  KSA row carries 9/5/45; the 7 new template keys exist and the 15 originals are unchanged.

---

## 8. Traceability to the brief

| Brief section | Realised as |
|---|---|
| §3 "Do not hardcode Najm, currencies, national rules" | `accident_country_rule_profiles` rows (KSA/UAE/Egypt) |
| §4 classification → required fields/docs/teams/SLA/recipients/closure/reporting | `accident_type_profiles` (31) + `accident_route_profiles` (10) |
| §5C KSA 9/5/45 regulatory windows, Insurance Authority | KSA `regulatory_*_days` + `notes` |
| §7 / §10 mobile photo checklist + supervisor exception | `accident_evidence_requirements` (13 global + scoped) + audited-exception behaviour |
| §9 / §13 email triggers + `[TP-ACC-…]` subjects | 7 new `accident_email_templates` |
| §10 / §15 internal SLA targets + working calendar | `accident_sla_definitions` (11) + country `working_days` |
| §16 roles + §26 escalation | `email_recipient_roles` + `required_teams` + existing `accident_routing_rules` |
| §27 business-rule engine (config not code) | all six config tables — a new GCC country is rows, not code |
