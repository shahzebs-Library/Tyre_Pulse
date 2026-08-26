# 05. Local database schema

Artifact 5 of the nine required by section 75 of the Flutter migration spec.

This is the PERSISTENCE counterpart to artifact 06 (the offline command
registry). Artifact 06 answers "what may be queued and under what contract";
this file answers "where does it live on the device, and what shape does it
have". The two must be read together and neither repeats the other.

Sources read for this file: `mobile/lib/secureStorage.ts`,
`mobile/lib/recordQueue.ts`, `mobile/lib/offlineQueue.ts`,
`mobile/lib/durablePhotos.ts`, `mobile/lib/photoUpload.ts`,
`mobile/lib/checklistDraft.ts`, `mobile/lib/storageRefs.ts`,
`mobile/lib/savedSignature.ts`, `mobile/lib/userSignature.ts`,
`mobile/lib/authLifecycle.ts`, `mobile/lib/fetchAllRows.ts`,
`mobile/lib/fetchAll.ts`, `mobile/lib/ids.ts`, `mobile/contexts/AuthContext.tsx`,
the seven relevant `mobile/__tests__/*.ts`, and the `client_uuid` migrations
V81 / V125 / V213 / V215 / V271 / V292 / V608.

## Confidence key

Same convention as artifacts 02 and 06.

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (mobile source, a test, or a `MIGRATIONS_V*.sql`) |
| RECORDED | A measured live figure quoted from PROJECT_MEMORY |
| UNVERIFIED | Needs a live database or a device check. The Supabase connector was unauthenticated when this was written |

Everything below is VERIFIED unless marked otherwise.

---

## 1. What the RN app persists today

This is the migration input. Every row was read from source, not inferred.

### 1.1 The durability classes

There are three, and the difference between them is the whole design.

| Class | Mechanism | Property that matters |
|---|---|---|
| **secure** | `expo-secure-store` through the chunked adapter in `mobile/lib/secureStorage.ts` | Writes are STAGED (a new chunk generation, with the metadata write as the single commit point) and reads report WHY they came back empty (`ok` / `absent` / `unreadable` / `torn`). Nothing else on the device has either property |
| **durable file** | A named subfolder of `Paths.document` | The OS never evicts it. Two such folders exist and they deliberately do NOT share ownership of a file |
| **plain preference** | `@react-native-async-storage/async-storage` | No staging, no read health. Used only where losing the value costs nothing |

A fourth location exists and is NOT a persistence class: `Paths.cache`, where the
camera and image picker write. Android and iOS may purge it at any moment. Every
photo path that starts life there is copied out before it is trusted.

### 1.2 The store

| Storage key or path | Shape | Written by | Read by | Class |
|---|---|---|---|---|
| supabase-js auth token (default key `sb-<project-ref>-auth-token`; no explicit `storageKey` is set in `mobile/lib/supabase.ts`, so the literal is UNVERIFIED) | Session JSON, chunked at 1800 chars | supabase-js via `storage: secureStorage` | supabase-js, `classifyRestore` | secure |
| `tp_inspection_queue_v1` | `OfflineInspection[]` as ONE JSON blob | `offlineQueue.ts` | `offlineQueue.ts`, home badge, tab badge, sync banner | secure |
| `tp_record_queue_v2` | `QueuedRecord[]` as ONE JSON blob | `recordQueue.ts` | `recordQueue.ts`, badges | secure |
| `tp_checklist_drafts_v1` | `ChecklistDraft[]` as ONE JSON blob, capped at `MAX_DRAFTS = 25` | `checklistDraft.ts` | checklists hub, checklist fill screen | secure |
| `tp_profile_cache_v1` | `{ userId, at, profile }` | `AuthContext.cacheProfile` | `AuthContext.readCachedProfile`, bounded by `PROFILE_CACHE_MAX_AGE_MS = 90 days` | plain preference |
| `tp_language` | Language code string | `LanguageContext` | `LanguageContext` | plain preference |
| `tp_theme_pref` | Theme preference string | `ThemeContext` | `ThemeContext` | plain preference |
| `<document>/queued-photos/q_<ts>_<rand>.<ext>` | Resized JPEG bytes | `durablePhotos.persistPhotoForQueue` | `recordQueue.resolveCommandPhotos`, `sweepOrphanQueuedPhotos` | durable file |
| `<document>/checklist-drafts/d_<ts>_<rand>.<ext>` | Resized JPEG bytes | `checklistDraft.persistDraftPhoto` | `restoreDraftPhotoMap`, `sweepDraftPhotos` | durable file |
| `<cache>/...` | Raw camera output | expo-camera, expo-image-picker | copied out immediately by the two functions above | NOT durable |
| Supabase Storage buckets `tyre-photos`, `accident-photos` | Uploaded image objects, addressed as `tp-storage://<bucket>/<path>` | `photoUpload.ts` | `storageRefs.resolveStorageUrl` (15-minute signed URL) | remote, not local |

**Five distinct local mechanisms**: chunked SecureStore, AsyncStorage, the
`queued-photos/` document folder, the `checklist-drafts/` document folder, and
the OS cache directory the camera writes into.

### 1.3 The gap this schema exists to close

Two things are absent from the table above and both are load-bearing.

**A. There is no local cache of business data at all.** The ONLY remote row the
app keeps is the signed-in person's own profile. `vehicle_fleet`, `sites`,
`tyre_records`, `checklist_templates`, `work_orders` and everything else are
fetched live on every screen open. With no signal a field worker can still
CAPTURE (the queues work) but cannot LOOK ANYTHING UP - no asset picker, no site
list, no tyre history, no checklist to fill. That is what spec section 11's
`cached_*` tables are for, and it is a genuine capability gain, not a port.

**B. The inspection capture screen has no draft.** `mobile/app/(app)/inspection/new.tsx`
contains zero references to `draft`, `AsyncStorage` or `secureStorage`
(VERIFIED by grep). A part-filled inspection - the asset, the meter reading, and
up to 13 tyre positions each with a condition and a photo - exists ONLY in React
state until the moment of submit. Backgrounding the app and letting Android
reclaim the process loses all of it silently. The CHECKLIST got draft
preservation (`checklistDraft.ts`, with a 65-line header explaining exactly this
failure); the INSPECTION did not. Spec section 11 names `inspection_drafts` and
section 20 requires that "answers remain, photos remain, signature remains,
selected vehicle remains, selected tyre remains". Today none of that is true.

**This is the biggest data-loss risk found.** Every other trap listed in this
document is already mitigated in the Expo app. This one is live.

### 1.4 Two structural problems the Drift schema removes by construction

**A blob is not a database.** All three queues and the draft store are ONE JSON
blob rewritten in full on every change. `recordQueue.ts` says so itself in a
header note that names `expo-sqlite` as the intended replacement and marks the
`save()` / `getRecordQueue()` pair as the seam. The consequences are all real:
every badge read deserialises the whole queue; two writers must be serialised by
hand (`checklistDraft.ts` keeps a `writeChain` promise for exactly this); and a
single corrupt entry threatens every other entry, which is why `parseDrafts`
filters per record rather than failing whole.

**An empty read means two different things.** `getQueue()` and
`getRecordQueue()` answer `[]` for both "nothing is queued" and "the Keystore
refused". The Expo fix was `readItem`'s four-value status plus a
`loadForWrite` that THROWS (`QueueUnreadableError`, `DraftStoreUnreadableError`)
rather than saving over a store it could not see. The stated trade is
deliberate: risk failing to save ONE item rather than silently destroying ALL of
them.

**RULE for Flutter: model every one of these as a real table with real rows. A
read failure must be an exception or a typed error, never an empty list. There
must be no code path anywhere that serialises a whole collection and writes it
back.** This makes both problems structurally impossible instead of a convention
somebody has to remember.

---

## 2. The Drift schema

**17 tables.** The 12 named by spec section 11, one of them renamed for a name
collision, plus 5 the source proves are also needed. Each addition is justified
where it appears.

Types are given as Drift column builders with the SQLite type they produce.
`TEXT` primary keys are used throughout because every identity in this system is
either a UUID or a server-generated text id; an autoincrement integer would
create a second identity that means nothing to the server.

### 2.0 The scope column, and why every cached table carries it

Every `cached_*` table carries:

```dart
TextColumn get workspaceId => text()();          // organisation_id
TextColumn get country      => text().nullable()(); // null = visible to all
```

Spec section 8 requires that changing workspace "invalidate scoped providers"
and "refresh affected local cache", and forbids hard-coding one company or
Saudi Arabia. Artifact 02 records that every business table carries
`organisation_id` and most carry `country` and `site`.

**Why a cache without a scope column leaks across a workspace switch.** The
cache is a local copy of rows the server released under a specific RLS context.
Change the active workspace and the server would now release a DIFFERENT set,
but the local rows do not know which context produced them. An unscoped
`cached_assets` therefore serves company A's fleet to a user who has just
switched to company B, in a picker, with no error and no way to tell. Worse, the
row a technician then picks gets written into a command whose payload names an
asset the new workspace has never heard of, and that command syncs. The read
looks like a caching bug and the write is a cross-tenant data error.

Two further consequences follow and both are enforced below:

1. **Every read query filters on `workspaceId`.** Not "usually" - a repository
   that forgets it returns another tenant's rows. This is why `workspaceId` is
   the FIRST column of every cache index, so an unscoped query is also the slow
   query and shows up in testing.
2. **The country filter must be null-safe.** Artifact 02 records that a strict
   equality on `country` silently hid 55,606 country-less rows on the web. The
   local predicate is `workspace_id = ? AND (country = ? OR country IS NULL)`,
   mirroring `applyCountry`.

Rows in `pending_commands`, `pending_media_uploads`, the two draft tables and
`captured_signatures` carry `workspaceId` too, but for a different reason: to
prove which workspace the work was captured in, so a sync running under a
switched workspace can refuse to push it rather than write it into the wrong
tenant. See section 2.8.

### 2.1 `workspace_scope` (ADDITION)

The active workspace context from spec section 8. Added because every other
table in this schema references it and there is nowhere else for it to live.
One row per workspace the user has, plus a single-row marker for the active one.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `workspaceId` | `TextColumn` | TEXT | no | PRIMARY KEY. `organisation_id` |
| `tenantId` | `TextColumn` | TEXT | yes | Spec 8. UNVERIFIED whether the server exposes a tenant above organisation |
| `companyName` | `TextColumn` | TEXT | yes | Display only |
| `country` | `TextColumn` | TEXT | yes | Active country. Null = all countries the user may see |
| `currency` | `TextColumn` | TEXT | yes | Spec 8 forbids hard-coding SAR |
| `siteIdsJson` | `TextColumn` | TEXT | no | JSON array. The `profiles.sites` scope array; the sentinel `ALL` means org-wide |
| `userId` | `TextColumn` | TEXT | no | Whose context this is |
| `role` | `TextColumn` | TEXT | no | `profiles.role`, Title Case as the server stores it |
| `isSuperAdmin` | `BoolColumn` | INTEGER | no | Default false |
| `isActive` | `BoolColumn` | INTEGER | no | Exactly one row true |
| `lastVerifiedAt` | `DateTimeColumn` | INTEGER | no | When the server last confirmed this context |

Index: `idx_workspace_active ON (isActive)` - the app asks "which workspace am I
in" on every navigation build, and it must be one row read, not a scan.

**Currency and country are nullable and have no default.** A fabricated default
is precisely the Kotlin defect spec section 8 names. Null renders as "not set",
never as SAR.

### 2.2 `cached_users`

Remote source: `profiles` (11 call sites, artifact 02). RECORDED size: 38 rows.
Fits in one request, well under the 1000-row cap.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY. `profiles.id` (auth uid) |
| `workspaceId` | `TextColumn` | TEXT | no | Section 2.0 |
| `country` | `TextColumn` | TEXT | yes | Null-safe filter |
| `fullName` | `TextColumn` | TEXT | yes | |
| `username` | `TextColumn` | TEXT | yes | |
| `role` | `TextColumn` | TEXT | yes | |
| `approved` | `BoolColumn` | INTEGER | yes | Nullable on purpose: unknown is not false |
| `locked` | `BoolColumn` | INTEGER | yes | Same |
| `sitesJson` | `TextColumn` | TEXT | yes | JSON array |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | Staleness, section 8 |

Indexes:
- `idx_cached_users_scope ON (workspaceId, role)` - the approver picker and the
  "who signs" screens ask for users by role within the workspace.
- `idx_cached_users_name ON (workspaceId, fullName)` - name search in pickers.

**The signed-in user's own profile is NOT stored here.** It has its own copy in
`sync_metadata` (section 2.12) because it decides whether the app opens at all,
it is bounded by a different rule (90 days, `PROFILE_CACHE_MAX_AGE_MS`), and it
must be readable before any workspace is resolved. Mixing the two would make
opening the app depend on a table that is only populated after a successful
sync.

### 2.3 `cached_sites`

Remote source: `sites` (7 call sites) and the `reference_site_options` RPC.
RECORDED size: 62 rows. One request.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `country` | `TextColumn` | TEXT | yes | |
| `name` | `TextColumn` | TEXT | no | The canonical UPPER site name |
| `region` | `TextColumn` | TEXT | yes | |
| `active` | `BoolColumn` | INTEGER | yes | |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `idx_cached_sites_scope ON (workspaceId, country, name)` - every site picker
  is exactly this query, ordered by name.

**Site names are stored verbatim as the server returns them.** RECORDED: the
server normalises site casing and applies aliases through triggers. A client
that re-normalises would produce a value the server's own `.eq()` filters no
longer match. The client compares, it does not canonicalise.

### 2.4 `cached_assets`

Remote source: `vehicle_fleet` (23 call sites, the most central table) and the
`reference_asset_options` RPC. RECORDED size: 1,617 rows (KSA 1,030 / UAE 452 /
Egypt 135), 1,377 distinct asset codes.

**This table is over the 1000-row cap, so filling it MUST page.** RECORDED: the
picker truncation this caused read to users as "that asset was never created".
The table read pages with `fetchAllPages`-equivalent offset paging on a total
order; the RPC pages by IDENTITY per artifact 02.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY. `vehicle_fleet.id` |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `country` | `TextColumn` | TEXT | yes | |
| `assetNo` | `TextColumn` | TEXT | no | The code a technician types or scans |
| `assetNoNorm` | `TextColumn` | TEXT | no | Trimmed + uppercased, for lookup. See below |
| `fleetNumber` | `TextColumn` | TEXT | yes | |
| `registrationNo` | `TextColumn` | TEXT | yes | Plate |
| `chassisNo` | `TextColumn` | TEXT | yes | |
| `serialNo` | `TextColumn` | TEXT | yes | |
| `vehicleType` | `TextColumn` | TEXT | yes | Drives the tyre diagram layout |
| `make` | `TextColumn` | TEXT | yes | |
| `model` | `TextColumn` | TEXT | yes | |
| `site` | `TextColumn` | TEXT | yes | |
| `currentKm` | `IntColumn` | INTEGER | yes | Nullable. RECORDED: set on a minority of assets, and a fabricated 0 would read as a real odometer |
| `status` | `TextColumn` | TEXT | yes | Active / Inactive |
| `opsStatus` | `TextColumn` | TEXT | yes | What it is doing today, distinct from `status` |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `UNIQUE idx_cached_assets_identity ON (workspaceId, country, assetNoNorm)` -
  **the identity is (workspace, country, asset code), never the code alone.**
  RECORDED: 239 asset codes exist in more than one country and are usually
  DIFFERENT machines (`GN103` is a Caterpillar generator in KSA and a Sany one
  in UAE). A unique index on `assetNoNorm` alone would silently merge them.
- `idx_cached_assets_lookup ON (workspaceId, assetNoNorm)` - the scanner and the
  asset picker resolve a typed or scanned code. `assetNoNorm` exists so this is
  an index seek; matching on `UPPER(TRIM(assetNo))` at query time cannot use an
  index and turns every keystroke into a full scan of 1,617 rows.
- `idx_cached_assets_plate ON (workspaceId, registrationNo)` - spec 34 requires
  search by registration.
- `idx_cached_assets_chassis ON (workspaceId, chassisNo)` - spec 34, chassis.
- `idx_cached_assets_site ON (workspaceId, country, site)` - "assets at my site"
  is the default picker view.

### 2.5 `cached_tyres`

Remote source: `tyre_records` (10 call sites). RECORDED size: 11,193 rows.

**This table is deliberately NOT a full mirror.** Eleven thousand rows of tyre
history is both a slow first sync on a field phone and mostly irrelevant: a
technician needs the tyres on the machine in front of them and the ones they
looked up recently. It is populated on demand (by asset, or by serial from a
scan) and pruned by count.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `country` | `TextColumn` | TEXT | yes | |
| `serialNo` | `TextColumn` | TEXT | yes | Nullable: RECORDED, some rows carry no serial |
| `serialNoNorm` | `TextColumn` | TEXT | yes | Trimmed + uppercased. See the case-split note below |
| `assetNo` | `TextColumn` | TEXT | yes | |
| `position` | `TextColumn` | TEXT | yes | Canonical GCC position label |
| `brand` | `TextColumn` | TEXT | yes | |
| `size` | `TextColumn` | TEXT | yes | |
| `status` | `TextColumn` | TEXT | yes | Active / Removed / Scrapped |
| `issueDate` | `DateTimeColumn` | INTEGER | yes | Fitment |
| `removalDate` | `DateTimeColumn` | INTEGER | yes | |
| `kmAtFitment` | `IntColumn` | INTEGER | yes | |
| `kmAtRemoval` | `IntColumn` | INTEGER | yes | |
| `totalKm` | `IntColumn` | INTEGER | yes | |
| `removalReason` | `TextColumn` | TEXT | yes | |
| `lastSeenAt` | `DateTimeColumn` | INTEGER | no | Drives count-based pruning, section 8 |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `idx_cached_tyres_asset ON (workspaceId, assetNo, position)` - the tyre bay
  view is "every tyre on this machine, by position".
- `idx_cached_tyres_serial ON (workspaceId, serialNoNorm)` - serial search and
  the barcode scanner.
- `idx_cached_tyres_prune ON (lastSeenAt)` - the pruner orders by this.

**`serialNoNorm` is a LOOKUP aid and must not be written back.** RECORDED: the
server's `serial_no` is case-split (a real tyre's life is recorded half under
`k507B403590` and half under `K507B403590`), and the recorded decision was
explicitly NOT to normalise the column, because the barcode scan lookup is a
case-sensitive `.eq()` and uppercasing it turns a split-history bug into a
cannot-find-the-tyre bug in the field. So: search the local cache
case-insensitively via `serialNoNorm` to HELP the technician find the row, then
send `serialNo` verbatim in any command. Never send the normalised form.

### 2.6 `cached_checklist_templates`

Remote source: `checklist_templates` (2 call sites). RECORDED size: 6 published
templates.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `country` | `TextColumn` | TEXT | yes | |
| `name` | `TextColumn` | TEXT | no | |
| `version` | `IntColumn` | INTEGER | no | See the version rule below |
| `status` | `TextColumn` | TEXT | no | Only `published` is fillable |
| `icon` | `TextColumn` | TEXT | yes | A token, resolved per platform |
| `category` | `TextColumn` | TEXT | yes | |
| `fieldsJson` | `TextColumn` | TEXT | no | The field definitions, verbatim |
| `assigneeRolesJson` | `TextColumn` | TEXT | yes | **Null means everyone.** An empty array means nobody |
| `requireSignature` | `BoolColumn` | INTEGER | no | |
| `requireApproval` | `BoolColumn` | INTEGER | no | |
| `minIntervalDays` | `IntColumn` | INTEGER | yes | |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `idx_templates_scope ON (workspaceId, country, status)` - the hub lists
  published templates for the workspace.

Two rules the cache must not break:

**`fieldsJson` is stored verbatim, not parsed into child tables.** The field
definitions carry conditional logic, shared option references and per-language
labels. Splitting them into relational tables would mean re-implementing the
server's own document shape and drifting from it on the next template edit. The
one thing that must be relational is a filled ANSWER, which is section 2.8.

**`assigneeRolesJson` null and empty are different and must stay different.**
RECORDED: null means the template is for everyone, and an empty array reads as
"targeted at nobody". A Dart mapper that coalesces null to `[]` hides every
checklist from the whole fleet. Store the JSON as received.

**A draft is pinned to the template VERSION it was started on.** If a supervisor
publishes version 3 while a sheet filled against version 2 is still open, the
answers were given against different questions. `checklist_drafts.templateVersion`
records which, and a resume against a changed version must warn rather than
silently re-map the answers.

### 2.7 `cached_permissions` (ADDITION)

Remote source: `user_access_grants` (1 call site) plus the role default matrix.
Added because spec section 9 requires the app to compute
`role default + user grants - user revocations`, and with no cached copy the
navigation an offline user sees would be whatever the last render left in
memory.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `userId` | `TextColumn` | TEXT | no | Composite PRIMARY KEY with `moduleKey` |
| `moduleKey` | `TextColumn` | TEXT | no | Mobile module key, e.g. `records`, `inspect` |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `effect` | `TextColumn` | TEXT | no | `grant` or `revoke` |
| `capability` | `TextColumn` | TEXT | no | Default `view` |
| `expiresAt` | `DateTimeColumn` | INTEGER | yes | An expired grant is not applied |
| `cachedAt` | `DateTimeColumn` | INTEGER | no | |

Index: `idx_permissions_user ON (userId, workspaceId)` - resolved once per
navigation build.

**A revoke always beats a grant, and a cache miss is never an allow.** The
recorded precedence is admin/super, then revoke, then role default, then grant,
then deny. An empty local table means "we have not loaded permissions", which
must render the role default, not a blank app and not an open one. RLS remains
the real boundary either way; this decides only which screens are offered.

**Mobile module keys are NOT web module keys.** RECORDED: writing `mobile:` in
front of a WEB key produced 68 permission rows that gated nothing, because the
phone reads its own key (`records`, not `tyre_records`). Flutter must carry the
mobile registry and only the mobile registry.

### 2.8 `inspection_drafts` and `inspection_draft_positions` (the second is an ADDITION)

This is the table that does not exist today (section 1.3 B). It is the reason
this artifact treats drafts as a first-class subsystem rather than a port.

`inspection_drafts`:

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `draftKey` | `TextColumn` | TEXT | no | PRIMARY KEY. `userId|assetNo` normalised. Section 6 |
| `userId` | `TextColumn` | TEXT | no | Whose work this is |
| `workspaceId` | `TextColumn` | TEXT | no | Which tenant it was captured in |
| `country` | `TextColumn` | TEXT | yes | |
| `assetNo` | `TextColumn` | TEXT | no | Normalised, uppercase |
| `vehicleType` | `TextColumn` | TEXT | yes | Pins the diagram layout at fill time |
| `site` | `TextColumn` | TEXT | yes | |
| `inspectorName` | `TextColumn` | TEXT | yes | |
| `odometerKm` | `IntColumn` | INTEGER | yes | Nullable. Zero IS a reading and must not be conflated with absent |
| `engineHours` | `RealColumn` | REAL | yes | Same |
| `findings` | `TextColumn` | TEXT | yes | |
| `filled` | `IntColumn` | INTEGER | no | Progress as the SCREEN counted it |
| `total` | `IntColumn` | INTEGER | no | |
| `createdAt` | `DateTimeColumn` | INTEGER | no | |
| `updatedAt` | `DateTimeColumn` | INTEGER | no | Sort key and the "last saved" line |

Indexes:
- `idx_inspection_drafts_user ON (userId, updatedAt DESC)` - "my unfinished
  work, newest first" is the only list view.

`inspection_draft_positions` (one row per tyre position):

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY, local UUID |
| `draftKey` | `TextColumn` | TEXT | no | FK -> `inspection_drafts.draftKey` ON DELETE CASCADE |
| `position` | `TextColumn` | TEXT | no | Canonical label, e.g. `LHF1` |
| `condition` | `TextColumn` | TEXT | yes | Good / Worn / Flat / Damaged / Puncture / Wear |
| `pressurePsi` | `RealColumn` | REAL | yes | Nullable. **Zero is a flat tyre, not "no reading"** |
| `treadDepthMm` | `RealColumn` | REAL | yes | |
| `serialNo` | `TextColumn` | TEXT | yes | |
| `checked` | `BoolColumn` | INTEGER | no | Default FALSE. See below |
| `updatedAt` | `DateTimeColumn` | INTEGER | no | |

Index:
- `UNIQUE idx_draft_position ON (draftKey, position)` - one row per wheel. This
  is what makes the completeness gate a query instead of a scan of a JSON blob.

Why this is a child table rather than a `tyreConditionsJson` column: spec
section 27 requires the app to show EXACTLY what is missing before submit, and
that question is "which of this vehicle's positions has no row, and which has a
row with no evidence". Both are one indexed query here and a full deserialise
plus loop over a blob otherwise, on a screen that re-evaluates on every tap.

**`checked` is a real column and it must default to FALSE.** RECORDED: both
capture forms pre-seed every wheel with `condition: 'Good'`, so a seeded Good
and a deliberate Good are byte-identical and no completeness rule can tell them
apart. The recorded fix was an explicit marker stamped by the single write path
for a tyre edit, counted only when explicitly true. A Drift column defaulting to
false reproduces that exactly. Getting this wrong makes the completeness gate
either vacuous or a refusal of one inspection in four.

### 2.9 `checklist_drafts`

A direct port of `mobile/lib/checklistDraft.ts`, which is the best-designed
piece of persistence in the RN app. Its rules are preserved and its blob is not.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `draftKey` | `TextColumn` | TEXT | no | PRIMARY KEY. `userId|templateId|assetNoNorm`. Section 6 |
| `userId` | `TextColumn` | TEXT | no | |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `templateId` | `TextColumn` | TEXT | no | |
| `templateName` | `TextColumn` | TEXT | no | Denormalised so the list renders offline |
| `templateVersion` | `IntColumn` | INTEGER | no | Section 2.6, the version pin |
| `assetNo` | `TextColumn` | TEXT | no | Normalised. Empty string until one is picked |
| `assignmentId` | `TextColumn` | TEXT | yes | |
| `site` | `TextColumn` | TEXT | yes | |
| `title` | `TextColumn` | TEXT | yes | |
| `readLang` | `TextColumn` | TEXT | yes | So a resumed sheet reads in the same language |
| `answersJson` | `TextColumn` | TEXT | no | Keyed by field id |
| `notesJson` | `TextColumn` | TEXT | no | Per-line remarks, keyed by field id |
| `printedName` | `TextColumn` | TEXT | yes | |
| `filled` | `IntColumn` | INTEGER | no | Counted by the screen, never re-derived here |
| `total` | `IntColumn` | INTEGER | no | |
| `createdAt` | `DateTimeColumn` | INTEGER | no | Preserved across later saves |
| `updatedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `idx_checklist_drafts_user ON (userId, updatedAt DESC)` - the unfinished-work
  list.
- `idx_checklist_drafts_resume ON (userId, templateId, assetNo)` - the resume
  candidate lookup when a template is opened. `resumeCandidates` narrows to one
  machine once an asset is known and offers every sheet for the template while
  none is picked; that is exactly this index used two ways.

Photos and signatures are NOT columns here. They are rows in
`draft_photos` (2.10) and `captured_signatures` (2.11), because both have their
own file lifecycle and their own sweep.

**A draft is never a row in `checklist_submissions`.** This is load-bearing and
the source explains why at length: the server mints the document number
(`WDC-TM514-2026-0001`) from a per (org, prefix, asset, year) counter on BEFORE
INSERT, deliberately so that an abandoned fill never burns one. A server-side
draft row would gap a numbered document register permanently. The first time a
sheet reaches the database is still the submit. Flutter must not "improve" this
by syncing drafts.

### 2.10 `draft_photos` (ADDITION)

Added because the queue's media table and the draft's media are two different
things with two different lifecycles, and merging them is the exact trap
section 4 documents.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY, local UUID |
| `ownerKind` | `TextColumn` | TEXT | no | `checklist_draft` or `inspection_draft` |
| `ownerKey` | `TextColumn` | TEXT | no | The owning `draftKey`. FK with ON DELETE CASCADE |
| `fieldKey` | `TextColumn` | TEXT | yes | Checklist field id, or the tyre position |
| `localPath` | `TextColumn` | TEXT | no | Absolute `file://` inside the draft media folder |
| `fileName` | `TextColumn` | TEXT | no | Basename. The healing and sweep key. See below |
| `sizeBytes` | `IntColumn` | INTEGER | yes | |
| `mimeType` | `TextColumn` | TEXT | yes | |
| `checksum` | `TextColumn` | TEXT | yes | MD5 where readable, else `size:mtime` |
| `capturedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `idx_draft_photos_owner ON (ownerKind, ownerKey)` - restore a draft's photos.
- `UNIQUE idx_draft_photos_file ON (fileName)` - the sweep and the iOS container
  heal both key on basename, so it must be unique.

**`fileName` is stored separately from `localPath` on purpose.** iOS rewrites
the document container path between launches, so an absolute path stored
yesterday can be stale while the file is perfectly intact. The RN code heals by
looking for the same basename in the CURRENT folder; a column makes that a
lookup instead of a string operation on every restore.

**A restore never lies about a photo.** If neither the stored path nor the
healed path exists, the row is deleted and the count of dropped photos is
returned to the screen, which says so. Carrying a dead path forward means
submitting evidence that is unreachable for everyone while reporting success.

### 2.11 `captured_signatures` (ADDITION)

Added because spec section 21 requires metadata alongside the mark, and section
21 plus `checklistDraft.signatures` prove there can be several per form. Section
5 of this document covers the shape.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY, local UUID |
| `ownerKind` | `TextColumn` | TEXT | no | `checklist_draft`, `inspection_draft`, `pending_command` |
| `ownerKey` | `TextColumn` | TEXT | no | FK by convention, cascade handled in the repository |
| `fieldKey` | `TextColumn` | TEXT | no | The form field id. `__primary__` for the template-level pad |
| `format` | `TextColumn` | TEXT | no | `svg` or `dataurl`. See section 5 |
| `payload` | `TextColumn` | TEXT | no | The mark itself. Length-capped, section 5 |
| `strokesJson` | `TextColumn` | TEXT | yes | Vector points, when the pad captured them |
| `signerUserId` | `TextColumn` | TEXT | yes | Spec 21 metadata |
| `signerName` | `TextColumn` | TEXT | yes | |
| `signerRole` | `TextColumn` | TEXT | yes | |
| `source` | `TextColumn` | TEXT | no | `drawn`, `saved` or `none`. See section 5 |
| `signedAt` | `DateTimeColumn` | INTEGER | no | |

Index:
- `UNIQUE idx_signature_slot ON (ownerKind, ownerKey, fieldKey)` - **one mark
  per FIELD, and the uniqueness is what makes that true.** A single global slot
  is the recorded defect: three trades signing a workshop sheet overwrote one
  another, only the last reached the database, and every signature tile read
  "signed" once any one was.

### 2.12 `pending_commands`

The Drift form of `QueuedRecord`. Column names follow spec section 12; the
mapping to the RN field is given so the port is traceable.

| Column | Dart | SQL | Null | Spec 12 name / RN field |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | `id`. PRIMARY KEY, local UUID |
| `commandType` | `TextColumn` | TEXT | no | `commandType` / `type`. One of the 16 in artifact 06 |
| `entityType` | `TextColumn` | TEXT | no | `entityType`. The target table, derived from the registry, never client-chosen |
| `entityId` | `TextColumn` | TEXT | yes | `entityId`. The match value for an update command; null for an insert |
| `payloadJson` | `TextColumn` | TEXT | no | `payload`. Already stripped to the allow-list |
| `createdAt` | `DateTimeColumn` | INTEGER | no | `createdAt` |
| `createdBy` | `TextColumn` | TEXT | no | `createdBy`. NEW: the RN queue does not record this |
| `workspaceId` | `TextColumn` | TEXT | no | `workspaceId`. NEW. See below |
| `country` | `TextColumn` | TEXT | yes | Captured scope |
| `retryCount` | `IntColumn` | INTEGER | no | `retryCount` / `retry_count`. Default 0 |
| `nextRetryAt` | `DateTimeColumn` | INTEGER | no | `nextRetryAt` / `next_attempt_at` |
| `status` | `TextColumn` | TEXT | no | `status`. See the six values below |
| `lastError` | `TextColumn` | TEXT | yes | `lastError` / `error` |
| `idempotencyKey` | `TextColumn` | TEXT | no | `idempotencyKey` / `idempotency_key`. Section 3 |
| `syncedAt` | `DateTimeColumn` | INTEGER | yes | `synced_at` |
| `dependsOn` | `TextColumn` | TEXT | yes | NEW. Another `pending_commands.id` that must succeed first. Spec 15 requires processing "by dependency/order" |

Statuses, exactly as spec section 12 lists them:
`pending`, `processing`, `retry`, `blocked`, `failed`, `synced`.

The RN queue has only three (`pending`, `synced`, `failed`), and the two extra
that matter are:
- `processing` - claimed by the sync engine. A crash mid-flight leaves a row
  visibly stuck rather than silently re-runnable, and the engine can reclaim
  rows whose claim is older than a timeout.
- `blocked` - a `dependsOn` predecessor has not succeeded, or the row was
  captured in a workspace that is no longer active. Distinct from `failed`:
  nothing is wrong with it, it simply may not run yet.

Indexes:
- `idx_commands_due ON (status, nextRetryAt)` - the sync engine's only hot
  query: "what is due now". Status first because it is the more selective
  column once synced rows are pruned.
- `idx_commands_pending_count ON (status)` - every badge, the tab bar and the
  sync banner ask for a count. This must be an index-only count, not a scan; the
  RN app deserialises the whole queue for it.
- `UNIQUE idx_commands_idem ON (idempotencyKey)` - a local guard that the same
  logical write cannot be enqueued twice by two screens.
- `idx_commands_workspace ON (workspaceId, status)` - see the rule below.

**`workspaceId` on a queued command is a refusal, not a filter.** The RN queue
does not record which workspace a command was captured in, so a sync running
after a workspace switch would push it under whatever context is now active.
That is a cross-tenant write. The Flutter rule: if `workspaceId` does not match
the active workspace, the row is set `blocked` and reported to the user as
"captured in another workspace", never pushed and never discarded. Spec section
8 requires a workspace change to "preserve safe offline transactions"; this is
what makes that safe rather than merely preserved.

**Retry policy is ported unchanged**: `MAX_RETRIES = 8`, backoff
`30s * 2^retry` capped at 30 minutes. On exhaustion the row goes `failed`, stays
in the table, and a manual "retry failed" resets `retryCount` to 0 and
`nextRetryAt` to now.

**A failed row still counts as pending work in the UI.** RECORDED: counting only
`pending` made every badge read 0 the moment an item failed, so the banner and
its in-context Sync button vanished and the technician was shown "all synced"
while an inspection sat unsent. The count is everything not `synced`.

**There is no `pending_inspections` table.** The RN app has two queues because
the inspection queue was written first; there is no behavioural difference
worth two implementations. An inspection is `commandType = 'INSPECTION'` with
its positions in `pending_media_uploads` and `captured_signatures` like any
other command. One queue, one sync engine, one lock - which is also what spec
section 15 demands.

### 2.13 `pending_media_uploads` (spec calls this `pending_uploads`)

**Renamed deliberately. `pending_uploads` is ALREADY a real REMOTE table**
(artifact 02: 2 call sites, the admin approval queue for queued uploads, with
its own `approve_pending_upload` / `reject_pending_upload` RPCs, VERIFIED in
`MIGRATIONS_V320_MOBILE_APPROVAL_RPC.sql`). A local Drift table of the same name
would produce a repository named `PendingUploadsRepository` that means two
different things in two files, which is precisely how the Kotlin app drifted.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY, local UUID |
| `commandId` | `TextColumn` | TEXT | no | FK -> `pending_commands.id` ON DELETE RESTRICT. See section 4 |
| `fieldKey` | `TextColumn` | TEXT | yes | Checklist field id, or tyre position, or null for a flat list |
| `orderIndex` | `IntColumn` | INTEGER | no | Position within its field. Rebuilding the keyed map depends on this |
| `localPath` | `TextColumn` | TEXT | no | Absolute `file://` in the queue media folder |
| `fileName` | `TextColumn` | TEXT | no | Basename, for iOS container healing and the sweep |
| `sizeBytes` | `IntColumn` | INTEGER | yes | |
| `mimeType` | `TextColumn` | TEXT | yes | |
| `checksum` | `TextColumn` | TEXT | yes | MD5 where readable, else `size:mtime` |
| `bucket` | `TextColumn` | TEXT | yes | `tyre-photos` or `accident-photos` |
| `remotePath` | `TextColumn` | TEXT | yes | Set on confirmed upload |
| `remoteRef` | `TextColumn` | TEXT | yes | `tp-storage://<bucket>/<path>` |
| `state` | `TextColumn` | TEXT | no | The six-state machine, section 4 |
| `attempts` | `IntColumn` | INTEGER | no | Default 0 |
| `lastError` | `TextColumn` | TEXT | yes | |
| `capturedAt` | `DateTimeColumn` | INTEGER | no | |
| `uploadedAt` | `DateTimeColumn` | INTEGER | yes | |

Indexes:
- `idx_media_command ON (commandId, fieldKey, orderIndex)` - rebuild a
  command's photo structure in the right order before the write.
- `idx_media_state ON (state, attempts)` - the uploader picks work.
- `UNIQUE idx_media_file ON (fileName)` - one row per file on disk. This is what
  turns the orphan sweep into a join instead of a directory listing compared
  against an in-memory set (section 4).

### 2.14 `sync_failures`

A dead-letter record, kept separately from `pending_commands` so that clearing
the queue never erases the evidence of why something did not sync.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `commandId` | `TextColumn` | TEXT | yes | Nullable: the command row may have been cleared |
| `commandType` | `TextColumn` | TEXT | yes | |
| `entityType` | `TextColumn` | TEXT | yes | |
| `workspaceId` | `TextColumn` | TEXT | yes | |
| `occurredAt` | `DateTimeColumn` | INTEGER | no | |
| `attempt` | `IntColumn` | INTEGER | no | |
| `errorCode` | `TextColumn` | TEXT | yes | PostgREST or Postgres code where available |
| `errorClass` | `TextColumn` | TEXT | no | `network`, `auth`, `permission`, `validation`, `conflict`, `unknown` |
| `messageSafe` | `TextColumn` | TEXT | yes | Sanitised. See below |
| `payloadSnapshotJson` | `TextColumn` | TEXT | yes | What was attempted |

Index: `idx_failures_recent ON (occurredAt DESC)` - the diagnostics screen and
the Sentry breadcrumb both read the newest first.

**`messageSafe` is sanitised before it is stored, not before it is displayed.**
The RN app has `lib/safeError.ts` for exactly this and its marker list includes
`jwt`, `schema cache`, `pgrst`, `supabase`, `postgres`, `/rest/v1`, `/auth/v1`.
Sanitising at write time means a raw database message never lands on disk at
all, so it cannot leak later through a log export or a support screenshot.

**`errorClass` is what decides retry, not the message text.** RECORDED in
`authLifecycle.ts`: anything not positively recognised as a server verdict is
treated as transient, because the cost of guessing "transient" is a retry and
the cost of guessing "definitive" is a field worker signed out of an app they
cannot sign back into.

### 2.15 `sync_metadata`

Key-value, one row per named fact. A table rather than a preferences file
because these values must be read and written inside the same transaction as
the rows they describe.

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `key` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `workspaceId` | `TextColumn` | TEXT | yes | Null for device-wide facts |
| `valueJson` | `TextColumn` | TEXT | no | |
| `updatedAt` | `DateTimeColumn` | INTEGER | no | |

Keys this schema requires:

| Key | Holds |
|---|---|
| `cache.<table>.lastFullSyncAt` | Per cached table, so staleness is per feed and not one global timestamp |
| `cache.<table>.rowCount` | What the last sync actually stored, so a truncated page is detectable |
| `cache.<table>.truncated` | True when a paged read hit its ceiling. **Must be surfaced, never swallowed** |
| `sync.lockHolder` / `sync.lockAcquiredAt` | Spec 15: never two sync engines on one queue. Stale-claim reclaim needs the timestamp |
| `sync.lastRunAt` / `sync.lastResult` | The status UI, spec 17 |
| `profile.cached` | The signed-in user's own profile, with `at`. Bounded at 90 days per `PROFILE_CACHE_MAX_AGE_MS` |
| `schema.migratedAt` | When the local ladder last ran. Section 7 |
| `queue.drainedForUpgradeAt` | Section 9 |

**`truncated` is the reason this is a table and not a log line.** A paged read
that hit its ceiling produced a cache that is silently short, and RECORDED, a
silently short list reads to a user as "that asset was never created". The flag
travels with the cache so the picker can say "showing 1,000 of 1,617" instead of
lying by omission.

### 2.16 `recent_searches`

Spec section 34: "save recent searches locally".

| Column | Dart | SQL | Null | Notes |
|---|---|---|---|---|
| `id` | `TextColumn` | TEXT | no | PRIMARY KEY |
| `userId` | `TextColumn` | TEXT | no | Per user, not per device |
| `workspaceId` | `TextColumn` | TEXT | no | |
| `term` | `TextColumn` | TEXT | no | As typed |
| `termNorm` | `TextColumn` | TEXT | no | Trimmed + uppercased, for dedupe |
| `resultKind` | `TextColumn` | TEXT | yes | `asset`, `tyre`, `work_order`, `accident`, `inspection` |
| `resultId` | `TextColumn` | TEXT | yes | What was opened, so a repeat is one tap |
| `searchedAt` | `DateTimeColumn` | INTEGER | no | |

Indexes:
- `UNIQUE idx_recent_dedupe ON (userId, workspaceId, termNorm)` - searching the
  same thing twice updates the timestamp, it does not add a second row.
- `idx_recent_list ON (userId, workspaceId, searchedAt DESC)` - the list.

**Per user, and cleared on sign-out.** A shared handset must not show the
previous technician what the current one looked up. Same reason the queues are
user-scoped.

**A recent search stores what was SEARCHED, never a permission.** RECORDED from
the web: a recents list that replayed an allow could hand back access after a
grant was withdrawn. The row records a term and an id; whether that record is
still readable is re-decided by RLS on the next open.

---

## 3. Idempotency keys

### 3.1 Which tables carry `client_uuid` on the SERVER

All VERIFIED by reading the migration files. Cross-references artifact 06's
command table.

| Table | Added by | Index shape | Command |
|---|---|---|---|
| `tyre_records` | V81 | plain UNIQUE | `TYRE_CHANGE` |
| `work_orders` | V81 | plain UNIQUE | `WORK_ORDER` |
| `rca_records` | V81 | plain UNIQUE | `RCA` |
| `corrective_actions` | V81 | plain UNIQUE | `REPORT_ISSUE` |
| `inspections` | V81 | plain UNIQUE | the inspection queue |
| `checklist_submissions` | V125 | PARTIAL `WHERE client_uuid IS NOT NULL` | `CHECKLIST_SUBMISSION` |
| `odometer_logs` | V213 | PARTIAL | `ODOMETER_LOG` |
| `engine_hours_logs` | V213 | PARTIAL | `ENGINE_HOURS_LOG` |
| `accidents` | V215 | PARTIAL | `REPORT_ACCIDENT` |
| `wash_records` | V271 | plain UNIQUE | `WASH_RECORD` |
| `tech_activity_events` | V292 | PARTIAL | `WORKSHOP_EVENT` |
| `repair_requests` | V608 | PARTIAL | `REPAIR_REQUEST`. UNVERIFIED as applied - V608 is untracked in-flight work |

The five `update` commands (`STOCK_ADJUST`, `WORK_ORDER_STATUS`,
`CORRECTIVE_ACTION_STATUS`, `CHECKLIST_ASSIGNMENT_STATUS`, `CHECKLIST_APPROVAL`)
carry no `client_uuid` and need none: they patch a row matched by `id` with
absolute values, so replaying them converges. Artifact 06 section 3 covers why.

### 3.2 A discrepancy between the migrations that needs a live check

**V271 chose a PLAIN index over a partial one and stated the reason:**

> A plain (non-partial) unique index so ON CONFLICT (client_uuid) matches it;
> NULLs are distinct in a unique index, so historical rows (client_uuid NULL)
> coexist freely.

That is a real Postgres property: `ON CONFLICT (col)` performs index inference,
and inferring a PARTIAL unique index requires the statement to also supply the
index predicate. supabase-js `upsert(..., { onConflict: 'client_uuid' })` emits
no predicate.

Six of the twelve tables above use a PARTIAL index anyway (V125, V213 x2, V215,
V292, V608). If the inference genuinely fails, those upserts raise 42P10, the
queue's catch re-enqueues, and after `MAX_RETRIES = 8` the row lands `failed` -
so the write is visibly stuck, not silently duplicated.

**VERIFIED: the migration files disagree with each other, and V271 records the
reason. UNVERIFIED: which behaviour actually occurs against this database
through PostgREST.** This is the first thing to test when the Supabase connector
is available: issue one upsert against `wash_records` (plain) and one against
`odometer_logs` (partial) with a repeated `client_uuid` and compare. Flutter
must not assume the idempotency contract holds uniformly until that is settled.

### 3.3 How the local key is generated

The RN generator is `mobile/lib/ids.ts`: `crypto.randomUUID()` when the runtime
has it, otherwise an RFC4122-shaped v4 built from `Math.random`. The fallback
exists because on older Hermes runtimes the bare global `crypto` is undefined
and calling it throws a `ReferenceError` that aborts the save before it can even
queue offline.

Flutter has no such hole - `package:uuid` v4 is available on every target - so
the rule is simply:

```dart
final idempotencyKey = const Uuid().v4();
```

generated ONCE, at the moment the user commits the form, and written into
`pending_commands.idempotencyKey` in the same transaction that writes the row.

**The key must be minted before the first network attempt, not after it fails.**
The RN code does this correctly and the comment says why: "One stable client id
shared by the immediate attempt AND any queued retry, so a lost response / crash
can never create a duplicate". A key minted only on the fallback path means the
online attempt and the queued retry carry different keys, which is the exact
double-insert the mechanism exists to prevent.

### 3.4 The contract that makes a replay safe

Four conditions. All four are required; any one missing and the guarantee is
gone.

1. **The key is generated on the device, before the first attempt, and never
   regenerated.** A retry of the same logical write reuses the row's stored
   `idempotencyKey`.
2. **The key is written into the command row in the SAME local transaction as
   the payload.** If the app dies between the two, a retry with a new key would
   insert a second server row. In Drift this is one `transaction { }`.
3. **The server carries the column and a unique index on it**, and the write is
   an upsert with `onConflict: client_uuid, ignoreDuplicates: true`. Section 3.1
   lists which tables satisfy this and 3.2 flags the doubt.
4. **A confirmed success is committed locally before anything is deleted.** The
   RN loop persists after EACH item specifically so "a crash mid-loop cannot
   lose a 'synced' marking and replay an already-committed insert". In Drift:
   mark the row `synced` and commit, then prune, never the other way round.

### 3.5 The one command that is deliberately NOT idempotent

**There is none today, and artifact 06 is out of date on this point.**

Artifact 06's table records `WORKSHOP_EVENT` as `idempotent: false - append-only
log, no client_uuid`. VERIFIED against the current source: the `idempotent?:
boolean` flag exists on `CommandSpec` and defaults to true via
`COMMANDS[type].idempotent !== false`, but **no command in `COMMANDS` sets it to
false** (grep for `idempotent` in `mobile/lib/recordQueue.ts` returns only the
interface declaration, the helper, and comments). The `WORKSHOP_EVENT` entry
carries a comment saying the opposite of artifact 06:

> V292 added a client_uuid column + unique index, so this command is idempotent:
> a lost-response retry can never double-insert an event (which would inflate
> completed-task counts).

`MIGRATIONS_V292_TECH_EVENTS_CLIENT_UUID.sql` confirms it, and states the motive
in the same terms: "so every event is at-most-once".

So the mechanism exists but the exception it was built for has been closed.
**All 16 commands are idempotent as shipped.** That is a stronger position than
artifact 06 describes and Flutter should preserve it: the `idempotent: false`
escape hatch should be carried across for a future append-only log, and it
should stay unused. Any new command that cannot carry a `client_uuid` needs a
migration adding one before it may be queued, not an exception.

Flagged for artifact 06 to be corrected. Reported rather than edited: artifact
06 is a delivered audit document and this file is the cross-reference that found
the drift.

---

## 4. The photo pipeline tables

### 4.1 The state machine

Spec section 19 names six states. Mapped onto `pending_media_uploads.state`:

| State | Meaning | Entered when | May the local file be deleted? |
|---|---|---|---|
| `local` | Copied out of OS cache into the durable folder, not yet attached | `persistPhoto` succeeded | **No** |
| `queued` | Attached to a `pending_commands` row and awaiting its turn | The command was enqueued | **No** |
| `uploading` | Claimed by the uploader | Worker took the row | **No** |
| `uploaded` | Storage accepted the object; `remoteRef` is set | Upload returned without error | **No.** See 4.2 |
| `verified` | The owning command's row write succeeded carrying this ref | The command reached `synced` | **Yes** |
| `failed` | Upload refused after its attempts | Attempts exhausted, or the file is gone | Only with the user's knowledge |

Two transitions carry the real rules.

**`local` -> `queued` happens BEFORE the network is touched.** The RN code does
this in `enqueueCommand` and the reason is explicit: the camera writes into
`Paths.cache`, which Android and iOS may purge at any moment, so a queue that
merely remembered the cache path would come back holding dead URIs. Flutter must
keep the same ordering - copy first, enqueue second, and never enqueue a command
that references a cache path.

**`uploaded` -> `verified` is a separate step and the local file survives the
gap.** An object in the bucket that no database row references is unreachable;
the photo is only truly delivered once the business row carrying its
`tp-storage://` ref committed.

### 4.2 The rule: never delete a local source before the server confirms

Spec section 19 states it and the RN code implements it in two places:

- `resolveCommandPhotos` calls `deleteDurablePhoto(src)` only on the branch
  where `uploadModulePhoto` returned a ref, with the comment "remove durable copy
  only after a confirmed upload". The failure branch pushes the path back and
  sets `pending = true` so the record stays queued.
- The sync loop throws `'Photos pending upload - will retry'` rather than
  inserting a row without its evidence.

**In Drift this becomes a foreign key, not a convention:**

```
pending_media_uploads.commandId -> pending_commands.id  ON DELETE RESTRICT
```

`RESTRICT` rather than `CASCADE` is the whole point. A command row cannot be
deleted while media rows still reference it, so the pruner physically cannot
remove the queue entry that is the only thing keeping a photo's file alive. The
deletion order is forced: verify the media, delete the media rows and their
files, then delete the command.

**Stated cost, carried over from the RN design:** a photo that cannot be
persisted at capture time (the device is out of space) is DROPPED from the
payload so the data row is still queued, rather than losing the whole record.
The user is told how many were dropped. Losing one photo is recoverable;
losing the tyre change it belonged to is not.

### 4.3 Orphan sweeping, and the trap that a draft is not a queue entry

**How the RN sweep works.** `sweepOrphanQueuedPhotos` builds a set of every
durable path referenced by a non-synced queue entry, then
`cleanupOrphanDurablePhotos` lists the `queued-photos/` directory and DELETES
every file whose basename is not in that set. It runs after EVERY sync and on
app start.

**The trap.** A draft is not a queue entry. If draft photos were written into
`queued-photos/`, the next sync - which may be seconds later, triggered by
reconnection - would find them referenced by nothing and delete them. The
operator's part-filled sheet comes back with its evidence gone.

This is not hypothetical. `checklistDraft.ts` records that a previous attempt at
draft photos did exactly this and had to be reverted:

> The obvious fix, `persistPhotoForQueue`, is WRONG here: it writes into
> `queued-photos/`, and `sweepOrphanQueuedPhotos` (which runs after EVERY sync)
> deletes every file in that folder that no live QUEUE entry references. A draft
> is not a queue entry, so the next sync would delete the operator's photos -
> turning a likely loss into a certain one.

**The rule, and how Drift enforces it.** Two folders, two tables, two sweeps,
and no function may read one and delete in the other:

| | Queue media | Draft media |
|---|---|---|
| Folder | `<document>/queue-media/` | `<document>/draft-media/` |
| Table | `pending_media_uploads` | `draft_photos` |
| Referenced by | a `pending_commands` row | a draft row |
| Swept when | after a sync run | after a draft save or discard |
| Sweep query | files with no `pending_media_uploads` row in state != `verified` | files with no `draft_photos` row |

The sweep is a LEFT JOIN against its own table, not a directory listing compared
to an in-memory set. That is why both media tables carry a UNIQUE `fileName`
index: a file with no row is an orphan, and the question is one query.

**A draft's photos are COPIED, not moved, on submit.** The RN behaviour is that
the queue takes its own copy at enqueue (a draft path is not
`isDurablePhotoPath`, so `persistPayloadPhotos` copies it exactly as it would a
cache path) and only then is the draft discarded. The two folders never share
ownership of a file, so neither sweep can ever delete the other's bytes.
Preserve this even though it briefly doubles the disk cost of one sheet.

**A submitted draft is discarded even when the submit went OFFLINE.** The work
now belongs to the queue, which took its own durable copy; a draft left behind
could be filled in and submitted a second time.

### 4.4 Upload concurrency is a hard bound

RECORDED and VERIFIED in `photoUpload.uploadAllPositionPhotos`:
`UPLOAD_CONCURRENCY = 2`. A `Promise.all` over every tyre position decoded one
full-size bitmap per tyre simultaneously - 13 on a Tr-Mixer, roughly 600 MB peak
- which is a hard native out-of-memory crash on a 2 GB handset. The inspector
lost the work with no error, and the offline queue then REPLAYED the crash.

Two mitigations, both required:
1. **Bound the fan-out.** Two concurrent uploads, from a queue, never a
   `Future.wait` over a whole collection.
2. **Shrink before decoding.** `prepareForUpload` resizes to 1600px at quality
   0.5 with a retry ladder at 1024px/0.45 and 720px/0.4, then refuses anything
   still over `MAX_DECODE_BYTES = 12 MB`. The ladder exists because a single
   failed resize used to fall back to the original multi-megapixel file, which
   then exceeded the cap and was SILENTLY DROPPED.

The replay half is what makes this a persistence concern rather than a UI one: a
crash loop is recorded in `pending_media_uploads.attempts`, and a row that has
crashed the app twice must go `failed` and be reported rather than retried a
third time.

---

## 5. Signatures

### 5.1 What must be stored

Spec section 21 records that "one implementation stored a placeholder string
instead of an actual signature" and requires a real representation plus
metadata. `captured_signatures` (2.11) carries both.

**Two payload formats are accepted, deliberately.** VERIFIED in
`mobile/lib/savedSignature.ts`: the checklist path emits self-contained `<svg>`
markup and the canvas pad emits a `data:image/...` URL, and `SignatureView`
renders both. `normaliseSignature` accepts a string that starts with `<svg` or
`data:` and returns null for anything else - "Anything else is not a mark this
app draws. Storing it would put an arbitrary string in front of a reader as
though it were a signature." That refusal is the guard against the placeholder
defect and Flutter must port it.

**`strokesJson` is the addition spec 21 asks for.** SVG markup reconstructs the
picture; the raw stroke points reconstruct the ACT - pressure, order, timing -
and are what makes a mark defensible if a signature is ever disputed. Nullable,
because a mark restored from a saved signature has no strokes: it was drawn on
another day, possibly on another device.

**`SIGNATURE_MAX_LEN = 200000` is a server constraint, not a client
preference.** It mirrors `user_signatures_len_chk` in V601. The comment states
the rule: "A value the column would refuse must be refused here too, or the
screen offers to save something the server throws away." The Drift column
carries the same check, so an oversized mark is refused at capture with a
message, not at sync with a failure.

### 5.2 Multiple signature fields

VERIFIED in `mobile/app/(app)/checklists/[templateId].tsx`:

> One signature PER FIELD. A shared slot is what let three trades overwrite one
> another and made every signature tile read "done" after one signing.

The state is `signatures: Record<fieldId, string>` plus a separate
`primarySignature`, and `checklistDraft.ChecklistDraft` persists both. Three
consequences for the schema:

1. **`UNIQUE (ownerKind, ownerKey, fieldKey)`**, never `UNIQUE (ownerKind,
   ownerKey)`. The uniqueness constraint IS the fix.
2. **The template-level pad gets a reserved `fieldKey`** (`__primary__`) rather
   than a nullable column. A nullable field key would make the unique index
   permit several nulls in SQLite, quietly restoring the shared slot.
3. **A field's completeness is per field.** `isFieldAnswered` for a signature
   field is "is there a row for THIS field id", which with the index above is a
   point lookup.

**`require_signature` must be satisfiable.** RECORDED: the flag lives on the
TEMPLATE, but the only way to capture a signature was a signature FIELD, so a
template with the flag and no such field could be filled completely and NEVER
submitted - the footer pointed at a control that did not exist and the work was
lost on back-out. The rule ported: the requirement is satisfied by the
template-level pad OR any signed field. That is a query over
`captured_signatures` for the owner, not a check of one column.

### 5.3 The saved signature is not stored locally

`user_signatures` is a REMOTE table, keyed on `auth.uid()`, whose only policies
are "the row is mine". `userSignature.getMySignature()` reads it live and
degrades to null on any failure, deliberately: "a signature that cannot be
loaded on a weak signal must leave a supervisor with a blank pad they can still
sign on, never a screen they cannot get past."

**Do not add a `cached_user_signature` table.** Two reasons, both from the
recorded design: the whole point of putting it in its own table rather than a
`profiles` column was that a signature must not be readable by colleagues, and a
local cache on a SHARED handset reintroduces exactly that exposure; and
pre-filling is not signing - the value is a convenience that removes redrawing,
so its absence costs a few seconds, not a blocked approval.

**`source` is printed, not decoration.** `resolveSignature` returns `drawn` /
`saved` / `none` and a mark drawn NOW always beats the saved one. The screen
shows which, because otherwise "my signature came from somewhere" is
indistinguishable from "the app signed for me". The column carries it into the
record so an audit can answer the same question later.

### 5.4 An approval signature does not travel through this table

Artifact 06 section 4 establishes that `CHECKLIST_APPROVAL` should be
online-only and routed through `decide_checklist_approval`. It follows that an
approver's mark is captured, passed to the RPC, and never persisted locally: a
signature sitting in a local table waiting to approve something is a decision
queued offline, which is what section 14 of the spec forbids.

`captured_signatures.ownerKind` therefore has no `approval` value. That absence
is the enforcement.

---

## 6. Draft identity

### 6.1 The key

VERIFIED, `checklistDraft.draftKey`:

```
`${userId}|${templateId}|${normaliseAsset(assetNo)}`
```

where `normaliseAsset` is `String(asset ?? '').trim().toUpperCase()`.

Flutter ports this exactly. For an inspection there is no template, so the key
is `${userId}|${normaliseAsset(assetNo)}`.

Each of the three parts earns its place, and the tests pin all three
(`checklistDraft.test.ts`, `describe('identity')`):

- **user** - "keeps two users apart on the same sheet".
- **template** - two different sheets against one machine are two pieces of work.
- **asset, normalised** - "treats the same machine typed differently as one
  sheet". Without normalisation `tm514`, `TM514` and ` TM514 ` are three drafts
  of the same job and the operator finishes one of them.

An empty asset is a legitimate key component: a sheet started before a machine
is picked gets its own slot, and when the operator picks one the row is rekeyed
and the old key discarded (`[templateId].tsx` calls `discardDraft(previousKey)`).

### 6.2 The shared-device rule

Spec section 18: "Never silently overwrite a different user's draft on a shared
device." Three mechanisms, and all three are needed:

1. **`userId` is inside the primary key.** Two people filling the same sheet on
   the same handset produce two rows. Overwriting is not possible, it is not
   merely avoided.
2. **Every read filters on the signed-in user.** `draftsForUser` returns `[]`
   for a blank user id rather than everything - the test is "offers nothing at
   all when there is no signed-in user". A Flutter query that forgets the filter
   would show a technician their colleague's work; the repository must take the
   user id as a required parameter so it cannot be omitted.
3. **Sign-out does not delete pending work.** VERIFIED in
   `AuthContext.clearLocalUserState`: only SUCCESSFULLY SYNCED rows are cleared,
   and "PENDING / failed inspections, photos and records are PRESERVED so a tyre
   man who logs out while offline does not lose captured work; those rows are
   picked up again the next time that user signs in."

Point 3 is what makes point 1 load-bearing rather than theoretical. Because
unsynced work survives a sign-out, a shared handset genuinely can hold two
people's drafts at once, and the key is the only thing keeping them apart.

### 6.3 Two rules about what counts as a draft

**A merely-opened sheet is not work in progress.** `hasDraftContent` is
deliberately strict, and the reason is specific: the fill screen SEEDS auto
fields (today's date, the inspector's own name) the instant a template opens, so
a draft judged by "are any answers non-blank" would be written for every
template anybody merely looked at. The test is `filled > 0` (progress as the
screen counted it, over fields a person can actually record) OR any photo,
remark or signature - "a sheet whose only content so far is a photograph of a
fault is still real work".

**A draft the operator emptied out again is REMOVED, not stored.** Otherwise it
lingers in the unfinished list claiming work that no longer exists.

### 6.4 Concurrent writes

`checklistDraft.ts` serialises every write through a promise chain because "the
autosave timer and the backgrounding flush can fire within milliseconds of each
other, and each is a read-modify-write over one shared blob. Run concurrently,
the slower one writes a list assembled before the faster one's change existed and
silently reverts it."

**Drift removes the need for the chain by removing the read-modify-write.** An
autosave is an upsert of one row plus a diff of its child rows, inside one
transaction. Two concurrent autosaves serialise at the database, and neither can
revert the other's columns. Do not port the promise chain; port the property.

---

## 7. Local migration policy

### 7.1 The absolute rule

**A schema change NEVER wipes local data.** Spec section 61: "Never simply
delete local data when the schema changes."

The reason is not tidiness. `pending_commands`, the two draft tables and both
media tables hold work that exists NOWHERE ELSE. A field worker's unsynced
inspection is the only copy in the world; a `deleteDatabase()` on version
mismatch, which is a common Drift starter pattern, destroys it silently on
upgrade day, at scale, across a fleet.

This forbids, explicitly:

- `deleteFrom(...)` in any migration step.
- `drop table` followed by `create table`, including the recreate-and-copy
  pattern where the copy is lossy.
- Any `onUpgrade` fallback that recreates the schema when a step throws.
- `MigrationStrategy(beforeOpen: ... validateDatabaseSchema)` configured to
  repair by recreation.

A destructive step is permitted for `cached_*` tables ONLY, because those are a
copy of server data and can be refetched. Even there it is a truncate plus a
reset of `sync_metadata.cache.<table>.lastFullSyncAt`, never a drop, and the
user is shown a re-syncing state rather than an empty picker.

### 7.2 The ladder

```dart
@DriftDatabase(tables: [...])
class LocalDb extends _$LocalDb {
  @override
  int get schemaVersion => 1;

  @override
  MigrationStrategy get migration => MigrationStrategy(
    onCreate: (m) async {
      await m.createAll();
      await _seedSyncMetadata();
    },
    onUpgrade: stepByStep(
      from1To2: (m, schema) async { /* additive only */ },
      from2To3: (m, schema) async { /* additive only */ },
    ),
    beforeOpen: (details) async {
      await customStatement('PRAGMA foreign_keys = ON');
      // The RESTRICT on pending_media_uploads is inert without this.
      if (details.wasCreated || details.hadUpgrade) {
        await _recordMigratedAt();
      }
    },
  );
}
```

`stepByStep` is used rather than a hand-written `if (from < n)` chain because
each step is then individually testable and a skipped version is impossible.

**Ship version 1 with every table in this document.** Adding a table later is
cheap; shipping a partial schema and migrating a device that already holds
unsynced work is where migrations go wrong.

**`PRAGMA foreign_keys = ON` is not optional.** SQLite disables foreign keys by
default per connection. Without it, the ON DELETE RESTRICT that protects a photo
from its own pruner (section 4.2) does nothing at all, and every cascade in this
schema silently leaves orphan rows.

### 7.3 What a migration test must prove

Spec 61: "Migration tests are mandatory." Drift generates schema snapshots
(`drift_dev schema dump` / `generate step-by-step`) so each version's shape can
be reconstructed in a test. Five things must be asserted, and the fourth is the
one that actually protects the field worker:

1. **The ladder reaches the current version from EVERY prior version.** Not just
   N-1. Devices skip releases; a phone that has been offline in a yard for three
   months upgrades from whatever it had.
2. **The resulting schema matches the generated snapshot** (`verifySelfIntegrity`
   plus the schema comparison helper). This catches a column added to the Dart
   table and forgotten in the migration step - the classic drift.
3. **Foreign keys and indexes survive.** A table rebuilt by a migration step
   loses its indexes unless they are recreated; the test asserts each index in
   this document exists after every upgrade path.
4. **Unsynced work survives, with its content intact.** Seed a version-N
   database with a `pending_commands` row, its `pending_media_uploads` children,
   a `checklist_drafts` row with `draft_photos` and `captured_signatures`, then
   upgrade and assert every row is present AND its payload, idempotency key and
   file paths are byte-identical. **A migration test that only checks the schema
   is not a migration test - it passes while every field worker's queue is
   emptied.**
5. **A failing step does not leave a half-migrated database.** Force a step to
   throw and assert the database is still openable at its previous version and
   the rows are intact.

Two further constraints on the WAY steps are written:

**A migration step must never call generated Dart mappers.** It must use the
`schema` object of ITS OWN version. A mapper compiled against today's Dart class
will not match the table a device is actually carrying, and the failure surfaces
as corrupt data rather than a compile error.

**Downgrade is refused, not attempted.** RECORDED: the Expo secure storage
format is forward-compatible but not rollback-safe, and a downgraded device
signed the user out AND read a full offline queue as empty, then overwrote it.
Flutter starts clean, so define the policy now: if `schemaVersion` on disk is
GREATER than the app's, the app refuses to open the database, shows "this device
has newer data than this version of the app", and does not touch a byte. An
older binary must never write to a newer schema.

---

## 8. Retention and size

### 8.1 What is pruned, and by what rule

| Table | Pruned | Rule | Why this rule |
|---|---|---|---|
| `pending_commands` | rows in state `synced` | Delete after the transaction that marked them, once no `pending_media_uploads` child remains unverified | Ported: the RN loop prunes synced entries because "they are safely in the database, and keeping them would grow SecureStore without bound". Pending and failed are PRESERVED so retry and "retry failed" still work |
| `pending_media_uploads` | rows in state `verified` | Delete the row, then the file | Order matters: file first would orphan the row on a crash and the sweep would never find it |
| `sync_failures` | oldest | **By COUNT, keep the newest 200** | Age would delete the diagnosis of a device that has been offline for weeks - exactly the device whose failures matter most |
| `checklist_drafts` | oldest past the cap | **By COUNT, `MAX_DRAFTS = 25`** | VERIFIED and explicitly reasoned in source: "Nothing is pruned by AGE - a sheet abandoned for two months is still the operator's work, and it is listed with its age so a person decides, rather than the app deleting it quietly" |
| `inspection_drafts` | oldest past the cap | **By COUNT, 25** | Same rule, same reason |
| `draft_photos` | files no live draft references | Sweep on save and discard | Section 4.3 |
| `recent_searches` | oldest past the cap | By COUNT, 50 per user | A list nobody scrolls past 50 |
| `cached_tyres` | least recently seen | By COUNT, 2,000 rows, ordered by `lastSeenAt` | The table is populated on demand; a cap keeps the working set warm without mirroring 11,193 rows |
| `cached_assets`, `cached_sites`, `cached_users`, `cached_checklist_templates` | not pruned | Replaced wholesale on refresh | Small, and a partial fleet list is the truncation defect all over again |
| `sync_metadata`, `workspace_scope`, `cached_permissions` | not pruned | | Bounded by definition |

**Count, not age, wherever the source says so.** Both draft tables and
`sync_failures` follow this, and the reason generalises: age-based deletion of
unsynced or diagnostic data punishes the offline device hardest, which is
exactly backwards for a field app.

**Nothing that has not reached the server is EVER pruned automatically.** Not by
age, not by count, not by a cap. A `pending_commands` row that is `failed` after
eight attempts stays until a person acts on it. The only automatic removal of
unsynced work in this schema is none.

**One exception, and it is not automatic:** an explicit user or admin action.
The RN `clearRecordQueue` exists for logout on a shared device and is called
only on that path.

### 8.2 Expected worst-case size

The database file itself is small; the media folders are the real weight.

| Component | Rows | Per row | Total |
|---|---|---|---|
| `cached_assets` | 1,617 (RECORDED) | ~400 B | ~650 KB |
| `cached_tyres` | 2,000 (capped) | ~300 B | ~600 KB |
| `cached_users` / `cached_sites` / templates | 38 / 62 / 6 (RECORDED) | | < 200 KB |
| `pending_commands` | 30 (heavy day) | ~4 KB payload | ~120 KB |
| Draft rows + positions + answers | 25 drafts | ~8 KB | ~200 KB |
| `captured_signatures` | 50 | up to 200 KB, typically ~15 KB | ~750 KB |
| `sync_failures` | 200 | ~1 KB | ~200 KB |
| Indexes and SQLite overhead | | | ~1 MB |
| **Database file** | | | **~4 MB, budget 8 MB** |

Media, at 1600px quality 0.5 (roughly 150-350 KB per photo):

| | Photos | Bytes |
|---|---|---|
| One inspection, 13 positions (Tr-Mixer) | 13 | ~4 MB |
| Queue media, worst realistic day: 20 commands x 5 photos | 100 | ~30 MB |
| Draft media: 25 drafts x 6 photos | 150 | ~45 MB |
| **Media total worst case** | **~263** | **~75 MB** |

**Design budget: 100 MB total on device.** That is comfortable on the 2 GB
Android handsets this fleet uses (RECORDED), and the failure mode if it is
exceeded is not a crash: `persistPhoto` returns null when the copy fails for
lack of space, the photo is dropped, the data row is still queued, and the user
is told. That behaviour is ported from the RN design.

**Two operational rules the size analysis implies:**

1. **Show the number, do not hide it.** A "Storage used: 62 MB, 41 photos
   waiting to upload" line on the sync screen turns an invisible accumulation
   into something a supervisor can act on.
2. **Warn before the device is full, not after.** Past 80 MB of media the app
   should prompt to sync before capturing more. A field worker who fills the
   device and starts losing photos silently is the exact failure this whole
   subsystem exists to prevent.

### 8.3 What must NOT be cached

RECORDED sizes make three tables obviously wrong to mirror:

- `work_orders` - 89,913 rows. Read on demand, per asset or per assignment.
- `parts_consumption` - 216,792 rows. Not a mobile surface at all.
- `audit_log_v2` - 503,000+ rows. Never.

More generally: **a mobile cache holds what a technician standing at a machine
needs to look up, not a copy of the fleet's history.** Anything answered by a
server aggregate (`get_mobile_analytics` is the precedent - artifact 02 records
it replaced a client-side full-table scan) stays a server aggregate.

---

## 9. Data migration from the RN app

### 9.1 The authority

Spec section 68, verbatim: "Do not assume React AsyncStorage structures can
simply be read by Flutter. Treat server data as migration authority."

**Flutter must not attempt to read the Expo installation's storage.** Three
reasons, all concrete:

1. **The auth session is unreadable by construction.** It lives in
   `expo-secure-store`, chunked at 1800 characters across
   `${key}_g${gen}_chunk_${i}` slots with a `{chunks, gen}` metadata slot as the
   commit point. Reading it from Flutter means reimplementing that adapter
   exactly, including the generation logic and the legacy pre-generation key
   form, against a Keystore that RECORDED evidence says refuses calls on this
   hardware. Getting it subtly wrong yields a `torn` read that looks like an
   empty queue.
2. **The install may be replaced, not upgraded.** Spec section 69 flags that the
   package identity question is open. A different package ID means a different
   sandbox and there is nothing to read at all.
3. **A partial read is worse than no read.** Reading 18 of 20 queued commands
   and reporting success is precisely the class of silent loss this entire
   document is built to prevent.

### 9.2 The required pre-upgrade drain

**`pending queue = 0` is a precondition, not a target.** Spec 68 lists it
second. The sequence:

1. **The legacy Expo app must sync to zero.** Every `tp_inspection_queue_v1` and
   `tp_record_queue_v2` entry must reach `synced`, and every
   `queued-photos/` file must be uploaded and confirmed.
2. **Verify, do not assume.** The count that matters is everything NOT `synced`,
   including `failed` - the recorded defect is that counting only `pending` made
   the badges read 0 while an inspection sat unsent. A `failed` row means a real
   record that never arrived and must be resolved before the upgrade, by fixing
   the underlying error and using "retry failed".
3. **Drain the drafts too, and this is the part that will be missed.** A
   `tp_checklist_drafts_v1` entry is not in any queue and no pending count
   includes it. Up to 25 part-filled sheets per device can be sitting there,
   invisible to a "queue is empty" check. They must be SUBMITTED or explicitly
   discarded before the upgrade.
4. **Warn users before the upgrade**, in the app, naming what is outstanding:
   "You have 3 records and 2 unfinished checklists that must be synced before
   updating."
5. **Record the drain.** The Flutter app writes
   `sync_metadata.queue.drainedForUpgradeAt` on first run so support can tell a
   clean migration from a forced one.

### 9.3 What happens if a user upgrades with unsynced work

**It is lost, and the app must say so rather than pretend otherwise.**

The Flutter app opens with an empty local database, downloads its offline cache
from the server (spec 68 step 6), and has no way to know that anything was
outstanding. There is no recovery path from inside Flutter.

Three mitigations, in order of how much they actually help:

1. **Prevent it.** Gate the Play rollout. The legacy app can already refuse to
   run below a minimum version (`system_config.mobile_min_version`); the same
   lever can hold users on the Expo build until their queue is clean, and the
   staged rollout can be paused. This is the only mitigation that works.
2. **Detect it server-side.** Before the rollout, query for the most recent
   record per device or per user and identify accounts whose last sync predates
   their last login by more than a shift. Those are the devices carrying work.
   UNVERIFIED whether `user_devices` (V321) carries enough to do this per
   device; it needs a live check.
3. **Be honest afterwards.** If the upgrade has happened, the Flutter app cannot
   recover the rows, and support must tell the affected worker to re-enter the
   inspection rather than assuming it synced.

**Do not ship a "legacy import" screen.** It would have to reimplement the
chunked Keystore adapter to read data it can only partially validate, and its
most likely outcome is reporting success on an incomplete read - which is worse
than the honest loss, because nobody then re-enters the work.

---

## 10. What still needs a live check

The Supabase connector was unauthenticated when this was written. The following
are UNVERIFIED and must be settled before Flutter code depends on them.

1. **Whether a PARTIAL unique index on `client_uuid` satisfies PostgREST's
   `on_conflict=client_uuid`** (section 3.2). Six of the twelve idempotent
   tables depend on the answer. Test `wash_records` (plain) against
   `odometer_logs` (partial) with a repeated key.
2. **The exact column list, types and nullability of every table this schema
   caches.** Artifact 02 records the same gap. A Drift column typed
   non-nullable against a nullable remote column crashes the mapper on the first
   real row.
3. **Whether `repair_requests` (V608) is applied**, which decides whether
   `REPAIR_REQUEST` and its `client_uuid` index are real. V608 is untracked
   in-flight work from a parallel session.
4. **Current row counts**, to confirm the size analysis in section 8.2 and to
   decide which cached reads must page on day one. The figures used are RECORDED
   from PROJECT_MEMORY, not measured now.
5. **Whether `user_devices` (V321) can identify devices with stale syncs** for
   the pre-upgrade detection in section 9.3.
6. **The supabase-js `storageKey` literal** in the current Expo build, for
   completeness of the section 1 inventory. It is not set explicitly in
   `mobile/lib/supabase.ts`, so the default is assumed.
7. **Whether any cached read's source RPC carries an internal LIMIT.** Artifact
   02 records that `get_asset_master` does, so a caller must raise `p_limit` as
   well as page or the function cuts the page short. `reference_asset_options`
   and `reference_site_options` need the same check before they fill a cache.

---

## 11. Findings from the implementation

Added 2026-08-25, after this schema was implemented in
`tyre_pulse_flutter/lib/core/database/`. All 17 tables and all 31 named indexes
were built as specified. The points below are where the specification and the
implementation disagree, or where a specified shape carries a caveat worth
knowing. They are recorded here so nobody later "fixes" the code to match the
document, or the document to match the code, without seeing the reasoning.

### 11.1 Two foreign keys could not be declared as specified

Section 2.10 specifies `draft_photos.ownerKey` as a foreign key with
`ON DELETE CASCADE`. It cannot be one: `ownerKind` is polymorphic across
`inspection_drafts` and `checklist_drafts`, and SQLite cannot express a foreign
key whose target table depends on another column. The same applies to
`captured_signatures`, which section 2.11 already conceded.

The cascade is therefore performed in application code, inside the same
transaction as the draft delete, and it returns the orphaned file paths so the
caller can remove them. That is a real behavioural equivalence, not a weakening
- but it is only equivalent for as long as every delete path goes through the
DAO. A raw delete would leak rows.

`inspection_draft_positions` DOES use a real foreign key cascade, because its
parent is unambiguous.

### 11.2 `pending_commands.dependsOn` is deliberately not a foreign key

A predecessor command that has synced is eventually pruned, while a dependent
may still be queued. A foreign key would either block that prune or
cascade-delete unsynced work, and losing unsynced work is the one outcome this
whole design exists to prevent.

The queue therefore treats a MISSING predecessor as satisfied, on the reasoning
that it can only be missing after it synced successfully.

### 11.3 One specified index is redundant

`idx_commands_pending_count ON (status)` is a strict prefix of
`idx_commands_due ON (status, nextRetryAt)`. SQLite can serve any query the
first index supports from the second, so it costs write throughput on every
queue mutation and buys nothing.

It was implemented as specified rather than silently dropped. Dropping it is a
safe, mechanical change whenever someone wants it, and it needs a schema
migration step like any other.

### 11.4 A unique index that does not constrain what it appears to

`idx_cached_assets_identity` is UNIQUE on
`(workspaceId, country, assetNoNorm)`, and `country` is nullable.

**SQLite treats NULLs as distinct in a unique index.** So two cached rows for
the same asset code with a NULL country are both accepted, and the index does
not deduplicate them. The constraint only bites once `country` is populated.

This is exactly the shape section 4 specifies, and it is the correct shape for
the null-safe country convention this codebase uses everywhere else. It is
recorded because "there is a unique index on it" would otherwise read as a
guarantee that duplicates are impossible, and they are not.

### 11.5 Status vocabularies are TEXT plus constants, not Dart enums

The stored values must be exactly the strings this document specifies
(`checklist_draft`, not `checklistDraft`), because they are compared against
values the queue and the server already use. Drift's `textEnum` stores the Dart
`.name`, which would force either the wrong stored value or an identifier style
the analyser rejects.

### 11.6 A test-only constructor currently lives in production code

`AppDatabase.forMigrationTest` exists so the mandatory migration test can open
one database file at two schema versions. The proper mechanism is drift's
`stepByStep`, which is generated from committed schema snapshots, and those
snapshots cannot be produced on a machine with no Dart SDK.

**Action for CI:** once `drift_dev schema dump` runs, replace this constructor
with the generated helper and delete it.

### 11.7 Retention rules are in tension, and were implemented literally

Section 8.1 says the queue is never pruned automatically, while both draft
tables carry a count cap of 25 ported from the React Native source.

`pruneDraftsToCap` is therefore an explicit call that nothing invokes
automatically, and it returns file paths rather than deleting anything itself.
Whoever wires it up decides when a field worker's oldest draft disappears, which
is a product decision rather than a storage one.
