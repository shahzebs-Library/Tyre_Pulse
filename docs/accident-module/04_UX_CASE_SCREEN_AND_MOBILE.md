# 04 — UX: Desktop Case Screen, Team Inbox, and Mobile Capture Wizard

Phase-4 UI/UX design for the Tyre Pulse Accident & Insurance module upgrade. This
document is the implementable design spec for:

- **(A)** the desktop **case screen** — sticky case header + 18 workstream tabs + role-aware team inbox
- **(B)** the mobile **5-step accident-capture wizard**

It maps the brief (`ACCIDENT_MODULE_BRIEF.md` §6, §7, §8, §10, §11, §12) onto the
**existing** Tyre Pulse design system and the workstream data model
(`accident_cases`, `case_tasks`, `sla_instances`, … from brief §12/§17). It writes
**no code** — it specifies routes, components, props, data reads/writes, roles,
counters, and i18n keys precisely enough to build.

> Scope guard: this is a UX spec. Column/table definitions come from the data-model
> doc; SLA timer logic from the SLA doc; email templates from the notifications doc.
> Where a table is named here it is to say *which workstream record a tab reads/writes*.

---

## 0. What is preserved (non-negotiable)

The accidents **list page** (`/accidents`, `src/pages/Accidents.jsx`) keeps its three
current tabs **exactly as they are today**:

| Tab | Component today | Status |
|---|---|---|
| **Incidents** register | KPI strip + status pills + filters + `EnterpriseTable` | **Preserved** — becomes the case *list*, rows link to the new case screen |
| **Analytics** | `AccidentIntelligencePanel`, `ClaimProgressBoard`, doughnuts/trend charts, chart-capture PDF/PPTX | **Preserved verbatim** (user insists) |
| **Report Builder** | lazy `AccidentReportBuilder` (block layouts, saved templates, scheduled) | **Preserved verbatim** (user insists) |

The `usePersistedState('accidents.tab', 'incidents')` tab model, the report-email
button, the URL `?claims=open` filter, and the bulk-delete (admin) flow all remain.

**The case screen is additive.** Route `/accidents/:id` already exists
(`App.jsx:464` → lazy `AccidentDetailModal`). Phase-4 **evolves that route** from the
current 9-tab detail modal into the full **18-tab case view**. The list page is
untouched apart from its rows navigating to `/accidents/:id` (already the behaviour:
`openDetail = navigate('/accidents/${id}')`).

```
/accidents                 → list page  (Incidents | Analytics | Report Builder)   [PRESERVED]
/accidents/:id             → CASE SCREEN (sticky header + 18 tabs)                 [Phase-4 build]
/accidents/inbox           → TEAM INBOX  (role-aware landing block)                [Phase-4 build]
/claims-summary            → Claims dashboard                                       [PRESERVED]
```

---

## 1. Design-system contract (reuse only)

Everything below is drawn from the current app so the module reads as one product.

### 1.1 Tokens (from `src/index.css`)

Use CSS variables, never raw hex, for surface/text/border. Most-used in this module:

- Text: `var(--text-primary)`, `var(--text-secondary)`, `var(--text-dim)`, `var(--text-muted)`
- Surface: `var(--surface-1)`, `var(--surface-2)`, `var(--input-bg)`, `var(--input-bg-hover)`
- Border: `var(--input-border)`, `var(--border)`, `var(--hairline)`
- Charts: `var(--panel-2)` for grid lines (resolved per-theme by `chartVarPlugin`)

Semantic status hues stay **hard-coded** (they carry meaning — do **not** palettise):
severity ladder (Minor grey / Moderate amber / Major orange-red), fault
(Faulty red / Non-faulty green / Under review amber), SLA (green/amber/red).

### 1.2 Component classes (from `index.css`)

- `.card` — the panel primitive (has `overflow:hidden` — **never** render a dropdown
  menu *inside* a card; use a fixed-overlay modal/portal, per the repo lesson).
- `.btn-primary`, `.btn-secondary`, `.btn-danger` — action buttons.
- `.input` — text inputs/selects/textareas.
- `.badge`, `.badge-critical/high/medium/low` — status chips.

### 1.3 Reusable building blocks (already in the repo)

| Component | Path | Use in case screen |
|---|---|---|
| `PageHeader` | `src/components/ui/PageHeader.jsx` | history-aware Back; case-screen title bar |
| `EnterpriseTable` | `src/components/ui/EnterpriseTable.jsx` | tabular lists (tasks, documents, parts, quotes, transactions) — supports `columns`, `onRowClick`, `enableRowSelection`, virtualised, CSV/PDF export meta |
| `EmptyState` | `src/components/EmptyState.jsx` | props `{ icon, illustration, title, description, action:{label,onClick}, compact }` |
| `CaseProgressPanel` | `src/components/accidents/CaseProgressPanel.jsx` | **the workstream engine UI** — reuse on the Overview + Workstream tabs |
| `ClaimProgressBoard` | `src/components/accidents/ClaimProgressBoard.jsx` | team bottleneck board (Analytics + Inbox) |
| `AccidentIntelligencePanel` | `src/components/accidents/AccidentIntelligencePanel.jsx` | trust/basis + concentration (Analytics) |
| `BreakdownCard` (local, `Accidents.jsx`) | proportional ranked bars | small KPI breakdowns |

### 1.4 Motion

`framer-motion` is already imported in `Accidents.jsx`. Use the existing pattern:
subtle `initial/animate` fade+rise on tab-panel mount, `prefers-reduced-motion`
respected. Current-stage spinner uses the `CaseProgressPanel` convention
(`Loader2`, 3s duration).

### 1.5 Icons — verified against installed `lucide-react@0.263.1`

**Available (use freely):** `Inbox`, `ListChecks`, `ListTodo`, `FileText`, `Files`,
`FolderOpen`, `Camera`, `Image`, `ShieldAlert`, `ShieldCheck`, `BadgeCheck`,
`Wrench`, `Hammer`, `Package`, `Truck`, `Car`, `Fuel`, `DollarSign`,
`CircleDollarSign`, `Banknote`, `Receipt`, `ClipboardCheck`, `ClipboardList`,
`ClipboardX`, `Clock`, `Timer`, `Hourglass`, `AlertTriangle`, `AlertOctagon`,
`CheckCircle2`, `CheckCheck`, `Circle`, `CircleDot`, `Users`, `UserCheck`,
`GitBranch`, `GitPullRequest`, `Workflow`, `MessageSquare`, `History`, `Gauge`,
`MapPin`, `LocateFixed`, `CalendarDays`, `PauseCircle`, `PlayCircle`, `ChevronRight`,
`ChevronDown`, `ArrowRight`, `ArrowLeft`, `Paperclip`, `Bell`, `Filter`, `Search`,
`Plus`, `Save`, `Eye`, `Repeat`, `Copy`, `TrendingUp`, `BarChart2`, `Info`,
`Lightbulb`, `Presentation`, `Mail`, `SlidersHorizontal`, `Flag`, `Phone`, `Upload`,
`Download`, `ScanLine`, `QrCode`, `Milestone`, `Navigation`, `PenTool`, `PenLine`,
`FileSignature`, `Stamp`, `Ban`, `XCircle`, `Undo2`, `LayoutDashboard`, `Building2`,
`FileCheck`, `FileClock`, `FileWarning`, `Split`, `Send`, `X`, `Trash2`.

**MISSING in 0.263.1 — do NOT import (build will break):** `Handshake`, `Route`,
`CircleCheck`, `CircleAlert`, `Signature`, `Waypoints`.
Substitutes: settlement → `BadgeCheck`; routing → `GitBranch`/`Milestone`;
signature → `PenTool`/`FileSignature`; check → `CheckCircle2`; alert → `AlertTriangle`.

> Rule (repo convention): verify every lucide icon before import. This list was
> verified against the installed version at authoring time.

---

## 2. Desktop CASE screen — `/accidents/:id`

Layout: `PageHeader` (Back) → **sticky case header** → **tab strip** (18 tabs, wrap on
narrow) → **active tab panel**. The header is `position: sticky; top: 0` inside a
scroll container so it never leaves the viewport while a tab scrolls. Tab strip is
sticky directly under it.

### 2.1 Sticky case header (brief §12.1) — `<CaseHeader>`

A dense, read-only status bar. Never a form. Three rows on desktop, collapses to
stacked chips on mobile.

**Props:** `{ record, workstreams, sla, currentOwner, nextAction, completion }`

**Row 1 — identity (always visible, largest):**

| Field | Source | Render |
|---|---|---|
| Case number | `reference_no` (e.g. `TP-ACC-KSA-2026-000124`) | mono, bold, copy-on-click (`Copy` icon) |
| Asset number | `asset_no` | mono chip |
| Plate number | `plate_number` | chip |
| Country | `country` | flag/text chip |
| Site / project | `site` · `project` | text |
| Accident date | `incident_date` (+ `incident_time`) | `formatDate` |
| Driver / operator | `driver_name` | text |

**Row 2 — case state chips (status-coloured):**

| Chip | Source | Colour rule |
|---|---|---|
| Severity | `severity` → `canonSeverity` | `accidentSeverityPill` (grey/amber/red) |
| Liability | `liable_party` / `gcc_liability_ratio` | neutral, red when disputed |
| Vehicle condition | `damage_condition` | severity-toned |
| Vehicle operational status | derived (`vor`, release state) | Off-road → red, Operational → green |
| Current stage | `workflow_stage` → `stageLabel` | `stageTone` |
| Repair status | workstream `repair_in_progress` state | chip |
| Insurance status | workstream `insurance_claim` state | chip |
| Settlement status | workstream `cost_recovery` state | chip |

**Row 3 — action & SLA strip (the "what now"):**

| Field | Source | Render |
|---|---|---|
| Current owner | `case_tasks` open task assignee → fallback `responsible_owner_id` | `UserCheck` + name |
| Next action | current stage's required action (`case_tasks` open title) | text, links to the owning tab |
| Due date | active `sla_instances.due_at` | `CalendarDays` + relative ("in 3h", "overdue 2d") |
| SLA condition | `sla_instances` state | **green** on-track / **amber** warning / **red** breach / **grey** paused (`PauseCircle`) |
| Overall completion | route-based % (see §2.3) | thin progress bar + `NN%` |

**Header actions (right-aligned, role-gated):** `Edit incident` (opens the ONE
consolidated form — see §2.4), `Advance stage` (owner only), `Reopen` / `Close`
(nominated managers only), `Print case PDF`, `Copy case link`.

**Behaviour:** unsaved-change guard active while any tab has a dirty draft (browser
`beforeunload` + in-app confirm). Skeleton header while `record` loads.

### 2.2 Tab strip (brief §12.2) — 18 tabs with pending counters

Tab bar reuses the existing underline-active pattern
(`border-green-500 text-green-400` active / `border-transparent text-gray-400` idle,
per `AccidentDetailModal`). Each tab shows an icon, label, and — when it has open
items — a **pending-action counter badge** (see §2.5). Tabs a case route does **not**
require are dimmed and labelled `N/A` (waived), never hidden, so the reader sees the
full model (brief §4 route-based completeness).

Persist active tab with `usePersistedState('accidentcase.tab', 'overview')`.

For each tab: **Purpose · Reads (workstream table) · Key components · Read/Write ·
Roles that can act · Counter source.**

---

#### Tab 1 — Overview `LayoutDashboard`

- **Purpose:** the whole case at a glance; the reader's landing point.
- **Reads:** `accident_cases`, `accident_case_workstreams`, `case_tasks`,
  `sla_instances`, `closure_requirements`, `case_communications` (latest), `financial_transactions` (rollup).
- **Key components:**
  - **Workstream status grid** — reuse `CaseProgressPanel` (`record`, `canEdit=false`
    here → read-only ladder) showing each of the six workstreams' state chips
    (brief §7): *Incident Evidence · Liability · Insurance · Repair · Fleet Handover ·
    Finance · Corrective Actions*, plus "Overall case".
  - **Route-based completion** cards: five progress bars — Incident / Insurance /
    Repair / Financial / Overall (brief §9) via the route engine (§2.3).
  - **Pending actions** list, **Overdue tasks**, **Missing documents**, **Closure
    blockers** — each an `EmptyState` when clear.
  - **Latest decision** (from `claim_decisions`/`case_approvals`), **Upcoming
    deadline** (soonest `sla_instances.due_at`), **Cost summary** tiles,
    **Repair timeline** + **Insurance timeline** mini-timelines, **Communication
    timeline** (last 5).
- **Read/Write:** read-only summary; each block **links** into its owning tab.
- **Roles:** all case members (view).
- **Counter:** none (it *is* the aggregate).

#### Tab 2 — Incident `FileText`

- **Purpose:** the initial report — what/where/who/classification.
- **Reads:** `accident_cases` core fields, `accident_case_vehicles`, `driver_statements`.
- **Key components:** read cards for date/time, GPS (`MapPin` + mini map link),
  site/road, accident type, description, initial vehicle condition, movable/recovery
  toggles (read state), odometer/hours; **driver statement** card.
- **Write:** `Edit incident` → the ONE consolidated form (§2.4). Correcting a field
  after submission writes an audit row (old→new+reason).
- **Roles:** Fleet Incident Officer / reporter (pre-validation); after validation,
  edits require Fleet Supervisor and are audited.
- **Counter:** "evidence incomplete" flag count from `evidence_requirements` unmet.

#### Tab 3 — Evidence `Camera`

- **Purpose:** photographs, videos, authority reports, documents + the **photo checklist**.
- **Reads:** `accident_evidence`, `evidence_requirements`, `authority_reports`.
- **Key components:**
  - **Photo checklist board** — the desktop mirror of the mobile 13-item checklist
    (§B4). Grid of required slots with thumbnail / "missing" state and an
    `NN of MM required` progress bar. Slots come from `evidence_requirements` for the
    case route (configurable), not hard-coded.
  - **Documents table** (`EnterpriseTable`): category, type, uploaded-by, date,
    mandatory/optional, verification status, preview/download. Reuse `resolveStorageUrl`.
  - **Authority report** card (Najm / traffic / police reference + upload).
- **Write:** upload evidence, verify a document, record an authority reference,
  **request a photo exception** (supervisor only, reason + audit).
- **Roles:** Fleet/reporter upload; Fleet Supervisor verifies + grants exceptions.
- **Counter:** `requiredPhotos - uploaded` + unverified mandatory docs.

#### Tab 4 — Parties `Users`

- **Purpose:** every third party, witness, other vehicle involved (one case → many).
- **Reads:** `accident_case_parties`, `witness_statements`.
- **Key components:** party cards (name, role: third-party/witness/other, contact,
  vehicle, plate, insurer), add-party modal, witness statement list.
- **Write:** add/edit party, add witness statement (Fleet). Gated behind
  `third_party_involved` toggle for the third-party section.
- **Roles:** Fleet Incident Officer / Supervisor.
- **Counter:** parties flagged incomplete (third-party toggled on but no party recorded).

#### Tab 5 — Liability & Safety `ShieldAlert`

- **Purpose:** severity, preventability, official liability, root cause, corrective actions.
- **Reads:** `liability_assessments`, `safety_investigations`, `root_causes`, `corrective_actions`.
- **Key components:** severity + preventability selectors, **liability picker**
  (brief §5.3 nine options), split liability % (company / third-party / other),
  **root-cause** block, **corrective/preventive actions** table (owner, due date,
  status) — reuse the corrective-action pattern already in the app.
- **Write:** classify severity/liability, record causes, create/assign corrective
  actions. **Approved liability locks** — a later change requires reason + supporting
  doc + manager approval (brief §5.3), all audited. Reuse `CaseProgressPanel`'s
  `hse_investigation` stage fields.
- **Roles:** HSE Officer / Safety Manager / authorised Fleet Manager. **Reporters
  cannot approve liability** (brief §15).
- **Counter:** open corrective actions + "liability not yet approved".

#### Tab 6 — Insurance `FileCheck`

- **Purpose:** policy, claim, insurer/broker, surveyor, decisions, settlement.
- **Reads:** `insurance_policies`, `insurance_claims`, `insurance_claim_documents`,
  `insurance_claim_events`, `insurance_decisions`, `insurance_settlements`, `surveyors`.
- **Key components:** policy-validity card (valid on accident date? green/red),
  claim registration card (claim number, registration date), **required/missing
  documents** checklist, insurer-acknowledgement + surveyor-visit tracker, **decision**
  block (accepted / partial / rejected + deductible, approved amount, exclusions,
  rejection reason), settlement + recovery tracker. A **claim-events timeline**
  (`insurance_claim_events`) shows insurer SLA clock (brief §1.C: 9/5/45 working-day
  regulatory maxima as *configurable* markers).
- **Write:** register claim, log documents, record insurer decision + amounts, track
  settlement. Reuse `CaseProgressPanel`'s `insurance_claim` stage fields.
- **Roles:** Insurance Claims Officer / Insurance Manager. **Cannot edit workshop
  findings** (brief §15).
- **Counter:** missing claim documents + "claim not registered" + "awaiting insurer".

#### Tab 7 — Technical Assessment `ClipboardList`

- **Purpose:** damage inspection + repair estimate + total-loss flag.
- **Reads:** `damage_assessments`, `damage_items`, `accident_evidence` (assessment photos).
- **Key components:** damage checklist by system (body/chassis/suspension/steering/
  tyre-wheel/electrical/mechanical/safety-system/attachments), assessment photo strip,
  estimated labour hours, estimated cost, recommended repair route, recommended
  off-road + estimated downtime, **total-loss possibility** flag.
- **Write:** record damage items, upload assessment photos, submit estimate. Reuse
  `workshop_assessment` stage fields.
- **Roles:** Workshop Inspector / Planner / Supervisor.
- **Counter:** "assessment pending" until estimate submitted.

#### Tab 8 — Repair Planning `Wrench`

- **Purpose:** repair decision + repair order + tasks + workshop + PO refs + dates.
- **Reads:** `repair_decisions`, `repair_orders`, `repair_tasks`, `external_workshops`, `quotations`, `quotation_items`.
- **Key components:** **repair-route decision** card (internal / external / insurer /
  dealer / specialist / replacement / total-loss), quotation comparison table
  (`EnterpriseTable` — vendor, amount, currency, chosen), repair-order + task list
  (owner, est hours), planned start/completion, off-road start, expected downtime.
- **Write:** select route (records who recommended + who approved + date + remarks),
  create repair order + tasks, attach/compare quotations. Fleet approves the plan
  before formal off-road (brief §5.7).
- **Roles:** Workshop Planner (plan) + authorised Fleet/Workshop Manager or Insurance
  Officer (route approval, per case).
- **Counter:** "route decision pending" / "awaiting quotation".

#### Tab 9 — Repair Execution `Hammer`

- **Purpose:** do the work, track progress, additional-damage approvals, QC handoff.
- **Reads:** `repair_orders`, `repair_tasks`, `repair_progress_updates`, `repair_quality_checks`.
- **Key components:** task-progress board (per task % / status), progress-update
  timeline, during-repair photo strip, parts-used + labour-hours entries,
  additional-damage-discovered banner (triggers a revised-approval task), **workshop
  QC** checklist + pass/reject.
- **Write:** start/update tasks, add notes/parts/labour/delays, upload photos, request
  revised approval, complete repair, submit for QC. QC pass/reject (Workshop QC).
  Reuse `repair_in_progress` stage fields (repair cost, parts cost).
- **Roles:** Internal/External Workshop Coordinator (execution); Workshop Quality
  Inspector (QC). **Cannot change insurer decisions** (brief §15).
- **Counter:** open repair tasks + "QC pending".

#### Tab 10 — Parts & Procurement `Package`

- **Purpose:** parts requests → store availability → purchase/quotation → PO.
- **Reads:** `parts_requests`, `parts_request_items`, `purchase_requests`,
  `purchase_orders`, `quotations` (reuse existing Parts Requests module where possible).
- **Key components:** parts-request list (status flow requested→approved→issued→
  fulfilled), stock-availability chips, quotation-required list, PO-pending list,
  expected-delivery + delayed-items.
- **Write:** create parts request, mark stock, request quotation/PO, record PO
  reference, update delivery dates.
- **Roles:** Storekeeper, Procurement Officer/Manager.
- **Counter:** open parts requests + POs pending.

#### Tab 11 — Vehicle Downtime `Truck`

- **Purpose:** off-road period, replacement vehicle, vehicle movement, actual downtime.
- **Reads:** `vehicle_downtime`, `replacement_vehicle_allocations`.
- **Key components:** off-road-period card (approved start/expected return), vehicle
  operational-status stepper (Operational → Off-road → Under repair → Ready for
  inspection → Returned), replacement-vehicle allocation card, towing/recovery record,
  **actual downtime** counter.
- **Write:** approve off-road dates, allocate replacement, record movement/recovery,
  confirm return-to-operation. Gated behind `vehicle_off_road` / `replacement_vehicle_required` toggles.
- **Roles:** Fleet Operations Officer.
- **Counter:** "awaiting off-road confirmation".

#### Tab 12 — Handover `ClipboardCheck`

- **Purpose:** Fleet inspection of the completed vehicle; accept or reject; return to service.
- **Reads:** `fleet_handover_inspections`, `repair_quality_checks`.
- **Key components:** workshop-completion vs Fleet-acceptance split (recorded
  separately — brief §5.11), handover checklist, handover photos, **accept** /
  **reject with remarks** (reject creates rectification tasks), return-to-service date,
  actual downtime confirm.
- **Write:** inspect, accept, reject + rectification tasks, confirm return date. Reuse
  `final_inspection` + `vehicle_release` stage fields.
- **Roles:** **Only Fleet Inspectors can accept the vehicle** (brief §15).
- **Counter:** "ready for inspection" / "rejected — rectification open".

#### Tab 13 — Cost & Recovery `CircleDollarSign`

- **Purpose:** all costs, insurer amount, deductible, recovered, unrecovered loss.
- **Reads:** `financial_transactions`, `claim_recoveries`, `insurance_settlements`.
- **Key components:** cost tiles (internal labour, internal parts, external repair,
  towing, storage, third-party), PO/invoice-match card, insurer-approved amount,
  deductible, insurance payment, third-party recovery, **unrecovered / company loss**,
  financial-closure confirm. Currency **per country** — never blend (repo rule);
  show each figure in the case currency.
- **Write:** post costs/recoveries, match PO/invoice, confirm financial closure. Reuse
  `cost_recovery` stage fields.
- **Roles:** Finance Officer / Cost Controller. **Cannot close operational handover** (brief §15).
- **Counter:** unmatched invoices + "financial closure pending".

#### Tab 14 — Corrective Actions `ListChecks`

- **Purpose:** the CAPA register for this case (may span Safety + Fleet).
- **Reads:** `corrective_actions` (+ evidence).
- **Key components:** action table (title, owner, due, status, evidence), overdue
  highlight, add-action modal. Reuse the app's existing corrective-action pattern.
- **Write:** create/assign/close actions (gated behind `corrective_action_required`).
- **Roles:** HSE + action owners.
- **Counter:** open/overdue corrective actions.

#### Tab 15 — Tasks `ListTodo`

- **Purpose:** every case task across all workstreams in one place (the case's own inbox slice).
- **Reads:** `case_tasks`, `case_task_dependencies`.
- **Key components:** task list (`EnterpriseTable`): title, workstream, owner, team,
  status, due, SLA chip; filters (mine / team / overdue / waiting). Row → owning tab.
- **Write:** claim/reassign, mark complete, add dependency (role-scoped to task owner/team).
- **Roles:** all members act on their own team's tasks; managers reassign.
- **Counter:** open tasks assigned within the case (the sum other tab counters roll up from).

#### Tab 16 — Approvals `BadgeCheck`

- **Purpose:** every approval gate on the case (liability lock, repair route, PO, revised scope, closure).
- **Reads:** `case_approvals`.
- **Key components:** approval queue cards (what, requested by, requested at, decision,
  approver, remarks), pending vs decided sections. Confirmation dialog on approve/reject
  with mandatory remark.
- **Write:** approve/reject (role-gated per approval type; never bulk — each may demand
  a signature/cost/named approver, per the repo's approvals rule).
- **Roles:** the authorised approver per gate (HSE/Fleet Manager/Insurance Manager/
  nominated closer).
- **Counter:** pending approvals awaiting *this user*.

#### Tab 17 — Communication `MessageSquare`

- **Purpose:** chronological emails, comments, calls, decisions, attachments — the case record.
- **Reads:** `case_communications`, `case_comments`, `email_events`.
- **Key components:** unified timeline (in-app comment, outbound email, inbound reply,
  call log, decision), each with author/date/channel and attachments; add-comment box;
  "email this stage" action. Inbound email replies (matched by case token — brief §9)
  render inline. **The app is the record; email only notifies** (brief intro).
- **Write:** add comment, log a call, send an action email (uses existing
  `sendReportEmail`/notification pipeline). External replies are ingested, not composed here.
- **Roles:** all members (comment); email-send gated to case owners/managers.
- **Counter:** unread inbound items since last view.

#### Tab 18 — Audit Trail `History`

- **Purpose:** every change: old value → new value, user, role, date, reason, source.
- **Reads:** `audit_logs` (case-scoped) + `accident_stage_events` (stage transitions,
  incl. **skipped** stages — the existing `ClaimProgressBoard`/`CaseProgressPanel` skip
  detection).
- **Key components:** filterable audit table (entity, action, before/after diff, user,
  reason, source web/mobile/api/email), read-only. Reuse the existing
  before/after-diff renderer pattern.
- **Write:** none (audit is append-only; **not editable** — brief §18).
- **Roles:** all members view; full detail to managers/auditors.
- **Counter:** none.

### 2.3 Route-based completion (brief §4, §9)

Completion is **never** field-count. It is the share of the **required workstreams for
the selected case route** that are complete (each workstream complete = its
`accident_case_workstreams` state is `Completed` **or** validly `Not applicable`).
The route is stored on `accident_case_routes` and driven by accident type + toggles
(brief §14). The header's five bars (Incident / Insurance / Repair / Financial /
Overall) each compute over their route-required subset.

Reuse `CaseProgressPanel`'s `caseProgress()` engine, which already computes
"required fields recorded across the stages reached (%)" and skip/outstanding sets —
extend it to consume the route's required-workstream list instead of the full ladder.
A workstream marked **Not applicable** must carry a reason (brief §3) — surface the
reason inline (the panel already renders `stage_waivers` reasons).

### 2.4 The ONE consolidated incident form (preserved model)

The current app already consolidates all create/edit into a single inline form on
`/accidents` (`EMPTY_FORM` in `Accidents.jsx`; the detail page's "Edit incident"
deep-links to it via `location.state.editId`). **Keep this single-form rule.** Each
workstream tab that writes does so through *its own scoped fields* (as
`CaseProgressPanel` already does with `saveStageFields`, which **refuses any column the
named stage does not own**) — never a second giant form. This preserves brief §12.5
"no long unstructured forms" while keeping one authoritative write path.

### 2.5 Per-tab pending-action counters

Each tab badge = count of **actionable-by-the-viewer** open items for that workstream,
derived from `case_tasks` (open + assigned to me/my team) **plus** workstream-specific
unmet requirements (missing docs, pending approval, unmatched invoice). Rules:

- Badge shown only when count > 0; hidden at 0 (never a "0" chip — brief §12.5 clarity).
- Colour: neutral for normal pending; **amber** when SLA-warning; **red** when SLA-breach
  or overdue (reuse SLA chip colours).
- A viewer with no write role on that workstream sees an **informational** grey count
  (what's outstanding) but no action affordance.
- Counters roll up: the **Tasks** tab (15) badge = union of all workstream task counts;
  the **Overview** tab shows the same numbers as a list, not a badge.

Counter data comes from one `case_tasks` + `sla_instances` read done once at case load
and refreshed on any write (single query, distributed to tab badges — do not query
per tab).

---

## 3. Team Inbox — role-aware landing block (brief §11, §12.4)

A **role-aware landing block** that renders at the top of the accident **list page**
(above the Incidents register) *and* is directly reachable at `/accidents/inbox`. It is
the "what do *I* need to do" surface. It is **not** a new module — it reads the same
`case_tasks` / workstream-status / `sla_instances` records the case screen writes.

### 3.1 Structure

`<TeamInbox role={profile.role}>`:

- **Queue tabs** (brief §12.4 — the same set for every role, filtered by ownership):
  *My tasks · My team's tasks · Unassigned · Overdue · Due today · Due this week ·
  Waiting for external party · Waiting for approval · Recently completed · Escalated.*
- **Role queue cards** — the specific queues that matter to the viewer's role (below).
  Each card = a labelled count + a mini list; clicking a row opens the case at the
  relevant tab (deep-link `/accidents/:id` + `usePersistedState` tab preset, mirroring
  the existing `presetReportType` deep-link pattern).
- **Filter bar** (brief §12.4): Country, Company, Branch, Project, Site, Asset type,
  Vehicle, Accident severity, Accident type, Current stage, Owner, Insurer, Workshop,
  Claim status, Repair status, Date range, SLA status. Reuse the `usePersistedState`
  filter pattern from `Accidents.jsx`.
- **Bottleneck strip** — embed `ClaimProgressBoard` (already computes per-team hold time,
  longest-waiting, and skipped stages via `buildStageIntelligence`) so a manager sees
  *which team/external party is delaying* (brief §13 process analytics).

The block is driven entirely by:
`case_tasks` (assignee/team/status/due) × `accident_case_workstreams` (state) ×
`sla_instances` (due/warn/breach/paused). No new derived store.

### 3.2 Per-role queues (brief §11)

Role is resolved from `profile.role` (reuse `teamForRole()` in `accidentStages.js`,
which already maps roles → Fleet / Insurance / Workshop / HSE / Finance / Site / Ops).
A user with multiple roles sees the union.

| Role | Queue cards | Primary filters pre-applied | Driven by |
|---|---|---|---|
| **Fleet** (Incident Officer / Supervisor / Operations) `Truck` | Accidents awaiting initial evidence · Missing photographs · Vehicles awaiting off-road confirmation · Vehicles ready for inspection · Rejected handovers · Vehicles currently unavailable | my team = Fleet/PMV + Operations; site scope | `case_tasks` at `reported`/`initial_review`/`vehicle_release` + `evidence_requirements` unmet + `vehicle_downtime` state |
| **Insurance Officer** `FileCheck` | New cases requiring insurance review · Claims not registered · Missing claim documents · Claims awaiting insurer response · Claims approaching insurer SLA · Rejected / partially accepted · Settlements pending | stage = insurance_claim; insurer filter | `insurance_claims` state + `insurance_claim_documents` + `sla_instances` (insurer SLA warn) |
| **Workshop Planner** `Wrench` | Vehicles awaiting inspection · Assessments pending · Repairs waiting for parts · Repairs waiting for PO · Work planned today · Delayed repairs · Vehicles ready for QC | stage ∈ {workshop_assessment, repair_*}; workshop filter | `repair_orders`/`repair_tasks` state + `parts_requests` + `sla_instances` breach |
| **Procurement & Store** `Package` | Parts requests · Stock availability · Quotations required · PO pending · Expected-delivery dates · Delayed items | open parts requests | `parts_requests`/`parts_request_items`/`purchase_orders` state |
| **Fleet Manager** `ShieldAlert` | Overdue cases · Cases requiring approval · High-severity incidents · Long vehicle downtime · Disputed liability · High repair cost · Reopened cases | country/company scope | `case_tasks` overdue + `case_approvals` pending + severity/liability flags + `vehicle_downtime` |
| **Finance** `Banknote` | Invoices pending · PO/invoice mismatch · Insurance receivables · Deductibles · Unrecovered amounts · Cases awaiting financial closure | stage = cost_recovery | `financial_transactions` + `claim_recoveries` + `closure_requirements` (financial) |

### 3.3 SLA in the inbox

Each queue row shows its SLA chip (green/amber/red/paused) from `sla_instances`.
**Escalated** queue = tasks past the escalation threshold. **Waiting for external
party** rows show a paused-timer chip (`PauseCircle`) with the pause reason (brief §10)
so a paused case is never mistaken for a stalled one. Row sort default = SLA severity
then due date.

---

## 4. Mobile accident-capture wizard (brief §7, §10)

Fast, offline-tolerant, **site-first**. The Fleet team never sees the insurance/workshop
form when reporting (brief §7). Built on the existing mobile stack: Daylight design
system (`lib/theme.ts`, `components/ui`), `recordQueue.saveCommand('REPORT_ACCIDENT', …)`
(offline-safe, idempotent on `client_uuid`), `photoUpload.prepareForUpload` (resize
1600px / q0.5 before base64 → no OOM), `assetLookup` (`extractScanCode` +
`lookupAssetByCode`), and `useLanguage()` en/ar with `isRTL` mirroring.

### 4.1 Shell

A 5-step wizard replacing the current single long scroll (`app/(app)/accident/report.tsx`
becomes a stepper; the field-parity logic it already contains is reused per step). Top:
`Screen` + a **step progress bar** (`Step 2 of 5` + segmented dots). Bottom: sticky
`Back` / `Next` (`Submit` on step 5). Every step **auto-saves a draft** to `recordQueue`
so a dropped session or lost signal never loses input. RTL: `flexDirection: 'row-reverse'`
+ `textAlign` from `isRTL` (existing pattern).

### 4.2 Step 1 — Identify

- **Scan** big primary button → camera/QR/RFID → `extractScanCode` → `lookupAssetByCode`
  → `applyAsset()` (auto-fills site, plate/fleet no, vehicle type, make/model, country
  from `vehicle_fleet`; **the picked asset's own site is authoritative and replaces any
  stale value** — existing `applyAsset` rule).
- **Search** fallback (search-first list; never dump the fleet) + **Manual entry** toggle.
- Read-only confirmation card once matched: asset no, plate, type, make/model, site,
  driver (auto-filled), project/site, country.
- **Odometer / hour meter** number field.
- **Next disabled until** an asset is resolved.
- Wireframe: `[ Scan vehicle ]` → matched card → `Odometer [____]` → `Next`.

### 4.3 Step 2 — Accident

- Date (native `DateTimePicker`, local-format, existing plumbing), Time, **GPS location**
  (`LocateFixed`, `lib/location`), Road / project site (dropdown from sites + Other),
  **Accident type** (icon chips, existing `ACC_TYPE_ICONS`), short description.
- **Yes/No toggles:** Injury · Third party · Vehicle movable · Recovery required ·
  Vehicle safe to operate (brief §10). Each toggle drives conditional reveals (§5).
- **Next disabled until** type + description present.

### 4.4 Step 3 — Authority & third party

- **Authority involved** toggle → authority type (configurable per country: Najm /
  Traffic Police / Police / Site Security / Civil Defence / Other), report/reference
  number, **Report available / Report pending / No report (+ mandatory reason)**.
- **Liability available / pending** toggle.
- **Third-party** section (shown only when *Third party* toggled on in step 2):
  name, vehicle, plate, contact, insurer.
- Existing Najm/Taqdeer fields fold in here for KSA (configurable, not hard-coded).

### 4.5 Step 4 — Photograph checklist (the key screen — brief §7, §10)

A **configurable mandatory-photo checklist** with live `NN of MM` progress. This
extends the current `AccidentPhotoGrid` (today: 5 doc slots + a multi "accident" bucket)
into a **positional required checklist** driven by `evidence_requirements` for the case
route.

- **Progress header:** `11 of 13 required photos` + progress bar (amber until complete,
  green at 100%). Uses `ListChecks`.
- **Required slots** (default set, per brief; configurable per route/country):
  Full front · Full rear · Left side · Right side · Front-left corner · Front-right
  corner · Rear-left corner · Rear-right corner · Close-up damage · Accident scene ·
  Vehicle plate · Chassis/VIN (when required) · Odometer · Dashboard warning lights ·
  Other-party vehicle (if third party) · Other-party plate (if third party) · Road/site
  condition · Tyres & wheels · Property damage (if environmental/property toggle).
- **Slot card:** icon + label + thumbnail (`previewUri`) or empty "tap to capture"
  state; camera/gallery pick; each upload runs `prepareForUpload` then
  `uploadCategorizedPhoto` (category encoded in filename prefix — existing convention;
  extend `AccidentPhotoCategory` with the positional keys). Document slots
  (license/resident_id/registration/najm/taqdeer) remain as-is beneath the required grid.
- **Conditional slots** appear only when their toggle is on (other-party = third party;
  property = property/environmental toggle), so the `MM` denominator is route-correct
  (brief §4 route-based completeness — never 13-of-fixed when the case needs fewer).
- **Exception path:** submission is blocked until all mandatory slots are filled,
  **unless** an authorised supervisor records an exception — a modal capturing
  **missing-photo reason + supervisor approval**, written to the audit trail
  (`AlertTriangle`, brief §7/§10). A non-supervisor sees the block with a clear message,
  not a silent disable.
- Offline: a queued photo that cannot upload yet keeps its local thumbnail and is
  retried by `recordQueue`; the slot shows a `cloud-offline` chip.

### 4.6 Step 5 — Statement & submit (review)

- Driver statement (textarea), witness details, immediate action taken.
- **Review screen** (brief §7 step 5): **Missing fields**, **Missing photographs**
  (`N of M`), **People who will receive the case** (resolved recipients — reuse
  `resolveRecipients`/routing so the reporter sees who's notified), **Initial due date**
  (from the first SLA target). Each missing item deep-links back to its step.
- `Submit` → `saveCommand('REPORT_ACCIDENT', payload, safeUuid())` (idempotent). Success
  screen (existing) shows online/offline state. Offline submits sync via the queue with
  the same `client_uuid` (no dupes).

### 4.7 New i18n keys (en + ar) — reuse the existing `accident.report.*` namespace

Add under `mobile/locales/en.json` and `mobile/locales/ar.json`. Keys are ASCII in code;
Arabic values only in `ar.json` (existing rule). DB tokens stay English.

| Key | en | ar |
|---|---|---|
| `accident.wizard.step` | `Step {n} of {total}` | `الخطوة {n} من {total}` |
| `accident.wizard.next` | `Next` | `التالي` |
| `accident.wizard.back` | `Back` | `السابق` |
| `accident.wizard.stepIdentify` | `Identify` | `تحديد المركبة` |
| `accident.wizard.stepAccident` | `Accident` | `الحادث` |
| `accident.wizard.stepAuthority` | `Authority` | `الجهة المختصة` |
| `accident.wizard.stepPhotos` | `Photos` | `الصور` |
| `accident.wizard.stepReview` | `Review & submit` | `المراجعة والإرسال` |
| `accident.wizard.scanVehicle` | `Scan vehicle` | `مسح المركبة` |
| `accident.wizard.odometer` | `Odometer / hour meter` | `عداد المسافة / الساعات` |
| `accident.wizard.gps` | `Use current location` | `استخدام الموقع الحالي` |
| `accident.wizard.injury` | `Injury` | `إصابة` |
| `accident.wizard.thirdParty` | `Third party` | `طرف ثالث` |
| `accident.wizard.movable` | `Vehicle movable` | `المركبة قابلة للتحريك` |
| `accident.wizard.recoveryRequired` | `Recovery required` | `تتطلب سحب` |
| `accident.wizard.safeToOperate` | `Safe to operate` | `آمنة للتشغيل` |
| `accident.wizard.authorityInvolved` | `Authority involved` | `تدخل جهة مختصة` |
| `accident.wizard.authorityType` | `Authority type` | `نوع الجهة` |
| `accident.wizard.reportNumber` | `Report / reference number` | `رقم البلاغ / المرجع` |
| `accident.wizard.reportAvailable` | `Report available` | `البلاغ متوفر` |
| `accident.wizard.reportPending` | `Report pending` | `البلاغ قيد الإصدار` |
| `accident.wizard.noReport` | `No report` | `لا يوجد بلاغ` |
| `accident.wizard.noReportReason` | `Reason (required)` | `السبب (مطلوب)` |
| `accident.wizard.liabilityAvailable` | `Liability available` | `المسؤولية محددة` |
| `accident.wizard.photoProgress` | `{done} of {total} required photos` | `{done} من {total} صور مطلوبة` |
| `accident.wizard.photoTapCapture` | `Tap to capture` | `اضغط للتصوير` |
| `accident.wizard.photoMissing` | `Missing` | `ناقصة` |
| `accident.wizard.photoException` | `Submit without a required photo` | `الإرسال بدون صورة مطلوبة` |
| `accident.wizard.photoExceptionReason` | `Missing-photo reason` | `سبب نقص الصورة` |
| `accident.wizard.photoExceptionNeedsSupervisor` | `A supervisor must approve a missing photo` | `يلزم موافقة المشرف على نقص الصورة` |
| `accident.wizard.photo.fullFront` | `Full front` | `الأمام كامل` |
| `accident.wizard.photo.fullRear` | `Full rear` | `الخلف كامل` |
| `accident.wizard.photo.leftSide` | `Left side` | `الجانب الأيسر` |
| `accident.wizard.photo.rightSide` | `Right side` | `الجانب الأيمن` |
| `accident.wizard.photo.frontLeft` | `Front-left corner` | `الزاوية الأمامية اليسرى` |
| `accident.wizard.photo.frontRight` | `Front-right corner` | `الزاوية الأمامية اليمنى` |
| `accident.wizard.photo.rearLeft` | `Rear-left corner` | `الزاوية الخلفية اليسرى` |
| `accident.wizard.photo.rearRight` | `Rear-right corner` | `الزاوية الخلفية اليمنى` |
| `accident.wizard.photo.closeUp` | `Close-up damage` | `الضرر عن قرب` |
| `accident.wizard.photo.scene` | `Accident scene` | `موقع الحادث` |
| `accident.wizard.photo.plate` | `Vehicle plate` | `لوحة المركبة` |
| `accident.wizard.photo.chassis` | `Chassis / VIN` | `الهيكل / رقم التعريف` |
| `accident.wizard.photo.odometer` | `Odometer` | `عداد المسافة` |
| `accident.wizard.photo.dashboard` | `Dashboard warning lights` | `أضواء تحذير اللوحة` |
| `accident.wizard.photo.otherVehicle` | `Other-party vehicle` | `مركبة الطرف الآخر` |
| `accident.wizard.photo.otherPlate` | `Other-party plate` | `لوحة الطرف الآخر` |
| `accident.wizard.photo.road` | `Road / site condition` | `حالة الطريق / الموقع` |
| `accident.wizard.photo.tyres` | `Tyres & wheels` | `الإطارات والعجلات` |
| `accident.wizard.photo.property` | `Property damage` | `أضرار الممتلكات` |
| `accident.wizard.statement` | `Driver statement` | `إفادة السائق` |
| `accident.wizard.witness` | `Witness details` | `بيانات الشهود` |
| `accident.wizard.immediateAction` | `Immediate action taken` | `الإجراء الفوري المتخذ` |
| `accident.wizard.reviewMissingFields` | `Missing fields` | `حقول ناقصة` |
| `accident.wizard.reviewMissingPhotos` | `Missing photographs` | `صور ناقصة` |
| `accident.wizard.reviewRecipients` | `Who will receive this case` | `من سيستلم هذه الحالة` |
| `accident.wizard.reviewDueDate` | `Initial due date` | `تاريخ الاستحقاق المبدئي` |
| `accident.wizard.draftSaved` | `Draft saved` | `تم حفظ المسودة` |

> Interpolation (`{n}`, `{done}`) follows the existing `t()` interpolation used in
> `accident.report.*`. Add every key to **both** locales; `LanguageContext` falls back
> to English for any missing key, but ship both to avoid mixed-language screens.

---

## 5. Conditional toggles (brief §8, §11)

Toggles set **case attributes** and reveal only the related fields — never bypass a
mandatory control (brief §11). They live on the mobile wizard (steps 2–3) and, on
desktop, on the consolidated form; each reveal maps to the workstream tab that owns it.
Persisted on `accident_cases` / route flags; drive the route's required workstreams.

| Toggle | Reveals | Owning tab |
|---|---|---|
| Insurance involved | policy, insurer, broker, coverage, deductible, claim fields | 6 Insurance |
| Third party involved | third-party name/vehicle/plate/contact/insurer (Parties) | 4 Parties |
| Injury involved | injury count, medical/injury info, HSE-escalation flag | 5 Liability & Safety |
| Fatality involved | fatality details, mandatory management + legal escalation | 5, 16 Approvals |
| Authority report available | authority type, report number, upload slot | 3 Evidence |
| Authority report pending | expected-report reminder, pause-reason (waiting for report) | 3, SLA |
| Vehicle movable | (hides recovery/towing fields when true) | 11 Downtime |
| Recovery required | towing/recovery record, recovery cost | 11 Downtime, 13 Cost |
| Vehicle off road | off-road start, expected return, operational status | 11 Downtime |
| Replacement vehicle required | replacement allocation card | 11 Downtime |
| Internal repair | internal workshop, labour hours, parts request, repair cost | 8, 9, 10 |
| External repair | workshop, vendor quotation, repair estimate, PO requirement, vehicle-movement date, expected completion, vendor contact, insurer-approval requirement (brief §8 example) | 8, 10 |
| Insurer-approved workshop | insurer-approval gate before repair | 8, 16 |
| Dealer repair | dealer, dealer quotation | 8 |
| Total-loss possibility | total-loss approval, asset-deactivation, disposal/transfer | 6, 7, 13 |
| Driver statement received | statement upload/attach | 2 Incident, 3 Evidence |
| Liability disputed | dispute reason, legal-review flag, unlock-requires-approval | 5 Liability |
| Legal review required | legal-reviewer assignment, legal-hold pause reason | 5, 16 |
| Environmental damage | environmental-damage detail, property photo slot | 4, 5 |
| Customer property damaged | customer-property detail, third-party recovery | 4, 13 |
| Rental vehicle / Leased vehicle | rental/lease agreement, lessor contact | 2, 13 |
| Subcontractor vehicle | subcontractor party + liability routing | 4, 5 |
| Corrective action required | corrective-action creation (CAPA) | 14 Corrective Actions |
| Additional repair approval required | revised-approval task + cost delta | 9, 16 |
| Vehicle repair rejected | rectification tasks, reject remarks | 12 Handover |
| Case reopened | reopen reason, new owner, new due date (managers only) | 16, 18 |

Rule: a toggle **never** unlocks closure. Closure is the three-level gate (brief §3/§8),
enforced on the Overview/closure logic, not a switch.

---

## 6. Visual / UX rules to follow (brief §12.5)

- **Sticky case header** always visible; tab strip sticky beneath it.
- **Cards, status chips, progress bars, timeline views** — reuse `.card`, `.badge`,
  the `CaseProgressPanel` ladder, and the existing timeline pattern.
- **Action-focused buttons** — primary action per tab is obvious; secondary/tertiary de-emphasised.
- **Skeleton loading** for the header and each tab panel (never a blank flash).
- **Empty states with guidance** — every list/queue uses `EmptyState` with a `reason`
  and, where useful, an `action` (repo rule: "no rows matched" and "we could not look"
  must read differently).
- **Error states with Retry** — every fetch surfaces `toUserMessage(err)` + a Retry
  button (never a raw DB error).
- **Confirmation dialogs** for important/irreversible actions (approve, reject, close,
  reopen, mark Not applicable, delete-blocked→cancel).
- **Unsaved-change warning** — dirty draft on any tab guards navigation (in-app confirm
  + `beforeunload`).
- **Tooltips** on complex fields (liability %, SLA pause, route-based completion).
- **Accessible contrast** — token-driven; verified in both light and dark themes
  (`html.light` overrides already exist).
- **Responsive** — 3-column header collapses to stacked chips; tab strip wraps/scrolls;
  tables scroll inside their own container (body never scrolls horizontally); mobile is
  the wizard, not the 18-tab screen.
- **RTL / Arabic** — mirror layout via `isRTL`; every user-facing string via `t()`;
  no em/en dashes (repo rule — use ASCII, `N/A` not a dash).

### Avoid (brief §12.5)

- Long unstructured forms → the case is 18 scoped tabs + one controlled form, never one
  100-field page.
- Excessive popups → prefer inline panels/drawers; the few modals are confirmations and
  the photo-exception flow.
- Too many fields on one screen → each tab shows only its workstream's fields.
- Manual typing when the data exists → auto-fill from the fleet master (asset → plate /
  type / site / country / driver), reuse `applyAssetMaster`/`applyAsset`.
- Duplicate data entry → one write path per field (stage-scoped `saveStageFields`).
- Statuses users cannot understand → show human stage labels (`stageLabel`), never raw
  tokens; **status is derived from completed actions, not free-chosen from a dropdown**
  (brief §5, §12.5).
- Technical system terms in user-facing screens → plain labels; internal tokens stay
  in the audit tab only.

---

## 7. Implementation map (where each piece lands)

| Piece | New/Extend | File (proposed) |
|---|---|---|
| Case screen route | Extend existing `/accidents/:id` | `src/components/AccidentDetailModal.jsx` → grows to 18-tab `AccidentCaseScreen` (or new `src/pages/AccidentCase.jsx`) |
| Sticky case header | New | `src/components/accidents/CaseHeader.jsx` |
| Tab panels | New per workstream; reuse `CaseProgressPanel` for stage-field writes | `src/components/accidents/tabs/*.jsx` |
| Per-tab counters | New (single `case_tasks`+`sla_instances` read) | `src/lib/accidentCaseCounters.js` (pure) |
| Route-based completion | Extend `caseProgress()` | `src/lib/accidentStages.js` (route-aware) |
| Team Inbox | New landing block + `/accidents/inbox` | `src/components/accidents/TeamInbox.jsx`; reuse `ClaimProgressBoard` |
| Mobile wizard | Refactor single screen → 5-step stepper | `mobile/app/(app)/accident/report.tsx` (+ step components) |
| Photo checklist | Extend `AccidentPhotoGrid` categories → positional required slots | `mobile/components/AccidentPhotoGrid.tsx` |
| i18n | Add `accident.wizard.*` (en + ar) | `mobile/locales/en.json`, `mobile/locales/ar.json` |

**Preserved and untouched:** `Accidents.jsx` Incidents/Analytics/Report-Builder tabs,
`AccidentReportBuilder.jsx`, `AccidentIntelligencePanel.jsx`, `ClaimProgressBoard.jsx`
(reused, not modified beyond optional embed), the report-email pipeline, and the
existing `REPORT_ACCIDENT` offline command contract (extended only by adding the new
photo categories to its allow-list, never breaking it).
