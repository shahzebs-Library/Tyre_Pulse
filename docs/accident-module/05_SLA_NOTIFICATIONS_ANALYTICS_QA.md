# 05 — SLA Engine, Notifications & Escalation, External Portal, Process Analytics & Audit, QA / Acceptance

> Phase‑2 / Phase‑3 design for the Tyre Pulse Accident & Insurance module.
> Companion to `01_…` – `04_…` (audit, data model, workstreams/state machine, closure engine).
> Covers brief sections **9, 10, 13, 14, 18, 24, 25, 26, 31, 32** and master‑prompt sections **13, 14, 15, 18, 24, 25, 26, 30, 31, 32**.
>
> **Golden rule for this phase: reuse the plumbing that already exists.** The module already has a
> domain‑event bus, a consumer, a durable delivery queue, a cron deliverer and an edge function that
> renders accident email + push. We extend those, we do **not** build a second notification pipeline.

---

## 0. What already exists (grounding — do not rebuild)

Everything below is **live in the DB** (project `jhssdmeruxtrlqnwfksc`) and in the repo. This design is
layered on top of it.

| Concern | Existing object | Where |
|---|---|---|
| Unified lifecycle | `accidents.workflow_stage` (12‑stage CHECK) + `accident_stage_from_status` / `accident_status_from_stage` | `MIGRATIONS_V300` parts 1‑2; pure mirror `src/lib/accidentWorkflow.js` |
| Per‑stage occupancy ledger | `accident_stage_events` (`stage, department, entered_at, exited_at, entered_by, skipped, basis, note`) — **written only by a DEFINER trigger**, client INSERT/UPDATE/DELETE revoked (V398b/V398c) | `src/lib/accidentStages.js` reads it |
| Stage ownership map + team analytics | `STAGE_FIELDS`, `caseProgress`, `teamPerformance`, `longestWaiting`, `skippedStageReport`, `buildStageIntelligence` | `src/lib/accidentStages.js` |
| Domain‑event bus | `domain_events` (`event_type, entity_type, entity_id, organisation_id, actor_id, payload, status, attempts, processed_at`) + `emit_domain_event(...)` + `process_domain_events` (pg_cron 1/min) | V96 / V117 |
| Consumer registry | `event_consumers` (`consumer, event_types[], enabled`) | — |
| Accident event emitter | `emit_accident_domain_events()` trigger → `accident.reported` / `accident.stage_changed` / `accident.claim_changed` / `accident.vor_changed` | `MIGRATIONS_V300` part 5 |
| Accident routing consumer | `consume_event_accident_notify` — matches `accident_routing_rules` → resolves recipient profiles (org+site+country) → **always** inserts in‑app `notifications` → enqueues `workflow_notifications` **only when `accident_emails_enabled` is true and a template maps** (dedupe on `event_id`) | registered in `event_consumers` for **6** event types today |
| Routing config | `accident_routing_rules` (`event_key, match_severities[], match_types[], match_sites[], match_countries[], min_cost, require_injury, require_vor, require_third_party, departments[], to_roles[], cc_roles[], escalate_roles[], priority, active`) | pure preview `evaluateRouting()` / `resolveRecipients()` in `accidentWorkflow.js` |
| Approved templates | `accident_email_templates` (`key, subject, body_html, active, approved`) — **15 keys live**: `reported, critical, missing_docs, workshop_assessed, repair_approval, claim_submitted, claim_approved, claim_rejected, claim_delayed, vor_sla_breach, repair_completed, final_inspection_pending, released, closed, overdue` | rendered by `accident_apply_tokens(tpl, acc, dept)` |
| Delivery queue | `workflow_notifications` (`event_id, event_type, payload jsonb, recipient_count, status, attempts, next_attempt_at, response_status, result, last_error, delivered_at`) | — |
| Cron deliverer | `deliver_workflow_notifications` → `net.http_post` (pg_cron **1/min**, live jobname `deliver-workflow-notifications`) | V119 |
| Channel fan‑out | edge fn **`workflow-notify` v5** — Email→Resend, Push→Expo, WhatsApp→Twilio; each channel independent, no‑op when its env is unset; gated by `x-workflow-secret` (never fails open) | `supabase/functions/workflow-notify/index.ts` |
| Existing SLA/escalation cron | live jobname **`accident-sla-scan`** (V305) — emits `accident.vor_sla_breach` / `accident.overdue`, deduped via `accidents.vor_sla_notified_at` / `accidents.overdue_notified_at`; and `escalate-workflows` for the generic engine | pg_cron |
| In‑app inbox | `notifications` (`user_id, type, title, body, entity_type, entity_id, read, created_at`) — server‑inserted only; web `NotificationCenter`, mobile inbox | V299 |
| Master email gate | `system_config.accident_emails_enabled` (default `'false'`) | `getAccidentEmailsEnabled()` |
| Public/TV share tokens | `report_shares` (`token`, `password_hash` bcrypt, `pages jsonb`, `layout jsonb`, `expires_at`, `active`, `view_count`, `last_viewed_at`) + `create_report_share(...)` (mints `rpt_`+18‑byte hex) + `get_report_snapshot(token, password)` (SECURITY DEFINER, anon‑callable, org derived from the token row) + `revoke_report_share(id)` | V251/V252, `src/lib/api/reportShares.js` |

**Confirmed gaps this doc fills (new objects, unbuilt today):** `sla_definitions`, `sla_instances`,
`sla_pause_events`, `case_communications`, `accident_audit_logs`, `accident_working_calendars`,
`accident_country_holidays`, and the external‑portal token family (built on the `report_shares` pattern,
not a new share surface).

> Migration numbering: the accident module is at V300‑V305 live; the next free migration overall is
> **V417** (per `PROJECT_MEMORY.md`). The migrations below are **specified, not applied** — this is a
> design deliverable. Each ships **email OFF by default** (the `accident_emails_enabled` gate) and is
> additive/non‑destructive.

---

# PART A — SLA ENGINE (brief §10, §15)

## A.1 Design principles

1. **A timer is an instance of a definition.** `sla_definitions` is configurable policy (per country /
   company / route / activity). `sla_instances` are the running clocks on a specific case activity.
   `sla_pause_events` are the audited stop/resume records. This mirrors the brief's §17 entity list
   (`sla_definitions`, `sla_instances`, `sla_pause_events`) exactly.
2. **Internal targets are much shorter than regulatory maxima** (brief §10). The regulatory KSA numbers
   (9 / 5 / 45 working days for missing‑docs / accept‑reject / settlement) live as **separate configurable
   regulatory controls** on `country_rule_profiles` (docs 02/03), never mixed into the internal targets.
3. **Timers start and stop off workstream/stage status transitions, never a manual toggle.** The trigger
   already writing `accident_stage_events` is the single source of transition truth; the SLA engine hooks
   the same transition path.
4. **Working‑calendar aware.** Elapsed time is *business* time (working hours minus weekends and country
   holidays), not wall‑clock, so "4 working hours" and "1 business day" mean what the brief says.
5. **A pause needs a reason and an expected follow‑up date**, always; long pauses need approval (brief §10,
   §15). "Waiting for insurer" is legitimately outside our control and must not count as us breaching.
6. **Warning and breach are deduped, not re‑fired every minute.** We reuse the exact pattern V305 already
   uses for VOR/overdue (`*_notified_at` columns), so a scanning cron cannot spam.

## A.2 `sla_definitions` (configurable policy)

```
sla_definitions
  id                 uuid pk
  organisation_id    uuid  not null default app_current_org()
  country            text        -- null = applies to all countries in the org
  company            text        -- optional narrower scope
  route_key          text        -- null = all routes; else FK to workflow_route_profiles (doc 03)
  activity_key       text  not null   -- see A.3 catalog (stable machine key)
  name               text  not null   -- human label
  target_minutes     integer not null -- business minutes (working-calendar counted)
  calendar_id        uuid        -- FK accident_working_calendars; null = org default calendar
  warning_pct        numeric not null default 0.75  -- warn at 75% of target consumed
  escalate_l2_pct    numeric not null default 1.00  -- overdue → team lead
  escalate_l3_after_min integer          -- minutes past due → dept manager (null = disabled)
  escalate_l4_events text[] not null default '{}'   -- attribute events that jump straight to L4 (A.10)
  responsible_team   text        -- department that owns the clock (matches accidents/routing dept vocab)
  pausable           boolean not null default true
  requires_pause_approval_after_min integer default 1440  -- >24 business-hours pause needs a manager
  active             boolean not null default true
  priority           integer not null default 100
  created_by/at, updated_by/at
  UNIQUE (organisation_id, country, company, route_key, activity_key)   -- most-specific wins
```

**Resolution order (most specific → least):** exact `(country, company, route_key)` → `(country, route_key)`
→ `(country)` → org default. Mirrors the `material_master` / country‑profile resolution style already used
in the codebase. Nothing is hardcoded; KSA is seeded as data.

## A.3 Suggested internal starting targets (seed data, brief §10 / §15)

Seeded as `sla_definitions` rows for the pilot org, **country = KSA**, `route_key = null` (all routes),
against a KSA working calendar (Sun–Thu, standard hours). These are *defaults*, editable in the admin
Business‑Rules screen — never hardcoded in engine code.

| `activity_key` | Name | Internal target | Business unit | Notes |
|---|---|---|---|---|
| `initial_registration` | Initial accident registration | **2 hours** | wall/working hrs | starts at `accident.reported` |
| `fleet_validation` | Fleet validation | **4 working hours** | working hrs | |
| `insurance_review` | Insurance review | **4 working hours** | working hrs | |
| `claim_submission` | Submit complete claim | **1 business day** | business days | |
| `workshop_inspection` | Workshop inspection | **1 business day** | business days | |
| `initial_repair_estimate` | Initial repair estimate | **2 business days** | business days | |
| `repair_route_approval` | Repair‑route approval | **1 business day** | business days | |
| `po_after_approval` | PO after approval | **1 business day** | business days | |
| `fleet_inspection` | Fleet inspection after repair | **4 working hours** | working hrs | |
| `rectification_plan` | Rectification plan after rejection | **1 business day** | business days | |
| `closure_review` | Final closure review | **2 business days** | business days | |

`target_minutes` for "1 business day" = one full working day of the resolved calendar (e.g. 8×60 = 480),
**not** 1440 wall minutes. This is why the calendar is load‑bearing (A.5).

## A.4 `sla_instances` (running clocks)

```
sla_instances
  id                 uuid pk
  organisation_id    uuid not null default app_current_org()
  accident_id        uuid not null            -- FK accidents
  workstream_key     text                     -- which workstream this clock belongs to (doc 02/03)
  definition_id      uuid not null            -- FK sla_definitions (resolved at start)
  activity_key       text not null            -- denormalised for scanning/reporting
  country            text
  site               text
  responsible_team   text
  assigned_user_id   uuid                     -- current owner (from workstream owner / responsible_owner_id)
  started_at         timestamptz not null default now()
  target_minutes     integer not null         -- copied from definition at start (immutable snapshot)
  due_at             timestamptz not null     -- computed = started_at + target business-minutes
  completed_at       timestamptz              -- set when the activity's exit transition fires
  status             text not null default 'running'
                       -- running | warning | breached | paused | met | missed | cancelled
  -- durable dedupe columns (same pattern as accidents.vor_sla_notified_at / overdue_notified_at):
  warned_at          timestamptz              -- warning notice fired once
  breached_at        timestamptz              -- breach notice fired once
  escalated_l2_at    timestamptz
  escalated_l3_at    timestamptz
  escalated_l4_at    timestamptz
  paused_total_min   integer not null default 0   -- accumulated paused business-minutes (excluded from elapsed)
  paused_since       timestamptz              -- non-null while a pause is open
  breach_minutes     integer                  -- populated at completion = business-minutes overdue (0 if met)
  created_at, updated_at
  INDEX (organisation_id, status, due_at)     -- the scan predicate
  INDEX (accident_id)
```

**Immutability of `target_minutes` / `due_at`:** copied from the definition **at start**. Editing a
definition later must not silently re‑time a clock already running against an agreed target — the same
"a filled value must never retroactively change" discipline used across the codebase.

`due_at` recompute happens **only** when a pause resumes (A.7), because paused business‑minutes push the
due time forward.

## A.5 Working calendar + country holidays (brief §15)

```
accident_working_calendars
  id, organisation_id, country, name,
  week_mask       int[]  not null   -- working weekdays, 0=Sun..6=Sat (KSA default {0,1,2,3,4} = Sun-Thu)
  day_start_min   int not null default 480    -- 08:00
  day_end_min     int not null default 1020   -- 17:00
  timezone        text not null default 'Asia/Riyadh'
  active boolean, priority int
  UNIQUE (organisation_id, country, name)

accident_country_holidays
  id, organisation_id, country, holiday_date date, name text
  UNIQUE (organisation_id, country, holiday_date)
```

**Business‑minute arithmetic** is a single pure engine — the SLA analogue of the existing pure engines
(`accidentStages.js`, `expenseTrends.js`):

- New pure module **`src/lib/sla/businessTime.js`** (mirrors a SQL `sla_business_minutes(from, to, calendar,
  holidays)` used by the cron):
  - `businessMinutesBetween(from, to, cal, holidays)` — counts only minutes inside working weekdays,
    inside `[day_start_min, day_end_min]`, excluding `holiday_date`s.
  - `addBusinessMinutes(from, minutes, cal, holidays)` — the inverse, used to compute `due_at`.
  - Deterministic: `now`/`from`/`to` are injected; **no `Date.now()` inside**, so it is unit‑testable
    (same rule the codebase enforces for `accidentStages.js`).
- **The SQL mirror is authoritative for the cron** (the scan runs in the DB); the JS mirror powers the
  live "remaining time" countdown in the case header. A test pins the two produce identical results for a
  fixed fixture set (same "SQL ↔ JS mirror" discipline used for `classify_parts_consumption`).

**Timezone:** stored/compared in UTC; the calendar's `timezone` converts wall‑clock working hours. Dates are
timezone‑aware (master‑prompt §3). "2 hours" (a wall‑clock target like initial registration) is expressed as
`target_minutes` against a **24×7 calendar** row, not the working calendar — so registration is due 2 clock
hours after the accident even overnight.

## A.6 Warning / escalation thresholds (brief §15, §26)

Each `sla_definition` carries `warning_pct` (default 0.75), `escalate_l2_pct` (1.00 = at due),
`escalate_l3_after_min`, and `escalate_l4_events[]`. The **4 escalation levels** are exactly the brief §26
ladder:

| Level | Fires when | Recipient (resolved via routing rules, A.9) |
|---|---|---|
| **L1 warning** | consumed ≥ `warning_pct × target` and not yet due | assigned user (`to_roles`) |
| **L2 overdue** | `now > due_at` (paused time excluded) | assigned user **+ team lead** (`escalate_roles` of the owning team) |
| **L3 manager** | overdue by `escalate_l3_after_min` business‑minutes | department manager |
| **L4 senior** | an attribute event in `escalate_l4_events[]` (fatality, high value, VOR beyond threshold, claim rejection, liability dispute, total loss, legal, long‑overdue settlement) | Fleet Manager / senior management |

L4 is **event‑driven, not timer‑driven** — it is emitted directly by the attribute change (A.10), so a
fatality escalates the instant it is recorded, not when a timer expires.

## A.7 Pause / resume (brief §10, §15) — reason + follow‑up date always, approval for long pauses

```
sla_pause_events
  id, organisation_id, accident_id, sla_instance_id not null,
  action           text not null   -- 'pause' | 'resume'
  reason_code      text            -- required on pause; from the fixed catalog below
  expected_follow_up_date date     -- REQUIRED on pause (brief: "cannot pause without ... expected follow-up date")
  comment          text            -- required (pause comments, brief §15)
  approved_by      uuid            -- required when the projected pause exceeds requires_pause_approval_after_min
  approval_ref     text
  acted_by         uuid not null default auth.uid()
  acted_at         timestamptz not null default now()
```

**Valid pause reason catalog** (union of brief §10 + §15 — configurable, seeded, not hardcoded):
`waiting_authority_report`, `waiting_driver`, `waiting_third_party`, `waiting_insurer`, `waiting_surveyor`,
`waiting_management_approval`, `waiting_quotation`, `waiting_po`, `waiting_parts`, `waiting_workshop_capacity`,
`vehicle_unavailable`, `legal_hold`, `weather_delay`, `site_access_restriction`, `other_approved_reason`.

**Server enforcement (the control that makes this real):** the pause RPC
`sla_pause(p_instance_id, p_reason_code, p_expected_follow_up, p_comment, p_approved_by)`:
- **rejects** a pause with a null/blank `reason_code`, a null `expected_follow_up_date`, or blank `comment`
  (brief: "must not be able to pause a timer without selecting a reason and expected follow‑up date");
- if the projected pause length (from `expected_follow_up_date`) exceeds
  `requires_pause_approval_after_min`, **requires** `approved_by` to be a manager (checked against role), else
  rejects — "approval for long pauses";
- sets `sla_instances.paused_since = now()`, `status = 'paused'`, writes the `pause` row, and writes an
  `accident_audit_logs` row (Part D). **`other_approved_reason` always requires approval.**

`sla_resume(p_instance_id, p_comment)`:
- accumulates `paused_total_min += businessMinutesBetween(paused_since, now())`,
- **pushes `due_at` forward** by the same amount (this is why insurer waits do not breach us),
- clears `paused_since`, recomputes `status`, writes the `resume` row + audit row.

## A.8 Timer start / stop off transitions (not manual)

A timer is **created and completed by the same transition machinery that already writes
`accident_stage_events`** — no new manual "start timer" button. Each `sla_definition.activity_key` maps to a
**start transition** and an **exit transition** (a table `sla_activity_bindings`, seeded, editable):

```
sla_activity_bindings
  activity_key      text
  start_on          text   -- e.g. 'stage_enter:workshop_assessment' | 'workstream_status:insurance:in_progress'
  complete_on       text   -- e.g. 'stage_exit:workshop_assessment'   | 'field_set:estimated_damage_cost'
  cancel_on         text[] -- transitions that cancel the clock (e.g. workstream marked not_applicable)
```

Hook point: extend the **existing** DEFINER trigger that writes `accident_stage_events`
(the one behind `caseProgress`) so that on a stage `enter` it also:
1. resolves the applicable `sla_definitions` for that activity (A.2 resolution),
2. `INSERT`s an `sla_instance` (idempotent per `(accident_id, activity_key, open)`),
3. on the matching exit/`complete_on`, stamps `completed_at`, computes `breach_minutes`, sets `status = met|missed`,
4. on `cancel_on` (e.g. workstream marked **Not Applicable** with a reason — brief §8/§3), sets
   `status = 'cancelled'` (a waived stage must not show an eternally‑open clock — same principle as
   `stageApplies()` in `accidentStages.js`).

Because `accident_stage_events` is written **only by the DEFINER trigger** (client writes revoked in
V398c), a user cannot forge a start/stop and cannot manufacture a "met" SLA. This is the server boundary
the acceptance criteria demand (§32.19, §32.24).

## A.9 The scan cron — reuse the `accident-sla-scan` pattern

**Do not add a new cron for warnings/breaches — extend the pattern already running.** V305 ships a live
pg_cron job `accident-sla-scan` that emits `accident.vor_sla_breach` / `accident.overdue`, deduped via
`accidents.vor_sla_notified_at` / `accidents.overdue_notified_at`. The SLA engine adds one function the same
job calls (or a sibling job on the same cadence):

`sla_scan()` (SECURITY DEFINER, runs every ~15 min like `accident-sla-scan`):
```
for each sla_instances i where status in ('running','warning'):
    elapsed  = businessMinutesBetween(i.started_at, now(), cal, holidays) - i.paused_total_min
    if i.paused_since is not null: continue         -- a paused clock never warns/breaches
    if elapsed >= warning_pct*target and i.warned_at is null:
        set status='warning', warned_at=now()
        emit_domain_event('accident.sla_warning', 'accident', accident_id, {...instance...})
    if now() > i.due_at and i.breached_at is null:
        set status='breached', breached_at=now(), escalated_l2_at=now()
        emit_domain_event('accident.sla_breach', 'accident', accident_id, {...instance, level:2...})
    if breached and l3 threshold passed and escalated_l3_at is null:
        set escalated_l3_at=now()
        emit_domain_event('accident.sla_escalation', ..., {level:3})
```

- **Dedupe is structural:** `warned_at` / `breached_at` / `escalated_l3_at` are the exact analogue of
  `vor_sla_notified_at`, so a warning/breach notice fires **once**, never every 15 minutes. (This is the
  same lesson recorded in `PROJECT_MEMORY` for the VOR scan.)
- The emitted events land on the **existing bus** → `consume_event_accident_notify` (extended, B.3) resolves
  recipients → in‑app `notifications` always, email only when the master gate is on.
- **`sla_business_minutes(...)` SQL** is the authoritative calendar function; the cron never uses wall‑clock.
- **No new delivery path.** Everything after `emit_domain_event` is the pipeline that already runs.

## A.10 L4 attribute events (event‑driven, not timer)

Extend `emit_accident_domain_events()` (the trigger already emitting `accident.reported` etc.) to also emit,
on the relevant field/toggle change:

| Emitted event | Trigger condition |
|---|---|
| `accident.injury_reported` | `injuries`/`fatality` set true, or `injury_count > 0` |
| `accident.total_loss_declared` | repair route/decision = total loss |
| `accident.high_value_flagged` | `estimated_damage_cost` (or approved) crosses a configurable threshold |
| `accident.liability_disputed` | `fault_status`/liability = disputed |
| `accident.settlement_overdue` | (already handled by scan when a `claim_submission`/settlement SLA breaches) |

These carry `escalate_l4` routing so senior management is notified immediately (brief §26 L4).

---

# PART B — NOTIFICATION MATRIX & ESCALATIONS (brief §9, §13, §26)

## B.1 The one pipeline (do not fork it)

```
accidents change ─┬─ trg_accident_derive (stage↔status, vor_since)     [V301]
                  └─ trg_emit_accident_events → emit_domain_event(...)   [V304]
                                     │
   sla_scan() / L4 attribute triggers ┘  (Part A)  emit more accident.* events
                                     ▼
                 domain_events (status='pending')  ──  process_domain_events  (pg_cron 1/min, V96)
                                     ▼
                 consume_event_accident_notify(ev)                          [V304, extended B.3]
                   ├─ match accident_routing_rules (event_key, severity, type, site, country, cost, flags)
                   ├─ resolve recipient PROFILES (org + site + country + role)   ← resolveRecipients()
                   ├─ ALWAYS insert in-app notifications (one row per recipient)  ← notifications table
                   └─ IF accident_emails_enabled AND a template maps AND channel warranted (B.5):
                         render accident_email_templates via accident_apply_tokens
                         → INSERT workflow_notifications (payload{subject,html,push{title,body},recipients})
                                     ▼
                 deliver_workflow_notifications  (pg_cron 1/min, V119, job 'deliver-workflow-notifications')
                                     ▼
                 workflow-notify (edge fn v5) → Email(Resend) / Push(Expo) / WhatsApp(Twilio)
```

**Everything from `domain_events` onward already exists.** New work is limited to: (a) emitting a few more
event types, (b) adding routing‑rule rows + template rows, (c) teaching the consumer the digest‑vs‑immediate
rule, (d) the SLA/L4 events from Part A.

## B.2 New domain event types to emit

Add to `emit_accident_domain_events()` / `sla_scan()` and register on the consumer's `event_types[]`
(currently 6 → grows to the set below). Names follow the live `accident.*` convention.

| New event type | Emit condition | Maps to template key |
|---|---|---|
| `accident.workstream_assigned` | a workstream's owner/`responsible_owner_id` is set/changed, or `departments_involved` gains a dept | `workstream_assigned` (new) |
| `accident.approval_required` | case enters an approval stage (`repair_approval`) OR an approval task is created | `repair_approval` (exists) / `approval_required` (new) |
| `accident.evidence_incomplete` | Fleet validation returns the case for missing photos/report | `missing_docs` (exists) |
| `accident.claim_status` | `claim_status` change (already `accident.claim_changed`; **kept**, this row documents the mapping to templates by status: submitted/approved/rejected/delayed) | `claim_submitted`/`claim_approved`/`claim_rejected`/`claim_delayed` |
| `accident.insurer_docs_requested` | insurer requests documents (missing‑docs task created) | `missing_docs` (exists) |
| `accident.repair_ready` | Workshop QC passes / vehicle ready for Fleet inspection | `final_inspection_pending` (exists) |
| `accident.handover_rejected` | Fleet rejects the handover (rectification loop) | `handover_rejected` (new) |
| `accident.parts_required` | a parts request is raised | `parts_required` (new) |
| `accident.po_required` | external repair approved / PO needed | `po_required` (new) |
| `accident.settlement_overdue` | settlement SLA breached (from `sla_scan`) | `claim_delayed` (exists) / `settlement_overdue` (new) |
| `accident.ready_for_closure` | all closure requirements met, closure review requested | `ready_for_closure` (new) |
| `accident.reopened` | case reopened (audited) | `reopened` (new) |
| `accident.sla_warning` | Part A L1 | `sla_warning` (new) |
| `accident.sla_breach` | Part A L2 | `sla_breach` (new) / reuse `overdue` |
| `accident.sla_escalation` | Part A L3/L4 | `sla_escalation` (new) |

> The 15 templates already seeded cover `reported, critical, missing_docs, workshop_assessed,
> repair_approval, claim_submitted, claim_approved, claim_rejected, claim_delayed, vor_sla_breach,
> repair_completed, final_inspection_pending, released, closed, overdue`. The **new** template keys to seed
> are: `workstream_assigned, approval_required, handover_rejected, parts_required, po_required,
> settlement_overdue, ready_for_closure, reopened, sla_warning, sla_breach, sla_escalation`.

## B.3 The full trigger → recipient matrix (brief §9 table + §13 + §26)

Each row is realised as an `accident_routing_rules` row (or a rule + `escalate_roles`). Recipients are
**roles**, resolved to profiles at send time by `resolveRecipients()` (org + site + country scoped) — so no
employee name is ever hardcoded (matches the live V303 seed design).

| # | Event (domain event) | To roles | CC roles | Escalate roles | Channel class (B.5) |
|---|---|---|---|---|---|
| 1 | `accident.reported` (complete submission) | Fleet Supervisor, HSE Officer, Insurance Claims Officer | Fleet Manager | — | major‑status → immediate |
| 2 | `accident.evidence_incomplete` | Accident Reporter, Fleet Incident Officer | Fleet Supervisor | — | action‑required → immediate |
| 3 | `accident.injury_reported` (serious injury/fatality) | HSE Manager, Fleet Manager | Senior Management | Senior Management (**L4**) | escalation → immediate |
| 4 | `accident.stage_changed → insurance_claim` (claim required) | Insurance Claims Officer | Fleet Supervisor | Insurance Manager | action‑required → immediate |
| 5 | `accident.claim_status = registered/submitted` | Fleet Supervisor, Workshop Planner, Insurance Manager | — | — | major‑status → immediate |
| 6 | `accident.insurer_docs_requested` | Insurance Claims Officer (doc owner), Fleet Incident Officer | Insurance Manager | — | missing‑docs → immediate |
| 7 | `accident.repair_route = external approved` | Fleet Ops Officer, Workshop Planner, Procurement Officer | Fleet Manager | — | approval‑completed → immediate |
| 8 | `accident.parts_required` | Storekeeper, Procurement Officer | Workshop Planner | — | action‑required → immediate |
| 9 | `accident.stage_changed → repair plan completed` | Fleet Operations Officer | Workshop Supervisor | — | major‑status → immediate |
| 10 | `accident.repair_ready` (vehicle ready) | Fleet Inspector | Fleet Ops Officer | — | action‑required → immediate |
| 11 | `accident.handover_rejected` | Workshop Supervisor | Workshop Manager, Fleet Ops | — | rejection → immediate |
| 12 | `accident.stage_changed → vehicle_release` (vehicle accepted) | Insurance Claims Officer, Finance Officer | Fleet Manager | — | major‑status → **daily digest** (informational) |
| 13 | `accident.settlement_overdue` | Insurance Manager, Fleet Manager | — | Senior Management (**L4**) | escalation → immediate |
| 14 | `accident.ready_for_closure` | Fleet Manager (final approver) | — | — | approval‑required → immediate |
| 15 | `accident.approval_required` (repair estimate approval) | Fleet Manager / Workshop Manager (per route) | — | — | approval‑required → immediate |
| 16 | `accident.claim_status = approved` | Insurance Claims Officer, Finance Officer, Fleet Supervisor | — | — | approval‑completed → immediate |
| 17 | `accident.claim_status = rejected` | Insurance Manager, Fleet Manager | — | Senior Management (**L4** if high value) | rejection → immediate |
| 18 | `accident.workstream_assigned` | the assigned owner | that owner's team lead | — | assignment → immediate |
| 19 | `accident.sla_warning` (L1) | assigned user | — | — | SLA → immediate |
| 20 | `accident.sla_breach` (L2) | assigned user | team lead (`escalate_roles`) | — | SLA → immediate |
| 21 | `accident.sla_escalation` (L3) | department manager | team lead | — | escalation → immediate |
| 22 | `accident.reopened` | new assigned owner | Fleet Manager | — | major‑status → immediate |
| 23 | normal field updates (non‑action) | owner only | — | — | **daily digest** |

## B.4 Home‑screen inbox alignment (brief §11)

The same routing feeds the role home screens. No new query engine — the in‑app inbox reads `notifications`
+ the case's derived state via the existing `accidentStages.js` selectors (`caseProgress`, `longestWaiting`).
Each role's home tiles (Fleet / Insurance / Workshop planner / Procurement‑Store / Fleet manager / Finance —
brief §11) are **filters over the same data**, not new tables.

## B.5 Digest vs immediate rule (brief §9, §13 — "do not send every update to every user")

The consumer classifies every event into a **channel class** and routes accordingly:

| Class | Examples | Delivery |
|---|---|---|
| **Immediate** | action‑required, assignment, approval‑required, approval‑completed, rejection, missing‑docs, major status change, SLA warning/breach, escalation | in‑app now **+** email now (if gate on) |
| **Digest** | routine field updates, informational "vehicle accepted", low‑priority status touches (matrix row 12, 23) | in‑app now, **email batched** into a per‑user **daily digest** |

Implementation, reusing existing objects:
- **Immediate** → the current path (consumer enqueues a `workflow_notifications` row at once).
- **Digest** → the consumer sets a `digest = true` flag on the enqueued row (add nullable
  `workflow_notifications.digest_group text`, or a lightweight `accident_digest_queue` table keyed by
  `(user_id, day)`), and a **once‑daily pg_cron** (sibling of `deliver-workflow-notifications`, e.g.
  `accident-daily-digest` at 06:30 org‑time like the existing coverage/SLA jobs) coalesces each user's
  pending digest rows into **one** email via the same `workflow-notify` edge function (payload carries a
  multi‑item digest body). This reuses the Resend channel — no new provider.
- **Escalation digest** (brief §13 "optional escalation digest") is the same mechanism with a manager
  audience and only L2+ rows.

## B.6 Master gate (unchanged, default OFF)

Everything email stays behind `system_config.accident_emails_enabled` (default `'false'`). In‑app
`notifications` **always** fire (they are free and internal). Push/WhatsApp remain independently no‑op unless
their edge‑function env is set. Turning the module live for a customer is a **single toggle** in the admin
Email‑Delivery tab — the design‑time default protects a customer from surprise external emails during
migration (brief §36).

---

# PART C — EMAIL TEMPLATES & REPLY CAPTURE (brief §9, §13, §23)

## C.1 Subject format (brief §9 / master §13)

Rendered by `accident_apply_tokens` from `accident_email_templates.subject`:

```
[{{reference_no}}][{{action_tag}}] {{action_label}} | Asset {{asset_no}}
```

Producing e.g.:
- `[TP-ACC-KSA-2026-00124][Action Required] Register Insurance Claim | Asset MX-241`
- `[TP-ACC-KSA-2026-00124][Repair Approved] External Workshop | Due 30-Jul-2026`
- `[TP-ACC-KSA-2026-00124][Vehicle Ready] Fleet Inspection Required | Asset MX-241`

`{{action_tag}}` is the class label (`Action Required`, `Repair Approved`, `Vehicle Ready`, `SLA Breach`,
`Claim Rejected`, …); `{{reference_no}}` is the case number the derive trigger already generates
(`ACC-YYYY-####`; the country segment `TP-ACC-KSA-…` is a display concern — the stored `reference_no`
carries the sequence, the country is prefixed at render from `accidents.country`).

## C.2 Body tokens (brief §9 / §13 email content)

`accident_apply_tokens(tpl, acc, dept)` already substitutes: `{{reference_no}} {{company}} {{site}}
{{asset_no}} {{plate_number}} {{driver_name}} {{incident_date}} {{location}} {{severity}} {{stage_label}}
{{vor_label}} {{estimated_cost}} {{approved_cost}} {{claim_status}} {{department}} {{pending_action}}
{{due_date}} {{link}}`.

**Tokens to add** to satisfy the full brief §9/§13 body contract:
`{{liability_label}}`, `{{vehicle_condition}}`, `{{responsible_person}}`, `{{missing_documents}}` (list),
`{{latest_decision}}`, `{{sla_remaining}}`, `{{reply_line}}` (C.4). The `{{link}}` is the **secure deep link
into the case** inside Tyre Pulse — email directs the user back to the app, it is never the record itself
(brief §9, master §35).

### Concrete `accident_email_templates` rows (illustrative — seed, editable, `approved=true`)

**`workstream_assigned`**
```
key      : workstream_assigned
name     : Workstream assigned to you
subject  : [{{reference_no}}][Action Required] {{department}} — {{pending_action}} | Asset {{asset_no}}
body_html: <card>
  <h2>Case {{reference_no}} — {{pending_action}}</h2>
  <table>
    <tr><td>Asset / Plate</td><td>{{asset_no}} / {{plate_number}}</td></tr>
    <tr><td>Project / Site</td><td>{{company}} / {{site}}</td></tr>
    <tr><td>Accident date</td><td>{{incident_date}}</td></tr>
    <tr><td>Stage</td><td>{{stage_label}}</td></tr>
    <tr><td>Severity / Liability</td><td>{{severity}} / {{liability_label}}</td></tr>
    <tr><td>Vehicle condition</td><td>{{vehicle_condition}}</td></tr>
    <tr><td>Required action</td><td><b>{{pending_action}}</b></td></tr>
    <tr><td>Owner</td><td>{{responsible_person}}</td></tr>
    <tr><td>Due</td><td>{{due_date}} ({{sla_remaining}} remaining)</td></tr>
    <tr><td>Missing documents</td><td>{{missing_documents}}</td></tr>
    <tr><td>Latest decision</td><td>{{latest_decision}}</td></tr>
  </table>
  <a href="{{link}}">Open the case in Tyre Pulse →</a>
  {{reply_line}}
</card>
```

**`sla_breach`**
```
key      : sla_breach
name     : SLA breached
subject  : [{{reference_no}}][SLA Breach] {{pending_action}} overdue | Asset {{asset_no}}
body_html: … same card … <p>This activity passed its {{due_date}} target. It is now with {{department}}.</p>
```

**`ready_for_closure`**
```
key      : ready_for_closure
name     : Case ready for closure
subject  : [{{reference_no}}][Approval Required] Closure review | Asset {{asset_no}}
body_html: … card listing each workstream state + "no outstanding blockers" + {{link}} …
```

All bodies reuse the **shared card + `{{tokens}}`** structure the 15 live templates already use — so a new
key is a data insert, not code. Bilingual (EN/AR): store `body_html` with both, or add `locale` to the
unique key `(organisation_id, key, locale)` (master §3 Arabic support). Templates are versioned via
`updated_at`/`updated_by`; `approved` must be true to send (brief §23 template version + approval).

## C.3 The 5 emails a person actually gets (brief §9 discipline)

Per recipient, per case, the pipeline only ever produces: **action‑required**, **approval/rejection**,
**major status‑change**, **daily digest** (normal updates), **escalation**. The routing matrix (B.3) + the
digest classifier (B.5) enforce this; there is no "email every field change to everyone" path.

## C.4 Email reply capture (brief §9, §13, §23) → `case_communications`

`case_communications` does **not exist yet** — this is the new table for the Communication tab (brief §6 tab
9 / §12 §17). Design:

```
case_communications
  id, organisation_id, accident_id not null,
  workstream_key   text,               -- link the reply to the right workstream/task (brief §13)
  direction        text not null,      -- 'outbound' | 'inbound' | 'internal_note'
  channel          text not null,      -- 'email' | 'whatsapp' | 'in_app' | 'call_log' | 'portal'
  reply_token      text unique,        -- per-message opaque token embedded in outbound address/body
  from_address     text, to_addresses  text[], cc_addresses text[],
  subject          text, body_text     text, body_html text,
  external_party_id uuid,              -- FK to the portal grant / insurer / workshop (Part E)
  attachments      jsonb default '[]', -- {storage_path, filename, mime, size, verified}
  provider_message_id text,            -- Resend / inbound provider id (idempotency)
  posted_by        uuid, posted_at timestamptz default now(),
  INDEX (accident_id, posted_at), UNIQUE (provider_message_id)
```

**Outbound tagging:** every action email carries a **unique reply token** (per message, not per case) both in
a `+tag` reply address (`case+{reply_token}@…`) and encoded in `{{reply_line}}` ("Reply above this line —
your message will be attached to case {{reference_no}}"). The token maps to `(accident_id, workstream_key,
recipient)` so an inbound reply lands on the exact case **and** the right task, and cannot be replayed onto
another case.

**Inbound path & the Resend reality (brief §23 / master §13, §23):**
- **Resend (the module's current email provider) does NOT support inbound email / IMAP.** It is send‑only.
  So inbound capture needs a **provider abstraction** and one of:
  1. an **inbound webhook provider** for the reply subdomain (e.g. **SendGrid Inbound Parse**, **Mailgun
     Routes**, **Postmark inbound**, or **Cloudflare Email Workers**) posting to a new edge function
     `accident-email-inbound`; or
  2. Microsoft 365 / Google Workspace **Graph/Gmail push** on a dedicated `accidents@` mailbox.
- New edge function **`accident-email-inbound`** (verify_jwt=false, shared‑secret header like
  `workflow-notify`): parses the inbound payload, extracts the `reply_token`, verifies it, strips quoted
  history, stores the body + attachments (to the accidents storage bucket, virus‑scanned), and inserts a
  `case_communications` inbound row via a DEFINER RPC. **Unknown/expired token → quarantine, never auto‑file**
  (prevent unauthorised commands through email — master §13).
- **Design so it degrades:** if no inbound provider is configured, outbound still works and the reply line
  says "reply not monitored — use the secure link". The abstraction is `email_provider` config in
  `system_config` (brief §23: outbound, delivery status, retry, template version, log, inbound where
  available, reply token, attachments).
- **Delivery status / retry / log** already exist on `workflow_notifications`
  (`status, attempts, next_attempt_at, response_status, result, last_error, delivered_at`) — the email log
  is that table plus `case_communications` for the human‑readable thread.

---

# PART D — PROCESS ANALYTICS & AUDIT (brief §13, §18, §24, §25)

## D.1 Where the numbers come from (no new fact tables for KPIs)

All KPIs are computed from data that already exists or is added by Parts A/C:
- **accidents** (severity, type, site, country, costs, dates, claim fields, `vor`/`vor_since`) —
  read via the live `buildAccidentKpis()` and `analyzeClaims()` (the single claims calc source).
- **accident_stage_events** — time‑with‑team (already powering `teamPerformance` / `longestWaiting`).
- **sla_instances / sla_pause_events** — the precise "waiting‑for‑X" analytics.
- **case_communications** — insurer response cadence.

New pure engine **`src/lib/accidentProcessAnalytics.js`** (sibling of `accidentStages.js`, deterministic,
`now` injected) is the single source for process KPIs — no inline recomputation elsewhere.

## D.2 KPI catalog (brief §13 / §24)

**Operational (§24.1):** total accidents; open/closed/reopened; by country/project/site/vehicle‑type/
severity/accident‑type; vehicles currently off road (`vor=true`); average reporting time (registration SLA);
average repair duration; average vehicle downtime (VOR days); cases overdue by team; repair rejection rate
(handover_rejected / handovers); repeat‑asset & repeat‑driver counts. *(Most already in `buildAccidentKpis`;
extend with reopened + off‑road + overdue‑by‑team from `sla_instances`.)*

**Insurance (§24.2):** insured vs uninsured; claims registered/approved/partially‑approved/rejected;
awaiting‑docs/survey/decision/settlement; avg claim‑registration time; avg insurer response time (from
`case_communications` outbound→inbound deltas); avg settlement time; recovery %; rejection reasons; insurer &
broker performance; **claims aging over 15/30/45 working days** (uses the same working‑calendar function as
the SLA engine so "working days" is consistent).

**Financial (§24.3):** gross accident cost; internal/external repair cost; parts; labour; towing; storage;
third‑party; insurer‑approved; recovered; deductible; uninsured loss; unrecovered loss; cost by
project/asset/accident‑type; average cost per accident. **Currency:** per the org config, per‑country, never
blended (the repo's standing money rule — `governedCost.js`; the "SAR+AED+EGP" blend bug must not recur).

**Safety (§24.4):** preventable vs non‑preventable; liability distribution; root causes; unsafe acts/
conditions; driver violations; weather/site cases; corrective actions overdue; accidents per million km;
accidents per 100 active assets.

## D.3 Process analytics — the management view (brief §13, §24.5)

This is the differentiator: **which team or external party is delaying the case.** Computed from
`sla_instances` + `accident_stage_events` (both hold the durations), split into **internal hold** and
**external wait**:

| Metric | Source |
|---|---|
| Time spent with Fleet / HSE / Insurance / Workshop / Finance | sum of `accident_stage_events` business‑minutes by `department` (already in `teamPerformance`) |
| Waiting for insurer / surveyor / parts / quotation / PO / vendor | sum of `sla_pause_events` paused business‑minutes **grouped by `reason_code`** — this is the exact answer, because a `waiting_insurer` pause is time the case sat outside our control |
| Waiting for Fleet inspection / settlement / closure approval | open `sla_instances` for those activities, business‑minutes since `started_at` |

**Key honesty rule (carried from `accidentStages.js`):** the analytics report time **held / waited**, never
"caused the delay." A 40‑day `waiting_insurer` pause counts against the *external* bucket, not the Insurance
team — the pause reason distinguishes "our team is slow" from "we are correctly waiting on a third party."
`teamPerformance` already reports median + worst (a single stalled case must not drag the mean). Backfilled
durations are labelled `estimated` (basis='backfilled'), never presented as measured.

## D.4 Where these surface (reuse existing surfaces, brief §25)

- **In‑app dashboards:** extend the existing accident Analytics tab + `ClaimProgressBoard` /
  `CaseProgressPanel` (V398) with the process‑analytics panel. No new page family.
- **Exports (brief §25):** accident case report, insurance claim report, repair report, downtime, cost &
  recovery, open‑actions, overdue‑task, claims‑aging, insurer/workshop performance, root‑cause, corrective‑
  action, monthly summary, country/project comparison, full case PDF, Excel, management summary — all through
  the existing `exportUtils.js` (`exportToExcel` / `exportToPdf`) + the accident report‑builder engine.
  **Reports respect user permissions & data scope** (org+country+site RLS is inherited — the service layer
  never bypasses it).
- **TV / shareable board:** reuse the `report_shares` + `get_report_snapshot` token pattern for an accident
  ops board (aggregates only, no PII) — same as the existing workshop/ops boards.

## D.5 Audit trail (brief §18 / master §18, §30) — `accident_audit_logs`

The existing `accident_audit_log` (V223) records status transitions. Phase‑2 needs the **full** field‑level
audit the brief demands. New immutable table:

```
accident_audit_logs
  id            bigint pk
  organisation_id uuid not null default app_current_org()
  accident_id   uuid not null           -- FK; case number derivable via reference_no
  entity_type   text not null           -- 'accident' | 'insurance_claim' | 'repair_order' | 'sla_instance' | 'case_communication' | 'closure_review' | ...
  entity_id     text not null
  action        text not null           -- created | submitted | field_changed | liability_approved | liability_changed
                                         --  | claim_registered | claim_decision | repair_decision | po_approved
                                         --  | scope_changed | vehicle_accepted | vehicle_rejected | cost_changed
                                         --  | settlement_posted | marked_not_applicable | closed | reopened
                                         --  | document_deleted | permission_override | sla_paused | sla_resumed
  field         text                    -- for field_changed
  old_value     jsonb                   -- previous value
  new_value     jsonb                   -- new value
  reason        text                    -- required for liability change, NA, reopen, cost change, override
  approval_ref  text                    -- links to case_approvals when the action needed sign-off
  actor_id      uuid not null default auth.uid()
  actor_role    text                    -- snapshot of the acting role
  source        text not null           -- 'web' | 'mobile' | 'api' | 'email' | 'portal' | 'system'
  ip            inet, session_id text   -- where available
  at            timestamptz not null default now()
  INDEX (accident_id, at), INDEX (organisation_id, action, at)
```

**Immutability (master §18, §30):** written only by DEFINER triggers / RPCs; `authenticated` has **no**
INSERT/UPDATE/DELETE grant (the V398c pattern — client writes revoked). A BEFORE UPDATE/DELETE trigger
raises on any attempt. Audited actions are exactly the brief §18 list. `source` is stamped by the writing
context (email‑inbound writes `'email'`, the portal writes `'portal'`, the SLA cron writes `'system'`).

**Silent‑change bans enforced here (master §35):** liability change, cost change, claim decision, and
"marked Not Applicable" all require a non‑null `reason` — the RPC rejects the mutation otherwise, so a value
can never move silently.

---

# PART E — EXTERNAL PORTAL (brief §9, §14 / master §14, §30)

## E.1 Reuse the `report_shares` token pattern — do not invent a second share surface

The codebase already has a **secure, expiring, org‑scoped, password‑protectable anon‑token** mechanism:
`report_shares` + `create_report_share()` (mints `rpt_`+18‑byte hex, bcrypt password) +
`get_report_snapshot(token, password)` (SECURITY DEFINER, anon‑callable, **org derived from the token row —
no cross‑org leak**, bumps `view_count`/`last_viewed_at`) + `revoke_report_share()`. The external portal is a
**sibling family** built on exactly this pattern, scoped to **one case, one party, one purpose**.

## E.2 `accident_external_grants` (new, mirrors `report_shares`)

```
accident_external_grants
  id, organisation_id, accident_id not null,
  party_type       text not null,   -- insurer | broker | surveyor | external_workshop | recovery | vendor
  party_name       text, party_email text,
  token            text unique,     -- 'acx_' + 18-byte hex (mirrors rpt_ minting)
  password_hash    text,            -- optional bcrypt PIN
  scope            text[] not null, -- allowed actions (E.3)
  workstream_key   text,            -- the single request they can see (e.g. a repair order, a doc request)
  expires_at       timestamptz not null,   -- REQUIRED (expiring link)
  max_uses         integer,         -- optional
  active           boolean not null default true,
  created_by, created_at, last_used_at, use_count bigint default 0
```

Minting RPC `create_accident_external_grant(...)` (elevated‑gated, DEFINER) + `revoke_accident_external_grant(id)`
— the `create_report_share` twins. **Search path must include `extensions`** (the `gen_random_bytes`/`crypt`
lesson recorded in `PROJECT_MEMORY` V259).

## E.3 What an external party can do (brief §14 — restricted, never the full case)

Read‑only view of **only the assigned request** + a small set of writes, each gated by `scope[]`:
`view_request`, `upload_document`, `upload_quotation`, `upload_invoice`, `confirm_survey_appointment`,
`confirm_repair_start`, `confirm_expected_completion`, `confirm_repair_completion`, `add_remark`,
`respond_to_document_request`.

- **Anon DEFINER read RPC** `get_accident_external_view(token, password)` returns a **PII‑free, single‑request
  projection** (case reference, asset label, the specific request text, required documents list, dates) —
  never internal financials, driver personal data, liability %, other projects, or the full policy
  (master §30 "do not expose"). It derives org+case from the token row, exactly like `get_report_snapshot`.
- **Anon DEFINER write RPCs** `external_upload_document(token, …)`, `external_confirm(token, kind, …)`,
  `external_add_remark(token, …)` — each checks the token (active, not expired, scope allows the action),
  writes to `case_communications` (`channel='portal'`, `external_party_id = grant.id`) and/or the relevant
  workstream table, and writes an `accident_audit_logs` row with `source='portal'`. **Every external action
  is audited** (brief §14, master §30).
- **Rate limiting** on the anon endpoints (master §29) — the edge/RPC layer throttles per token; expired /
  exhausted (`max_uses`) / revoked tokens return a clean "link expired" (brief §31 external‑link‑expiry test).
- Uploads go to the accidents storage bucket via **signed URLs**, virus‑scanned, MIME‑whitelisted (master
  §19, §30); the file lands as `mandatory=false, verified=false` until an internal user verifies it.

## E.4 Notification loop

When an external party uploads/confirms, the write RPC emits `accident.external_response` on the **same bus**,
which routes (via `accident_routing_rules`) an in‑app + optional email notice to the internal owner ("Workshop
uploaded a quotation for TP‑ACC‑…"). No separate channel.

---

# PART F — QA / ACCEPTANCE (brief §31, §32 / master §31, §32)

## F.1 Test layers

| Layer | Tooling (existing) | What it proves |
|---|---|---|
| **Unit (pure engines)** | Vitest — `src/lib/**` (e.g. `accidentStages.test.js`, new `businessTime.test.js`, `slaEngine.test.js`, `accidentProcessAnalytics.test.js`, `emailTokens.test.js`) | maths & rules are correct and deterministic; SQL↔JS mirrors agree |
| **Integration (DB / RLS / state machine)** | rolled‑back SQL transactions via Supabase MCP, impersonating real roles | triggers, RLS, permissions, closure gate, audit immutability |
| **Acceptance** | manual checklist against the 25 criteria (F.4) | end‑to‑end business behaviour |

## F.2 Case‑route test matrix (brief §31)

Each row = one end‑to‑end scenario asserting: correct required workstreams activate, correct SLAs start,
correct notifications route, correct closure blockers, correct audit rows.

| # | Scenario (brief §31) | Key assertions |
|---|---|---|
| 1 | Minor accident **without** insurance | insurance workstream not required; closure allowed without a claim; route completeness = only its required set |
| 2 | Insured **external** repair | claim + assessment + PO + external repair + QC + fleet inspection + settlement all required; insurer‑approval gate before repair |
| 3 | Internal workshop repair | no PO/external path; QC + fleet acceptance required |
| 4 | Injury accident | HSE investigation + authority report + management review + corrective actions required; `accident.injury_reported` → L4 escalation fires |
| 5 | Total‑loss case | total‑loss approval + asset‑register update + disposal required; `accident.total_loss_declared` → L4 |
| 6 | Third‑party claim | third‑party party + recovery tracking; Legal/Insurance routing |
| 7 | Hit‑and‑run | liability = hit_and_run; no third‑party recovery path required |
| 8 | Missing authority report | submission blocked / flagged; `missing_docs` notice; exception needs supervisor approval + audit |
| 9 | Missing mandatory photograph | mobile wizard blocks final submit; authorised exception records reason + approver + audit |
| 10 | Claim rejection | `claim_status=rejected` → template + (high value) L4; recovery path stays open |
| 11 | Partial claim approval | approved+rejected amounts recorded; challenge loop available |
| 12 | Additional repair damage | scope change → `accident.scope_changed` audit + re‑approval task |
| 13 | Repair‑cost increase | cost change requires reason (audit); re‑approval SLA starts |
| 14 | PO delay | `po_after_approval` SLA warns/breaches; process analytics attributes the wait to `waiting_po` |
| 15 | Parts delay | `waiting_parts` pause; store/procurement routing |
| 16 | External workshop delay | `waiting_workshop_capacity` pause; external‑wait bucket, not internal |
| 17 | Fleet repair rejection | `accident.handover_rejected` → rectification loop; repair returns to In Progress |
| 18 | Repair rectification loop | stage revisits recorded (multiple `accident_stage_events` visits); QC + inspection repeat |
| 19 | Financial settlement pending | operationally completed but not fully closed; closure blocked on finance |
| 20 | Case closure blocked | closure RPC rejects while any required workstream/task/approval/doc is outstanding |
| 21 | Reopening a closed case | requires reason + approval + new owner + due date; `accident.reopened` audit + notice |
| 22 | Duplicate case | cancelled‑as‑duplicate with link to primary; **never physically deleted** |
| 23 | Unauthorized user access | RLS denies cross‑role write (reporter cannot approve liability, insurance cannot edit workshop, etc.) |
| 24 | Cross‑company access attempt | org‑isolation RLS returns 0 rows; token cannot cross org |
| 25 | External link expiry | expired/revoked/over‑use token → clean "link expired", no data |
| 26 | Email failure | `workflow_notifications` retry ladder (`attempts`, `next_attempt_at`) re‑delivers; in‑app unaffected |
| 27 | Notification retry | a failed `net.http_post` re‑queues; dedupe columns prevent double‑fire |
| 28 | Data migration | existing cases keep `reference_no`; status→stage mapped; no historical case falsely marked complete |
| 29 | Mobile responsiveness | capture wizard on a 2 GB device; photo checklist gate |
| 30 | Poor network / interrupted upload | draft save + offline queue (existing mobile queue) replays without dup |
| 31 | Arabic content | RTL render of case + templates; AR template locale served |
| 32 | Timezone handling | SLA "4 working hours" respects `Asia/Riyadh` calendar; due times correct across midnight |
| 33 | Country‑specific config | KSA `sla_definitions` + `country_rule_profiles` apply; a second country resolves its own profile |

## F.3 Permission / state‑machine integration tests (brief §31 "all permission combinations", "cannot bypass closure via API")

Run each as an impersonated role in a rolled‑back transaction (the repo's proven method):

- **Closure cannot be bypassed via the API/RLS** (§32.13, §32.24 — the highest‑value security test):
  - Attempt a **direct `UPDATE accidents SET workflow_stage='closed'`** as every non‑manager role → the
    closure **BEFORE trigger / RPC guard** must reject unless all closure requirements are met, regardless of
    which client sends it. Closure is enforced **server‑side**, not in the UI.
  - Attempt to set `workflow_stage='closed'` while a required `sla_instance` is open / a required workstream
    is not `completed`/`not_applicable` / a required document is missing → rejected with the specific blocker.
  - Attempt to **forge** an `accident_stage_events` / `accident_audit_logs` / `sla_instances` "met" row as
    `authenticated` → denied (client write grants revoked; DEFINER‑only).
  - Attempt to mark a workstream **Not Applicable** with a null reason → rejected.
  - Attempt to change liability / cost after approval without a reason → rejected + no silent change.
  - Attempt to **reopen** without approval → rejected.
  - Attempt to **DELETE** an accident → blocked (cancel‑as‑duplicate only; never physical delete).
- **Role boundaries** (brief §15/§16): reporter cannot approve liability; insurance cannot edit workshop
  findings; workshop cannot edit insurer decisions; finance cannot accept handover; only fleet inspector
  accepts the vehicle; only nominated managers close/reopen. Each is one deny assertion.
- **Scope isolation:** country/site/company RLS returns exactly the in‑scope rows; external token sees one
  case only.
- **SLA math:** `businessMinutesBetween` SQL == JS mirror on a fixed fixture (incl. weekend + KSA holiday +
  overnight); a paused clock does not breach; resume pushes `due_at`; warning/breach fire once (dedupe).
- **Notification dedupe & gating:** email suppressed when `accident_emails_enabled='false'`; in‑app always
  fires; one warning per breach; digest coalesces to a single daily email.

## F.4 Acceptance checklist — the 25 criteria (brief §32)

| # | Criterion | Verified by |
|---|---|---|
| 1 | Fleet registers via mobile‑friendly flow | F.2‑29 + capture wizard demo |
| 2 | Mandatory evidence changes by case type | route‑profile tests (F.2‑1,2,4,5) |
| 3 | Incomplete cases returned with clear missing items | F.2‑8,9 (`missing_docs`, evidence_incomplete) |
| 4 | Each workstream has a separate owner + status | data model (doc 02) + `caseProgress` |
| 5 | Case shows current owner + next action | header + `accident_pending_action` + `holdingTeam` |
| 6 | Insurance manages claims independently | F.2‑2,10,11 + role tests |
| 7 | Workshop assesses/plans/executes | F.2‑2,3 |
| 8 | Store/Procurement process parts + POs | F.2‑14,15 |
| 9 | Fleet controls off‑road / return‑to‑service | VOR + release stages |
| 10 | Workshop completion requires Fleet acceptance | F.2‑17,18 (handover_rejected loop) |
| 11 | Fleet can reject repair → rectification loop | F.2‑17,18 |
| 12 | Financial settlement stays open after operational completion | F.2‑19 (3‑level closure) |
| 13 | Cannot fully close with missing requirements | **F.3 closure‑bypass suite** |
| 14 | Not Applicable requires a reason | F.3 (null‑reason rejected) |
| 15 | Reopening requires approval | F.2‑21 |
| 16 | All important actions audited | `accident_audit_logs` immutability + coverage (Part D) |
| 17 | Emails/notifications linked to correct case | `event_id`/`reply_token` traceability |
| 18 | External users get restricted access only | Part E + F.2‑24,25 |
| 19 | SLA timers + escalation function correctly | Part A + F.3 SLA math |
| 20 | Dashboards correctly identify team delays | Part D process analytics + `teamPerformance` |
| 21 | Existing accident data safely migrated | F.2‑28 migration test (reference_no preserved) |
| 22 | Existing Tyre Pulse functionality intact | full existing suite green (regression) |
| 23 | Works on desktop + mobile | responsive + mobile wizard |
| 24 | Permissions validated on the server | **F.3 (RLS/DEFINER, not UI)** |
| 25 | Documentation + tests complete | this doc + docs 01‑04 + test files |

## F.5 Regression guard (repo discipline)

- Every new pure engine ships a Vitest file where **each case is a real scenario** (the codebase's rule:
  when the engine gets one wrong, add the failing row first).
- **SQL ↔ JS mirrors** (`sla_business_minutes` ↔ `businessTime.js`, `accident_apply_tokens` ↔ `emailTokens.js`)
  are pinned by a test that fails if they diverge — the same guard used for `classify_parts_consumption`.
- The full existing suite (5,750+ tests) must stay green; the accident work must not touch unrelated money /
  classification paths.

---

## Appendix — new vs reused, at a glance

**Reused unchanged:** `domain_events`, `event_consumers`, `process_domain_events`, `workflow_notifications`,
`deliver_workflow_notifications` (cron), `workflow-notify` (edge fn v5), `notifications` (in‑app),
`accident_routing_rules`, `accident_email_templates`, `accident_apply_tokens`, `accident_stage_events`,
`emit_accident_domain_events`, `system_config.accident_emails_enabled`, `accidents.sla_due_at` /
`vor_sla_notified_at` / `overdue_notified_at`, the `report_shares` / `create_report_share` /
`get_report_snapshot` token pattern, `exportUtils.js`, `accidentStages.js`, `accidentWorkflow.js`,
`claimsAnalytics.js`.

**Extended:** `emit_accident_domain_events()` (more event types + L4 attribute events), the DEFINER stage‑event
trigger (start/stop SLA instances), `consume_event_accident_notify` (digest‑vs‑immediate class + new event
types), `event_consumers.event_types[]`, the `accident-sla-scan` cron pattern (adds `sla_scan()`),
`accident_email_templates` (11 new seeded keys), `accident_routing_rules` (matrix rows in B.3).

**New tables/functions (specified, not applied):** `sla_definitions`, `sla_instances`, `sla_pause_events`,
`sla_activity_bindings`, `accident_working_calendars`, `accident_country_holidays`, `case_communications`,
`accident_audit_logs`, `accident_external_grants`; functions `sla_business_minutes`, `sla_pause`, `sla_resume`,
`sla_scan`, `create_accident_external_grant`, `get_accident_external_view`, `external_upload_document`,
`external_confirm`, `external_add_remark`; edge fn `accident-email-inbound`; pure engines `businessTime.js`,
`slaEngine.js`, `accidentProcessAnalytics.js`, `emailTokens.js`.

**Defaults (brief §36):** email OFF (`accident_emails_enabled='false'`); driver login optional; email provider
abstracted (Resend outbound today, inbound needs a webhook provider); external access via configurable expiring
links; KSA seeded as data, never hardcoded.
