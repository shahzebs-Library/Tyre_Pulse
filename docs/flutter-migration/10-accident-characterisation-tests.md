# 10. Accident characterisation tests

Artifact 10, written to satisfy the Phase 9 entry gate in
`docs/flutter-migration/09-migration-matrix.md`: "characterisation tests
written against the current Expo accident flow. This phase cannot start on
test parity because there is no test to have parity with." Risk R3 in the same
file names the cause: two feature areas ship with zero behaviour-pinning
tests, and one of them is a 1,235-line form. Artifact 01 section 5 confirms it
independently - of 13 feature areas, 11 carry at least one test; accidents and
assets/scanning are the two with none.

This file does for the CURRENT Expo accident flow what artifacts 07 and 08 did
for the tyre diagram and the checklist engine: it reads the real production
source in full and pins down what it actually does, as a numbered set of test
cases with a file-and-line citation for every rule. It is modelled directly on
those two files' structure and discipline, using artifact 08's per-group
letter-prefixed numbering (`A1`, `A2`, ... `B1`, ...) because this feature has
more independent behavioural concerns than either prior parity suite.
**Every rule carries the file and line that proves it.** Nothing here is a
recommendation for what the Flutter version SHOULD do differently - where the
current app is inconsistent with itself, that inconsistency is recorded as a
fact for whoever builds Phase 9 to make a deliberate decision about, not
silently resolved in this document.

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (`mobile/` source only - no live database check was possible in this session) |
| RECORDED | A figure or decision quoted from another artifact or PROJECT_MEMORY |
| UNVERIFIED | Needs a live database check - the CHECK constraints, RPC bodies and server-side role enforcement behind these screens were not inspected |

Everything below is VERIFIED unless marked otherwise.

## Source files read in full

| File | Lines | Role |
|---|---|---|
| `mobile/app/(app)/accident/report.tsx` | 1,235 | The incident creation form. Seven sections, offline-safe |
| `mobile/app/(app)/accident/[id].tsx` | 771 | Detail view: status change, delete, audit trail, PDF export, mounts the claims panel |
| `mobile/app/(app)/accident/dashboard.tsx` | 507 | List/register: KPI tiles, severity chart, filters, search |
| `mobile/app/(app)/accident/case.tsx` | 253 | Read-only workflow/workstream view, distinct from `[id].tsx` |
| `mobile/lib/accidentCase.ts` | 179 | Pure domain mirror of the web case/workstream model. Powers `case.tsx` |
| `mobile/lib/accidentPdf.ts` | 144 | On-device PDF export of one accident |
| `mobile/components/AccidentClaimsPanel.tsx` | 983 | Closure workflow, claim/responsibility edit, parts ledger, case log. Mounted inside `[id].tsx` |
| `mobile/components/AccidentPhotoGrid.tsx` | 469 | Categorised evidence capture: five single-document slots plus a multi-photo accident section |
| `mobile/lib/types.ts` (relevant slice, lines 55-420) | - | `AccidentRecord` and the supporting unions/label maps every other file imports |
| `mobile/lib/recordQueue.ts` (relevant slice) | - | The `REPORT_ACCIDENT` offline command definition |
| `tyre_pulse_flutter/lib/core/sync/command_registry.dart` (read-only cross-check, not edited) | - | Already declares `reportAccident` with a 54-field allow-list, matching what this document independently counted from `recordQueue.ts` |

Cross-checked against `docs/flutter-migration/01-feature-inventory.md` section
2.8 and `docs/flutter-migration/06-offline-command-registry.md` sections 1-3
for consistency; divergences from those two artifacts are called out by name
where found (section 11).

---

## 1. The vocabulary problem: three columns are typed narrower than what is actually written

This is the single most important finding in this document, and it is the
same class of defect artifact 07 found in the tyre-position vocabulary: **a
TypeScript type in `lib/types.ts` records an earlier, narrower vocabulary, and
the form that actually writes the row uses a wider one it maps through its own
`toDb*` function.** Unlike the tyre-position case, here the mismatch is not
resolved anywhere - nothing converts between the two, because the write side
and the type declaration were simply never kept in sync. A Flutter model built
from `types.ts` alone will not compile against a real row.

### 1.1 `accident_type` - typed for 7, written for 13

`AccidentType` (`mobile/lib/types.ts:168-170`):

```
export type AccidentType =
  | 'collision' | 'rollover' | 'tyre_failure'
  | 'mechanical' | 'near_miss' | 'property_damage' | 'other'
```

`report.tsx` declares thirteen (`report.tsx:76-90`):

```
ACCIDENT_TYPE_LABELS = ['Collision', 'Rollover', 'Rear-end', 'Side-swipe',
  'Reversing', 'Fire', 'Vandalism', 'Weather', 'Tyre failure', 'Mechanical',
  'Near miss', 'Property damage', 'Other']
ACCIDENT_TYPE_TOKENS = {collision, rollover, rear_end, side_swipe, reversing,
  fire, vandalism, weather, tyre_failure, mechanical, near_miss,
  property_damage, other}
```

`toDbAccidentType(s)` (`report.tsx:86-90`) writes any of the thirteen tokens
straight into `accidents.accident_type`, defaulting an unrecognised label to
`'other'`. Six of them - `rear_end`, `side_swipe`, `reversing`, `fire`,
`vandalism`, `weather` - are not members of the `AccidentType` union at all,
so `AccidentRecord.accident_type: AccidentType` (`types.ts:186`) is a lie
about what the column can actually hold, for a record the mobile app itself
created.

**Consequence, verified defensively-handled in one place and not in another.**
`[id].tsx:55-63` (`TYPE_ICONS`) only maps the 7 typed values, but the lookup at
`[id].tsx:286` is guarded: `TYPE_ICONS[accident.accident_type] ?? 'alert-circle-outline'`.
The i18n lookup at `[id].tsx:287` and `dashboard.tsx:385` (`t(\`accident.types.${accident.accident_type}\`)`)
is a plain string key with no type constraint, so it renders for any of the
thirteen tokens PROVIDED the locale file has all thirteen keys - which this
document did not check (section 13, item 1).

### 1.2 `AccidentStatus` - typed for 3, written for 7, referenced for 8

`AccidentStatus` (`types.ts:174`): `'reported' | 'under_review' | 'closed'`.
Exactly three values.

`report.tsx:62-74` writes seven, via `toDbStatus()`:

```
STATUS_LABELS = ['Reported', 'Under Investigation', 'Repair In Progress',
  'Awaiting Parts', 'Awaiting Approval', 'Insurance Claim', 'Closed']
-> reported | under_review | repair_in_progress | awaiting_parts |
   awaiting_approval | insurance_claim | closed
```

`dashboard.tsx:46-54` (`STATUS_KIND`) is keyed on a THIRD set, and the source
comment at `dashboard.tsx:43-45` states outright that the type is known to be
wrong: "the DB carries more statuses than the base `AccidentStatus` union ...
this is string-keyed with a neutral fallback at the call site." Its seven keys
are `reported, under_review, awaiting_approval, insurance_claim,
repair_in_progress, released, closed` - **note `awaiting_parts`, one of the
seven tokens `report.tsx` itself writes, is MISSING from this map**, and
`released` is present despite no writer anywhere in this codebase producing
it for the `status` column (`'Released'` is a value of the unrelated
`current_status` free-text column - see section 1.4). An accident created
with `status = 'awaiting_parts'` therefore falls through `STATUS_KIND[...] ??
'neutral'` on the dashboard card (`dashboard.tsx:416`), the one place this is
guarded.

`STATUS_ICONS` (`types.ts:394-398`) has only the original three keys. It is
consumed **unguarded** at `[id].tsx:247`:

```
<Ionicons name={STATUS_ICONS[accident.status] as IconName} ... />
```

versus **guarded** at `dashboard.tsx:417`:

```
icon={(STATUS_ICONS[accident.status] ?? 'ellipse-outline') as IconName}
```

**This is a real, reachable defect, not a hypothetical.** Any accident whose
`status` is `repair_in_progress`, `awaiting_parts`, `awaiting_approval` or
`insurance_claim` - all four fully reachable from the create form's own
Status dropdown - renders `Ionicons name={undefined}`, which is exactly the
kind of drift a Flutter port must not reproduce, and exactly the kind of thing
this document exists to surface before Phase 9 starts.

### 1.3 `recovery_status` - two SEPARATE vocabularies write the SAME column

This is the most serious of the three, because it is not a type gap - it is
two live editors of the same field disagreeing about what values are legal.

`report.tsx` (create form): the "Cost Recovery" dropdown
(`report.tsx:918-919`) uses `RECOVERY_DECISION_OPTS = ['Yes', 'No', 'N/A']`
(`report.tsx:104`), and the raw label is written straight to the column with
no `toDb*` mapping at all (`report.tsx:508`):

```
recovery_status: extra.recovery_status || 'N/A',
```

`AccidentClaimsPanel.tsx` (edit form): the "Recovery status" chip picker
(`AccidentClaimsPanel.tsx:825-837`) uses `RECOVERY_STATUSES: RecoveryStatus[]
= ['pending', 'partial', 'recovered', 'written_off']`
(`AccidentClaimsPanel.tsx:43`), and writes it back with the SAME column name
(`AccidentClaimsPanel.tsx:703`): `recovery_status: f.recovery_status,`.

`types.ts:232` declares `RecoveryStatus = 'pending' | 'partial' | 'recovered'
| 'written_off'` - matching the CLAIMS PANEL's vocabulary, not the CREATE
FORM's. `RECOVERY_STATUS_LABELS` and `RECOVERY_STATUS_COLORS`
(`types.ts:238-244`) are keyed the same way.

**Consequence, traced through to a real rendering bug.** An accident created
via `report.tsx` with the Cost Recovery gate set to "Yes" has
`accidents.recovery_status = 'Yes'` on the row. Every OTHER screen that reads
that field looks it up against the claims-panel vocabulary:

```
AccidentClaimsPanel.tsx:164  const recoveryColor = RECOVERY_STATUS_COLORS[accident.recovery_status ?? 'pending']
AccidentClaimsPanel.tsx:289  Recovery: {RECOVERY_STATUS_LABELS[accident.recovery_status ?? 'pending']}
```

`RECOVERY_STATUS_LABELS['Yes']` and `RECOVERY_STATUS_COLORS['Yes']` are both
`undefined` - the map has no such key. The screen renders "Recovery:
undefined" and a colour swatch built from `undefined + '1F'`. This is not a
theoretical edge case: it is the value the mobile create form writes on the
recovery gate's DEFAULT selectable option, for every accident anyone reports
from a phone where a recovery is expected.

### 1.4 `current_status` is a fourth, entirely separate free-text field

`CURRENT_CONDITION_OPTS = ['Running', 'Waiting for approval', 'Under Repair',
'Repair Completed', 'Released', 'Closed']` (`report.tsx:92-94`) populates
`accidents.current_status` (`report.tsx:479`), which is DISTINCT from
`accidents.status`. `'Released'` here is what dashboard.tsx's stray
`STATUS_KIND.released` key was almost certainly meant to key off of, on the
wrong column. Nothing in the four files read enforces a relationship between
`status` and `current_status` - they are independently settable and can
disagree (e.g. `status = 'closed'` while `current_status = 'Running'`).

### 1.5 Rule for Flutter

**`types.ts`'s unions are not the source of truth for what a row can hold.
`report.tsx`'s `toDb*` functions and constant arrays are the closest thing
this codebase has to a live vocabulary, and even they disagree with each other
on `recovery_status`.** A Flutter `AccidentType`/`AccidentStatus`/
`RecoveryStatus` enum built from `types.ts` will silently reject or mis-map
real rows. The actual DB CHECK constraints were not inspected in this session
- see section 13, items 2-4 - and are the only true source; until they are
read, treat every union in this document as a lower bound, not a closed set.

---

## 2. The status/workflow model: three overlapping concepts on one row

Independent of the vocabulary drift above, the `accidents` table carries
**three structurally different notions of "where is this case"**, none of
which supersedes another, and no file read in this session reconciles them.

| # | Column(s) | Values (as written by mobile) | Who writes it | Who reads it |
|---|---|---|---|---|
| 1 | `status` | 7 tokens, section 1.2 | `report.tsx` on create; `[id].tsx` status dropdown (3 of the 7, section 5.1) | `[id].tsx`, `dashboard.tsx`, `accidentPdf.ts` |
| 2 | `closure_status` (+ `close_requested_by/at/note`, `closure_approved_by/at`, `closure_rejected_reason`) | `'open' \| 'pending_closure' \| 'closed'` (`types.ts:249`) | RPCs `request_accident_closure` / `approve_accident_closure` / `reject_accident_closure`, all called from `AccidentClaimsPanel.tsx:126-152` | `AccidentClaimsPanel.tsx` closure banner (section 6.1) |
| 3 | `workflow_stage`, `case_status`, `route_key`, `closure_level`, `completion_overall`, `completion_incident`, `completion_insurance`, `completion_repair`, `completion_financial` + the child table `accident_case_workstreams` | Web-authored, mobile is READ-ONLY (`accidentCase.ts:1-19` says so explicitly - "there is NO write path here by design") | The web app (V417, a migration that may not be applied - see below) | `case.tsx` |

**Concept 3 is conditional on a migration that this session could not confirm
is live.** `accidentCase.ts:8-14` states the caution itself: "The relational
spine ... is a web migration that may not be applied yet. SHIP-BEFORE-MIGRATE:
every read degrades." `loadAccidentCase()` (`accidentCase.ts:140-179`) reads
the accident row with `select('*')` specifically so a missing case COLUMN
never errors, and treats a missing `accident_case_workstreams` RELATION as a
`{provisioned: false}` sentinel (`accidentCase.ts:166`, `isMissingRelation()`
at `:120-128`) rather than a crash. `case.tsx:159-164` renders an honest "not
yet activated" empty state in that case.

None of the three concepts is derived from another. An accident can be
`status = 'closed'`, `closure_status = 'open'` (nobody ever requested the V19
closure workflow), and have no `accident_case_workstreams` rows at all
(the case model was never provisioned for this org) - all simultaneously true,
all rendered on the same detail screen without contradiction, because nothing
cross-checks them.

**Rule for Flutter.** Model these as three independent value objects on the
accident aggregate, not as one status enum with three names. Whichever one
Phase 9 chooses as the primary field-facing status must be a deliberate
product decision (AD1, section 14), not an artefact of which table happened
to load first.

---

## 3. The report (create) form

`report.tsx`, gated `withModuleGuard(AccidentReportScreen, 'reportAccident')`
(`report.tsx:263`) - a DIFFERENT module key from the `'accidents'` key that
gates the detail/dashboard/case screens (`[id].tsx:68`, `dashboard.tsx:60`,
`case.tsx:55`). A user could plausibly hold one grant without the other.

### 3.1 Required-field validation on submit

`validate()` (`report.tsx:442-448`), four checks, each an `Alert.alert` that
blocks submit and returns without setting any per-field error state (there is
no field-level red-outline behaviour anywhere in this form - only a blocking
modal alert):

| # | Check | Alert copy key |
|---|---|---|
| 1 | An asset is picked (`getEffectiveAssetNo()` non-empty - either the picked-from-list asset or the manual-entry text) | `alertSelectVehicle` |
| 2 | `base.site` is non-empty | `alertSelectSite` |
| 3 | `base.description.trim()` is non-empty | `alertDescribe` |
| 4 | `uploadedPhotoRefs.length > 0` - **at least one uploaded photo of ANY category** | `alertAttachPhoto` |

**Check 4 is satisfiable by a single document photo with zero photos of the
accident itself.** `uploadedPhotoRefs` (`report.tsx:309-312`) is derived from
ALL six photo categories (`isUploadedPhoto` filters only on whether the ref
looks uploaded, `report.tsx:258-259`), not specifically the `'accident'`
category from `AccidentPhotoGrid`. A report satisfying "attach a photo" by
uploading only a driving-licence photo, with zero images of the vehicle or
damage, is valid and submittable.

Everything else in the 1,235-line form is OPTIONAL. Injury count, third-party
flag, police report number, damage description, estimated cost, every GCC
liability/Najm/Taqdeer/insurance/claim/recovery/repair field across four whole
sections - none of it blocks submit.

`canSubmit` (`report.tsx:587-588`) is a SEPARATE, looser gate that only
disables the button while submitting/uploading or while the two cheapest
checks (site, effective asset) are unmet - it does NOT re-check description or
photos, so the button can be enabled right up until `validate()` runs on
press and rejects it with an alert.

### 3.2 The seven form sections and their DB targets

Every field maps to a real `accidents` column via the submit payload
(`report.tsx:460-526`). Grouped exactly as rendered:

| Section | Fields -> column | Notes |
|---|---|---|
| **Incident** (`:613-780`) | `asset_no`/`vehicle_id` (asset-first picker, auto-fills the rest), `plate_number`, `vehicle_type`, `reported_by`, `reporter_name`, `incident_date`, `incident_time`, `location`, `driver_name`, `description`, `country` | See 3.3 for asset auto-fill; date/time are native pickers stored `YYYY-MM-DD`/`HH:mm` LOCAL time (`report.tsx:131-133`, explicitly never `toISOString()` to avoid a GCC-timezone day shift) |
| **Classification** (`:782-806`) | `accident_type` (13-option dropdown, section 1.1), `severity` (3-chip row, section 3.4), `status` (7-option dropdown, section 1.2), `current_status` (6-option dropdown, section 1.4) | |
| **People & Damage** (`:808-840`) | `injuries` (switch, gates `injury_count`), `injury_count`, `third_party_involved` (switch), `police_report_no`, `damage_condition` (4-option: Minor/Moderate/Major/N/A), `damage_description`, `estimated_damage_cost` | |
| **Liability & GCC Case** (`:842-871`) | `fault_status`, `gcc_liability_ratio` (0/50/100, displayed with a `%` suffix, stored as a bare number), `najm_status` (gates `najm_fault`), `taqdeer_status` (gates `taqdeer_no`), `liable_party`, `payer`, `responsible_party` | See 3.5 for the conditional gates |
| **Insurance & Claim** (`:873-939`) | `insurer`, `policy_no`, `insurance_claim_no`, `claim_status` (5-option), `claim_amount`, `claim_approved_amount`, `deductible`, `recovered_amount` (auto-computed, see 3.6), `recovery_status` (Yes/No/N/A - section 1.3), then gated on Yes: `recovery_source`, `recovery_date`, `recovery_reference`, `amount_transfer` | |
| **Repair & Release** (`:941-971`) | `repair_type` (Internal/External, gates the next three), `workshop_location` (site dropdown when Internal, free text when External), `workshop_name`, `repair_cost` (Internal only), `expected_release_date`, `release_date` | |
| **Photos** (`:973-990`) | `photos` (`string[]`, section 4), `notes` (free text) | |

### 3.3 Asset-first auto-fill

`applyAsset()` (`report.tsx:395-413`): picking a vehicle overwrites
`asset_no`, `vehicle_id`, `plate_number`, `vehicle_type`, `make`, `model`
unconditionally, and REPLACES `site` with the vehicle's own site
(`site: v.site || prev.site` - the picked vehicle's site wins whenever it has
one, per the comment at `:388-394`: "a stale chip must never linger"). This
mirrors the same rule artifact 01 section 5 records for `meter-logs.tsx` and
`repair-request.tsx`. The asset picker is search-first (no vehicle appears
until 2+ characters are typed, `:670-684`), backed by a paged, country-scoped,
3,000-row-capped fleet read (`FLEET_SEARCH_CAP = 3000`, `report.tsx:49`,
`fetchAllRows` at `:371-379`) with a manual-entry fallback
(`lookupAssetByCode`, debounced 550ms, `:416-436`) for anything past the cap
- consistent with artifact 01's own note that the accident form's manual
lookup debounce is 550ms against other screens' 350ms.

### 3.4 Severity: 3 UI options for a 4-value column

`SEVERITY_LABELS = ['Minor', 'Moderate', 'Major']` (`report.tsx:51`),
`toDbSeverity()` (`:57-60`) maps Minor/Moderate/Major to
`minor`/`moderate`/`severe`. **`AccidentSeverity` has a fourth value, `fatal`
(`types.ts:172`), which the mobile report form cannot produce under any input**
- there is no UI path to it. `fatal` is reachable only by whatever writes it
elsewhere (the web app, presumably; not inspected in this session).

### 3.5 Conditional field visibility (all local `&&` renders, no shared engine)

Unlike the checklist engine (artifact 08 section 3), the accident form has no
`visibleWhen` abstraction - each gate is a hand-written boolean test inline:

| Gate | Test | Governs |
|---|---|---|
| `najmHasReport(v)` (`:115`) | `/report/i.test(v) && !/^no/i.test(v)` | shows `najm_fault` dropdown |
| `taqdeerHasReport(v)` (`:116`) | same shape | shows `taqdeer_no` text field |
| `recoveryIsYes(v)` (`:117`) | `v.trim().toLowerCase() === 'yes'` | shows `recovery_source`/`recovery_date`/`amount_transfer`/`recovery_reference` |
| `repairIsInternal(v)` (`:118`) | `v === 'Internal'` (exact match, case-sensitive) | switches `workshop_location` between a site dropdown and free text; shows/hides `repair_cost` |
| `base.injuries` (switch) | boolean | shows `injury_count` |

**A hidden field's stale value is NOT cleared on hide, and IS submitted.**
When `recovery_status` is changed away from "Yes", the payload still computes
`recovery_source: yes ? (extra.recovery_source || 'none') : 'none'` (`:509`) -
so the source IS reset to `'none'` on submit specifically for that one field -
but `najm_fault` and `taqdeer_no` follow the SAME `hasReport(...) ? value :
null` pattern (`:492`, `:494`), meaning they ARE nulled on submit when their
gate is closed. This is inconsistent with the checklist engine's rule
(artifact 08 section 3, "nothing is cleared, the whole answer object is
submitted whole") - the accident form DOES clear gated fields, but only at
submit time, and only for fields with an explicit `gate ? v : null` in the
payload construction; the `current_status`/`damage_condition` dropdowns have
no such clearing and simply persist whatever was last selected.

### 3.6 The Recovered auto-calculation

`computeRecovered(claim, approved, deductible)` (`report.tsx:121-124`):
`max(0, claim - approved - deductible)`, treating any non-finite input as 0.
Recomputed on every keystroke in Claim amount/Approved/Deductible
(`useEffect` at `:322-329`) UNTIL the user edits the Recovered field directly,
tracked by a `recoveredTouched` ref (`:301`) that is never reset within one
form session. `AccidentClaimsPanel.tsx`'s edit modal implements the identical
formula independently (`AccidentClaimsPanel.tsx:59-62`, `:672-679`) with its
own separate `recoveredTouched` ref - two copies of the same three-line
function, not shared.

### 3.7 Submit path and offline behaviour

`handleSubmit()` (`report.tsx:452-537`) builds the full payload (all fields
in the table in 3.2) and calls:

```
saveCommand('REPORT_ACCIDENT', payload, safeUuid())
```

`REPORT_ACCIDENT` (`mobile/lib/recordQueue.ts:209-229`) is an **INSERT into
`accidents`** with a **54-field allow-list** (counted directly from the array
at `recordQueue.ts:212-227`; this document's own count matches the figure
`tyre_pulse_flutter/lib/core/sync/command_registry.dart:112-117` already
states independently: "the widest allow-list of any command here (54
fields)" - artifact 01 section 2.8 instead records "a 50-column allow-list";
that is a stale/imprecise figure against the live source, see finding #16 in
section 11). It is **idempotent by default** (`isIdempotent()`,
`recordQueue.ts:333-335`, since `COMMANDS.REPORT_ACCIDENT` sets no
`idempotent: false`), so `saveCommand` (`recordQueue.ts:603-655`) either
inserts immediately or, on any failure (including "no network"), queues the
same payload keyed on the `client_uuid` passed as `safeUuid()`, and the queue
replay path (`recordQueue.ts:707-712`) upserts on that same key with
`onConflict: 'client_uuid', ignoreDuplicates: true` - so a lost response or
app crash mid-submit can never duplicate the accident row.

**This makes accident CREATION the single most offline-resilient write path
in the whole feature area.** Every subsequent mutation to that same row -
status change, delete, claim edit, part add/delete, remark, closure
request/approve/reject - is a direct, un-queued Supabase call with no offline
fallback (sections 5, 6). If the phone loses signal a minute after submitting
a report, the report itself survives to sync later; a status change or a
case-log note typed in that same minute is simply lost with an error alert and
no retry.

On success, `savedOffline = !!res.offline` is surfaced with a distinct
"saved, will sync" banner (`report.tsx:530`, `:561-568`) rather than a plain
success message - the user is told the difference.

---

## 4. Evidence capture (`AccidentPhotoGrid.tsx`)

### 4.1 Six categories, two shapes

`AccidentPhotoCategory = 'license' | 'resident_id' | 'registration' | 'najm'
| 'taqdeer' | 'accident'` (`AccidentPhotoGrid.tsx:39-40`).

- **Five single-photo document slots** (`SINGLE_SLOTS`, `:63-69`): Driving
  License, Resident ID, Vehicle Registration, Najm Report, Taqdeer
  Estimation. Each holds exactly one photo; picking a new one for an
  already-filled slot REPLACES it (`setSingle()`, `:189-202`).
- **One multi-photo `'accident'` category**, capped at
  `MAX_ACCIDENT_PHOTOS = 10` (`:50`), sequential upload
  (`addAccidentPhotos()`, `:212-229`).

All six are optional individually - the create-form gate (section 3.1, check
4) only requires at least one uploaded photo across ALL SIX.

### 4.2 Upload timing: immediate, per photo, not deferred to submit

Every pick triggers an upload as soon as the local URI is chosen -
`setSingle()`/`addAccidentPhotos()` call `uploadCategorizedPhoto()`
immediately (`:194-201`, `:220-227`), not on form submit. The form tracks a
single shared `photosUploading` boolean across the whole grid
(`onUploadingChange`, `AccidentPhotoGrid.tsx:147-150` -> `report.tsx:285`,
`:977-978`) and disables Submit while any photo is mid-upload
(`canSubmit`, `report.tsx:587`). A local thumbnail (`localUri`) renders
instantly regardless of upload state (`previewUri()`, `:254`), so the operator
sees the photo before the network round trip completes.

### 4.3 Upload mechanics

`uploadCategorizedPhoto()` (`:77-119`):

1. Resize/compress via the shared `prepareForUpload()` helper (image-picker
   capture quality is 0.55 at the picker call itself, `:160`, `:173`).
2. Reject anything not `jpg/jpeg/png/heic/heif` (`ALLOWED_EXTS`, `:74`); HEIC
   and HEIF are renamed to `.jpg` for `contentType`.
3. Read the file via the SDK-54 `File` API's `.bytes()`, and refuse anything
   over `MAX_DECODE_BYTES = 12 * 1024 * 1024` before reading it (`:97-98`).
   The comment at `:91-96` explains WHY this matters: the legacy
   `expo-file-system` function API "THROWS at runtime in expo-file-system 19",
   and because that throw used to be swallowed by an outer catch, "every
   accident photo was silently dropped instead of uploaded" - a real,
   previously-shipped defect this file's current form exists to have fixed.
4. Upload to the PRIVATE bucket `accident-photos`
   (`supabase.storage.from('accident-photos').upload(...)`, `:107-109`) at
   path `accidents/<uid-prefix>/<category>_<timestamp>_<rand>.<ext>`, and
   return a `tp-storage://` ref via `storageRef()`.
5. Any failure anywhere in this chain returns `null`, silently - caught at
   `:115-118`, surfaced to the caller only as a generic "could not upload"
   alert (`AccidentPhotoGrid.tsx:198`, `:224`). **There is no automatic
   retry.** A single-slot photo that failed to upload keeps its local
   thumbnail with no "uploaded" badge and a visible Replace button
   (`:290-306`); a failed accident-category photo likewise has no retry
   affordance beyond re-adding it.

### 4.4 Persistence shape

The stored `accidents.photos` column is a **plain `string[]`** of uploaded
refs (`isUploadedPhoto` filters to `tp-storage://` or `http`-prefixed values
only, `report.tsx:258-259`, `:309-312`) - the category information does NOT
survive into a separate structured field. It is recoverable only by parsing
the storage filename prefix (`CATEGORY_PREFIX`, `AccidentPhotoGrid.tsx:58-61`:
`license_`, `resident_`, `registration_`, `najm_`, `taqdeer_`, `accident_`).
The header comment (`:9-15`) states this is deliberate: "kept a plain string
array, ordered documents-first then accident photos, with the category
encoded in the storage filename prefix ... `recordQueue`'s allow-list and the
web gallery rendering are untouched." A Flutter port that wants to render
photos grouped by category on the detail screen must parse the filename,
because the column carries no other signal.

`sortEntries()` (`:121-126`) is a stable sort that always places the five
document categories before `'accident'`, in `CATEGORY_ORDER` (`:53-55`), and
this ordering is what the persisted array reflects on submit.

---

## 5. The detail screen (`[id].tsx`)

Gated `'accidents'` (`[id].tsx:68`), separate from the report screen's
`'reportAccident'` gate (section 3).

### 5.1 Status change: reachable to 3 of the (at least) 7 values

`STATUS_OPTIONS: AccidentStatus[] = ['reported', 'under_review', 'closed']`
(`[id].tsx:44`) drives the ENTIRE status-change bottom sheet
(`:509-548`). `canChangeStatus = isAdminOrAbove(role)` (`:104`) - Admin,
Manager or Director (`types.ts:76-78`).

**An accident created with `status = 'repair_in_progress'`,
`'awaiting_parts'`, `'awaiting_approval'` or `'insurance_claim'` (all four
reachable from the CREATE form's own dropdown, section 1.2) can never be set
back to any of those four values from this screen - only forward or sideways
among `reported`/`under_review`/`closed`.** There is no way, using this
detail screen alone, to move an accident from `closed` back to
`awaiting_parts`, or to advance one sitting at `awaiting_approval` to
`insurance_claim`. The status-change UI is strictly narrower than the
create-time vocabulary.

`updateStatus()` (`:154-178`) is a **direct, un-queued**
`supabase.from('accidents').update({status}).eq('id', accident.id)` call
(`:159-162`) - no offline fallback. On success it re-fetches the audit log
(`get_accident_audit` RPC, `:169`) so the Activity section stays current; on
failure it shows a generic error alert with no retry queue.

### 5.2 Delete: admin-only, direct, irreversible from the client's view

`canDelete = isAdmin(role) === true || isSuperAdmin === true` (`:106`) -
strictly `admin` or the platform super-admin, NOT `manager`/`director` (unlike
status change, which is `isAdminOrAbove`). `confirmDelete()` (`:180-209`) is
a confirmation `Alert` followed by a direct `.delete().eq('id', accident.id)`
(`:193`) with no queue, no undo, and no cascade visibility on the client (what
happens to `accident_parts`/`accident_remarks` rows for that id is a
server/FK question, UNVERIFIED - section 13 item 5).

### 5.3 Audit trail

`canSeeAudit = isAdminOrAbove(role)` (`:107`), same gate as status change.
Loaded via RPC `get_accident_audit(p_accident_id)` (`:121`, re-loaded at
`:169` after a status change), rendered through the shared
`describeAuditRow()` helper from `mobile/lib/auditDiff.ts` (imported at
`:31`). Each row's colour is chosen by a hand-matched prefix test
(`:473-477`): `status_change` -> info, `delete` -> danger, anything starting
with `part_` -> violet, else -> success (covers remark/closure-event rows by
elimination, not by an explicit list).

### 5.4 Photo gallery and lightbox

Photo refs are resolved via `resolveStorageUrls()` then passed through
`safeImageSrc()` (`:135-137`) - **the only screen among the four read in this
session that explicitly filters resolved photo URLs through the safe-URL
allowlist before rendering** (`AccidentPhotoGrid`'s own preview uses
`safeImageSrc` too, at `:254`, but on a locally-controlled `localUri`/`url`
pair, not on server-returned data). Photo resolution is wrapped in its own
try/catch (`:132-141`) so a storage hiccup degrades to zero photos rather than
blanking the whole report - the same "best-effort, non-fatal" pattern used
throughout this codebase.

### 5.5 Case status entry point

`[id].tsx:300-313` renders a tappable card linking to
`/(app)/accident/case?id=${accident.id}` - the read-only view covered in
section 7. This link is unconditional (not gated on whether the case model is
provisioned); the destination screen itself decides how to degrade
(`case.tsx:159-164`).

### 5.6 What this screen does NOT let you edit

Every field captured by the create form OTHER than `status` - injuries,
description, damage fields, the whole Classification section, `current_status`,
`damage_condition` - has no edit path on this screen at all. Editing the
GCC/liability/insurance/claim/repair block is entirely delegated to
`AccidentClaimsPanel` (section 6), which does not cover the Incident,
Classification or People & Damage sections either. **There is no screen in
this codebase that can edit `description`, `injuries`, `injury_count`,
`third_party_involved`, `police_report_no`, `damage_description`,
`estimated_damage_cost`, `accident_type`, or `plate_number`/`vehicle_type`
after creation.** A typo in the incident description on a submitted report is
permanent from the mobile client's side.

---

## 6. The claims panel (`AccidentClaimsPanel.tsx`)

Mounted unconditionally inside `[id].tsx:443` for every user who can see the
detail screen at all - there is no separate module gate on the panel itself;
it self-gates individual actions via `canManage = isAdminOrAbove(role)`
(`AccidentClaimsPanel.tsx:81`).

### 6.1 Closure workflow

`closure: ClosureStatus = accident.closure_status ?? 'open'` (`:94`). Three
renderings (`:171-242`):

| `closure_status` | Who can act | Action -> RPC |
|---|---|---|
| `'open'` (or unset) | ANY user with accidents access (not gated by `canManage`) | "Request Closure" button opens a text-prompt modal for an optional note -> `request_accident_closure(p_accident_id, p_note)` (`:126-134`) |
| `'pending_closure'` | `canManage` only | "Approve" -> `approve_accident_closure(p_accident_id)` (`:136-142`); "Reject" (opens a REQUIRED-reason prompt) -> `reject_accident_closure(p_accident_id, p_reason)` (`:144-152`) |
| `'closed'` | nobody (terminal in the UI) | shows the approval timestamp only |

All three RPC calls are direct (`supabase.rpc(...)`), no offline queue,
generic error alert on failure. A rejected closure surfaces
`closure_rejected_reason` as a persistent banner on the next "open" render
(`:224-230`) until a new closure request supersedes it.

**Server-side enforcement of the role check inside these RPCs is UNVERIFIED**
- the client hides the Approve/Reject buttons behind `canManage`, but whether
the RPC itself refuses a non-elevated caller (matching the "server is the
real boundary" convention this codebase states elsewhere) was not checked
(section 13, item 6).

### 6.2 Claim & Responsibility - the second full copy of the field-parity form

`ClaimEditModal` (`:608-871`) is opened by the Edit link, visible only to
`canManage` (`:249-254`). It edits the SAME 27-plus fields the create form's
Liability/Insurance/Repair sections write (`responsible_party`,
`liable_party`, `payer`, `driver_name`, `insurer`, `policy_no`,
`insurance_claim_no`, `claim_status`, `claim_amount`,
`claim_approved_amount`, `deductible`, `recovered_amount`, `recovery_date`,
`recovery_reference`, `recovery_source`, `recovery_status`, `fault_status`,
`gcc_liability_ratio`, `najm_status`, `najm_fault`, `taqdeer_status`,
`taqdeer_no`, `damage_condition`, `amount_transfer`, `repair_type`,
`workshop_name`, `workshop_location`, `repair_cost`, `expected_release_date`,
`release_date`), using its OWN independent copy of every option list and the
`najmHasReport`/`taqdeerHasReport`/`repairIsInternal`/`computeRecovered`
helpers (`:45-62`), byte-for-byte identical to `report.tsx`'s versions but
maintained as a SEPARATE copy in a separate file - there is no shared module
either screen imports. **This is the second full duplication of the
field-parity form logic in this codebase**, and it is the mechanism by which
`recovery_status`'s two vocabularies (section 1.3) diverged: each copy was
free to declare its own option list because neither references the other.

`save()` (`:684-720`) is a direct `.update()` on `accidents`, no queue. The
modal's local state is NOT persisted anywhere (no draft) - closing it or the
app dying while it is open with unsaved edits and no connectivity loses the
edits with nothing recoverable.

### 6.3 Parts and repairs ledger

`accident_parts` rows: `part_name` (required), `part_number`, `quantity`
(default 1), `unit_cost` (default 0), `supplier`, `status` (`'needed' |
'ordered' | 'received' | 'fitted'`, `types.ts:250`). `total_cost` is read
from the row (`p.total_cost`, section 6.4 note) - it is NOT computed
client-side on insert; the insert payload (`AccidentClaimsPanel.tsx:552-561`)
sends `quantity` and `unit_cost` only, so `total_cost` is either a generated
column or trigger-computed server-side (UNVERIFIED, section 13 item 7).

**Add** is gated `canManage` (`:325-330`); a direct `.insert()` (`:552-561`).
**Delete** is gated `canManage` (`:355-359`); a direct `.delete()` (`:154-158`).
There is no edit action on an existing part - only delete-and-re-add.

### 6.4 Net cost calculation, computed twice with slightly different inputs

`AccidentClaimsPanel.tsx:165-166`:

```
grossCost = (estimated_damage_cost || 0) + partsTotal
netCost = max(0, grossCost - (recovered_amount || 0))
```

`accidentPdf.ts:35-37` computes the SAME formula independently, over the SAME
two source values, for the exported PDF - two copies of a three-line
calculation, consistent with each other today by inspection but not
guaranteed to stay so since neither imports the other.

### 6.5 Case log / remarks

`accident_remarks`: `remark` (required, non-empty after trim), `remark_type`
always hard-coded `'note'` on this write path (`:118`) even though
`RemarkType` has eight values (`types.ts:252-254`: `note`, `insurance`,
`repair`, `responsibility`, `status_change`, `closure_request`,
`closure_approved`, `closure_rejected`) - the other seven are presumably
written server-side (by the closure/status RPCs and triggers) since no client
file read in this session ever sets `remark_type` to anything but `'note'`.
**Adding a remark has NO role gate at all** - unlike every other write in this
panel, the send button (`:390-397`) is reachable by any user who can see the
detail screen. It is a direct `.insert()` (`:113-119`), no queue; on failure
the typed text is neither cleared nor queued, so the operator must notice the
alert and retry manually.

---

## 7. The case/workstream read-only mirror (`case.tsx` / `accidentCase.ts`)

Genuinely read-only by design - the file header says so twice
(`accidentCase.ts:6-7`, `case.tsx:6-7`: "There is NO write path here by
design"). Reached from `[id].tsx`'s case-status card (section 5.5) or by deep
link with an `id` param.

### 7.1 The ten canonical workstreams, in pipeline order

`WORKSTREAM_ORDER` (`accidentCase.ts:27-38`):

```
incident_evidence, fleet_validation, liability, insurance, assessment,
repair, workshop_qc, handover, finance, corrective
```

Rendered order is enforced by `WS_INDEX` (`:42-44`) sorting the loaded rows;
an unrecognised `workstream_key` sorts last (`?? 99`, `:173-176`).

### 7.2 The four-chip collapse

`CaseChip = 'done' | 'in_progress' | 'pending' | 'not_required'`
(`accidentCase.ts:48`). `CHIP_FOR_STATUS` (`:51-64`) folds twelve underlying
web-side workstream status tokens onto the four chips (`completed` ->
`done`; `not_required`/`cancelled` -> `not_required`; `not_started`/`rejected`
-> `pending`; `assigned`/`in_progress`/`waiting_info`/`waiting_approval`/
`waiting_external`/`on_hold`/`reopened` -> `in_progress`). `caseChipFor()`
(`:69-73`): a row explicitly flagged `not_applicable` ALWAYS renders
`not_required` regardless of its `status` string, and an unrecognised/blank
status defaults to `pending`, never a crash or a fifth "unknown" chip.

### 7.3 Degradation ladder

`loadAccidentCase()` returns one of three shapes (`accidentCase.ts:114-116`),
each with its own screen state:

| Result | Screen renders | Condition |
|---|---|---|
| accident row is `null` | "not found" empty state (`case.tsx:114-121`) | `accidents` select returns nothing for the id |
| `{provisioned: false, case}` | "not yet activated" empty state, workstream section entirely absent | `accident_case_workstreams` table/relation is missing (`isMissingRelation`, `accidentCase.ts:120-128`, matching Postgres/PostgREST codes `42P01`, `42703`, `PGRST205`, `PGRST204` or a message containing "does not exist"/"could not find") |
| `{provisioned: true, case, workstreams: []}` | "no workstreams" empty state | the migration is applied but this specific accident has zero rows |
| `{provisioned: true, case, workstreams: [...]}` | the workstream list, each row a name + chip + optional `na_reason` | normal case |

The header fields (`case.tsx:123-155`) fall back gracefully:
`reference = rec.reference_no ?? rec.case_no ?? rec.id.slice(0,8)`, and
`overallStatus = humanise(rec.case_status ?? rec.status)` - **this is the one
place in the whole feature that reconciles two of the three status concepts
from section 2**, and only for DISPLAY, falling back from the workstream
model's `case_status` to the plain `status` column when the former is unset.

### 7.4 Country scoping is a client convenience only

`loadAccidentCase(accidentId, {country})` applies an OR filter
(`country.eq.<c>,country.is.null`) on the workstream read ONLY when
`normaliseCountry()` collapses the user's profile country to a single value
(`accidentCase.ts:145`, `:160-163`) - the file's own header states RLS is the
real boundary and this filter is "a null-safe convenience only"
(`accidentCase.ts:16-18`). The accident row itself carries no client-side
country filter at all (plain `.eq('id', accidentId)`), relying entirely on
RLS.

---

## 8. PDF export (`accidentPdf.ts`)

### 8.1 Field set actually printed

Five sections, verified against the HTML template (`:82-137`):

| Section | Fields |
|---|---|
| Incident | Type, Severity, Status (all THREE printed as raw DB tokens, see 8.2), Location, Reported by, Description, Injuries (+ count), Third party, Police report, Damage description, Estimated damage |
| Claim & Responsibility | Claim status (labelled via `CLAIM_STATUS_LABELS`), Responsible party, Liable party, Who pays, Driver, Insurer, Policy/Claim no, Claim amount, Approved amount, Deductible |
| Cost Recovery | Recovery status (labelled via `RECOVERY_STATUS_LABELS`), Recovered amount, Recovery source (labelled), Recovery date, Recovery reference, plus a computed Gross/Recovered/Net banner |
| Parts & Repairs | A table of every `accident_parts` row (name, number, qty, unit cost, total, status-labelled) with a total-cost footer row |
| Case Log | Every `accident_remarks` row, author + timestamp + text, newest first |
| Photos | An inline `<img>` grid of every resolved photo URL, no category grouping |

### 8.2 What is missing from the PDF that the app itself shows

**The entire Classification & GCC Case block and the entire Repair & Release
block, both rendered on-screen by `[id].tsx:393-433` and editable via
`AccidentClaimsPanel.tsx:741-859`, are absent from the exported PDF.**
Specifically not printed anywhere: `plate_number`, `vehicle_type`,
`current_status`, `damage_condition`, `fault_status`, `gcc_liability_ratio`,
`najm_status`, `najm_fault`, `taqdeer_status`, `taqdeer_no`,
`amount_transfer`, `repair_type`, `workshop_name`, `workshop_location`,
`repair_cost`, `expected_release_date`, `release_date`. A PDF generated for
an insurer or a GCC case file - the document's own stated purpose
(`accidentPdf.ts:79`: "Accident & Claim Report") - omits the Najm/Taqdeer/
liability-ratio evidence and the entire repair-and-release timeline that the
in-app claims panel treats as core to the same record.

### 8.3 Raw tokens versus translated labels, inconsistently, within the same file

`row('Type', accident.accident_type)`, `row('Severity', accident.severity)`
and `row('Status', accident.status)` (`:84-86`) print the RAW lowercase/
snake_case DB token (e.g. `reported`, `severe`, `tyre_failure`) with no label
mapping. In the SAME function, four other fields on the SAME page ARE mapped
through a label constant: `CLAIM_STATUS_LABELS[...]` (`:99`),
`RECOVERY_STATUS_LABELS[...]` (`:113`), `RECOVERY_SOURCE_LABELS[...]`
(`:115`), `PART_STATUS_LABELS[...]` (`:46`, inside the parts-row builder).
Nothing in the file explains why type/severity/status are treated
differently from claim/recovery/part status; it reads as an omission rather
than a decision.

### 8.4 Generation mechanism

`Print.printToFileAsync({html})` then `Sharing.shareAsync(uri, {mimeType:
'application/pdf', ...})` (`:140-143`) - on-device rendering, no server round
trip beyond the two `Promise.all`-fetched source tables (`accident_parts`,
`accident_remarks`, `:28-31`) and the photo-URL resolution (`:38`). Every
value passed through `esc()` (`:17-18`), a minimal `&<>"` HTML-escaper - not a
full sanitiser, but sufficient for the plain-text fields this template
interpolates.

---

## 9. Dashboard / register (`dashboard.tsx`)

### 9.1 The load, and its cap

`load()` (`:83-115`): `supabase.from('accidents').select('*').order('created_at',
{ascending:false}).limit(200)` (`:88-92`) - **a hard cap of 200 rows with no
paging mechanism anywhere in this file.** `filterTab === 'mine'` adds
`.eq('reported_by', profile.id)` server-side (`:94-96`); for an elevated user,
`siteFilter !== 'all'` adds `.eq('site', siteFilter)` server-side (`:97-99`).
**Everything else - the open/closed status filter and the free-text search -
is applied CLIENT-SIDE, in-memory, over whatever subset of the (at most) 200
newest rows the server returned** (`byStatus`, `:138-142`; `filtered`,
`:144-153`). Any organisation with more than 200 accidents matching the
active server-side filters will have older accidents silently absent from
search results and status counts, with no indication on screen that the list
is truncated - the same class of defect artifact 01 section 5.19 records for
`.limit(N)` reads elsewhere in this codebase, here at a lower, sub-1000
threshold that PostgREST's own cap would not otherwise trigger.

### 9.2 KPI tiles and severity chart

Four tiles (`:214-219`), all computed client-side over the (capped) loaded
set: Total, Open (`status !== 'closed'`, `:128` - note this treats all SIX
non-`closed` tokens as "open", including `awaiting_approval` and
`insurance_claim`), This Month (`incident_date` string-prefix match against
`new Date().toISOString().slice(0,7)`, `:126`, `:129` - a UTC-month
comparison against a locally-entered date, a potential off-by-one-day
mismatch near midnight in GCC timezones that this file does not guard
against, unlike the report form's deliberate local-time formatting, section
3.2), Critical (`severity === 'fatal' || 'severe'`, `:130`).

Severity breakdown (`:221-247`) is a four-row proportional bar chart over
`SEVERITY_ORDER = ['minor','moderate','severe','fatal']` (`:33`) - the FULL
four-value type from `types.ts`, unlike the create form which can only
produce three of them (section 3.4). The `fatal` row will always read zero
for any accident this mobile app itself created.

### 9.3 Filters

- **Site** (`:250-273`): chip row, elevated users only (`isAdminOrAbove`),
  options derived from the DISTINCT sites present in the already-loaded
  (capped) set, not a separate live query - so a site with zero accidents in
  the current 200-row window never appears as a filter option even if it has
  older accidents beyond the cap.
- **Search** (`:276-292`): substring match (case-insensitive) across
  `asset_no`, `site`, `location`, `reporter_name`, `accident_type` -
  `accident_type` is matched as its RAW token (`collision`, `rear_end`, ...),
  not its translated label, so a user typing the display word "Rear-end" will
  not match a `rear_end` row unless the raw token happens to contain the
  typed substring.
- **Filter tabs** All/Mine (`:295-313`) and Status All/Open/Closed
  (`:316-336`), independent of each other and composable.

### 9.4 The list card

`AccidentCard` (`:363-448`): asset + site, translated accident type, severity
badge, incident date, location (if present), injury count (if `injuries`),
status badge (`STATUS_KIND[...] ?? 'neutral'`, guarded - contrast section
1.2), and for elevated users the reporter name plus photo count inline; for
everyone else, photo count alone if present. `FlatList` windowing constants
(`initialNumToRender={8}`, `maxToRenderPerBatch={10}`, `windowSize={11}`,
`removeClippedSubviews`) are set explicitly - the only file among the four
screens read that tunes list-rendering performance this way.

---

## 10. The characterisation test suite

**105 cases across 19 groups.** Each is name / input / expected / proof, using
the `A1`, `A2`, ... `B1`, ... prefix convention from artifact 08 rather than
artifact 07's globally-continuous numbering, because a feature this size is
easier to cite forward and backward by group+index than by a single running
count. Every proof cites the section above where the source line is already
quoted, or a direct file:line where it is not.

### Group A - `accident_type` vocabulary (4 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| A1 | The create form offers 13 labels | `ACCIDENT_TYPE_LABELS.length` | 13 | `report.tsx:76-80` |
| A2 | `toDbAccidentType` maps every label to its snake_case token | `toDbAccidentType('Rear-end')`, `toDbAccidentType('Side-swipe')` | `'rear_end'`, `'side_swipe'` | `report.tsx:86-90` |
| A3 | An unrecognised label defaults to `'other'`, never throws | `toDbAccidentType('')`, `toDbAccidentType('Nonsense')` | both `'other'` | `report.tsx:87-89` |
| A4 | A DB token outside the `AccidentType` union does not crash the detail icon lookup | `TYPE_ICONS['fire']` (not a key) | `undefined`, coalesced by the caller to `'alert-circle-outline'` | `[id].tsx:55-63`, `:286`; section 1.1 |

### Group B - severity vocabulary (4 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| B1 | 3 UI chips map to 3 of the 4 DB tokens | `toDbSeverity('Minor')`, `('Moderate')`, `('Major')` | `'minor'`, `'moderate'`, `'severe'` | `report.tsx:57-60` |
| B2 | An unrecognised label defaults to `'minor'` | `toDbSeverity('')`, `toDbSeverity('X')` | both `'minor'` | `report.tsx:58-59` |
| B3 | `fatal` is unreachable from the create form | every branch of `SEVERITY_LABELS`/`toDbSeverity` | none produce `'fatal'` | `report.tsx:51-60`; section 3.4 |
| B4 | The dashboard's severity chart still has a row for `fatal` | `SEVERITY_ORDER` | `['minor','moderate','severe','fatal']`, 4 entries, the last always 0 for a mobile-created accident | `dashboard.tsx:33`; section 9.2 |

### Group C - `status` vocabulary, write side (5 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| C1 | The create form offers 7 status labels | `STATUS_LABELS.length` | 7 | `report.tsx:62-65` |
| C2 | Each label maps to its own token | `toDbStatus('Awaiting Parts')`, `toDbStatus('Insurance Claim')` | `'awaiting_parts'`, `'insurance_claim'` | `report.tsx:66-73` |
| C3 | An unrecognised label defaults to `'reported'` | `toDbStatus('')`, `toDbStatus('X')` | both `'reported'` | `report.tsx:67-73` |
| C4 | `current_status` is a SEPARATE column with its own 6-value vocabulary | `CURRENT_CONDITION_OPTS` | `['Running','Waiting for approval','Under Repair','Repair Completed','Released','Closed']`, written raw (no `toDb*`) to `accidents.current_status` | `report.tsx:92-94`, `:479` |
| C5 | `current_status` and `status` are independently settable and can disagree | set `status='closed'`, `current_status='Running'` in the same submit | both persist as entered, no cross-validation anywhere in the form | section 1.4, section 3.2 |

### Group D - `status` vocabulary, read side (4 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| D1 | `[id].tsx`'s status-icon lookup is UNGUARDED | `STATUS_ICONS['awaiting_parts']` fed into `Ionicons name={...}` | `undefined` (a real bug, not a fallback) | `[id].tsx:247`, `types.ts:394-398`; section 1.2 |
| D2 | `dashboard.tsx`'s equivalent lookup IS guarded | `STATUS_KIND['awaiting_parts'] ?? 'neutral'` | `'neutral'` | `dashboard.tsx:417` |
| D3 | `dashboard.tsx`'s `STATUS_KIND` map is missing a token the create form writes | `'awaiting_parts' in STATUS_KIND` | `false` | `dashboard.tsx:46-54`; section 1.2 |
| D4 | `dashboard.tsx`'s `STATUS_KIND` map contains a token no writer produces | `'released' in STATUS_KIND` | `true`, but no file read in this session ever writes `status = 'released'` | `dashboard.tsx:53`; section 1.4 |

### Group E - `closure_status` state machine (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| E1 | Default closure state renders the request button | `accident.closure_status` is `null`/`undefined` | `closure = 'open'`, Request Closure button shown to any accessing user | `AccidentClaimsPanel.tsx:94`, `:222-239` |
| E2 | Requesting closure calls the RPC with an optional note | Request Closure -> type a note -> Submit | `request_accident_closure(p_accident_id, p_note)` | `:126-134` |
| E3 | `pending_closure` hides Request and shows Approve/Reject to `canManage` only | `closure_status = 'pending_closure'`, role = Mechanic (not admin/manager/director) | no Approve/Reject buttons rendered | `:187-221` |
| E4 | Approve calls its RPC with no reason | tap Approve -> confirm | `approve_accident_closure(p_accident_id)` | `:136-142` |
| E5 | Reject REQUIRES a reason | tap Reject -> leave the reason blank -> Confirm | the `TextPromptModal`'s confirm still fires with an empty string (no client-side non-blank check on THIS modal, unlike the create form's photo/description checks) | `:448-457`, `:481-524` - no length guard visible on `onConfirm={rejectClosure}` |
| E6 | A rejected closure's reason persists as a banner until the NEXT request | `closure_status` reverts to `'open'`, `closure_rejected_reason` still set | banner shows "Previous closure rejected: ..." | `:224-231` |

### Group F - case/workstream chip collapse (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| F1 | `completed` collapses to `done` | `caseChipFor('completed', false)` | `'done'` | `accidentCase.ts:52`, `:69-73` |
| F2 | `not_applicable` always wins regardless of status text | `caseChipFor('completed', true)` | `'not_required'` | `accidentCase.ts:70` |
| F3 | An unrecognised status defaults to `pending`, not a crash | `caseChipFor('some_new_token', false)` | `'pending'` | `accidentCase.ts:72` |
| F4 | Seven "in progress"-family tokens all collapse the same way | `caseChipFor('waiting_external', false)`, `caseChipFor('reopened', false)` | both `'in_progress'` | `accidentCase.ts:57-63` |
| F5 | Rows sort by canonical pipeline order, unknown keys last | a workstream list with `corrective` before `liability` in raw order | rendered order restores `liability` before `corrective` | `accidentCase.ts:27-44`, `:170-176` |
| F6 | The workstream table is missing entirely -> honest degrade, not a crash | `accident_case_workstreams` relation absent (42P01) | `{provisioned:false, case}` returned, "not yet activated" empty state rendered | `accidentCase.ts:120-128`, `:166`; `case.tsx:159-164` |

### Group G - create-form required-field validation (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| G1 | No asset picked blocks submit | `getEffectiveAssetNo() === ''` | `alertSelectVehicle`, submit refused | `report.tsx:443` |
| G2 | No site blocks submit | `base.site === ''` | `alertSelectSite` | `report.tsx:444` |
| G3 | Blank/whitespace-only description blocks submit | `base.description = '   '` | `alertDescribe` (`.trim()` is empty) | `report.tsx:445` |
| G4 | Zero uploaded photos blocks submit | `uploadedPhotoRefs.length === 0` | `alertAttachPhoto` | `report.tsx:446` |
| G5 | ONE document photo (no accident photo) satisfies the photo gate | `photoEntries = [{category:'license', url:'tp-storage://...'}]`, zero `'accident'`-category entries | submit proceeds past check 4 | `report.tsx:309-312`, `258-259`; section 3.1 |
| G6 | Every other field (GCC/insurance/claim/repair block) is optional | all four blocks left blank | submit still succeeds if G1-G4 pass | `report.tsx:442-448` (no other checks exist) |

### Group H - the recovery gate and the computed Recovered field (7 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| H1 | Recovered auto-computes from the three inputs | claim=1000, approved=800, deductible=100 | Recovered = 100 | `report.tsx:121-124` |
| H2 | Recovered floors at 0 | claim=100, approved=500, deductible=0 | Recovered = 0, never negative | `report.tsx:123` |
| H3 | Editing Recovered by hand stops the auto-recompute | type into Recovered once, then change Claim amount | Recovered no longer updates | `report.tsx:301`, `:323-329` |
| H4 | The claims-panel edit modal computes the SAME formula independently | same three inputs in `ClaimEditModal` | same result, via a SEPARATE copy of the function | `AccidentClaimsPanel.tsx:59-62`, `:672-679` |
| H5 | The Cost Recovery gate is a Yes/No/N/A dropdown, not a boolean | `RECOVERY_DECISION_OPTS` | `['Yes','No','N/A']` | `report.tsx:104` |
| H6 | Recovery source/date/reference/amount_transfer are gated on exactly "Yes" | `extra.recovery_status = 'no'` (lowercase) | `recoveryIsYes('no')` is `false` (case-insensitive compare), fields hidden and nulled on submit | `report.tsx:117`, `:509-512` |
| H7 | An unset recovery_status writes `'N/A'`, not `null` | `extra.recovery_status = ''` | payload `recovery_status: 'N/A'` | `report.tsx:508` |

### Group I - Najm/Taqdeer/Repair conditional gates (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| I1 | `najmHasReport` requires the word "report" and rejects anything starting with "no" | `najmHasReport('Najm report')` true; `najmHasReport('No Najm')` false | as stated | `report.tsx:115` |
| I2 | Closing the Najm gate nulls `najm_fault` on submit | `najm_status = 'No Najm'`, `najm_fault` previously set to `'Faulty'` | payload `najm_fault: null` | `report.tsx:492` |
| I3 | `taqdeerHasReport` mirrors the Najm rule exactly | `taqdeerHasReport('Taqdeer report')` true; `('No Taqdeer')` false | as stated | `report.tsx:116` |
| I4 | `repairIsInternal` is an EXACT, case-sensitive match | `repairIsInternal('Internal')` true; `repairIsInternal('internal')` false | as stated | `report.tsx:118` |
| I5 | Internal repair shows a site dropdown for workshop location; External shows free text | toggle `repair_type` | `workshop_location` control swaps input type | `report.tsx:945-952` |
| I6 | `repair_cost` is only ever sent when repair is Internal | `repair_type = 'External'`, `repair_cost` typed anyway | payload `repair_cost: null` (`internal ? num(...) : null`) | `report.tsx:517` |

### Group J - asset-first auto-fill (4 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| J1 | Picking an asset REPLACES the site, never merges | `base.site` already set from a previous pick, new asset has its own site | `site` becomes the NEW asset's site | `report.tsx:404`, `:388-394` |
| J2 | Picking an asset with no site preserves whatever site was already chosen | new asset's `site` is null/empty | `site: v.site || prev.site` keeps `prev.site` | `report.tsx:404` |
| J3 | The asset search shows nothing until 2+ characters are typed | `vehicleQuery = 'T'` | "search to begin" hint, zero chips | `report.tsx:670-684` |
| J4 | Manual asset entry auto-fills after a 550ms debounce | type a full valid asset code with `useManualEntry=true` | `applyAsset()` runs ~550ms after the last keystroke | `report.tsx:416-436` |

### Group K - photo capture (8 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| K1 | A document slot holds exactly one photo, replacing on re-pick | pick twice for `'license'` | the second upload REPLACES the first entry, not appended | `AccidentPhotoGrid.tsx:189-202` |
| K2 | The accident category is capped at 10 | 11th pick attempt | `Alert.alert(photoMaxReached)`, picker never opens | `:231-236` |
| K3 | Upload starts immediately on pick, not on form submit | pick a photo, do not press Submit | an upload request is already in flight | `:194-201`, `:220-227`; section 4.2 |
| K4 | A file over 12MB is refused before decode | `file.size > MAX_DECODE_BYTES` | upload returns `null`, no bytes read | `:97-98` |
| K5 | A non-image extension is refused | uploaded file ext `.pdf` (hypothetically renamed) | `ALLOWED_EXTS.has('pdf')` is `false`, returns `null` | `:74`, `:87` |
| K6 | HEIC/HEIF are normalised to `.jpg` for content-type, not rejected | ext `heic` | `contentType = 'image/jpeg'`, uploaded as `.jpg` | `:88-89` |
| K7 | A failed upload is never retried automatically | upload throws/returns null | the entry stays with `url: ''`, a Replace button is offered, nothing else happens | `:196-201`, `:290-306` |
| K8 | Category is recoverable ONLY from the storage filename prefix, not a stored field | a persisted `photos` entry, e.g. `tp-storage://accident-photos/accidents/ab12/najm_1699999999_ab12.jpg` | category = `'najm'`, parsed from the filename, since `accidents.photos` carries no separate category column | `CATEGORY_PREFIX` (`:58-61`); section 4.4 |

### Group L - offline queue and idempotency (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| L1 | `REPORT_ACCIDENT`'s allow-list is exactly 54 fields | count `COMMANDS.REPORT_ACCIDENT.fields` | 54 | `recordQueue.ts:212-227`; cross-checked at `command_registry.dart:112-117` |
| L2 | It is idempotent by default | `isIdempotent('REPORT_ACCIDENT')` | `true` (no `idempotent:false` set) | `recordQueue.ts:333-335`, `:209-229` |
| L3 | A successful immediate submit does NOT queue | network available, insert succeeds | `saveCommand` returns `{ok:true, offline:false}` | `recordQueue.ts:646-655` |
| L4 | Any failure (including offline) queues under the SAME client_uuid passed by the form | `saveCommand('REPORT_ACCIDENT', payload, safeUuid())` fails its first attempt | queued item's `idempotency_key` equals the `safeUuid()` passed in | `report.tsx:528`; `recordQueue.ts:637-645` |
| L5 | A replayed queue item upserts on `client_uuid`, never duplicates | the same queued item is synced twice (e.g. after a crash mid-ack) | `onConflict: 'client_uuid', ignoreDuplicates: true` - second attempt is a no-op | `recordQueue.ts:707-712` |
| L6 | Every OTHER accident write (status change, delete, claim edit, part CRUD, remark, closure RPCs) bypasses this mechanism entirely | any of those actions attempted with no network | a plain error alert, nothing queued, work lost until manually retried online | sections 5.1, 5.2, 6.1, 6.2, 6.3, 6.5; section 3.7 |

### Group M - detail-screen permissions and status-change reachability (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| M1 | Manager/Director/Admin can change status; everyone else cannot | role = Manager vs role = Tyre Man | status dropdown shown vs hidden | `[id].tsx:104`, `:316-336` |
| M2 | Only Admin or the super-admin can delete | role = Manager (elevated but not Admin) | delete button NOT rendered | `[id].tsx:106` |
| M3 | Audit trail visibility matches status-change visibility, not delete visibility | role = Director | audit trail shown (same gate as M1, not M2) | `[id].tsx:107` |
| M4 | The status sheet only ever offers 3 options regardless of the row's current value | `accident.status = 'insurance_claim'` | sheet options are still exactly `reported`/`under_review`/`closed` | `[id].tsx:44`, `:521-542`; section 5.1 |
| M5 | A status change is a direct write with no offline path | phone offline, tap a status option | generic error alert, status unchanged, no queue entry created | `[id].tsx:154-178` |
| M6 | Deleting an accident with no network fails outright | phone offline, confirm delete | generic error alert, row not removed locally or remotely | `[id].tsx:180-209` |

### Group N - claims-panel permissions (6 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| N1 | Requesting closure has NO role gate | role = Driver (not admin/manager/director) | Request Closure button IS shown and usable | `AccidentClaimsPanel.tsx:232-239` (outside the `canManage` block at `:198-221`) |
| N2 | Approving/rejecting closure IS gated to `canManage` | role = Driver | Approve/Reject buttons NOT shown | `:198` |
| N3 | Editing Claim & Responsibility is gated to `canManage` | role = Driver | Edit link not shown, `ClaimEditModal` unreachable | `:249-254` |
| N4 | Adding a case-log remark has NO role gate | role = Driver | remark input and send button both usable | `:380-397` (no `canManage` check anywhere in this block) |
| N5 | A remark is a direct insert with no offline path | phone offline, send a remark | error alert, text neither cleared nor queued | `:109-124` |
| N6 | The Claim edit modal keeps unsaved changes in memory only, with no draft persistence | open `ClaimEditModal`, edit several fields, kill the app before saving | edits are lost - no local storage, no queue entry | `:608-871`; no `AsyncStorage`/draft reference anywhere in the file |

### Group O - parts ledger (5 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| O1 | Adding a part requires only a name | `name=''`, everything else filled | `Alert.alert('Required', 'Enter a part name.')`, save refused | `AccidentClaimsPanel.tsx:550` |
| O2 | Quantity and unit cost default to sane values when left blank/non-numeric | `qty=''`, `cost=''` | `quantity: 1` (`Number('')||1`), `unit_cost: 0` | `:556-557` |
| O3 | `total_cost` is never sent by the client | inspect the insert payload | no `total_cost` key present | `:552-561`; section 6.3 |
| O4 | Add/Delete are both gated `canManage`; there is no Edit | role = Driver | neither Add nor Delete controls render; no per-row edit action exists at all | `:325-330`, `:355-359` |
| O5 | Deleting a part is a direct, un-queued call | phone offline, tap delete on a part | error alert, part remains in the ledger | `:154-158` |

### Group P - case-log remarks (3 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| P1 | A blank remark is silently ignored, not alerted | `newRemark = '   '` -> press send | `addRemark()` returns early on `if (!text) return`, no error shown, no insert attempted | `AccidentClaimsPanel.tsx:110-111` |
| P2 | Every client-side remark is written as `remark_type: 'note'` | any remark sent from this screen | payload always `remark_type: 'note'`, regardless of content | `:118` |
| P3 | The other seven `RemarkType` values are never produced by any client file read in this session | grep all four detail/claims files for `remark_type:` | exactly one literal, `'note'`, at `AccidentClaimsPanel.tsx:118` | `types.ts:252-254`; section 6.5 |

### Group Q - dashboard KPIs, filters, and the row cap (8 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| Q1 | The base load is capped at 200 rows with no paging | org has 250 accidents matching the active filters | only the newest 200 are ever fetched | `dashboard.tsx:88-92` |
| Q2 | "Open" counts six of the seven status tokens, not just "not reported" | rows with every status except `closed` | all counted as Open | `dashboard.tsx:128` |
| Q3 | "This Month" compares a UTC-derived prefix against a locally-entered date | `incident_date = '2026-03-01'` entered near a GCC midnight boundary, `new Date().toISOString()` in UTC | a possible off-by-one-day mismatch, unguarded | `dashboard.tsx:126`, `:129`; contrast `report.tsx:131-133`'s deliberate local-time formatting |
| Q4 | "Critical" is severity `fatal` OR `severe` | a `moderate` accident | not counted as critical | `dashboard.tsx:130` |
| Q5 | Site filter chips are only offered to elevated roles, and only from what is ALREADY loaded | role = Tyre Man | no site filter row rendered at all | `dashboard.tsx:250-273`, `:81` |
| Q6 | Status filter (open/closed) and search both run client-side over the capped set | 201st-oldest matching accident exists beyond the load | invisible to both filters and the search box, with no "showing N of M" indicator anywhere | `dashboard.tsx:138-153`; section 9.1 |
| Q7 | Search matches `accident_type` by its RAW token, not its translated label | search text `'Rear-end'` (the display label) against a row with `accident_type = 'rear_end'` | no match, because the substring test runs on the raw token | `dashboard.tsx:151`; section 9.3 |
| Q8 | The 'mine' filter tab is server-side, not client-side | `filterTab = 'mine'` | query adds `.eq('reported_by', profile.id)` BEFORE the 200-row cap is applied, so it does not compound with the cap the way status/search do | `dashboard.tsx:94-96` |

### Group R - PDF export field set (5 cases)

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| R1 | The PDF prints five sections regardless of how much data is present | an accident with only the required fields filled | Incident/Claim/Recovery/Parts/Log/Photos sections all render, empty ones say "No parts recorded" / "No log entries" / "No photos" rather than being omitted | `accidentPdf.ts:40-56` |
| R2 | Classification & GCC fields are absent from the PDF even when populated | `najm_status`, `gcc_liability_ratio`, `fault_status` all set on the row | none appear anywhere in the generated HTML | `accidentPdf.ts:82-137`; section 8.2 |
| R3 | Repair & Release fields are absent from the PDF even when populated | `repair_type`, `workshop_name`, `release_date` all set | none appear anywhere in the generated HTML | same as R2 |
| R4 | `accident_type`/`severity`/`status` print as raw DB tokens; `claim_status`/`recovery_status`/`recovery_source`/part `status` print as translated labels, in the same document | one accident with both kinds of field populated | the first three show snake_case/lowercase tokens, the rest show human labels | `accidentPdf.ts:84-86` vs `:99`, `:113`, `:115`, `:46`; section 8.3 |
| R5 | Net cost is computed the same way as the claims panel, independently | same `estimated_damage_cost`, `partsTotal`, `recovered_amount` inputs fed to both `accidentPdf.ts` and `AccidentClaimsPanel.tsx` | identical result from two separate implementations | `accidentPdf.ts:35-37`; `AccidentClaimsPanel.tsx:165-166`; section 6.4 |

### Group S - cross-file contradiction regression pins (6 cases)

These exist to make the findings in section 11 individually testable, so a
future fix (or a deliberate decision to preserve current behaviour) has a
concrete assertion to change rather than a prose paragraph to reinterpret.

| # | Name | Input | Expected | Proof |
|---|---|---|---|---|
| S1 | `recovery_status = 'Yes'` (a value the create form CAN write) is not a key in `RECOVERY_STATUS_LABELS` | `RECOVERY_STATUS_LABELS['Yes']` | `undefined` | `types.ts:238-241`; section 1.3 |
| S2 | `recovery_status = 'Yes'` is not a key in `RECOVERY_STATUS_COLORS` either | `RECOVERY_STATUS_COLORS['Yes']` | `undefined`, so the claims-panel chip background becomes the string `'undefined1F'` | `types.ts:242-244`; `AccidentClaimsPanel.tsx:164`, `:287` |
| S3 | `STATUS_ICONS[accident.status]` is unguarded specifically in `[id].tsx`, and guarded specifically in `dashboard.tsx`, for the identical map and the identical column | same accident row rendered on both screens with `status = 'awaiting_parts'` | `[id].tsx` passes `undefined` to `Ionicons name`; `dashboard.tsx` renders `'ellipse-outline'` | `[id].tsx:247` vs `dashboard.tsx:417`; section 1.2 |
| S4 | `report.tsx`'s and `AccidentClaimsPanel.tsx`'s `computeRecovered` are two separate function bodies, not one shared import | grep both files for `function computeRecovered` / `const computeRecovered` | two distinct definitions | `report.tsx:121-124`; `AccidentClaimsPanel.tsx:59-62` |
| S5 | The create-form vocabulary for `recovery_status` (`RECOVERY_DECISION_OPTS`) and the claims-panel vocabulary (`RECOVERY_STATUSES`) share zero values | intersect the two arrays | empty set - `{'Yes','No','N/A'}` ∩ `{'pending','partial','recovered','written_off'}` = `{}` | `report.tsx:104`; `AccidentClaimsPanel.tsx:43` |
| S6 | `AccidentDraft`/`emptyAccidentDraft` in `types.ts` have zero import sites outside their own declaration | grep `mobile/` for `AccidentDraft` and `emptyAccidentDraft` | only the declaration itself and one comment (`report.tsx:158-159`) referencing it by name to explain why it is NOT used | `types.ts:320-361`; section 11, finding #14 |

---

## 11. Defects and cross-file contradictions found in the current app

Restated as a single numbered list for anyone triaging what to fix versus
what to deliberately port unchanged. Each is cited to its full explanation
above, and to the Group-S regression pin that makes it testable where one
exists.

| # | Finding | Severity | See |
|---|---|---|---|
| 1 | `accidents.recovery_status` is written with two mutually unintelligible vocabularies (`Yes/No/N/A` from the create form vs `pending/partial/recovered/written_off` from the claims panel), and the label/colour maps only recognise the second - a create-form default renders as "Recovery: undefined" | High | 1.3, S1-S2, S5 |
| 2 | `AccidentStatus` type + `STATUS_ICONS` cover 3 values; the create form writes 7; `[id].tsx:247` looks up `STATUS_ICONS[accident.status]` with NO fallback for the other 4 (dashboard's equivalent lookup IS guarded) | High | 1.2, S3 |
| 3 | `AccidentType` type covers 7 values; the create form writes 13; the 6 extra tokens (`rear_end`, `side_swipe`, `reversing`, `fire`, `vandalism`, `weather`) are untyped and their i18n coverage is unverified | Medium | 1.1, A4, 13.1 |
| 4 | `dashboard.tsx`'s `STATUS_KIND` map is missing `awaiting_parts` (one of the 7 create-form-writable status tokens) and includes `released`, which no writer read in this session produces for the `status` column | Medium | 1.2, 1.4, D3-D4 |
| 5 | Three structurally independent "where is this case" concepts (`status`, `closure_status`, the web case/workstream model) coexist on one row with no cross-validation | High | 2 |
| 6 | `severity` has a 4th DB value, `fatal`, unreachable from the mobile create form under any input | Low | 3.4, B3 |
| 7 | The exported PDF omits the entire Classification/GCC-case and Repair/Release blocks that the app itself shows and lets an elevated user edit | High | 8.2, R2-R3 |
| 8 | The PDF prints `accident_type`/`severity`/`status` as raw DB tokens while printing `claim_status`/`recovery_status`/`recovery_source`/part `status` through label maps, in the same document | Low | 8.3, R4 |
| 9 | The field-parity form logic (option lists, `najmHasReport`/`taqdeerHasReport`/`repairIsInternal`/`computeRecovered`) is duplicated byte-for-byte between `report.tsx` and `AccidentClaimsPanel.tsx` with no shared module - this is the mechanism that let finding 1 happen | Medium | 6.2, S4 |
| 10 | Net-cost (`gross - recovered`) is computed independently in `AccidentClaimsPanel.tsx` and `accidentPdf.ts` | Low | 6.4, R5 |
| 11 | Accidents have NO linkage to `corrective_actions` or `rca_records` anywhere in the mobile app, despite the migration matrix phase map grouping "Accidents, evidence, claims, RCA, PDFs" as one phase (`09-migration-matrix.md` section 2, Phase 9) | Medium | 12 |
| 12 | The accident report captures no device GPS (`gps_lat`/`gps_lng`/`gps_accuracy`/`gps_captured_at`), unlike the inspection module, which captures all four on the same codebase (`mobile/lib/types.ts:137-145`, `InspectionPayload`) | Medium | 12 |
| 13 | `dashboard.tsx` loads accidents with a bare `.limit(200)` and no paging; the open/closed and search filters run client-side over that capped set with no "showing N of M" indication | Medium | 9.1, Q1, Q6 |
| 14 | `AccidentDraft`/`emptyAccidentDraft` (`types.ts:320-361`) have zero consumers anywhere in `mobile/` outside their own declaration - dead code the create form deliberately does not use (`report.tsx:158-159` says so) | Low | S6 |
| 15 | `ClaimEditModal`'s Najm-report `onSelect` handler is a no-op ternary, `najmHasReport(v) ? v : v` (`AccidentClaimsPanel.tsx:759`) - both branches are identical, so the condition has no effect; functionally equivalent to `v => set('najm_status', v)` | Trivial | 6.2 |
| 16 | Artifact 01 section 2.8 records the `REPORT_ACCIDENT` offline allow-list as "a 50-column allow-list"; this document counted the live array at `recordQueue.ts:212-227` directly and got 54, which matches `command_registry.dart:112-117`'s own independently-stated figure exactly. Artifact 01's "50" is a stale or imprecise figure against the current source | Low | 3.7, L1 |

---

## 12. RCA and GPS: the two gaps not otherwise covered in the table above

**RCA/corrective-actions linkage.** `mobile/app/(app)/rca.tsx:74-76` reads
and writes the `rca_records` table keyed on `asset_no`/`tyre_serial` only -
no `accident_id` column is selected or referenced anywhere in that file.
`mobile/app/(app)/tasks.tsx:69-71` reads `corrective_actions` selecting
`id,title,priority,status,site,asset_no,description,assigned_to,due_date,
created_at` - again, no `accident_id`. Neither `accidentPdf.ts` nor
`AccidentClaimsPanel.tsx` reference either table. **In the current mobile
app, an accident and any RCA or corrective action that resulted from it are
two completely unconnected records**, joinable at best by matching
`asset_no` and eyeballing dates. This matters directly for Phase 9's exit
criterion ("evidence is linked by stable IDs") - there is no ID link to
preserve, because none exists today; Flutter would be adding a real
capability, not porting one, exactly as artifact 05 flags the inspection
draft as a new capability rather than a port (risk R2, migration matrix
section 5).

**GPS.** A grep of `report.tsx` for `gps`/`Location.` returns no matches.
Compare `InspectionPayload` (`types.ts:112-146`), which carries
`gps_lat`, `gps_lng`, `gps_accuracy`, `gps_captured_at` and documents that a
denied/unavailable fix is null and never blocks the inspection. The accident
form has the equivalent capability available elsewhere in this same codebase
and simply does not call it - it captures only the free-text `location`
dropdown/field (section 3.2). Whether `accidents` even carries GPS columns
for a future writer to populate is UNVERIFIED (section 13, item 8).

---

## 13. Open questions and UNVERIFIED items

The Supabase connector was not available in this session. Each item needs a
live database check before Flutter code depends on it.

**1. Does the locale dictionary carry all 13 `accident_type` tokens and all 7
(or more) `status` tokens?** Section 1.1 and 1.2 depend on this to know
whether the untyped values render a real word or a raw i18n key on screen.
Not checked - `mobile/locales/en.json` / `ar.json` were not read in this
session.

**2. What are the live CHECK constraints on `accidents.status`,
`accidents.accident_type`, `accidents.severity` and `accidents.recovery_status`?**
This is the actual authority the mobile client's `toDb*` functions are
guessing at. Query:

```sql
select conname, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'public.accidents'::regclass
   and contype = 'c';
```

**3. Does `accidents.recovery_status` currently hold BOTH vocabularies live -
`'Yes'`/`'No'`/`'N/A'` rows from the mobile create form AND
`'pending'`/`'partial'`/`'recovered'`/`'written_off'` rows from the claims
panel - or has one path never actually been used in production?**

```sql
select recovery_status, count(*) from public.accidents group by 1 order by 2 desc;
```

**4. What does `accidents.status` actually contain across live rows, and in
what proportion?** Decides how urgent finding #2 in section 11 is.

```sql
select status, count(*) from public.accidents group by 1 order by 2 desc;
```

**5. What happens to `accident_parts` and `accident_remarks` rows on delete?**
`[id].tsx:193` deletes only the parent row; whether an FK `ON DELETE CASCADE`
removes the children or leaves them orphaned was not checked.

```sql
select conname, confdeltype
  from pg_constraint
 where confrelid = 'public.accidents'::regclass and contype = 'f';
```

**6. Do `request_accident_closure` / `approve_accident_closure` /
`reject_accident_closure` enforce the same `isAdminOrAbove` role check the
client applies for approve/reject, or is the client gate the only boundary?**

```sql
select proname, prosecdef, pg_get_functiondef(oid)
  from pg_proc
 where proname in ('request_accident_closure','approve_accident_closure',
                    'reject_accident_closure');
```

**7. Is `accident_parts.total_cost` a generated column, a trigger, or is it
silently left null on insert (since the client never sends it)?**

```sql
select column_name, is_generated, generation_expression
  from information_schema.columns
 where table_name = 'accident_parts' and column_name = 'total_cost';
```

**8. Does `accidents` carry `gps_lat`/`gps_lng`/`gps_accuracy`/
`gps_captured_at` columns already (unused by mobile, section 12), or would
adding GPS capture require a schema change?**

```sql
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'accidents'
 order by ordinal_position;
```

**9. Is the `accident_case_workstreams` migration (web V417, referenced at
`accidentCase.ts:8`) actually applied on the environment Flutter will target?**
Section 2 and 7.3 depend on this for whether concept 3 of the status model is
live data or an always-`provisioned:false` dead branch on day one.

```sql
select to_regclass('public.accident_case_workstreams') is not null as provisioned;
```

**10. `RemarkType` declares 8 values; only `'note'` was observed being
written from a client file in this session.** Confirm the other seven
(`insurance`, `repair`, `responsibility`, `status_change`, `closure_request`,
`closure_approved`, `closure_rejected`) are actually written somewhere
(presumably server-side, by the closure RPCs and a status-change trigger)
and are not simply dead enum members.

```sql
select remark_type, count(*) from public.accident_remarks group by 1 order by 2 desc;
```

---

## 14. What a future Flutter Accidents dispatch needs to know before starting

The migration matrix's Phase 9 exit criterion (section 3): **"the workstream
status logic matches production, evidence is linked by stable IDs, and no
invented field appears."** Measured against what this document actually
found:

- **"Workstream status logic matches production" is now answerable, but
  "production" is three logics, not one.** Section 2 is the artifact to
  build against. Whichever of `status` / `closure_status` / the
  workstream-completion model becomes the Flutter feature's primary status
  concept is a real product decision (AD1 below) - this document does not
  make it for you, because the current app itself has not made it either.
- **"Evidence is linked by stable IDs" is achievable for photos** (section
  4.4 - the storage ref plus filename-prefix category is a real, if
  clumsy, stable link) **but is currently FALSE for RCA/corrective actions**
  (section 12) - there is nothing to preserve there because nothing links
  them today. Building that link in Flutter is new work, not a port, and
  should be scoped and estimated as such.
- **"No invented field appears" is the one criterion this document can
  confirm is achievable purely by following the field tables in sections 3.2,
  6.2 and 8.1** - every field in this document traces to a real column
  observed being written or read by production source. The risk is the
  opposite direction: a Flutter build that trusts `types.ts`'s unions instead
  of the wider vocabulary `report.tsx` actually writes (section 1) will
  REJECT real, legitimately-created data as invalid, which is arguably worse
  for a migration than inventing a field would be.

### Genuinely ambiguous items needing a product-owner decision (AD-series, this artifact's own register)

Matches the style of the D-series decisions in `01-feature-inventory.md` and
`09-migration-matrix.md`, but does not renumber into that sequence since
neither of those files scoped these specific questions.

| ID | Decision | Why it cannot be resolved by reading source |
|---|---|---|
| AD1 | Which of `status`, `closure_status`, or the workstream-completion model is the Flutter feature's PRIMARY status signal on the accident list/detail screens? | All three exist, none supersedes another today, and each is edited by a different surface (section 2) |
| AD2 | Should `recovery_status` be unified onto ONE vocabulary before Flutter ships, or should Flutter model it as two historically-different value spaces and migrate the data? | This is a data decision (finding #1, section 11) with real rows possibly already written under both schemes (open question 3, section 13) - not something Flutter code can paper over unilaterally |
| AD3 | Does the Flutter accident detail screen get full status-change coverage (all live tokens, not the current 3-of-7), or does it deliberately preserve the narrower set for a reason not recorded in the source (e.g. those states are meant to be system-driven, not manually set)? | The narrowing in `[id].tsx:44` is unexplained in the source - no comment states why `repair_in_progress`/`awaiting_parts`/`awaiting_approval`/`insurance_claim` are excluded from manual re-selection |
| AD4 | Should Flutter capture device GPS on accident report, matching the inspection module's capability (section 12), or is free-text location a deliberate choice for this feature (e.g. GCC liability paperwork requires a named site, not coordinates)? | Nothing in the source states a reason either way; the capability exists in the same codebase for a sibling feature and simply was not used here |
| AD5 | Should the Flutter PDF export include the Classification/GCC/Repair fields the current PDF omits (finding #7), given that omission may be intentional scoping (a shorter document for a specific audience) rather than an oversight? | No comment or test in `accidentPdf.ts` explains the omission either way |
| AD6 | Should accident creation and RCA/corrective-action creation be linked by a shared `accident_id` in the Flutter data model, closing finding #11, or is that explicitly out of scope for the mobile app (web-only feature)? | The migration matrix groups them in one phase (`09-migration-matrix.md`, Phase 9 scope: "Accidents, evidence, claims, RCA, PDFs") but the current mobile app treats them as unrelated; artifact 01's own decision D5 covers a different, adjacent gap (repair-request/RFR) and does not settle this one |

None of these six blocks writing the Flutter data layer or the read-only
screens (list, detail-view, case status) - they block the WRITE screens
(report form, claims edit, status change) reaching parity, because parity
with an inconsistent original requires knowing which inconsistency to keep
and which to fix. Per AGENTS.md rule 1 ("never fabricate fleet data") and
rule 4 ("never hard-code KPIs"), Flutter must not silently pick an answer to
any of AD1-AD6 and present it as if it were what production does - production
does not have one consistent answer to any of them, and this document is the
proof.
