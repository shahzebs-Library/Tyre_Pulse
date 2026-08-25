# 06. Offline command registry

Artifact 6 of the nine required by section 75 of the Flutter migration spec.
Sources: `mobile/lib/recordQueue.ts` (801 lines) and `mobile/lib/offlineQueue.ts`
(200 lines). Everything below is VERIFIED from those files unless marked.

The existing design is good and Flutter should port its SHAPE, not reinvent it.
Three properties are load-bearing and must survive the rewrite.

---

## 1. The three properties that must survive

**A. One table-name registry.** `COMMANDS` is described in the source as "the
ONLY place a table name may appear on the client". Every queued write goes
through it. Flutter must keep exactly one such registry - scattering table names
across repositories is how the Kotlin app drifted into inventing endpoints.

**B. A field allow-list per command.** Each spec carries `fields`, and anything
not listed is DROPPED before the write. The comment states why: fields are
restricted to columns that actually exist on the live schema, so a stripped
payload never fails an insert on an unknown column. A column PostgREST cannot
find fails the WHOLE request, so this is what stops one stray key killing a
field worker's whole sync.

**C. Idempotency is per command, and the default is ON.** `isIdempotent()`
returns `COMMANDS[type].idempotent !== false`. An insert upserts on a stable
`client_uuid`, so a lost response or a crash never double-inserts. The target
table must carry a `client_uuid` column plus a unique index.

The `idempotent: false` escape hatch exists in the helper but **no command uses
it**. CORRECTED 2026-08-25 while writing artifact 05: an earlier draft of this
file recorded `WORKSHOP_EVENT` as the exception. It is not. Re-verified from
source - the `WORKSHOP_EVENT` spec at `mobile/lib/recordQueue.ts:247` carries
only `table` and `fields` and no flag, and
`MIGRATIONS_V292_TECH_EVENTS_CLIENT_UUID.sql` added `client_uuid` plus a unique
index to `tech_activity_events` for exactly this reason, its own header stating
the goal is that "every event is at-most-once".

So all 16 commands are idempotent as shipped. Flutter should treat idempotency
as mandatory and keep the opt-out only if a genuinely append-only table with no
`client_uuid` ever appears.

---

## 2. The 16 commands

| Command | Table | Op | Match | Notes |
|---|---|---|---|---|
| `TYRE_CHANGE` | `tyre_records` | insert | n/a | Widest allow-list; carries photos |
| `WORK_ORDER` | `work_orders` | insert | n/a | |
| `RCA` | `rca_records` | insert | n/a | |
| `REPORT_ISSUE` | `corrective_actions` | insert | n/a | |
| `STOCK_ADJUST` | `stock_records` | update | `id` | Absolute value, not a delta - see section 3 |
| `WORK_ORDER_STATUS` | `work_orders` | update | `id` | |
| `CORRECTIVE_ACTION_STATUS` | `corrective_actions` | update | `id` | |
| `CHECKLIST_SUBMISSION` | `checklist_submissions` | insert | n/a | Carries a keyed photo map |
| `CHECKLIST_ASSIGNMENT_STATUS` | `checklist_assignments` | update | `id` | |
| `CHECKLIST_APPROVAL` | `checklist_submissions` | update | `id` | **See section 4 - this one is wrong to queue** |
| `ODOMETER_LOG` | `odometer_logs` | insert | n/a | Advances `vehicle_fleet.current_km` via trigger |
| `ENGINE_HOURS_LOG` | `engine_hours_logs` | insert | n/a | |
| `REPORT_ACCIDENT` | `accidents` | insert | n/a | `accidents.client_uuid` added specifically so a replay is idempotent |
| `WASH_RECORD` | `wash_records` | insert | n/a | `client_uuid` + unique index |
| `WORKSHOP_EVENT` | `tech_activity_events` | insert | n/a | Idempotent. `client_uuid` + unique index added by V292 - see the correction in section 1 |
| `REPAIR_REQUEST` | `repair_requests` | insert | n/a | **UNVERIFIED as shipped**: the table is created by `MIGRATIONS_V608_REPAIR_REQUEST_RFR.sql`, which is UNTRACKED in-flight work from a parallel session at the time of writing |

An `update` command excludes the match column from the SET clause, so the
primary key is never rewritten. Flutter must preserve that.

---

## 3. Why STOCK_ADJUST is safe to queue

The source notes it is idempotent "because callers send absolute values (e.g. the
new quantity)". A DELTA would not be: replaying "subtract 3" twice subtracts six.

**Rule for Flutter: a queued mutation must be expressed as a desired END STATE,
never as an increment.** Any new command that cannot be phrased that way is
online-only.

---

## 4. Spec section 14 applied - queueable vs online-only

Spec section 14 is "Do Not Offline-Queue Unsafe Decisions". The rule used here:

> A command may be queued only if its validity can be decided from what the
> phone already holds. If correctness depends on server state the device cannot
> see, or on a permission the server must re-check at the moment of the write,
> it is online-only.

| Command | Verdict | Reason |
|---|---|---|
| `TYRE_CHANGE`, `ODOMETER_LOG`, `ENGINE_HOURS_LOG`, `WASH_RECORD`, `REPORT_ACCIDENT`, `RCA`, `REPORT_ISSUE`, `WORK_ORDER`, `CHECKLIST_SUBMISSION`, `WORKSHOP_EVENT` | QUEUEABLE | An OBSERVATION. The technician saw it; the server cannot contradict what was observed in the field |
| `STOCK_ADJUST` | QUEUEABLE | Absolute value (section 3) |
| `WORK_ORDER_STATUS`, `CORRECTIVE_ACTION_STATUS`, `CHECKLIST_ASSIGNMENT_STATUS` | QUEUEABLE WITH CARE | A blind patch-by-id can overwrite a decision someone else made while the phone was offline. Flutter should carry the expected prior status and let the server refuse a stale transition rather than silently clobber |
| `CHECKLIST_APPROVAL` | **SHOULD BE ONLINE-ONLY** | An approval is a DECISION, not an observation. Three reasons, all recorded in PROJECT_MEMORY: a checklist's closability depends on its own answers and a single blocking fault mark must refuse closure; the database enforces that at APPROVAL time with a trigger, so a queued approval can be accepted by the phone and then refused by the server; and the approver's identity and permission must be re-checked server-side. The correct path is the `decide_checklist_approval` RPC while online |
| `REPAIR_REQUEST` | UNVERIFIED | Parallel in-flight work. Classify once V608 settles |

**This is the single most important finding in this artifact.** `CHECKLIST_APPROVAL`
is currently a queued blind `update` on `checklist_submissions` matched by `id`,
which bypasses the RPC that exists precisely to enforce the rungs and the
signature. Flutter must route approvals through the RPC and refuse to queue them.
Report before changing: the Expo app is production and this document is an audit,
not a patch.

---

## 5. Two data-loss traps the Flutter design must make impossible

**A. An empty read that means two different things.** RECORDED in PROJECT_MEMORY:
`getQueue()` and `getRecordQueue()` returned `[]` for BOTH "nothing is queued" and
"secure storage refused the read", and TEN callers then SAVED what they had read.
One bad read replaced a worker's unsynced inspections and accident reports with an
empty list, silently, with the only copy on that device.

The Expo fix was to report WHY a read was empty (ok / absent / unreadable / torn)
and refuse every read-modify-write unless the read genuinely succeeded. The stated
trade is deliberate: risk failing to save ONE new item rather than silently
destroying ALL of them.

**In Flutter this must be structural, not a convention.** Drift is a real database,
so model the queue as a table and never as a serialise-whole-list-and-write-back
blob. A read failure must be an error type, not an empty list.

**B. A storage format that is not rollback-safe.** RECORDED: the chunked secure
storage writes `${key}_g${gen}_chunk_${i}` with metadata `{chunks, gen}`; an older
build reads `${key}_chunk_${i}` and ignores `gen`. Upgrading is safe, DOWNGRADING
is not - a rolled-back device signs the user out AND reads a full offline queue as
empty, then overwrites it.

Flutter starts clean, so define the on-device format WITH a version field from day
one and decide the downgrade policy before shipping, not after.

---

## 6. Photos

Photo handling is its own subsystem (spec 19-20) and interacts with the queue.
RECORDED traps worth carrying into the Drift design:

- `sweepOrphanQueuedPhotos` deletes any queued photo no QUEUE ENTRY references. A
  DRAFT is not a queue entry, so a naive implementation deletes the operator's
  draft photos on the next sync. Drafts need their own retained folder.
- Photos are stored as a keyed MAP for checklists (`{fieldId: [uris]}`) and a flat
  ARRAY elsewhere. Code that assumes `Array.isArray` silently skips the map form.
- Uploads must be BOUNDED in parallelism. RECORDED: a `Promise.all` over every tyre
  position decoded 13 full-size bitmaps at once and hard-crashed 2 GB handsets,
  and the offline queue then REPLAYED the crash.
