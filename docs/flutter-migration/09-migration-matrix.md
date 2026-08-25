# 09. Migration matrix

Artifact 9 of the nine required by section 75 of the Flutter migration spec, and
the last of them. Artifacts 01-08 describe WHAT exists. This one decides, per
feature, **how it crosses over** and **in what order**, in the six axes section
75 names: source logic, corrections, backend, Flutter target, offline strategy,
tests.

It deliberately does not restate artifact 01. Where a fact is already recorded
there, this file carries only the DECISION.

---

## 1. The four verdicts

Every feature gets exactly one.

| Verdict | Meaning |
|---|---|
| **PORT** | Behaviour is correct. Move it, keep it identical, pin it with a parity test |
| **PORT + CORRECT** | Behaviour is correct but something adjacent is wrong - a fabricated figure in the Kotlin build, a payload column that does not exist, a duplicated package. Port the RN behaviour, do not reproduce the defect |
| **REDESIGN** | The current behaviour is wrong in a way that cannot be carried. Decide the new rule before writing code |
| **BLOCKED** | Depends on something not yet applied or not yet decided. Do not start |

Spec section 75 closes with the rule this table serves: *Do not remove existing
production behavior unless there is evidence that it is broken or the product
owner explicitly changes the requirement.* So PORT is the default, and every
other verdict below names its evidence.

---

## 2. Build order

The order is dependency-driven, not importance-driven. Each wave is only
startable once the one above it holds.

**Wave 0 - the floor.** Session durability, secure storage, the Drift queue,
permissions, router, error type. Nothing else can be trusted until these are
right, and two of them carry data-loss history (section 5).

**Wave 1 - inspections.** The reason the app exists and the heaviest offline
surface: a four-step wizard, an interactive tyre diagram, a completeness gate
and a queued submit. It exercises every Wave 0 component under real load, so
building it second is what proves the floor.

**Wave 2 - checklists.** The dynamic form engine, the draft store and the
approval ladder. Second-heaviest, and where the one REDESIGN lives.

**Wave 3 - field capture.** Meter logs, washing, accidents, repair request. All
queued, all observations, all structurally similar once Wave 0 exists.

**Wave 4 - workshop and work orders.** Includes the consolidation in section 4.

**Wave 5 - read surfaces.** Registers, alerts, overview, calendar, notifications.

**Wave 6 - admin, reports, analytics, AI.** Admin-only, online-only, lowest
field risk, and the largest concentration of Kotlin fabrications to NOT
reproduce.

---

## 3. The matrix

The Offline column uses artifact 06 vocabulary: QUEUED / ONLINE-ONLY / CACHED / n/a.

### Wave 0 - core

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| Session durability, secure storage | PORT + CORRECT | n/a | Port the RULES. Do NOT port the storage FORMAT - see section 5B |
| Offline queue | PORT + CORRECT | n/a | Port the registry SHAPE and all three load-bearing properties (artifact 06 section 1). Model it as a Drift TABLE, never a serialised blob - see section 5A |
| Permissions / ModuleGuard | PORT | n/a | 31-module registry. `resolveGuardedAccess` fails CLOSED for admin, users and approvals when the permission RPCs error. Keep that asymmetry, it is deliberate |
| Route guard registry | REDESIGN | n/a | `lib/routeAccess.ts` maps every deep-linkable route to its ModuleKey and is **imported by nothing**. In Flutter the router must READ it, so a deep link cannot reach a screen the sidebar would deny |
| Back navigation | PORT | n/a | Pops with history, REPLACES without, never a no-op |
| Forced update gate | PORT | n/a | Fails OPEN on every error path. Keep that - a gate that fails closed locks the fleet out of an app they cannot update |
| Login | PORT | ONLINE-ONLY | Server-enforced lockout via four RPCs |
| Register | PORT | n/a | Invite-only dead end with a Back button. Keep it so old links resolve |

### Wave 1 - inspections

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| New inspection | PORT | QUEUED | Upserts on `client_uuid` with ignoreDuplicates |
| Completeness engine | PORT | n/a | Pure, 407 lines, already test-pinned. Straight port |
| Tyre diagram engine | PORT | n/a | Parity tests are artifact 07. The resolver ORDER is load-bearing: specific rules must run before the generic catch-all |
| Inspection detail, PDF | PORT | ONLINE-ONLY / n/a | |
| Approvals queue | PORT + CORRECT | ONLINE-ONLY | Kotlin spec 2 flags `GET approvals` as fabricated. Read the real table |
| Inspection sign-off | PORT | ONLINE-ONLY | Already online-only, and correctly so - it goes through `decide_inspection_approval` |

### Wave 2 - checklists

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| Checklist fill | PORT | QUEUED | 2253 lines. Field engine, conditionals, shared option sets and per-field photos all port as-is |
| Draft store | PORT | n/a | Drafts live in their OWN folder. Section 5C says why that is not optional |
| Approval ladder | PORT | n/a | Mirrors the DB trigger `guard_checklist_approval_stages`. Mirror pair - change both together |
| **Checklist sign-off** | **REDESIGN** | **ONLINE-ONLY** | The single most important decision in this matrix. See section 6 |
| Checklist history, i18n | PORT | ONLINE-ONLY / n/a | i18n ALWAYS stores the English value. Keep that invariant |

### Wave 3 - field capture

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| Meter log | PORT + CORRECT | QUEUED | Kotlin spec 38 flags payload columns that did not exist. Write only columns artifact 02 verifies. Also collapse `feature/meters` and `feature/odometer` into ONE package |
| Vehicle washing | PORT | QUEUED | The wash-due rule is derived on-device and drives a LOCAL notification - no server cron |
| Report accident | PORT | QUEUED | A 50-column allow-list, the largest silent-strip risk in the app, and it has **no test today**. Wave 3 must add one before the port is called done |
| Accident detail, dashboard | PORT | ONLINE-ONLY | |
| Case status | PORT + CORRECT | n/a | Kotlin spec 42 invented an Assigned Officer shown for every incident. Render only real workstream rows, and degrade honestly when the case migration is absent |
| Repair request (RFR) | **BLOCKED** | QUEUED | `repair_requests` does not exist live - V608 is AUTHORED, NOT APPLIED. Classify once it settles |

### Wave 4 - workshop and work orders

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| My Jobs (workshop) | PORT + CORRECT | QUEUED | Kotlin spec 40 invented technicians, bays, job numbers and productivity. Every figure must come from `tech_activity_events` |
| Live status engine | PORT | n/a | 15 event types, 6 blocked reasons, 11 statuses, 12 actions. Pure and test-pinned |
| Corrective actions, three surfaces | **REDESIGN** | mixed | Three vocabularies, three write paths, one table. See section 4 |
| Work orders | PORT + CORRECT | QUEUED | Orphaned - nothing links to it. Kotlin spec 41 flags a route-id mismatch that crashed. Give it a real entry point or drop it deliberately, not by accident |
| Preventive maintenance | PORT | ONLINE-ONLY | Deliberately online-only: `record_pm_service` is transactional and role-gated. Do not queue it |
| RCA | PORT | QUEUED | |

### Wave 5 - read surfaces

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| Tyre records, vehicles, history | PORT | ONLINE-ONLY | Paged. Keep the paging - artifact 02 records the 1000-row cap |
| Serial search | PORT | ONLINE-ONLY | Scrap and unscrap are RPC-gated by design |
| Scanner and scan routing | PORT + CORRECT | ONLINE-ONLY | Collapse `feature/scan` and `feature/scanner` into ONE package |
| Stock count | PORT + CORRECT | QUEUED (fallback) | Kotlin spec 45 invented tyre stock at Qiddiya. The offline fallback writes an ABSOLUTE quantity and no ledger row - artifact 06 section 3 explains why that is the only safe form |
| Alerts, overview, calendar, report-issue, analytics | PORT | ONLINE-ONLY | The spec names no Flutter package for these five. Assign one at Wave 5 rather than leaving them homeless |
| Notification inbox | PORT + CORRECT | ONLINE-ONLY | Kotlin spec 2 flags the mark-read endpoint as fabricated. Mark-read writes the real table |

### Wave 6 - admin, reports, AI

| Feature | Verdict | Offline | The decision |
|---|---|---|---|
| Admin console, users, sites, access, approvals | PORT + CORRECT | ONLINE-ONLY | Kotlin spec 45 invented four sites. All five are RPC-driven; keep them so |
| Reports, analytics | PORT | ONLINE-ONLY | Both read ONE server aggregate. Currency is NEVER blended: on the All-countries view cost arrives null, the screen renders N/A and ranks by volume. Unrated tyres are stated separately, never folded into Low |
| Fleet AI, admin AI chat | PORT + CORRECT | ONLINE-ONLY | Kotlin spec 49 flags hard-coded predictions, an invented budget and an invented confidence percentage. Render only what the edge function returns |
| Saved signature | PORT + CORRECT | ONLINE-ONLY | Kotlin spec 21 stored a placeholder STRING instead of a signature. Store the drawn mark |
| PDF generation | PORT | n/a | Rendered LOCALLY and shared. Kotlin spec 48 covers the generator |

---

## 4. The clearest consolidation target

Three surfaces read `corrective_actions`:

| Surface | Label | Write path |
|---|---|---|
| `workorders/index.tsx` | Work Orders | QUEUED via `CORRECTIVE_ACTION_STATUS` |
| `tasks.tsx` | Tasks | **Direct update** - not queued, same table |
| `report-issue.tsx` | Report an issue | QUEUED via `REPORT_ISSUE`, write-only |

Three vocabularies and two different offline postures on ONE table. A technician
resolving a task from `tasks.tsx` with no signal loses the write; the same
transition from `workorders/index.tsx` survives. That asymmetry is invisible in
the UI and is exactly what a rewrite should not carry across.

**Decision: one `features/work_orders` package with ONE status vocabulary and
ONE queued write path.** Keep three ENTRY POINTS if the product wants them; do
not keep three engines.

---

## 5. Structural requirements the Flutter design must make impossible

These are not features. They are shapes that must be wrong by construction.

**A. An empty read that means two different things.** RECORDED: `getQueue()`
returned an empty list for both nothing-is-queued and storage-refused, and ten
callers then SAVED what they read - replacing a worker's unsynced inspections
with an empty list, silently, with the only copy on that device. In Flutter a
read failure must be an ERROR TYPE, not an empty list, and the queue must be a
Drift table, never a serialise-and-write-back blob.

**B. A storage format that is not rollback-safe.** RECORDED: the chunked format
is forward-compatible but not backward. Flutter starts clean, so version the
on-device format from day one and decide the downgrade policy before shipping.

**C. Draft photos are not queue photos.** The orphan sweep deletes any queued
photo that no QUEUE ENTRY references, and a draft is not a queue entry. Drafts
need their own retained folder, or the next sync deletes the operator's work.

**D. Photo uploads must be bounded.** RECORDED: a parallel decode over every
tyre position handled 13 full-size bitmaps at once and hard-crashed 2 GB
handsets - and the queue then REPLAYED the crash.

---

## 6. The one REDESIGN, stated plainly

`CHECKLIST_APPROVAL` is currently a queued blind update on
`checklist_submissions` matched by id.

An approval is a **decision**, not an observation, and three things make it
unqueueable:

1. A checklist's closability depends on its own answers. A single blocking fault
   mark must refuse closure, and the DATABASE enforces that at approval time
   with a trigger - so a queued approval can be accepted by the phone and then
   refused by the server, with the operator already told it succeeded.
2. The approver's identity and permission must be re-checked server-side at the
   moment of the write.
3. `decide_checklist_approval` exists precisely to enforce the rungs and the
   signature, and the queued path walks straight past it.

**Flutter must route approvals through the RPC and refuse to queue them.**

Reported, not patched. The Expo app is production and these artifacts are an
audit.

---

## 7. Open, and owned by someone else

| Item | Blocked on |
|---|---|
| Repair request (RFR) | V608 applied to the live database |
| Five features with no named Flutter package | A package assignment at Wave 5 |
| Accident form parity test | Wave 3 - it is the highest-volume capture surface and has none |
| Live schema re-verification | The Supabase connector was unauthenticated when artifacts 01-09 were written. Every row marked UNVERIFIED needs one pass against the live database before Wave 0 starts |
