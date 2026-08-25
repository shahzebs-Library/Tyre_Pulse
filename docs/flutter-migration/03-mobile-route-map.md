# 03. Mobile route map

Artifact 3 of the nine required by section 75 of the Flutter migration spec.

This is the contract a Flutter engineer builds the router from. It maps every
navigable destination in the production Expo app under `mobile/app/` to a
GoRouter target, and captures the navigation RULES that must survive the
rewrite - the rules, not just the paths, because every one of them was written
in response to a defect the product owner reported.

Spec section 41 is the reason this artifact is precise about parameter names:
the Kotlin rebuild routed on `jobId` while the ViewModel expected `workOrderId`,
and it crashed. Section 5 is the reason it is precise about Back: the Expo tab
router sent Back to Home from every screen, reported three times.

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo (`mobile/app/**`, `mobile/lib/**`, `mobile/__tests__/**`) |
| RECORDED | A measured fact quoted from PROJECT_MEMORY or from a test's own stated evidence |
| UNVERIFIED | Needs a live database check. The Supabase connector was disconnected when this was written |

Everything below is VERIFIED unless marked otherwise. No route, parameter name
or module key is asserted from memory - each was read out of the file.

---

## 0. What is actually there

Counted off the filesystem: **53 `.tsx` files under `mobile/app/`**, of which
**3 are `_layout.tsx`**, leaving **50 route files**. One of those is the
`+not-found.tsx` catch-all, so there are **49 addressable routes**:

| Group | Count | Notes |
|---|---|---|
| `app/(app)/**` | 46 | The authenticated app. Every one is a TAB route - there is no nested Stack anywhere |
| `app/(auth)/**` | 2 | `login`, `register` |
| `app/index.tsx` | 1 | The boot decider (session restore -> app or login) |
| `app/+not-found.tsx` | 1 | The catch-all safety net |

Gate coverage of the 46 `(app)` screens:

| Gate shape | Count |
|---|---|
| `withModuleGuard(Screen, '<ModuleKey>')` wrapper | 36 |
| `useModuleGuard('<ModuleKey>')` hook only, no wrapper | 5 |
| `useAdminGuard()` literal role list (deliberately stricter) | 1 |
| Bespoke inline `if (!isSuperAdmin)` | 1 |
| `withModuleGuard(Screen, null)` - authenticated-only, explicit | 2 |
| No gate expression at all | 1 (`(app)/index`, the Home hub) |

So **43 of 46 carry a real gate**, and the 3 that do not (`index`,
`notifications`, `profile`) are authenticated-only by design. There is no
screen that should be gated and is not.

---

## 1. Full route table

Column meanings:

- **Params** - the EXACT names the screen reads via `useLocalSearchParams`, with
  the type it declares. expo-router hands every one over as a string; the type
  column records what the screen coerces it to.
- **Kind** - `tab` = rendered in the bottom bar; `stack` = declared `href: null`
  and reached by `router.push`; `modal` = not a route at all, an in-page
  `<Modal>` (recorded here because Flutter engineers will look for a route).
- **Module** - the `ModuleKey` from `mobile/lib/permissions.ts` that actually
  gates the screen at runtime. Where `mobile/lib/routeAccess.ts` disagrees, that
  is flagged in section 5.
- **Canonical id** - the domain identifier name Flutter must use, per spec 41.

### 1.1 Root and auth

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/` | `app/index.tsx` | none | boot | n/a | `/` | `BootRoute` |
| `/(auth)/login` | `app/(auth)/login.tsx` | none | stack | public | `/login` | `LoginRoute` |
| `/(auth)/register` | `app/(auth)/register.tsx` | none | stack | public | `/register` | `RegisterRoute` |
| any unmatched | `app/+not-found.tsx` | none | catch-all | n/a | `errorBuilder` | `NotFoundRoute` |

`app/index.tsx` is not a screen in the product sense. It is a three-state
decider: `loading` -> spinner, `sessionTimedOut` -> a recoverable "Taking longer
than usual" screen with Try again / Sign in, else `<Redirect>` to `/(app)` or
`/(auth)/login`. RECORDED: the timeout state exists because reading the session
out of the Android Keystore stalls on low-end hardware and the screen previously
spun forever. **Flutter must keep the third state.** A GoRouter `redirect` that
only knows "signed in / not signed in" reproduces the permanent spinner.

### 1.2 Shell tabs (primary)

Declared `primary: true` in `TAB_BAR` (`mobile/lib/permissions.ts`).

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)` | `(app)/index.tsx` | none | tab | none (authenticated) | `/home` | `HomeRoute` |
| `/(app)/inspection/new` | `(app)/inspection/new.tsx` | `site?: string`, `asset?: string`, `tyreSerial?: string`, `tyrePosition?: string` | tab | `inspect` | `/inspect/new` | `NewInspectionRoute` |
| `/(app)/accident/dashboard` | `(app)/accident/dashboard.tsx` | none | tab | `accidents` | `/accidents` | `AccidentDashboardRoute` |
| `/(app)/meter-logs` | `(app)/meter-logs.tsx` | `asset?: string`, `site?: string` | tab | `meter` | `/meter` | `MeterLogRoute` |
| `/(app)/washing` | `(app)/washing.tsx` | none | tab | `washing` | `/washing` | `WashingRoute` |
| `/(app)/profile` | `(app)/profile.tsx` | none | tab | `null` (explicit) | `/profile` | `ProfileRoute` |

### 1.3 Inspections

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/inspection/[id]` | `(app)/inspection/[id].tsx` | `id: string` (an **inspection** id) | stack | `inspect` | `/history/inspection/:inspectionId` | `InspectionDetailRoute(inspectionId)` |
| `/(app)/inspection/approvals` | `(app)/inspection/approvals/index.tsx` | none | stack | `approvals` | `/approvals/inspections` | `InspectionApprovalsRoute` |
| `/(app)/inspection/approvals/[id]` | `(app)/inspection/approvals/[id].tsx` | `id?: string` (an **inspection** id) | stack | `approvals` | `/approvals/inspections/:inspectionId` | `InspectionApprovalReviewRoute(inspectionId)` |

**`inspection` is a DIRECTORY with no `index` file.** `/(app)/inspection` is not
a route and never was - pushing it lands on `+not-found`. VERIFIED, and asserted
as such in `__tests__/notificationRoutes.test.ts`.

### 1.4 Checklists

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/checklists` | `(app)/checklists/index.tsx` | none | stack | `checklists` | `/checklists` | `ChecklistsRoute` |
| `/(app)/checklists/[templateId]` | `(app)/checklists/[templateId].tsx` | `templateId?: string`, `assignment?: string`, `site?: string`, `asset_no?: string`, `resume?: string` | stack | `checklists` | `/checklists/:templateId` | `ChecklistFillRoute(templateId, {assignmentId, siteName, assetNo, draftKey})` |
| `/(app)/checklists/history` | `(app)/checklists/history.tsx` | none | stack | `checklists` (hook only) | `/checklists/history` | `ChecklistHistoryRoute` |
| `/(app)/checklists/approvals` | `(app)/checklists/approvals/index.tsx` | none | stack | `approvals` | `/approvals/checklists` | `ChecklistApprovalsRoute` |
| `/(app)/checklists/approvals/[submissionId]` | `(app)/checklists/approvals/[submissionId].tsx` | `submissionId?: string` | stack | `approvals` | `/approvals/checklists/:submissionId` | `ChecklistApprovalReviewRoute(submissionId)` |

The checklist family is the ONLY part of the app that already names its
parameters after their domain: `templateId`, `submissionId`. Copy this pattern,
not the `id` pattern used by inspections and accidents.

`resume` is a device-local DRAFT KEY, not a server id -
`draftKey(userId, templateId, assetNo)` in `mobile/lib/checklistDraft.ts`. It is
present only when the operator explicitly tapped Continue on an unfinished
sheet. Name it `draftKey` in Flutter; `resume` describes the gesture, not the
value.

### 1.5 Accidents

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/accident/report` | `(app)/accident/report.tsx` | none | stack | `reportAccident` | `/accidents/report` | `AccidentReportRoute` |
| `/(app)/accident/[id]` | `(app)/accident/[id].tsx` | `id: string` (an **accident** id) | stack | `accidents` | `/accidents/:accidentId` | `AccidentDetailRoute(accidentId)` |
| `/(app)/accident/case` | `(app)/accident/case.tsx` | `id: string` **as a query param** | stack | `accidents` | `/accidents/:accidentId/case` | `AccidentCaseRoute(accidentId)` |

**`accident/case` is the clearest spec-41 defect in the app.** The same domain
value - an accident id - is a PATH segment on `accident/[id]` and a QUERY
parameter on `accident/case` (`router.push('/(app)/accident/case?id=' + id)`,
`(app)/accident/[id].tsx:302`). Both are called `id`. In Flutter both become a
path segment named `accidentId`.

**`accident` is a DIRECTORY with no `index` file.** Same as `inspection`.

### 1.6 Fleet and records

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/records` | `(app)/records/index.tsx` | none | stack | `records` | `/records` | `TyreRecordsRoute` |
| `/(app)/vehicles` | `(app)/vehicles.tsx` | **none read** (see 7.4) | stack | `vehicles` | `/vehicles` | `VehiclesRoute({query})` |
| `/(app)/history` | `(app)/history.tsx` | none | stack | `history` | `/history` | `ActivityHistoryRoute` |
| `/(app)/alerts` | `(app)/alerts.tsx` | none | stack | `alerts` | `/alerts` | `AlertsRoute` |
| `/(app)/calendar` | `(app)/calendar.tsx` | none | stack | `calendar` | `/calendar` | `CalendarRoute` |
| `/(app)/serial-search` | `(app)/serial-search.tsx` | `q?: string` | stack | `serial` | `/serial-search` | `SerialSearchRoute({query})` |
| `/(app)/scanner` | `(app)/scanner.tsx` | none | stack | `scan` | `/scan` | `ScannerRoute` |

### 1.7 Maintenance and workshop

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/workorders` | `(app)/workorders/index.tsx` | none | stack | `workorders` | `/work-orders` | `WorkOrdersRoute` |
| `/(app)/work-orders` | `(app)/work-orders.tsx` | none | stack | `workorders` | **do not port** (see 7.1) | - |
| `/(app)/workshop` | `(app)/workshop.tsx` | none | stack | `workshop` | `/workshop` | `WorkshopRoute` |
| `/(app)/maintenance` | `(app)/maintenance.tsx` | none | stack | `pm` | `/maintenance` | `PreventiveMaintenanceRoute` |
| `/(app)/tasks` | `(app)/tasks.tsx` | none | stack | `tasks` | `/tasks` | `TasksRoute` |
| `/(app)/rca` | `(app)/rca.tsx` | `asset?: string`, `site?: string`, `serial?: string`, `brand?: string` | stack | `rca` | `/rca` | `RcaRoute({assetNo, siteName, tyreSerial, brand})` |
| `/(app)/stock` | `(app)/stock.tsx` | none | stack | `stock` | `/stock` | `StockCountRoute` |
| `/(app)/tyre-change` | `(app)/tyre-change.tsx` | `asset?: string`, `site?: string`, `position?: string` | stack | `tyreChange` | `/tyre-change` | `TyreChangeRoute({assetNo, siteName, tyrePosition})` |
| `/(app)/report-issue` | `(app)/report-issue.tsx` | `asset?: string`, `site?: string`, `serial?: string` | stack | `reportIssue` | `/report-issue` | `ReportIssueRoute({assetNo, siteName, tyreSerial})` |
| `/(app)/repair-request` | `(app)/repair-request.tsx` | `asset?: string`, `site?: string` | stack | `repairRequest` | `/repair-request` | `RepairRequestRoute({assetNo, siteName})` |

**There is NO work order detail route in the production app.** Both work-order
screens and the workshop screen open a record in an in-page `<Modal>`, closed by
clearing state. Spec section 41's `WorkOrderRoute(workOrderId)` is therefore NEW
surface in Flutter, not a port - which makes it the one place where the naming
can simply be got right from the first commit. See 4.3: a work-order push
notification currently lands on the workshop LIST, so spec section 5's
"Notification -> Work Order" journey does not exist yet either.

### 1.8 Management

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/overview` | `(app)/overview.tsx` | none | stack | `overview` | `/overview` | `OverviewRoute` |
| `/(app)/reports` | `(app)/reports/index.tsx` | none | stack | `reports` | `/reports` | `ReportsRoute` |
| `/(app)/analytics` | `(app)/analytics/index.tsx` | none | stack | `analytics` | `/analytics` | `AnalyticsRoute` |
| `/(app)/ai` | `(app)/ai/index.tsx` | none | stack | `ai` | `/ai` | `FleetAiRoute` |
| `/(app)/team` | `(app)/team.tsx` | none | stack | `team` | `/team` | `TeamRoute` |
| `/(app)/notifications` | `(app)/notifications.tsx` | none | stack | `null` (explicit) | `/notifications` | `NotificationsRoute` |

### 1.9 Admin

| Expo path | Screen file | Params | Kind | Module | GoRouter path | Typed route class |
|---|---|---|---|---|---|---|
| `/(app)/admin` | `(app)/admin/index.tsx` | none | stack | `admin` (hook only) | `/admin` | `AdminConsoleRoute` |
| `/(app)/admin/users` | `(app)/admin/users.tsx` | none | stack | `users` (hook only) | `/admin/users` | `AdminUsersRoute` |
| `/(app)/admin/access` | `(app)/admin/access.tsx` | none | stack | **super-admin only, bespoke** | `/admin/access` | `AdminAccessRoute` |
| `/(app)/admin/approvals` | `(app)/admin/approvals.tsx` | none | stack | **`useAdminGuard()`, admin only** | `/admin/approvals` | `AdminApprovalsRoute` |
| `/(app)/admin/sites` | `(app)/admin/sites.tsx` | none | stack | `admin` (hook only) | `/admin/sites` | `AdminSitesRoute` |
| `/(app)/admin/ai-chat` | `(app)/admin/ai-chat.tsx` | none | stack | `admin` (hook only) | `/admin/ai-chat` | `AdminAiChatRoute` |

### 1.10 Canonical domain identifiers

Spec 41: define these once, as typed values, and never carry them as loose
strings. The left column is the name Flutter uses everywhere; the right column
records every name the Expo app currently uses for the same value.

| Canonical name | Backing column | Names in use today |
|---|---|---|
| `accidentId` | `accidents.id` | `id` (path on `accident/[id]`), `id` (query on `accident/case`) |
| `inspectionId` | `inspections.id` | `id` (on `inspection/[id]` AND on `inspection/approvals/[id]`) |
| `submissionId` | `checklist_submissions.id` | `submissionId` - already correct |
| `templateId` | `checklist_templates.id` | `templateId` - already correct |
| `assignmentId` | `checklist_assignments.id` | `assignment` |
| `assetNo` | `vehicle_fleet.asset_no` | `asset` (inspection, meter, rca, tyre-change, report-issue, repair-request) AND `asset_no` (checklist fill) |
| `siteName` | `sites.name` / `<table>.site` | `site` - consistent |
| `tyreSerial` | `tyre_records.serial_no` | `tyreSerial` (inspection), `serial` (rca, report-issue), `q` (serial-search) |
| `tyrePosition` | `tyre_records.tyre_position` | `tyrePosition` (inspection) AND `position` (tyre-change) |
| `draftKey` | device-local | `resume` |
| `workOrderId` | `work_orders.id` | **no route exists** - new surface, get it right first time |

`assetNo` is NOT a uuid. It is a business code (`TM514`, `MP093`) and is unique
per `(organisation_id, country, asset_no)`, not globally - RECORDED, and the
reason the web app had to make `vehicle_fleet` unique per country. A typed
`AssetNo` value class should carry the country it was resolved in, or the same
code in two countries silently resolves to a different machine.

---

## 2. Tab bar and shell structure

### 2.1 What the Expo shell actually is

`mobile/app/(app)/_layout.tsx` renders ONE `<Tabs>` navigator. **Every screen in
the authenticated app is a tab route in it. There is no nested Stack anywhere.**
That single fact explains most of section 3.

Tabs are rendered from `TAB_BAR` in `mobile/lib/permissions.ts`, a 12-entry
descriptor list. Six carry `primary: true`:

| Route name | Module | `primary` | Badge |
|---|---|---|---|
| `index` | none | yes | live offline-queue pending count |
| `inspection/new` | `inspect` | yes | - |
| `accident/dashboard` | `accidents` | yes | open accidents (country-scoped) |
| `meter-logs` | `meter` | yes | - |
| `washing` | `washing` | yes | - |
| `profile` | none | yes | - |
| `records/index` | `records` | no | - |
| `workorders/index` | `workorders` | no | - |
| `analytics/index` | `analytics` | no | - |
| `reports/index` | `reports` | no | - |
| `ai/index` | `ai` | no | - |
| `admin/index` | `admin` | no | - |

The bar is then built as:

```
href: (tab.primary && canAccess(tab.moduleKey)) ? undefined : null
```

The remaining 34 screens are declared explicitly as
`<Tabs.Screen name="..." options={{ href: null }} />` below the loop.

### 2.2 The rule that must be understood before porting

**A screen that is neither in `TAB_BAR` nor declared `href: null` LEAKS as a
stray tab.** expo-router auto-adds every file under `(app)/` to the navigator,
so an undeclared screen appears in the bottom bar unbidden.

And the mirror of that rule, recorded in the layout's own comment because it
cost the business real data:

> **A name declared TWICE loses to the LATER declaration.** `washing` is
> `primary: true` in `TAB_BAR`, and a second `<Tabs.Screen name="washing"
> href:null />` below the loop overrode it back to hidden. That took the Vehicle
> Washing tab off the bar and left the screen reachable only by scrolling the
> Home hub - **the reason no wash was ever logged**. Spec section 39 names this
> exact incident.

The comment now stands in the source where the duplicate used to be. Flutter
does not have this failure mode - GoRouter throws on a duplicate path - but the
LESSON transfers: the navigation surface must be derived from one registry, and
a second place that can hide a destination will eventually hide one that
matters.

### 2.3 Primary tab sets by role, as the code actually computes them

Derived from `MODULES` role defaults with no per-user grant overlay. This is
what a fresh user of each role sees in the bar:

| Role | Primary tabs rendered | Count |
|---|---|---|
| `admin` (and super-admin) | Home, Inspect, Accidents, Meter, Washing, Profile | 6 |
| `manager` | Home, Inspect, Accidents, Meter, Washing, Profile | 6 |
| `director` | Home, Inspect, Accidents, Meter, Washing, Profile | 6 |
| `inspector` | Home, Inspect, Accidents, Meter, Washing, Profile | 6 |
| `tyre_man` | Home, Inspect, Meter, Washing, Profile | 5 |
| `driver` | Home, Meter, Washing, Profile | 4 |
| `reporter` | Home, Meter, Profile | 3 |
| `mechanic`, `electrician` | Home, Meter, Profile | 3 |
| `maintenance_supervisor`, `workshop_supervisor`, `pmv_manager`, `workshop_area_manager`, `workshop_maintenance_area_manager` | Home, Meter, Profile | 3 |
| `tyre_data_collector` | Home, Profile | 2 |

Two things to carry forward, both of which the shell gets wrong today:

1. **Six tabs can render, and the design says five.** The `TAB_BAR` comment
   states records was demoted so it "no longer occupies one of the five primary
   slots that field staff see", but four roles render six. Flutter should cap
   the branch count explicitly rather than rely on the module defaults happening
   to keep it short.
2. **`tyre_data_collector` is an APPROVER with a two-tab shell.** It holds the
   `approvals` module, so it can clear an approval queue, but reaches it only by
   scrolling the Home hub. Spec section 10 lists Approvals as a primary tab for
   the Supervisor persona. That gap is a product decision, not a port defect -
   but it is the one role where the current shell and the spec disagree outright.

### 2.4 The GoRouter design

Use `StatefulShellRoute.indexedStack` with one branch per primary destination.
Each branch owns its own `Navigator`, which is what gives per-tab history for
free - the thing the Expo `<Tabs>` navigator had to be coerced into (section 3).

```
StatefulShellRoute.indexedStack
  branch home        -> /home        (+ /notifications, /scan, /serial-search, /records,
                                        /vehicles, /alerts, /calendar, /overview,
                                        /reports, /analytics, /ai, /team,
                                        /tyre-change, /report-issue, /repair-request,
                                        /rca, /stock, /tasks, /maintenance,
                                        /work-orders, /workshop, /admin/*)
  branch inspect     -> /inspect/new
  branch accidents   -> /accidents   (+ /accidents/report, /accidents/:accidentId,
                                        /accidents/:accidentId/case)
  branch meter       -> /meter
  branch washing     -> /washing
  branch history     -> /history     (+ /history/inspection/:inspectionId)
  branch checklists  -> /checklists  (+ /checklists/:templateId, /checklists/history)
  branch approvals   -> /approvals/* (both queues and both review screens)
  branch profile     -> /profile
```

Branches exist for `history`, `checklists` and `approvals` even though they are
not primary tabs, because they are the three places the app pushes a detail
screen and expects Back to return to the LIST (asserted by name in
`__tests__/backNavigation.test.ts`). A branch is the cheapest way to guarantee
that. Whether a branch renders a bar item is a separate question, answered by
the same `canAccess(moduleKey)` predicate the Expo shell uses.

**Do not build one branch per role.** Spec section 10: one app, permission-driven
experiences. Build every branch, then filter which appear in the bar.

---

## 3. Back navigation contract

### 3.1 The rule

> **Back means return to where the user actually came from.** (Spec section 5.)

And its corollary, which is what the Expo code enforces:

> **A Back control can never be a dead press.** With history it pops; without
> history it REPLACES to the screen's real parent.

### 3.2 Why a bare `router.back()` is a no-op

`mobile/lib/goBack.ts` states it plainly: `router.back()` does nothing at all
whenever there is no history to pop - after a deep link, after a push
notification tap, after a `router.replace`, or on a cold start straight into a
route. The user presses Back and the screen does not move. RECORDED: that is the
defect reported on the Tyre Records filters screen.

`backTo(router, fallback)` is the fix and returns what it did, so tests can
assert it:

```
backTo(router, fallback) -> 'back' | 'replace' | 'unavailable'
```

- `canGoBack()` true  -> `router.back()`, returns `'back'`
- otherwise           -> `router.replace(fallback)`, returns `'replace'`
- a router that throws from `canGoBack` is treated as having NO history
- a blank or whitespace-only fallback falls back to `APP_HOME` = `/(app)`
- no usable router -> `'unavailable'`, and nothing is called

It is pure by design: it takes the router as an argument and imports nothing
from expo-router or react-native, so it is unit-testable in a plain Node runner.
Screens reach it through `useGoBack(fallback)` or the shared `<BackButton
fallback=... />`.

### 3.3 The navigator half - the part three earlier fixes missed

`backTo` alone did not fix the reported bug, and the reason is recorded in the
layout and pinned by the test:

`@react-navigation/routers` `TabRouter` defaults `backBehavior` to
`'firstRoute'`, and its `getRouteHistory()` then builds a history of exactly
`[routes[0], currentRoute]`. `routes[0]` is `index` = **Home**. So on EVERY
screen `canGoBack()` reported true and `back()` popped straight to Home.

That is why three previous fixes were partial: each tuned the FALLBACK inside
`backTo`, and the fallback branch was never reached. `canGoBack` was true, so
`backTo` always took the `back()` branch, and `back()` always landed on Home
whatever the fallback said.

The fix is one prop:

```
<Tabs backBehavior="history" ...>
```

`'history'` makes the router accumulate REAL visit history, de-duplicated by
route key so it stays bounded by the screen count. NOT `'fullHistory'`: it
de-dupes only the last entry, so an A-B-A-B loop grows without bound.

`__tests__/backNavigation.test.ts` asserts all three halves:
`backBehavior="history"` is present; no screen calls a bare `router.back()`; no
screen hand-rolls its own `canGoBack` / `back` / `replace` triple.

### 3.4 The fallback table, read from source

Every `backTo` / `useGoBack` / `<BackButton fallback>` in the app. The test
resolves each one against a route table read off the filesystem, because a
fallback pointing at a folder with no `index` does not error - it silently lands
on `+not-found`.

| Screen | Fallback |
|---|---|
| `checklists/[templateId]` | `/(app)/checklists` |
| `checklists/history` | `/(app)/checklists` |
| `checklists/approvals/index` | `/(app)/checklists` |
| `checklists/approvals/[submissionId]` | `/(app)/checklists/approvals` |
| `checklists/index` | `/(app)` |
| `inspection/[id]` | `/(app)/history` |
| `inspection/approvals/[id]` | `/(app)/inspection/approvals` |
| `inspection/approvals/index` | `/(app)` |
| `inspection/new` | `/(app)` |
| `accident/[id]` | `/(app)/accident/dashboard` |
| `accident/report` | `/(app)/accident/dashboard` |
| `accident/case` | `/(app)/accident/{accidentId}`, else `/(app)/accident/dashboard` |
| `admin/access`, `admin/ai-chat`, `admin/approvals`, `admin/sites`, `admin/users` | `/(app)/admin` |
| everything else | `/(app)` |

Three of these encode a real product decision and must survive:

- **`inspection/[id]` falls back to `/(app)/history`, not to an inspection
  list**, because History is the only screen that opens an inspection detail.
- **`accident/case` names its own accident first** and only degrades to the
  register when it has no id - a ternary, and the test checks BOTH branches
  resolve.
- **Closing a submission in checklist History is a `<Modal>`, not a
  navigation.** The test asserts it stays a modal, because if it ever starts
  navigating on close it will pop a screen the user never pushed.

### 3.5 The two journeys spec section 5 names

**Search -> Vehicle -> Inspection.** In the Expo app this is
Scanner (or Serial Search) -> resolved asset -> `inspectionForVehicle(v)` ->
`/(app)/inspection/new` with `{site, asset}` prefilled. Back must yield
Inspection -> Scanner, not Inspection -> Home. With `backBehavior="history"` it
does; with the default `'firstRoute'` it did not.

In GoRouter: `context.push` from the scanner branch keeps the scanner beneath
the inspection form in the SAME branch's Navigator, so `Navigator.pop` returns
to it. The `inspect` branch must NOT be the target of that push, or the pop
crosses branches and the scanner is gone. **Rule: a push that continues a task
stays in the branch the task started in.** Only a bar tap switches branch.

**Notification -> Work Order.** This journey does not exist yet - see 4.3. When
the work-order detail route is built, the notification must push
`/work-orders/:workOrderId` onto the branch that owns `/work-orders`, so Back
gives Work Order -> Workshop -> Home exactly as the spec draws it. A notification
that `go`s rather than `push`es produces an empty stack and a dead Back button -
which is the `backTo` fallback case, and why the fallback must be ported too.

### 3.6 How GoRouter reproduces it

1. `StatefulShellRoute` gives per-branch history. That replaces
   `backBehavior="history"` and is the structural half.
2. Port `backTo` verbatim as a pure Dart function over an interface, not over
   `BuildContext`, so it stays unit-testable:

```
enum BackOutcome { popped, replaced, unavailable }

BackOutcome backTo(GoRouter router, {String fallback = kAppHome}) {
  if (router.canPop()) { router.pop(); return BackOutcome.popped; }
  final target = fallback.trim().isEmpty ? kAppHome : fallback;
  router.go(target);            // go, not push - do not stack the parent
  return BackOutcome.replaced;
}
```

3. Give every pushed screen a `BackButton(fallback: ...)` built on it. One
   widget, one rule.
4. **Android hardware Back and the predictive-back gesture must route through
   the same function.** A `PopScope` that lets the framework pop by default
   reintroduces the dead-press case on a screen entered by deep link.
5. Port `backNavigation.test.ts` as a Dart source-scan test: no
   `Navigator.pop`/`context.pop` outside the helper, and every fallback string
   resolves against the real route table. RECORDED: reviewing for this does not
   work, because a drifted call site looks identical to a correct one.

---

## 4. Notification and deep-link routing

### 4.1 One mapping, two callers

`notificationRoute(n)` in `mobile/lib/notificationsInbox.ts` is THE tap mapping.
Both the in-app notifications list and the push-tap handler in
`app/_layout.tsx` call it.

They used to disagree: the list covered every kind while the root layout
hardcoded three, so an approval, an assignment, a parts request or an accident
push tapped from the shade **did nothing at all**. A second copy of a routing
rule always drifts from the first. **Flutter must keep exactly one.**

### 4.2 The mapping, in evaluation order

It keys on `type` first for local device notifications, then on
`entity_type ?? type` for server rows. Order matters and is load-bearing.

| # | Match | Destination | Why this order |
|---|---|---|---|
| 1 | `type == 'inspection_reminder'` | `/(app)/inspection/new` | Exact type FIRST: the string contains "inspection" and would otherwise fall into the approval-queue bucket |
| 1 | `type in {sync_success, sync_failure, photo_failure}` | `/(app)/profile` | Profile carries the offline queue: sync, retry and clear all live there |
| 1 | `type == 'wash_due'` | `/(app)/washing` | |
| 2 | `type == 'approval_decision'` | `/(app)/checklists` if the entity mentions checklist, else `/(app)/history` | A decision on YOUR OWN submission goes to your own-work history, not a generic hub |
| 3 | entity contains `checklist` | `/(app)/checklists/approvals` | Before the workshop bucket, which would swallow `checklist_assignment` on "assign" |
| 4 | entity contains any of `assign`, `work_order`, `workorder`, `job`, `parts`, `qc`, `workshop` | `/(app)/workshop` | Ahead of the inspection test on purpose: a "Quality Inspection" JOB CARD is workshop work, not a tyre inspection |
| 5 | entity contains `inspection` | `/(app)/inspection/approvals` | Not a decision on your own work means somebody is asking you to SIGN |
| 6 | entity contains `accident`, `incident` or `claim` | `/(app)/accident/dashboard` | `case` / `report` / `[id]` all need an id the mapping is never given |
| 7 | entity contains `alert` | `/(app)/alerts` | |
| - | anything else | `null` | The tap STAYS PUT and the row is still marked read |

**Every route this function returns resolves under `app/`.** Two did not:
`/(app)/inspection` and `/(app)/accident` are DIRECTORIES with no `index` file,
and expo-router only addresses a folder by its folder path when that folder
carries an `index`. Tapping an inspection or an accident notification therefore
landed the product owner on expo-router's raw "Unmatched Route" developer
screen, complete with a **Sitemap link enumerating every route in the app**.

`__tests__/notificationRoutes.test.ts` now resolves every route the function can
return against a route table read off the filesystem, and separately sweeps the
whole source for route literals. Both halves are needed: the two broken routes
were COMPUTED, so a literal grep found nothing.

### 4.3 Targets that do not exist as a route file

| Notification class | Current destination | Gap |
|---|---|---|
| job assigned, work order, parts request, QC failed | `/(app)/workshop` (a LIST) | There is no work-order or job detail route. Spec section 5's "Notification -> Work Order" journey cannot be walked today |
| accident, incident, claim | `/(app)/accident/dashboard` (a LIST) | The payload carries `entity_id`, and `accident/[id]` exists - the mapping simply never reads it |
| inspection approval requested | `/(app)/inspection/approvals` (a QUEUE) | `inspection/approvals/[id]` exists and is not used |
| checklist approval requested | `/(app)/checklists/approvals` (a QUEUE) | `checklists/approvals/[submissionId]` exists and is not used |

All four are the same shape: the notification row carries `entity_id`, the
detail route exists, and the mapping deliberately stops at the list because the
Expo mapping signature only receives `{type, entity_type}`.

**Flutter should widen the signature to include `entity_id` and route to the
detail.** That is what makes spec section 46's "notification detail" and "deep
linking" real. Keep the list as the fallback when `entity_id` is null - a queue
you can act from is a better landing than an id that resolves to nothing.

### 4.4 Cold start

A tap on a KILLED app does not reach the response listener the way a warm tap
does. Android delivers it to the native module before any JS listener exists,
and the app simply launches with nothing happening.

`app/_layout.tsx` handles it in four moves, all four of which Flutter needs:

1. **Read the stored response on boot, before subscribing.**
   `consumePendingNotificationTap()` calls
   `Notifications.getLastNotificationResponse()`, then
   `clearLastNotificationResponse()` so it is not re-selected on a later boot.
2. **De-duplicate against the live listener.** The native module replays the
   last response to a listener added afterwards, so without a guard the app
   navigates twice and stacks a duplicate screen.
   `addNotificationTapHandler` skips exactly that one response, once, by key.
3. **Queue the navigation until the router is mounted.** Pushing earlier throws
   "Attempted to navigate before mounting the Root Layout", so the target is
   parked in `queuedRouteRef` and flushed when `ready` flips.
4. **A blank or unknown target STAYS PUT.** Pushing an href with no route is
   what renders the Unmatched Route screen. `openRoute` returns early on a
   non-string or empty target, and the whole push is wrapped in try/catch
   because a tap must never be able to crash the app on launch.

In GoRouter, 3 is the one that changes shape: hold the pending deep link in a
provider and let the root `redirect` consume it once the router reports a
non-null `RouteInformation`. Do not call `go` from `initState`.

### 4.5 Scan routing

`mobile/lib/scanRouter.ts` is a second deep-link surface and is already the
right shape: pure, UI-free, returns `{pathname, params}` targets.

| Builder | Target | Params |
|---|---|---|
| `inspectionForVehicle(v)` | `/(app)/inspection/new` | `site`, `asset` |
| `tyreChangeForVehicle(v)` | `/(app)/tyre-change` | `site`, `asset` |
| `viewAssetRoute(v)` | `/(app)/vehicles` | `q` |
| `inspectionForTyre(t, code)` | `/(app)/inspection/new` | `site`, `asset`, `tyreSerial`, `tyrePosition` |
| `tyreChangeForTyre(t)` | `/(app)/tyre-change` | `site`, `asset`, `position` |
| `manualSearchRoute(code)` | `/(app)/serial-search` | `q` |

`resolveScan(raw)` classifies vehicle -> tyre -> none and never throws. Port it
as-is; make each builder return a typed route object rather than a
`Map<String, String>`.

**`viewAssetRoute` is broken today** - see 7.4.

---

## 5. Route guards

### 5.1 A refusal is not a spinner

The spec is emphatic and so is the test. `__tests__/deniedIsNotASpinner.test.ts`
opens with the incident:

> Four admin screens wrote `if (guardLoading || !allowed) return <spinner/>`.
> `allowed` never becomes true for somebody who is denied, so that spinner ran
> FOREVER - the owner reported it as "I feel is spinner but in actual no access".

Three rules follow, all enforced by source scan:

1. **Loading and denied render differently.** One ends by itself; the other
   never will. Fusing them into one branch is banned.
2. **A denied screen never renders `null`.** A blank screen is
   indistinguishable from a crash and tells somebody who simply lacks access
   nothing about why.
3. **The guard does NOT navigate away when it refuses.** `useModuleGuard` used
   to call `router.replace('/')`, which threw the person back to Home. A screen
   that vanishes and dumps you on the main page reads as the app malfunctioning,
   not as a permission boundary. Reported twice. The refusal now stays put and
   says so.

The shared denial view is `NoAccess` in `components/ModuleGuard.tsx`, exported
"so nobody writes a third one": a lock icon, "No access to this module", "You do
not have access to this module. Contact your administrator.", and a **Back
action** built on `backTo`.

### 5.2 How access resolves

One function, `resolveGuardedAccess`, used by the wrapper, the hook, the tab bar
and the Home hub, so the four layers can never disagree.

Precedence, highest first:

1. super-admin -> allow (never lockable)
2. per-user `revoke` -> deny (beats even an admin's allow-all)
3. `permissionsError` AND the module is SENSITIVE AND the role is not `admin`
   -> allow only on an explicit per-user `grant`
4. per-user `grant` -> allow
5. `isAdmin(role)` -> allow
6. role matrix (`mobile:`-prefixed `module_permissions` rows) explicit true/false
7. client-side role default from `MODULES[key].roles`

`SENSITIVE_MODULES = {admin, users, approvals}`. Everything else FAILS OPEN, and
that asymmetry is deliberate: a transient permission-RPC failure must never
strand a field user mid-shift, but it must never hand a non-admin a user
management console either.

### 5.3 The drift this design exists to prevent

`__tests__/routeGuardRegistry.test.ts`:

> Home and the tab bar gate on `canAccess(moduleKey)`. Screens used to gate on
> their OWN `useRoleGuard(['a','b'])` list. The two DRIFTED: `stock` admitted
> inspectors in the registry while the screen's list did not, so an inspector
> saw the tile, tapped it, and `router.replace('/')` threw them back to Home. To
> the user that reads as "it never opens / it spins". `meter` did the same to a
> DRIVER on their own primary tab.

Four rules are now enforced by scanning source:

1. No screen gates on a hardcoded role list. One exemption:
   `admin/approvals.tsx`, because it must be STRICTER than any module - the
   `approvals` module admits manager and director, and using the module key
   there would LOOSEN an admin gate. The exemption list is itself checked for
   staleness.
2. Every `useModuleGuard('x')` key is a real entry in `MODULES`. `tsc` cannot
   catch this: a key added to the `ModuleKey` union with no `M(...)` row
   compiles cleanly, leaves `MODULE_BY_KEY[key]` undefined, and denies the whole
   fleet at runtime.
3. Same for `withModuleGuard`.
4. A screen guarded twice uses the SAME key on both layers, or the wrapper
   admits a user the hook then bounces.

### 5.4 `mobile/lib/routeAccess.ts` - the right idea, currently dead code

`routeAccess.ts` is a single ordered registry mapping every deep-linkable route
PATH to the `ModuleKey` it requires (or `null` for authenticated-only). Its
header states the finding it was written for:

> the tab bar's `href:null` only hides a tab, it does NOT block a `router.push()`
> or a cold deep link, so navigation permissions and route guards were out of
> sync.

**It has zero consumers.** A grep across the whole mobile tree - source and
tests - returns one hit, its own definition. `ModuleGuard` takes an explicit
`moduleKey` prop and never calls `moduleKeyForRoute`, contrary to that header.
So the path-based guard the app documents does not run; what runs is the
per-screen wrapper.

**This matters for Flutter because a GoRouter `redirect` needs exactly this
table.** Port `routeAccess.ts` as the LIVE redirect map, and reconcile its three
divergences from the screens first:

| Route | `routeAccess` says | The screen actually enforces | Effect if the registry were used alone |
|---|---|---|---|
| `admin/approvals` | `approvals` | `useAdminGuard()` - admin only | LOOSENS: manager and director would reach it |
| `admin/access` | `users` | bespoke `isSuperAdmin` | LOOSENS: any admin would reach the Access Manager |
| `admin/ai-chat` | `ai` | `useModuleGuard('admin')` | LOOSENS: `ai` is a per-user-grantable module |
| `repair-request` | **no rule** | `withModuleGuard('repairRequest')` | Falls through to authenticated-only |
| `stockManage` | `stockManage` | **no screen file exists** | Dead rule |

### 5.5 The GoRouter redirect design

```
redirect: (context, state) {
  final auth = ref.read(authProvider);

  // 1. Session is still resolving - hold, do not decide.
  //    Deciding on a null profile bounces every role, including admin.
  if (auth.isResolving) return null;          // splash is rendered by the shell

  // 2. Not signed in.
  if (!auth.isSignedIn) return state.matchedLocation == '/login' ? null : '/login';

  // 3. Signed in but the shell must gate first, IN THIS ORDER:
  //    updateRequired -> profileError -> locked/unapproved.
  //    These are full-screen states, not routes - see 5.6.

  // 4. Module gate. NEVER redirect on a refusal.
  return null;
}
```

**The single most important line is number 4.** A GoRouter `redirect` that
returns `/home` for a denied route rebuilds the exact defect that was reported
twice: the screen vanishes and the user lands on the main page with no
explanation. The redirect must not decide access at all. Instead:

- resolve `moduleKeyForRoute(state.matchedLocation)` in the route's `builder`
- render `ModuleGuard(moduleKey: k, child: screen)` - the Flutter port of the
  wrapper, which renders `NoAccessView` in place
- `NoAccessView` carries a Back action built on `backTo`

Two more properties to preserve:

- **`resolving` is `loading || profileLoading`, and both matter.** RECORDED:
  `AuthContext` clears `loading` BEFORE the profile resolves, so a guard that
  waits only on `loading` evaluates a null profile on a cold start or deep link
  and denies everyone, admin included.
- **An UNMAPPED route is authenticated-only, never a gated module.** That is
  `moduleKeyForRoute` returning `undefined` and `ModuleGuard` treating it as
  `null` - so a screen nobody remembered to map is never a hole that silently
  grants access it should not.

### 5.6 The shell gates, in order

`(app)/_layout.tsx` runs five full-screen gates before the tabs render. These
are STATES, not routes - putting them on routes lets a deep link skip them.

| Order | Condition | Renders | Escape |
|---|---|---|---|
| 1 | `loading \|\| profileLoading` | spinner | - |
| 2 | `!user` | redirect to `/(auth)/login` | - |
| 3 | `updateRequired` | `UpdateRequiredGate` | Open Google Play, Sign out. Deliberately NO "continue anyway" |
| 4 | `profileError` | `ProfileErrorGate` (FAIL CLOSED) | Retry, Sign out |
| 5 | `profile.approved === false \|\| profile.locked === true` | `AccessGate` | Sign out |

Gate 3 is fail-OPEN by construction: `checkUpdateRequired()` starts false and
only flips if the server explicitly reports this build too old, and any error is
swallowed - "never lock a field user out over a version check".

---

## 6. State restoration and RTL

### 6.1 What survives process death today

**Navigation state does not.** There is no `unstable_settings`, no
`initialRouteName`, no persisted navigation key anywhere in `mobile/app/`. A
killed app reopens on Home. Spec section 5 lists state restoration as a
requirement, so this is new work, not a port.

What DOES survive, and is the part that actually matters to a field worker:

| Thing | Where | Key |
|---|---|---|
| Auth session | chunked secure storage | see artifact 06 section 5B |
| Profile cache | AsyncStorage | 90-day expiry, bound to one `user_id` |
| Offline command queue | secure storage | artifact 06 |
| Checklist drafts | AsyncStorage, max 25 | `draftKey(userId, templateId, assetNo)` |
| Language | AsyncStorage | `isRTL` derived from it |

### 6.2 What Flutter must restore

Restore the LOCATION, never the half-finished FORM STATE, and never both from
different sources. The rule that keeps this honest:

> A restored route must be re-derivable from durable data. If reopening a screen
> would show a form the user cannot recognise as their own, do not restore it -
> restore its parent and let the draft mechanism offer the work back explicitly.

Concretely:

- **Restore**: the branch index and the top location of each branch. GoRouter's
  `restorationScopeId` plus `RestorableRouteFuture` covers this.
- **Restore by offering, not by resuming**: a checklist in progress. The draft
  is already keyed and already listed on `/checklists` with a Continue action
  that passes `draftKey`. That explicit choice is better than silently
  reopening a sheet, and it is the behaviour the Expo app deliberately built.
- **Do not restore**: `/scan` (the camera must be re-consented to), the four
  shell gates in 5.6 (they must re-evaluate against the live profile), and any
  approval review screen (the row may have been decided by somebody else while
  the app was dead - reopening it presents a stale decision as actionable).

### 6.3 RTL

`isRtlLang(lang)` is `lang === 'ar' || lang === 'ur'`. `applyRTL` calls
`I18nManager.allowRTL` / `forceRTL` only when the value actually changes,
because a real change needs an app reload to take effect on native - handled by
a reload prompt in `setLanguage`.

**Flutter has no equivalent reload requirement.** Setting
`Directionality`/`MaterialApp.locale` flips the tree immediately, which is
strictly better and removes the prompt. Do not port the prompt.

Navigation chrome that MUST mirror (spec section 52):

| Element | Mirrors | Note |
|---|---|---|
| Back chevron | yes | `BackButton` already takes `isRTL` and flips the glyph |
| App bar title and action alignment | yes | |
| Bottom tab bar item order | yes | Flutter mirrors this automatically under `Directionality.rtl`; verify the badge anchors follow |
| Drawer / bottom sheet entry edge | yes | |
| List row chevrons and swipe direction | yes | |
| Tab badge position | yes | Currently anchored by absolute style in the Expo tab bar and is the most likely thing to be missed |

Navigation chrome that must NOT mirror:

| Element | Why |
|---|---|
| Tyre position IDs (`FL`, `RR2`, `LHF1`, `RHCO`) | Spec 52 and repository rule 10: these are technical identifiers, not prose. Wrap each in an LTR isolate |
| Asset numbers (`TM514`, `MP093`) | Mixed Arabic and Latin in one line is where bidi reordering visibly breaks. Isolate them |
| The tyre diagram itself | A vehicle layout is physical geometry. Mirroring it puts the near-side wheels on the wrong side. Mirror the CHROME around it, never the diagram |
| Route paths and deep links | Never localised |

---

## 7. Gaps and risks

Ordered by what a GoRouter port could silently break.

### 7.1 Two work-order screens, both live, both guarded the same

`(app)/work-orders.tsx` (273 lines) and `(app)/workorders/index.tsx` (431 lines)
are DIFFERENT implementations of the same module. Both export a component named
`WorkOrdersScreen`, both are `withModuleGuard(..., 'workorders')`, both open a
record in an in-page `<Modal>`, and both are reachable.

- `TAB_BAR` declares `workorders/index`.
- The Home hub and the AI screen link `/(app)/workorders`.
- `work-orders` is declared `href: null` in the layout and is linked from
  nowhere - reachable only by typing the deep link.
- `routeAccess`'s single rule `/^work-?orders(\/.*)?$/` covers both spellings,
  which is why the duplication never surfaced as a permission gap.

`work-orders.tsx` is the newer Daylight-styled one; `workorders/index.tsx` is
the one actually wired. **Port ONE.** Read both before choosing - they read
different columns - and delete the other rather than carrying a second path.
This is the same class of defect spec section 39 names for the washing tab: a
duplicate declaration that hid a working module.

### 7.2 `records/[id]` is declared and does not exist

`(app)/_layout.tsx` declares `<Tabs.Screen name="records/[id]" options={{ href:
null }} />`. There is no `app/(app)/records/[id].tsx`. The `records` directory
contains `index.tsx` only.

Harmless in expo-router (a declaration for a route that does not exist is
inert), but it is a false statement about the app's surface, and someone porting
by reading the layout will build a tyre-record detail route that has no
counterpart. `routeAccess`'s `/^records(\/.*)?$/` also anticipates it.

Decide deliberately: either build `/records/:tyreRecordId` in Flutter (there is
a real need - `history.tsx` opens inspections but nothing opens a tyre record)
or drop the declaration.

### 7.3 `TabDescriptor.visible` is dead, and the Meter tab is wider than intended

Every `TAB_BAR` entry carries a `visible: (role) => boolean` predicate. The only
consumer of `TAB_BAR` is `(app)/_layout.tsx`, and it gates on
`canAccess(tab.moduleKey)` - **it never reads `visible`**. Confirmed by grep:
`.visible` appears nowhere in the layout.

The visible consequence: `meter-logs` declares `visible: (r) => r === 'driver'`
but is gated on `canAccess('meter')`, and the `meter` module admits manager,
director, inspector, tyre_man, reporter, driver, mechanic, electrician and all
five supervisor roles. **The Meter Log tab is a primary tab for thirteen roles,
not for drivers.** That is why four roles render six primary tabs (2.3) against
a design that says five.

This is not necessarily wrong - a mechanic logging a meter reading is
reasonable - but it is not what the descriptor claims, and a Flutter port that
reads `visible` as the rule will produce a different bar from production. Pick
one mechanism. Recommendation: delete `visible` and keep `canAccess`, which is
the one that survives grants and the role matrix.

### 7.4 `viewAssetRoute` passes a parameter the target ignores

`scanRouter.viewAssetRoute(v)` returns
`{pathname: '/(app)/vehicles', params: {q: v.asset_no}}` and is wired to the
scanner's "View asset" action (`scanner.tsx:261`).

`(app)/vehicles.tsx` does not call `useLocalSearchParams` at all.

So scanning an asset and choosing View asset opens the UNFILTERED fleet list and
the user has to find the machine they just scanned by hand. It is not a crash
and not an error state, which is exactly why it has survived. In Flutter, a
typed `VehiclesRoute({String? query})` makes this impossible to reintroduce -
the parameter either exists on the route class or it does not compile.

### 7.5 Parameter-name inconsistencies

Full list, all VERIFIED from source. Each is a spec-41 crash waiting for a
stringly-typed port.

| Domain value | Names in use | Where |
|---|---|---|
| asset number | `asset` vs `asset_no` | `inspection/new`, `meter-logs`, `rca`, `tyre-change`, `report-issue`, `repair-request` use `asset`; `checklists/[templateId]` uses `asset_no` |
| tyre position | `tyrePosition` vs `position` | `inspection/new` vs `tyre-change` |
| tyre serial | `tyreSerial` vs `serial` vs `q` | `inspection/new` vs `rca`/`report-issue` vs `serial-search` |
| accident id | path `id` vs query `id` | `accident/[id]` vs `accident/case?id=` |
| inspection id | `id` on two different routes | `inspection/[id]` and `inspection/approvals/[id]` |
| draft key | `resume` | `checklists/[templateId]` |
| checklist assignment | `assignment` | `checklists/[templateId]` |

The pattern is that the newer surfaces (checklists) name their parameters after
their domain and the older ones (inspection, accident) call everything `id`.
Section 1.10 is the canonical table; adopt it wholesale rather than porting each
screen's local spelling.

### 7.6 Registry comments that disagree with the registry

`MODULES` carries a docblock stating that `tyre_man` gains `history` and
`reports`, and that `inspector` gains `reports`, with a stated reason ("field
submitters must be able to SEE and SHARE their own submitted work as PDF").

The rows themselves are:

```
M('history', 'History', ..., 'Fleet',      [])
M('reports', 'Reports', ..., 'Management', [])
```

`[]` means admin and super-admin only.

Two readings are possible and only a live check settles it: either the comment
records an intent never implemented, or the access is granted at runtime by
`mobile:history` / `mobile:reports` rows in `module_permissions` for those roles.
The second is exactly what the role-matrix layer is for.

**UNVERIFIED - needs a live database check.** Query `module_permissions` for
rows with `module_key` in (`mobile:history`, `mobile:reports`) and
`role` in ('Tyre Man', 'Inspector'). Until that is answered, port the ARRAYS
(`[]`) and not the comment, because the arrays are what the code executes.

### 7.7 `routeAccess.ts` has no consumers

Covered in 5.4. Restated here because it is the finding most likely to be missed
by someone porting file by file: the app documents a path-based guard registry,
ships it, tests do not reference it, and nothing calls it. Port it as the live
redirect table AND fix its three loosening divergences and one missing rule
before wiring it up.

### 7.8 A third denial view exists

`admin/sites.tsx` renders its own denial - a lock glyph and "Admin access
required" - instead of the shared `NoAccess`. It splits loading from denied
correctly, so it does not trip `deniedIsNotASpinner.test.ts`, but **it offers no
way out**: no Back action, no navigation, nothing. The user is on a dead screen.

The shared `NoAccess` is exported specifically "so nobody writes a third one".
Port one `NoAccessView` and use it everywhere.

### 7.9 The legacy role guard still redirects

`useRoleGuard` (and therefore `useAdminGuard`) still calls `router.replace('/')`
on refusal. Its one caller, `admin/approvals.tsx`, renders `NoAccess` itself
before that fires, so nobody currently sees the bounce - but the source comment
warns: "do not adopt this guard for a new screen expecting it to stay put".

In Flutter there should be no second guard at all. One `ModuleGuard`, one
`NoAccessView`, no navigation on refusal. A gate that must be stricter than its
module (the `admin/approvals` case) takes an extra predicate, not a different
guard.

### 7.10 A tab-route app has no modal semantics

Every `(app)` screen is a tab route, so nothing in the Expo app is a modal
ROUTE - the modals are in-page `<Modal>` widgets closed by clearing state, and
`backNavigation.test.ts` asserts that checklist History's viewer stays that way
"if it ever starts navigating on close it will pop a screen the user never
pushed".

GoRouter makes modal routes easy, which is the risk: promoting one of these
in-page modals to a route changes what Back means on that screen. If a modal
becomes a route, its own Back must pop only the modal, and the underlying
screen's Back contract must be unchanged. Verify against section 3.4 before
promoting any of them.

---

## 8. What still needs a live check

1. **7.6** - whether `module_permissions` carries `mobile:history` /
   `mobile:reports` rows for `Tyre Man` and `Inspector`. This decides whether
   two roles have those screens in production.
2. The full set of `type` and `entity_type` values the `notifications` table
   actually holds. Section 4.2 covers a realistic spread taken from the app's
   own test fixtures, but a value nobody anticipated routes to `null` and the
   tap does nothing. A `select distinct type, entity_type from notifications`
   settles it, and any value not covered by rules 1-7 is a routing gap.
3. Whether `notifications.entity_id` is populated for the four classes in 4.3.
   If it is, routing to the detail is a small change and closes spec section 5's
   "Notification -> Work Order" journey; if it is not, the list destinations are
   correct and the gap is server-side.
