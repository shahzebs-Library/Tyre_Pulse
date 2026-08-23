# Next work

`AGENTS.md` tells you to read this file before starting. It did not exist until now,
which is part of why work restarted instead of continuing.

Everything below was found by static audit on 2026-08-23. **Nothing here has been
compiled or run** - there is no JDK or Android SDK on the development machine, so CI
is the only compiler. Run the three checkers in `tools/` before pushing.

---

## 1. The API layer was written against a REST backend that does not exist

This is the single biggest item and it explains most "module does not work" symptoms.

The backend is **Supabase PostgREST**: tables are served at `/rest/v1/<table>` and
filters are query parameters. There are no nested resource routes. Several endpoints
assume otherwise, so they 404 on every call:

| Endpoint declared | Problem |
|---|---|
| `workshop/jobs`, `workshop/jobs/{id}/start`, `/complete`, `/status` | Not a PostgREST path shape at all |
| `workshop_events` | No such table (the real one is `tech_activity_events`) |
| `approvals` | No such table. Approval state lives on the records: `inspections.approval_status`, `checklist_submissions`, `accident_case_approvals`, `workflow_instances` |
| `tasks`, `tasks/{id}`, `tasks/{id}/status` | No `tasks` table (candidates: `action_items`, `wo_tasks`, `accident_case_tasks`) |
| `replacements`, `replacements/reasons`, `replacements/{id}` | No `replacements` table |
| `tyre_history`, `lookup_reasons` | No such tables. The source already says "Verify table name from schema" |
| `accidents/{id}`, `accidents/{id}/claims` | PostgREST filters by `?id=eq.X`, not path segments |
| `notifications/{id}/read`, `/read-all`, `/register-token` | Same - use `PATCH /notifications?id=eq.X` |

**Already fixed** (use these as the pattern):
- `ChecklistApi` had `@GET("rest/v1/checklists")` on a base that already ends in
  `/rest/v1/` - a double prefix - and `checklists` is not a table. Now
  `@GET("checklist_templates")`.
- `StorageApi` was mounted on the PostgREST base, so every upload resolved to
  `/rest/v1/storage/v1/object/...`. It now has its own Retrofit on `SUPABASE_URL`,
  and its `path` is `encoded = true` because storage paths contain slashes.
- `WorkshopApi.getWorkOrdersRows` is a correct PostgREST read of `work_orders`, with
  `WorkOrderDto` matching the real columns. Copy that shape.

Each remaining row needs a decision about which real table backs it. Do not guess -
check the schema first.

## 2. Fabricated data that has been removed - do not let it come back

These screens presented invented records as real. All are now either wired to a real
table or honestly empty:

- **Home dashboard** - hard-coded `inspectionsDue = 4`, `openJobs = 2`, and two fake
  jobs ("Mixer 2841", "Trailer 502"). Now reads `work_orders`. KPIs with no wired
  source are `null` and render as `-`, never as `0`.
- **WorkOrderRepository** - emitted two invented job cards under a comment reading
  "Fetching from Supabase logic...". Now a real read.
- **ApprovalRepository** - on any failure, and on any empty result, emitted two
  invented approvals ("Replace 4 Tyres on TRK-09"). Removed; errors now propagate.
- **StockViewModel** - four invented tyre lines at a hard-coded "Qiddiya Site". Now
  reads `stock_records`.
- **TeamViewModel** - four invented technicians. Now empty, with a stated reason.
- **Checklist signature** - saved the literal string
  `signature_data_url_mock_<timestamp>` instead of the drawing. Now captures the
  strokes and stores a real SVG (`SignatureSvg`).

Rule: an empty list is honest, an error is honest, an invention is neither.

## 3. Still to wire

- **Team status** needs `profiles` joined with `tech_activity_events` (what each
  person is doing) and `workshop_attendance` (who is on shift). No API exists yet and
  the shift/status rules need agreeing first.
- **Home KPIs** other than open jobs: inspections due, pending approvals, critical
  tyres. `inspections` and `tyre_records` are readable today; approvals needs item 1.
- **5 dead controls** that do nothing when tapped: the workspace switcher on
  Approvals / My Work / Tyre List (needs plumbing to the switcher in `MainActivity`),
  and the filter buttons on Approvals and the Notification Center.

## 4. Nine screens are built but unreachable

Registered in the NavHost, but nothing anywhere names the route, so no user can get
to them: `workshop_home`, `stock_management_route`, `ai_dashboard_route`,
`meter_log_route`, `odometer_route`, `rca_route`, `reports_route_v2`,
`analytics_route`, `records_route`.

Each needs either an entry in the Home/Profile module catalogs or removal.
`tools/check-navigation.mjs` reports them as warnings.

**`odometer_route` also has a data-integrity bug behind it**: the screen defaults to
`vehicleId = "V-1024"` and `previousOdometer = 124500`, and the NavHost hard-codes
`vehicleId = "V-1024"` on submit. If it is ever made reachable, it will write
odometer readings against a fabricated vehicle and validate them against a fabricated
baseline. Fix that before wiring it up.

## 5. Toolchain and the Play deadline

The version matrix was mutually incompatible for weeks - AGP 8.7 with Gradle 9.4.1,
which cannot configure - so the build never reached the Kotlin compiler. That is why
the history is a run of blind "fix: missing import" commits.

Now set to a documented-compatible set, **not yet build-verified**:

| | Version | Why |
|---|---|---|
| AGP | 8.11.1 | max API **36**; Kotlin 2.2.21 tests against exactly 8.11.1 |
| Gradle | 8.13 | AGP 8.11's minimum and default |
| Kotlin | 2.2.21 | supports Gradle to 8.14 and AGP to 8.11.1 |
| KSP | 2.2.21-2.0.5 | must track Kotlin exactly |
| Room | 2.8.4 | 2.6.1 predates KSP2 |
| Hilt | 2.57.2 | KSP2 / Kotlin 2.2 |
| androidx.hilt | 1.3.0 | its compiler runs under KSP2 |
| compileSdk / targetSdk | **36** | Play requires 36 from **31 Aug 2026** for new apps AND updates |

Compose BOM was deliberately **left at 2024.09.02**. The screens were only just
repaired for Material3 1.3.0's `PullToRefreshBox`, and a Compose jump risks breaking
those call sites again in a way nobody here can compile-check. Move it separately,
once there is a green build to compare against.

## 6. Security

- `tyre_pulse_app/release.jks` is **committed**, and its password was hard-coded in
  the workflow. The signing key is therefore public in git history. The workflow no
  longer generates or pushes a key and now prefers secrets, but **the key itself
  should be rotated**: Play Console -> Setup -> App signing -> request upload key
  reset, then store it as `ANDROID_KEYSTORE_BASE64`.
- The `dev` product flavour previously used the PRODUCTION anon key, because
  `NetworkConfig` hard-coded the values that `build.gradle.kts` was carefully reading
  from `local.properties`. It now reads `BuildConfig`. Consequence to action:
  `SUPABASE_ANON_KEY_DEV` in `local.properties` is still the placeholder
  `sb_publishable_DEV_KEY_PLACEHOLDER`, so the dev flavour needs a real key.
- Four `.kotlin/errors/*.log` compiler crash logs are tracked in git. Untrack them:
  `git rm --cached -r tyre_pulse_app/.kotlin`.

## 7. Before you push

```bash
cd tyre_pulse_app
node tools/check-kotlin-symbols.mjs   # missing imports (incl. Compose extensions)
node tools/check-hilt-graph.mjs       # unsatisfied bindings and DI cycles
node tools/check-navigation.mjs       # routes that crash, and unreachable screens
```

All three are mutation-tested. A clean run means what each says it means - none of
them is a type checker, so none of them means "this compiles".

---

# Update, 2026-08-23 (second pass): fabricated data removed

The first pass fixed the toolchain, auth and the API layer. This pass went after a
different defect class: screens that rendered **invented records as real fleet data**.

That is the most dangerous kind of bug in this app, because it cannot fail. A broken
read shows an error and someone investigates. A fabricated one shows a confident
number and someone acts on it.

## What was removed

| Where | What it claimed |
|---|---|
| Fleet AI chat | A `when` block over keywords returned fixed paragraphs: invented tread depths with "REPLACE NOW", an invented budget, "Confidence: 87%", a fleet of 47 vehicles. It slept 1200ms first so the answer looked computed. |
| Predictive Maintenance | A second AI chat that appended your message and **never replied at all**. It is what the Home hub's "AI Center" tile opened. |
| `AiViewModel` | A third AI implementation, unreferenced, answering everything with "your fleet costs are projected to decrease by 5%" and the real call commented out. |
| Accident case | `caseId` was accepted and ignored. Every incident opened the same fixed text: "Assigned Officer: Sarah Connor" and a narrative about a vehicle "TRK-09". Reachable from the register. |
| `InventorySyncWorker` | A background worker that POSTed two invented part deductions to `inventory_transactions` on every run, with retry. **Never enqueued, so it never wrote** - but it looked finished, and wiring it up was the obvious next step. |
| Stock Management | Three invented parts and a hard-coded "3 items awaiting network sync" - the display half of that worker. |
| Checklist library | Four templates with invented ids (`dvir_1`, ...). Tapping one routed to `checklist_runner/dvir_1`, a template that does not exist, so the runner opened on something it could never load. |
| Reports | Invented brand cost-per-km, invented monthly bars, invented KPIs, a fleet-health donut fixed at 68/22/10. |
| Driver scorecard | Five invented drivers with points, streaks and medals. No driver-scoring data exists anywhere in this system. |
| Asset detail | `demoTyres` (incl. one marked **Critical**), a fixed "Mixer 2841" header on every asset, fixed odometer/hours, and a **telemetry simulation** generating engine temperature and a "High Engine Temp Detected" alarm from `Random.nextFloat()` on a 2.5s loop. |
| Workshop / admin | Invented technicians, invented workshop bays, a fixed job header rendered underneath the real one, a job task list hard-set to `0.6f` so **every job opened three-fifths finished**, and a "Kick" button that ended nothing but reported "Kicked Mike Ross". |
| PDF export | `Operator: John Technician` and `Site: Site A` printed onto the exported report - both facts were already on the objects passed in. |
| Settings | A hard-coded "48 MB" local storage figure. |
| Home | "John Technician" as the greeting name, and "Good morning" at every hour. |

## The rule applied throughout

An empty list is honest. An error is honest. An invention is not.

- Unmeasured renders as a dash or "Not recorded", **never 0**.
- "No data" and "we could not load it" are opposite statements and render differently.
- Deleting a fabricated chart is a win, not a regression.

## Deliberately NOT re-derived

- **Tyre condition.** `tyre_records.risk_level` is NULL on all 11,205 rows, so no tyre
  is coloured Good or Critical anywhere. Verified against the live database.
- **"Assigned officer"** on an accident. No such column exists; the line is gone rather
  than back-filled from the nearest available name.
- **Inspections "due".** The table only holds `Done` and `In Progress`. There is no due
  state, so the Home tile reports in-progress instead. PM due dates come from
  `pm_programs`.
- **Workshop bays.** No table, no column, no API. The board says so.
- **Driver scoring.** Nothing records points, streaks or on-time rate.

## Still open

1. **No fleet data reaches the AI.** The chat calls the real `chat-ai` edge function,
   and its system prompt explicitly tells the model it has NOT been given fleet
   records and must not invent them. Attaching compact, field-whitelisted digests (the
   way the web app does) is the genuine next step. Do not skip the prompt guard when
   doing it - without it a model asked "which tyres need replacing?" will produce a
   plausible list, which is the original defect in a harder-to-spot form.
2. **Four screens are honest but unreferenced**: `TeamLiveScreen`,
   `WorkshopLiveMonitor`, `UserSessionScreen`, `SiteManagementScreen`. Nothing renders
   them. Wire or delete.
3. **`AssetApi` returns the domain `Asset`, not a DTO.** It survives only because
   `coerceInputValues = true` rescues the `status` enum from a free-text column via its
   default, and it has no `limit` query. Give it a DTO, as `WorkOrderDto` has.
4. **Tyre position vocabularies do not match.** `VehicleDiagram3D` matches `FL/FR/RL1`,
   while `tyre_records` stores the GCC convention fitters use (`LHF1`, `RHCO`, `LHRI`).
   Nothing maps between them, which is why the asset diagram was deleted rather than
   re-pointed at real rows. A mapping is needed before any wheel diagram can show real
   tyres.
5. **`PdfGenerator` is correct but uncalled.** Inspection export is a real capability
   the app is expected to grow.
6. **`release.jks` is committed** and its password was hard-coded in the workflow. The
   signing key is public in git history. Rotate via Play Console -> App signing ->
   upload key reset. This is an owner action, not a code change.

---

# Update, 2026-08-23 (third pass): engine hours + admin screens wired

Closing the two gaps found by comparing this app against the Expo app it replaces.

## 1. Engine hours - the module that did not exist

Native had **no engine-hours path at all**: no API, no sync command, no working
screen. `engine_hours_logs` holds 4,379 real readings, and hour-measured plant
(pumps, generators, loaders, much of the mixer fleet) carries no usable odometer -
so for those machines this is the ONLY meter. A fitter at a generator could not
record a reading.

Added `EngineHoursApi` (a deliberate mirror of `OdometerApi`; the two tables are
identical apart from the reading column) and the `ENGINE_HOURS_LOG` queue command.

**The Meter Log screen was not merely missing hours - nothing about it worked:**

- `currentKm = 125420` / `currentHours = 3640` were **hard-coded**, so both readings
  were validated against invented baselines on every asset in the fleet.
- `assetNo` defaulted to `""` and **nothing could set it** - no field, no setter - so
  every submission named no asset.
- It enqueued `"METER_LOG"`, a command with no table mapping, carrying keys `new_km`
  and `new_hours` that are columns of nothing. It aimed at a table called "meter_log".
- `onSuccess()` fired unconditionally, so a failed save still closed the screen.

It now confirms the asset against the fleet register, loads both real baselines, and
writes two rows to two tables - only for the meters actually entered.

**A backwards reading WARNS, it does not block.** A meter can genuinely be replaced or
roll over, and the database's own convention is accept-but-flag. Refusing would leave
a fitter unable to record what the meter actually says, and the reading would simply
never be captured.

## 2. Odometer logging was broken outright (found while building the above)

`OdometerLogPayload` sent `photo_url`. There is no such column on `odometer_logs` -
the real one is `photos`, a text array. With `encodeDefaults = true` and default
`explicitNulls`, `"photo_url": null` was written on **every** submission, not just
ones carrying a photo, and PostgREST rejects an unknown column. So every queued
odometer reading failed on sync, silently, after the driver had walked away.

Both meter commands now have field allow-lists in `SyncRepository`, so a future field
cannot reach the wire without being a real column.

## 3. A live crash on the Accidents tile

The Home hub AND the Profile catalog both pointed "Accidents" at `accident_dashboard`,
which is registered nowhere. Compose Navigation throws on an unknown route - so the
most prominent tile on the first screen crashed the app. Both now point at
`accident_list_route`.

## 4. The admin screens

All four were built and none was registered, so none could be opened - which is also
why the stubs stayed stubs and the fabricated content went unnoticed.

- `AdminDashboardScreen` was a title and the comment `// ... Metrics and settings
  navigation`. It is now a real hub linking People, Sites and Workshop activity.
- `SuperAdminScreen` **deleted**. Its entire content was two switches hard-coded to
  `checked = false` with `onCheckedChange = {}`, labelled "Global Sync Pause" and
  "Force Maintenance Mode" - an operator could believe they had paused the fleet's
  sync - beside "API Latency 142ms" and "Error Rate 0.02%" as string literals.
  System-wide overrides belong in the web console that owns `system_config`.
- `UserSessionScreen`, `SiteManagementScreen`, `TeamLiveScreen` routed from the hub.

The Admin entry on Profile is gated on the account's recorded role. **That is a UI
gate, not a security boundary** - row visibility is enforced by RLS, and hiding the
card only stops a technician opening a screen that would show them nothing.

## 5. Both checkers had blind spots. Both are closed and mutation-tested.

- **check-navigation** only looked at `navigate()` calls, so hub catalogs
  (`HomeModule`/`AppModule` entries, whose third argument is a route) were invisible.
  That is how the `accident_dashboard` crash passed a clean run. It now reads them.
- **check-kotlin-symbols** only resolves CAPITALISED identifiers, so an undeclared
  lowercase local is invisible. `ProfileScreen` referenced `user` throughout while the
  two lines declaring it had never landed - a compile error the checker walked past.
  Resolving arbitrary locals needs a real parser; instead it now flags an import that
  is never called, which is the precise signature of half-finished wiring.

Both were verified by reintroducing the exact bug and confirming the checker fires.

## Still open after this pass

- **`alerts` and `overview`** remain the two Expo modules with no native screen.
  `alerts` is **not worth building**: `alerts` and `alert_thresholds` both hold 0 rows.
  `overview` is a fleet KPI summary over `tyre_records` (11,205 rows) and may be
  covered by `analytics_route` - worth confirming with the owner before building.
- **Offline sync is 12 command types vs Expo's 14.** Still missing
  `CHECKLIST_APPROVAL` and `CHECKLIST_ASSIGNMENT_STATUS`. Approvals currently go
  through a transactional RPC and are online-only, which is a deliberate choice, not
  an oversight - an approval decision is not safe to replay blindly from a queue.
- **`pm_programs` holds 0 rows**, so Maintenance Due renders an honest empty state and
  stays empty until schedules exist. Same for `wo_tasks` (0). `stock_records` has 1
  row and `corrective_actions` 3.
- **Still unrouted**: `WorkshopLiveScreen`, `WorkOrderDetailsScreen`,
  `NotificationsScreen`, `HousekeepingChecklistScreen`, `EvidenceGalleryScreen`, and
  **two separate `LoginScreen` files** in `feature/auth/` and `feature/authentication/`
  - a duplicate auth package that should be resolved.

---

# Update, 2026-08-23 (fourth pass): verification + release 2.2.0

Four agents: one adversarial read-only auditor, three finishing the remaining work.

## The audit confirmed six claims and refuted the seventh

Claims 1-6 (engine hours end-to-end, the odometer `photo_url` fix, the accident link,
the admin wiring, six deletions, both checker fixes) were all CONFIRMED, including by
re-running the checker mutation tests against a scratch copy.

Claim 7 - "nothing missed" - was REFUTED, with six live defects. That is what the
auditor was for, and it is the more valuable half of the result.

## What the audit found, and what was done

**The app routed to a FAKE tyre-replacement screen while the real one sat orphaned.**
The registered screen hard-coded removal reason `"Wear & Tear"` behind
`onValueChange = {}`, had a dead serial field, and "Complete Installation" only called
`onBack()`. A fitter completed a tyre change and NOTHING was written. The working
implementation in `feature/tyre_replacement/` - which closes the fitment on
`tyre_records` through `TyreRepository.submitReplacementRequest` - had a graph builder
that was called from nowhere. It was the only one of 17 `NavGraphBuilder` extensions
never invoked, which is why nobody noticed. Real one routed, stub deleted.

**A mechanic's PRIMARY BOTTOM-NAV TAB opened an invented job.** "Active Job" showed
`WO-9021` / `CAT Excavator 320` / `Hydraulic Leak on Boom Cylinder` - identical for
every mechanic on every device - with a "Parts Deducted (Auto-synced)" list that synced
nowhere, ending in an invoice reading `Total Cost: $450.00`, `Labor Hours: 3.5 hrs` and
"Invoice Sent to Accounting". Nothing computed, nothing sent, and in dollars for a
fleet that reports in SAR. Both screens deleted; the tab now opens the real job list.

**`AiAnalyticsDashboard` was 100% string literals and reachable** - "The AI Engine has
predicted 2 assets will fail in the next 14 days", then two named machines with named
predicted failures. Deleted. Profile's three AI entries (two pointing at the same chat,
one at this) collapsed to one.

**LOGIN WAS BROKEN FOR 41 OF 43 USERS.** `profiles.country` is `text[]` in Postgres and
`core/model/Profile.kt` declared it `String?`. `getProfile` selects `*`, so PostgREST
returns `"country": ["KSA"]`; deserialising an array into a String throws, and
`coerceInputValues` does not rescue a type mismatch. The throw was swallowed by the
login try/catch and returned as a bare failure. 41 of 43 real profiles carry a non-empty
country array. Fixed, with `primaryCountry()` mirroring the Expo app's `normaliseCountry`.

**Every user's workspace claimed Saudi Arabia / SAR.** `AuthRepository` built
`Country("sa", "c1", "Saudi Arabia", "SA", "SAR", ...)` as a literal at login, so a UAE
user's AED figures were labelled SAR. Now derived from the profile; when no country is
scoped it is left unknown and the currency null, rather than defaulting.

**A settings switch promised an alert that can never fire.** "Critical Tyre Alerts -
notify when tread depth < 2mm" was `Switch(checked = true, onCheckedChange = {})`.
Verified against the live database: `tyre_records.tread_depth` is populated on **0 of
11,205 rows**. Wiring the toggle would have been the worse outcome - you would enable it
and never be warned. It now states the alert is unavailable and why, which is
actionable: start capturing tread depth.

**Analytics showed "Critical: 0"** from `risk_level`, which is NULL on all 11,205 rows -
a claim about the fleet made from no data. Renders as a dash until something rates a tyre.

Also: `WorkOrderDetailsViewModel` did `checkNotNull(savedStateHandle["workOrderId"])`
while the route declared `{jobId}`, so every tap on a work order crashed the app.
`NotificationsScreen` said "No new notifications" without querying a table holding
2,477 rows. `feature/authentication/`'s login screen called `onLoginSuccess` directly
without touching its ViewModel or AuthRepository - any password, or none, signed you in.
Deleted; `feature/auth/` is the live one.

## Release

Version bumped 2.1.17 (227) -> **2.2.0 (228)**, as required before triggering the
pipeline. `.github/workflows/build-native-android.yml` builds `bundleProdRelease`, signs
it, and PUBLISHES TO GOOGLE PLAY (internal track) for
`com.shahzebrahman.tyrepulse.native` - a different listing from the production Expo app.

**THIS IS THE FIRST COMPILE OF THIS CODE.** There is no JDK on the development machine;
the three checkers verify imports, the Hilt graph and route resolution, none of which is
a type checker. Expect the possibility of compile errors on the first run and read them
as ordinary, not as a sign the work is wrong.

**The signing key is still compromised** - `tyre_pulse_app/release.jks` and its password
are in git history. Rotate via Play Console -> Setup -> App signing -> upload key reset,
then store it as the `ANDROID_KEYSTORE_BASE64` secret. Owner action.
