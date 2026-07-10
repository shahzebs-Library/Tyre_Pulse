# Universal Approval & Workflow Engine — Spec & Implementation Plan

> **Priority: P0 (top of roadmap).** This is the single highest-leverage platform
> capability for Tyre Pulse as a commercial SaaS: one configurable engine that
> powers approvals for *every* current and future module, so no customer ever
> needs bespoke workflow code.

---

## 1. Vision

Do **not** hardcode approval logic per module. Build **one universal Approval &
Workflow Engine**. Every module asks the engine the same questions:

- Which workflow applies to this document?
- Who is the next approver?
- Is a signature required at this step?
- Is a photo mandatory? Is GPS required? Are comments mandatory?
- Is the document complete / ready to advance?

The same engine powers daily inspections, tyre replacements, accidents, purchase
requests, warranty claims, and 20+ other processes — configured, not coded.

### Reference flows the engine must express (config, not code)

**Daily Vehicle Inspection** — Tyre Man completes checklist → mandatory photos →
pressure → tread depth → Tyre Man signature → Inspector/Supervisor review →
Inspector signature → *Pass?* Yes → Approved · No → **Return with comments** →
optional Fleet Supervisor review → Final approval → **Inspection locked**.

**Tyre Replacement** — Tyre Man requests → damage photos → reason → Supervisor
approval → Store Keeper issues tyre → installed → Tyre Man signature → Inspector
verification → optional Fleet Manager approval → Completed.

**Accident** — Driver reports → photos → GPS → workshop inspection → estimate →
insurance approval → repair → final inspection → vehicle released.

**Purchase Request** — Tyre Man → Store Keeper → Workshop Manager → Procurement →
Finance → GM → Purchase Order.

### Digital signature block (every approval step)

`Approved By · Printed Name · Role · Signature image · Date · Time · Location
(GPS, optional) · Device info · Comments · Photo attachment · Voice note (future).`

### Status set (must support all six)

🟢 Approved · 🟡 Pending · 🔵 In Review · 🔴 Rejected · 🟠 Returned for Correction · ⚫ Cancelled

### Smart rules (conditional routing, no code changes)

- `tyre pressure < minimum` → require Supervisor approval step.
- `replacement cost > 5,000 SAR` → require Fleet Manager approval.
- `downtime > 48 h` → require Operations Manager approval.
- `accident is major` → require Insurance approval.

### Visual workflow builder

Admin drags & drops steps (Start → role → role → … → Complete). Every customer
builds their own chain per entity type. No developer involvement.

### Approval dashboard (one manager page)

Pending · Overdue · Rejected · Returned · Recently approved · Approval time · SLA status.

### Notifications at every stage

In-app · Email · WhatsApp · Push — e.g. *"Vehicle ABC-123 inspection is awaiting
your approval."*

### Immutable audit trail

Every action timestamped and permanent (created, signed, approved, returned,
locked). **Nothing is ever deleted from history.**

### Modules that must use the engine

Daily vehicle inspections · Tyre inspections · Tyre replacements · Tyre scrapping ·
Warranty claims · Accident reports · Job cards · Maintenance requests · Purchase
requests · Purchase orders · Goods received notes · Tyre issuance · Tyre returns ·
Tyre transfers · Vehicle handover · Vehicle return · Fuel exception reports ·
Driver violation reports · Workshop quality inspections · PM service completion ·
Vendor invoices · Asset disposal · Document approvals · Executive report publishing.

---

## 2. What already exists (build ON this — do not rebuild)

The Automation Platform (migrations **V97 Workflow Engine**, **V100 Business Rules**,
V96 domain events, applied live) already provides a real backbone:

| Capability | Status | Where |
|---|---|---|
| `workflow_definitions` (org-scoped, `entity_type`, `trigger_event`, `steps` jsonb, `active`) | ✅ | V97 |
| `workflow_instances` (status pending/approved/rejected/cancelled, `current_step`, steps snapshot, `context`) | ✅ | V97 |
| `workflow_step_events` (immutable audit: started/approved/rejected/escalated/cancelled, actor, comment) | ✅ | V97 |
| RPCs `start_workflow` / `workflow_act` / `workflow_cancel` / `my_pending_approvals` | ✅ | V97 |
| Auto-start on domain event (`consume_event_workflows`) + SLA escalation cron (`escalate_overdue_workflow_steps`) | ✅ | V97 |
| Org-scoped role notifications (`notify_role_in_org` → in-app `notifications`) | ✅ | V97 |
| Business Rules Engine (condition → action) | ✅ | V100 |
| Admin pages: `Approvals`, `WorkflowSettings`, `AutomationRules`, `EventStream`, `Integrations` | ✅ | src/pages |
| API client `src/lib/api/workflows.js`, `businessRules.js`, `domainEvents.js` | ✅ | src/lib/api |
| `SignaturePad` component + inspection signature capture | ✅ | src/components/SignaturePad.jsx |
| Feature-flag gate `automation_platform` (currently ON) | ✅ | src/lib/featureFlags.js |

---

## 3. Gap analysis (spec vs. current engine)

| # | Spec requirement | Current | Gap |
|---|---|---|---|
| G1 | Approvers: Tyre Man, Inspector, Store Keeper, Fleet Supervisor, Procurement, Finance, GM, PMV/Operations Manager… | Steps allow only `admin/manager/director` (`validate_workflow_steps`) | **Expand allowed approver roles** + allow assigning a specific **user** or **role**, not just three roles |
| G2 | Per-step requirements: signature, photo (mandatory), GPS, comment mandatory, printed name, device info | Step = `{name, approver_role, sla_hours}`; no requirement flags; act captures only `comment` | **Richer step schema** + capture columns on `workflow_step_events` (`signature_data`, `photo_urls[]`, `gps`, `device_info`, `printed_name`, `require_*` enforcement) |
| G3 | Six statuses incl. **In Review** and **Returned for Correction** | Only pending/approved/rejected/cancelled | Add `in_review` + `returned`; add a **`return` action** (send back to a prior step with mandatory comment) to `workflow_act` |
| G4 | Smart conditional routing (pressure/cost/downtime/severity thresholds pick steps) | Linear `current_step++`; Business Rules exist but not wired to insert/skip workflow steps | **Conditional steps** (`condition` per step, evaluated against instance `context`) + rules that inject/skip steps at start |
| G5 | Visual drag-&-drop workflow builder | `WorkflowSettings` is a form (no DnD) | **DnD step builder** (reuse `@dnd-kit` or `@tanstack`), per-step requirement toggles, condition editor, live preview |
| G6 | Approval dashboard: pending/overdue/rejected/returned/recently approved/approval-time/SLA | `Approvals` page + `my_pending_approvals` (pending only) | Extend RPC + page to **all buckets + SLA/overdue + avg approval time metrics** |
| G7 | Notifications: in-app **+ email + WhatsApp + push** | In-app ✅; email/push partial; WhatsApp ✗ | Fan-out on each transition to email (send-email fn), push (Expo tokens), **WhatsApp (Twilio)** |
| G8 | **Every module** starts a workflow on submit and locks on completion | `start_workflow` wired in **no** operational page yet | **Integrate the engine into each module** (submit → start_workflow; block edits while pending; lock on approved) |
| G9 | Signature block on printed/PDF documents | Report engine exists; no signature block | Render the approval/signature chain into the module PDF (reuse report engine) |
| G10 | Mobile parity (Tyre Man/Inspector act & sign in the field) | Mobile app exists; no workflow acts | Mobile: pending approvals, act + capture signature/photo/GPS |

---

## 4. Target data model (extends V97)

**`workflow_definitions.steps[]`** — extend each step object:

```jsonc
{
  "name": "Inspector Review",
  "assignee_type": "role",            // "role" | "user"
  "approver_role": "inspector",       // any app role (expanded set)
  "approver_user_id": null,           // when assignee_type = "user"
  "sla_hours": 24,
  "require_signature": true,
  "require_photo": false,
  "require_gps": false,
  "require_comment_on_return": true,
  "allow_return": true,               // can send back for correction
  "optional": false,                  // "optional" steps can be skipped
  "condition": {                      // step runs only if this evaluates true
    "field": "replacement_cost", "op": ">", "value": 5000
  }
}
```

**`workflow_step_events`** — add capture columns (all nullable, append-only):
`signature_data text` (data URL), `printed_name text`, `photo_urls text[]`,
`gps jsonb` (`{lat,lng,accuracy}`), `device_info jsonb`, plus a new `action`
value **`returned`**.

**`workflow_instances.status`** CHECK → add `in_review`, `returned`.
Add `returned_to_step int`, `last_actor_id uuid`.

New **`workflow_signatures`** view (or reuse step_events) for the PDF signature block.

All changes are **additive & backward-compatible** — existing definitions keep working.

---

## 5. Implementation plan (phased)

### Phase 0 — Foundations (DB, additive)
- **V116**: expand `validate_workflow_steps` (new roles, `assignee_type`, requirement
  flags, `condition`); add capture columns to `workflow_step_events`; add
  `in_review`/`returned` statuses + `returned_to_step`.
- **V117**: `workflow_act` gains `return` action (→ jumps to `returned_to_step`,
  status `returned`, mandatory comment) and enforces per-step `require_*` (rejects
  the act server-side if a required signature/photo/GPS/comment is missing —
  security boundary, never trust the client). `condition` evaluation on advance
  (auto-skip steps whose condition is false).
- **V118**: `approval_dashboard()` RPC (buckets + SLA/overdue + avg approval time,
  org-scoped); extend `my_pending_approvals` to include the acting user's role and
  specific-user assignments.
- Verify each migration live via Supabase MCP (pre-flight prereqs; smoke test).

### Phase 1 — Engine services + shared UI
- Extend `src/lib/api/workflows.js`: `returnWorkflow`, `actOnWorkflow` with
  `{signature, printedName, photos, gps, deviceInfo}`; `getApprovalDashboard`.
- New `src/lib/workflow/` client: `resolveWorkflow(entityType, context)`,
  `stepRequirements(step)`, `evaluateCondition(cond, context)` (pure, unit-tested).
- Shared **`<ApprovalAction>`** component: signature (reuse `SignaturePad`), photo
  upload, auto-GPS (`navigator.geolocation`), comment, device info — enforces the
  step’s requirements before enabling Approve/Return/Reject.
- Shared **`<ApprovalTrail>`** component: the immutable timeline + signature block.
- Shared **`<ApprovalStatusBadge>`**: the six statuses with the spec’s colours.

### Phase 2 — Visual workflow builder
- Rebuild `WorkflowSettings` as a **drag-&-drop builder** (`@dnd-kit/sortable`):
  add/reorder/remove steps, per-step assignee (role or user) + requirement toggles
  + SLA + condition editor, live linear preview, validation, activate/deactivate,
  clone, seed **starter templates** for the four reference flows.

### Phase 3 — Approval dashboard + notifications fan-out
- Rebuild `Approvals` into the manager dashboard (all buckets, SLA/overdue,
  approval-time, filters, bulk act). Wire `<ApprovalTrail>` into a detail drawer.
- Notification fan-out edge function `workflow-notify` (consumes
  `workflow.*` domain events → email via send-email, push via Expo tokens,
  **WhatsApp via Twilio**). In-app already covered. Env-gated per channel.

### Phase 4 — Module rollout (the payoff)
Wire the engine into modules in value order, each: *submit → `start_workflow`*,
*block edits while `pending/in_review/returned`*, *lock on `approved`*, *show
`<ApprovalTrail>` + `<ApprovalAction>`*, *signature block in the module PDF*.
1. Daily/tyre **Inspections** (highest volume) → 2. **Tyre Replacement/Issuance** →
3. **Accidents** → 4. **Purchase Request/PO/GRN** → 5. Warranty, Job Cards,
Maintenance, Scrapping, Transfers/Returns, Vehicle Handover → 6. remaining list.
A generic **`useEntityWorkflow(entityType, entityId, context)`** hook makes each
module wiring a few lines.

### Phase 5 — Mobile parity + polish
- Mobile: pending approvals list, act with signature/photo/GPS capture, offline-queue
  the act (reuse `offlineQueue`). Voice note (future) stub.

---

## 6. Architecture principles

- **One engine, many modules.** Modules never implement approval logic — they call
  `start_workflow` and render shared components. New modules cost ~10 lines.
- **Server-authoritative.** All requirement enforcement, role checks, transitions,
  and locking live in SECURITY DEFINER RPCs + RLS. The client UI is convenience only.
- **Append-only history.** `workflow_step_events` is never updated or deleted;
  status transitions are new rows. Satisfies audit/compliance.
- **Additive migrations.** Every DB change is backward-compatible; existing
  definitions and the live `automation_platform` flag keep working.
- **Multi-tenant.** Everything org-scoped via `app_current_org()` + existing RLS.
- **Config over code.** Roles, steps, requirements, conditions, SLAs, notification
  channels — all data, editable by an admin, zero deploys.

---

## 7. Acceptance criteria

- An admin can build the four reference flows in the visual builder with no code.
- A step can require signature + photo + GPS + comment, and the server **rejects**
  an act missing any required item.
- “Return for Correction” sends the document back to a prior step with a mandatory
  comment; the initiator is notified; history preserved.
- Conditional steps auto-include/skip based on `context` (e.g. cost > 5,000 → GM step).
- Approval dashboard shows pending/overdue/returned/rejected/recently-approved with
  SLA and average approval time.
- Notifications fire on every transition across in-app/email/push/WhatsApp.
- At least Inspections + Tyre Replacement + Accidents + Purchase Request run fully
  on the engine end-to-end (web + mobile act/sign), with a signed PDF.
- Full test suite green; migrations verified live; no regressions to existing pages.

---

## 8. Rollout & risk

- Ship behind the existing `automation_platform` flag; enable per-tenant.
- Each module integration is independently shippable and reversible.
- Seed starter templates so customers get value on day one, then customise.
- Backfill: existing in-flight documents are unaffected (engine opt-in per module).
```
