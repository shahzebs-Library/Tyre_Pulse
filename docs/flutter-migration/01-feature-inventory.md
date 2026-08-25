# 01. Feature inventory

Artifact 1 of the nine required by section 75 of the Flutter migration spec.

This is the complete list of what the PRODUCTION Expo/React Native app under
`mobile/` actually does. Spec section 1 sets the priority of truth: the real
Supabase schema first, then WORKING React Native behaviour. This file is that
second source, written so nobody has to guess what the phone does today.

Measured, not estimated:

- **53 files under `mobile/app/`** - 3 `_layout.tsx`, 1 `+not-found.tsx`, and
  **49 addressable routes**
- **67 modules under `mobile/lib/`**
- **37 test files under `mobile/__tests__/`**
- **31 modules in the `MODULES` access registry**, 11 of them admin-only
- **17 offline write paths** (16 record-queue commands plus a separate
  inspection queue)

## Confidence key

| Mark | Meaning |
|---|---|
| VERIFIED | Read directly from source in this repo |
| RECORDED | A measured figure quoted from a source comment or PROJECT_MEMORY, not re-measured here |
| UNVERIFIED | Needs a live database check. The Supabase connector was not authenticated when this was written |

Everything is VERIFIED unless marked otherwise.

---

## 1. How to read this

Spec section 75 asks for six facts per feature. The tables below carry all six.

- **Backing surface** cross-references artifact 02. A table artifact 02 does not
  list is called out in bold. Do not re-derive the backend map here.
- **Offline** cross-references artifact 06. A command name is one of its 16;
  `enqueueInspection` is the seventeenth path, which artifact 06's command table
  does not cover.
- **Kotlin** says whether `tyre_pulse_app/` has an equivalent, and whether the
  spec's audit flagged it. Read section 4 before trusting any Kotlin screen.
- **Tests** names the files under `mobile/__tests__/` that pin the behaviour.
  Blank means nothing pins it.
- **Flutter target** is the package from the spec section 3 folder list. Where
  the spec names no package, that is stated and section 6 raises it.

---

## 2. The inventory

### 2.1 Shell, session and navigation

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| App bootstrap | `app/_layout.tsx` | Loads Ionicons with a 3s escape hatch, hides splash, mounts ErrorBoundary -> providers -> a per-pathname `ScreenBoundary`, wires Android notification channels and push taps | `profiles`, RPC `register_user_device` / `revoke_user_device` | no | `MainActivity.kt` | `animatedLifecycle`, `jsxTextNode` | `app/` |
| Entry gate | `app/index.tsx` | Three states: session restore timed out (recoverable retry), loading, or redirect to `/(app)` or login | none | no | yes | `sessionDurability` | `app/router/` |
| Not-found | `app/+not-found.tsx` | Plain-language card with one Home button, replacing expo-router's dev Unmatched view | none | no | no | `notificationRoutes`, `backNavigation` | `app/router/` |
| Tab shell | `app/(app)/_layout.tsx` | Renders session/profile/version/approval gates in order, then a Tabs navigator driven by `TAB_BAR` (12 descriptors, 6 `primary`, max 5 visible for any real role) plus 35 explicit `href: null` screens | `accidents` head count, `system_config` | reads both queue counts | partial | `backNavigation`, `deniedIsNotASpinner`, `routeGuardRegistry` | `app/router/` |
| Login | `app/(auth)/login.tsx` | Identifier + password, language toggle, server-enforced lockout | RPC `login_attempt_status`, `record_login_failure`, `reset_login_attempts`, `get_email_by_identifier` | online-only | `feature/auth` | `sessionDurability` | `features/authentication/` |
| Register | `app/(auth)/register.tsx` | **Dead end.** Invite-only notice with a Back button. No form. Kept so old links resolve | none | n/a | `feature/auth` | | `features/authentication/` |
| Forced update gate | `lib/appVersionGate.ts`, `lib/appVersion.ts` | Reads one `system_config` key and blocks a build below the admin-set minimum. Fails OPEN on every error path | `system_config` (`mobile_min_version`) | no | no | `appVersion`, `appVersionDisplay` | `core/configuration/` |
| Session durability | `lib/authLifecycle.ts`, `lib/secureStorage.ts` | Pure rules deciding when a session may end, plus the chunked staged-write Keystore adapter | none (storage) | n/a | partial | `sessionDurability`, `secureStorageAtomicity`, `secureStorageReadHealth` | `core/auth/`, `core/storage/` |
| Back navigation | `lib/goBack.ts` | The one way out of a screen. Pops with history, REPLACES without, never a no-op | none | n/a | no | `goBack`, `backNavigation` | `app/router/` |
| Route guard registry | `lib/routeAccess.ts` | Maps every deep-linkable route to its ModuleKey. **Imported by nothing** - see section 5 | none | n/a | no | | `core/permissions/` |
| Access resolution | `lib/permissions.ts`, `components/ModuleGuard.tsx`, `hooks/useRoleGuard.ts` | The 31-module registry and `resolveGuardedAccess`, which fails CLOSED for admin / users / approvals when the permission RPCs errored | `module_permissions` via role matrix, `user_access_grants` | no | `feature/auth` | `whoSigns`, `routeGuardRegistry`, `deniedIsNotASpinner`, `adminIsAdminOnly` | `core/permissions/` |

### 2.2 Home

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Home hub | `app/(app)/index.tsx` | Greeting, bell with unread count, 3 stat tiles, Start-Inspection CTA, access-filtered quick-action grid in 5 groups, elevated-only Fleet Health card, scan shortcut, own recent inspections | `inspections`, `tyre_records`, `corrective_actions`, `vehicle_fleet`, `notifications` (all head counts where a total is shown) | reads and can RUN both queues | `feature/home` - spec 32 flags invented KPIs | `homeQuickActions` | `features/home/` |

Every Home figure is a real count. A failed storage read keeps the last known
value rather than rendering 0. One mislabel to carry forward: the tile reading
"open work orders" is populated from `corrective_actions`, not `work_orders`.

### 2.3 Inspections

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| New inspection | `app/(app)/inspection/new.tsx` (1862 lines) | Four-step wizard (header / tyres / review / submit): site + asset pick, GPS capture, interactive tyre diagram, per-position pressure / tread / condition / photos, completeness gate, signature, submit | `inspections`, `sites`, `vehicle_fleet` | **YES** - `enqueueInspection`, upserts `inspections` on `client_uuid` with `ignoreDuplicates` | `feature/inspections` | `tyreCompleteness`, `tyreDiagramLayouts`, `offlineQueue`, `queuedPhotoShapes` | `features/inspections/` |
| Inspection detail | `app/(app)/inspection/[id].tsx` | Read-only record with the per-position tyre map rendered as SVG and a PDF share | `inspections` | no | `feature/inspections` | | `features/inspections/` |
| Inspection approvals queue | `app/(app)/inspection/approvals/index.tsx` | Lists inspections at `pending_approval` | `inspections` | online-only | `feature/approvals` - spec 2 flags `GET approvals` as fabricated | `inspectionApprovals`, `whoSigns` | `features/approvals/` |
| Inspection sign-off | `app/(app)/inspection/approvals/[id].tsx` | Review, signature capture, approve or reject | RPC `decide_inspection_approval`, `inspections` (notes merge) | online-only, correctly | `feature/approvals` | `inspectionApprovals`, `savedSignature`, `signatureFieldKeys` | `features/approvals/` |
| Completeness engine | `lib/tyreCompleteness.ts` (407 lines) | Decides whether every wheel on this machine was actually filled in, and which specific wheel is outstanding | pure | n/a | no | `tyreCompleteness` | `features/inspections/domain/rules/` |
| Tyre diagram engine | `lib/tyreDiagramLayouts.ts` (549 lines), `lib/tyreLayout.ts`, `components/VehicleTyreDiagram.tsx` | Resolves a vehicle type to its axle layout and canonical position codes, and draws the top-down SVG | pure + `vehicle_diagram_configs` on web only | n/a | no | `tyreDiagramLayouts` | `features/tyres/domain/` |
| Inspection PDF | `lib/inspectionReportPdf.ts` | Renders the inspection to HTML, prints locally via expo-print, shares via expo-sharing | none | n/a | `core/common/PdfGenerator.kt` - spec 48 | | `features/reports/` |

`decide_inspection_approval` is the only correct approval path.
`lib/inspectionApprovals.ts:99-122` records the four defects it fixes versus the
direct UPDATE it replaced: no already-decided guard, so two supervisors could
overwrite each other; the approver identity came from the CLIENT and was written
into `approver_email`; the enforcing policy `role_update_inspections` is
PERMISSIVE and admits `inspector`, so only the screen's own gate stopped an
inspector approving their own inspection; and that same policy BLOCKED Directors,
whom the RPC allows. So the mobile gate was looser than the server on one axis
and tighter on another.

Two smaller behaviours worth keeping. The return-reason echo into
`inspections.notes` is explicitly best-effort, because the decision is already
committed and a failure there must not be reported as a failed decision. And the
inspection detail screen's back fallback is hardcoded to `/(app)/history`, not
Home, because History is the only place in the app that opens it.

**An i18n gap unique to this screen:** three user-facing strings in
`inspection/approvals/[id].tsx` are hardcoded English rather than `t()` keys -
`'Signature required'` (line 104), `'Reason required'` (106) and
`'Could not save decision'` (143). An Arabic-reading supervisor is refused in
English.

### 2.4 Checklists

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Checklist list | `app/(app)/checklists/index.tsx` | Published templates filtered to the reader's trade, plus assigned checklists. Tyre Man gets a search-one-asset flow instead of the template hub | `checklist_templates`, `checklist_assignments`, RPC `reference_site_options` / `reference_asset_options` | online-only | `feature/checklists` | `checklistTargeting` | `features/checklists/` |
| Checklist fill | `app/(app)/checklists/[templateId].tsx` (2253 lines) | The dynamic form engine: every field type, `visibleWhen` conditionals, shared option sets, auto-values, per-line remarks, per-field photos, multiple signature fields, autosaved on-device draft, interval warning | `checklist_submissions`, `checklist_templates`, `vehicle_fleet`, RPC `checklist_last_submission` | **YES** - `CHECKLIST_SUBMISSION` (+ `CHECKLIST_ASSIGNMENT_STATUS`) | `feature/checklists` | `checklistContextCard`, `checklistPhotos`, `checklistDraft`, `markIconsAreRealGlyphs` | `features/checklists/` |
| Checklist history | `app/(app)/checklists/history.tsx` | The tradesman's own submitted sheets, paged, leading with the document number and naming the rung rather than saying "pending". Team toggle is a view filter | `checklist_submissions`, `profiles` | no | no | `checklistHistory` | `features/checklists/` |
| Checklist approvals queue | `app/(app)/checklists/approvals/index.tsx` | Lists submissions at BOTH waiting states, not just `pending` | `checklist_submissions` | online-only | `feature/approvals` | `whoSigns` | `features/approvals/` |
| Checklist sign-off | `app/(app)/checklists/approvals/[submissionId].tsx` | Renders the answers as evidence, captures the rung's signature, approves or rejects | `checklist_submissions` | **YES via `CHECKLIST_APPROVAL`** - artifact 06 section 4 says this should be online-only | `feature/approvals` | `whoSigns`, `savedSignature`, `signatureFieldKeys` | `features/approvals/` |
| Draft store | `lib/checklistDraft.ts` (564 lines) | On-device resume for a part-filled sheet: answers, notes, signatures, picked asset and photos, in their OWN folder | secure storage + document dir | n/a | no | `checklistDraft` | `features/checklists/data/local/` |
| Approval ladder | `lib/checklistApproval.ts` | Two rungs: trade fills and signs, SUPERVISOR signs off, AREA MANAGER closes. Mirrors the DB trigger `guard_checklist_approval_stages` | pure | n/a | no | `whoSigns` | `features/approvals/domain/` |
| Field engine | `lib/checklistFields.ts`, `lib/checklistMarks.ts`, `lib/checklistIcons.ts` | Field types, the 8-mark legend with icon tokens and blocking marks, and the icon resolver | pure | n/a | partial | `markIconsAreRealGlyphs`, `checklistTargeting` | `features/checklists/domain/` |
| Checklist i18n | `lib/checklistI18n.ts` | Resolves template labels and options into the reader's language while ALWAYS storing the English value | pure | n/a | no | | `features/checklists/domain/` |

**A draft is deliberately NOT a row in `checklist_submissions`.** The document
number is minted on INSERT, so a server-side draft would burn a number on every
abandoned sheet and leave permanent holes in a numbered register.

### 2.5 Tyres

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Tyre change | `app/(app)/tyre-change.tsx` | Logs a fitment: asset, site, position, brand / size / serial, cost, fitment km, tread, removal reason, photos | `tyre_records` | **YES** - `TYRE_CHANGE` | `feature/tyre_replacement` - spec 36 flags a fake screen whose button wrote nothing | | `features/tyre_replacement/` |
| Serial search | `app/(app)/serial-search.tsx` | Find a tyre by serial (typed, pasted or scanned), then mark or undo scrap | `tyre_records`, `tyre_status_marks`, RPC `scrap_tyre_by_serial`, `unscrap_tyre_by_serial`, `tyre_scrap_allowed`, `tyre_unscrap_allowed` | online-only by design | `feature/tyres` | | `features/tyres/` |
| Tyre records register | `app/(app)/records/index.tsx` | Paged tyre list (30/page), debounced search, site and risk filters, detail modal. Admin-only | `tyre_records` | no | `feature/records` | `listPagingLifecycle` | `features/records/` |
| Tyre alerts | `app/(app)/alerts.tsx` | Critical / High risk tyres with per-row acknowledge | `tyre_records`, `alerts` | no | no | | **spec names no package** |
| Overview | `app/(app)/overview.tsx` | Tyre KPI overview with date, site and country filters. Admin-only | `tyre_records` | no | `feature/overview` | | **spec names no package** |

Scrap is one RPC because two client calls leave a PARTIAL SCRAP: the mark lands
in `tyre_status_marks` while the `tyre_records.status` stamp is refused, and the
tyre then reads Scrapped in the register while still fitted in the pool. Undo
restores the PRIOR status recorded on the mark, never a blanket `Active`.

### 2.6 Assets and scanning

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Vehicles register | `app/(app)/vehicles.tsx` | Paged fleet list, asset-class chips, search, expandable 12-field detail, Start Inspection deep link | `vehicle_fleet` | no | `feature/assets` | | `features/assets/` |
| Scanner | `app/(app)/scanner.tsx` | Live camera QR / barcode over 12 symbologies, classifies the code, opens a result sheet with prefilled actions | via `vehicle_fleet`, `tyre_records` | online-only | `feature/scan`, `feature/scanner` (two packages) | | `features/scanning/` |
| Scan routing | `lib/scanRouter.ts`, `lib/assetLookup.ts`, `lib/tyreLookup.ts` | Unwraps a JSON / URL / bare payload, resolves asset before tyre, and builds the prefilled target route | `vehicle_fleet`, `tyre_records` | n/a | partial | | `features/scanning/domain/` |
| Asset classes | `lib/assetClasses.ts` | Groups asset numbers into the classes that carry tyres | pure | n/a | no | | `features/assets/domain/` |

`lookupAssetByCode` is a three-step chain: exact `asset_no`, then case-insensitive
`asset_no`, then `fleet_number`. The LIKE literal is escaped so a code containing
`%` or `_` stays a literal match.

### 2.7 Meters and washing

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Meter log | `app/(app)/meter-logs.tsx` | Two-step entry then review: odometer km (mandatory), engine hours (optional), mandatory gauge photo, optional signature, site auto-filled from the asset | `odometer_logs` (read + write), **`engine_hours_logs`** (write only) | **YES** - `ODOMETER_LOG`, `ENGINE_HOURS_LOG` | `feature/meters`, `feature/odometer` (two packages) - spec 38 flags payload columns that did not exist | | `features/meter_logs/` |
| Vehicle washing | `app/(app)/washing.tsx` | Driver logs a wash: scan or search asset, auto-filled type and site, wash type, status, operator, bay, odometer, photos | `wash_records`, `vehicle_fleet` | **YES** - `WASH_RECORD` | `feature/washing` | `washSchedule` | `features/washing/` |
| Wash due rule | `lib/washSchedule.ts` | Rolling 7-day due list derived on-device from wash history, driving a LOCAL notification | pure over `wash_records` | n/a | no | `washSchedule` | `features/washing/domain/` |

**`engine_hours_logs` is not in artifact 02's table list.** Artifact 02 states the
Expo app does not use it. That is true of READS only - the app writes to it
through the `ENGINE_HOURS_LOG` queue command. See section 6.

A reading below the last one is NOT rejected. It is accepted, the driver is
warned, and the server flags it for review. `wash_date` is locked to today and
has no input control at all.

### 2.8 Accidents

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Report accident | `app/(app)/accident/report.tsx` (1235 lines) | Seven-section field-parity incident form mirroring the web: incident, classification, people and damage, liability and GCC case, insurance and claim, repair and release, photos | `accidents`, `sites`, `vehicle_fleet`, bucket `accident-photos` | **YES** - `REPORT_ACCIDENT`, a 50-column allow-list | `feature/accidents` | **none** | `features/accidents/` |
| Accident detail | `app/(app)/accident/[id].tsx` | Read-only record, photo lightbox, status change, admin delete, audit trail, PDF export, claims panel | `accidents`, `accident_parts`, `accident_remarks`, RPC `get_accident_audit`, `request_accident_closure`, `approve_accident_closure`, `reject_accident_closure` | online-only | `feature/accidents` | | `features/accidents/` |
| Accident dashboard | `app/(app)/accident/dashboard.tsx` | KPI tiles, severity breakdown, site / status / mine filters. A primary tab | `accidents` | no | `feature/accidents` | | `features/accidents/` |
| Case status | `app/(app)/accident/case.tsx` | Read-only workflow view: reference, stage, completion percent, one chip per workstream | `accidents`, `accident_case_workstreams` | n/a - no write path by design | `feature/accidents` - spec 42 flags an invented "Assigned Officer: Sarah" story shown for every incident | | `features/accidents/` |
| Case engine | `lib/accidentCase.ts` | Orders ten workstreams, computes completion, and degrades honestly when the case migration is not applied | pure + the two tables | n/a | no | | `features/accidents/domain/` |
| Accident PDF | `lib/accidentPdf.ts`, `lib/auditDiff.ts` | Local PDF of one case plus a readable audit diff | `accident_parts`, `accident_remarks` | n/a | `PdfGenerator.kt` | | `features/reports/` |

The accident form is the highest-volume capture surface in the app and has NO
dedicated test. Its 50-column allow-list is the single largest place where a
silently-stripped field would lose real data.

### 2.9 Workshop, work orders and maintenance

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| My Jobs (workshop) | `app/(app)/workshop.tsx` | Technician screen: my open jobs, per-job task picker, twelve large activity buttons, shift check in / out. Every tap writes one append-only event | `wo_assignments`, `work_orders`, `wo_tasks`, `tech_activity_events`, bucket `tyre-photos` | **YES** - `WORKSHOP_EVENT`, idempotent on `client_uuid` (V292) | `feature/workshop` - spec 40 flags invented technicians, bays, job numbers and productivity | `workshopLive` | `features/workshop/` |
| Live status engine | `lib/workshopLive.ts`, `lib/workshopApi.ts` | 15 event types, 6 blocked reasons, 11 statuses, 12 actions. Computes status, segments and today's productivity | pure | n/a | `WorkshopLiveViewModel.kt` | `workshopLive` | `features/workshop/domain/` |
| Corrective actions register | `app/(app)/workorders/index.tsx` | Labelled "Work Orders" but reads `corrective_actions`. Status list with a queued status change | `corrective_actions` | **YES** - `CORRECTIVE_ACTION_STATUS` | `feature/workshop` | | `features/work_orders/` |
| Work orders | `app/(app)/work-orders.tsx` | The only human surface reading the real `work_orders`. **Orphaned** - nothing links to it | `work_orders` | **YES** - `WORK_ORDER`, `WORK_ORDER_STATUS` | `feature/workshop` - spec 41 flags a route-id mismatch that crashed | | `features/work_orders/` |
| Tasks | `app/(app)/tasks.tsx` | Corrective actions with Open / Mine / All and a one-tap Resolve | `corrective_actions` | **NO** - a direct update, unlike the same table's queued path | `feature/tasks` | | `features/tasks/` |
| Report an issue | `app/(app)/report-issue.tsx` | Raise a corrective action: title, priority, site, asset, description, due-date preset, photos | `corrective_actions` (write only, no read) | **YES** - `REPORT_ISSUE` | `feature/report_issue` | | **spec names no package** |
| Repair request (RFR) | `app/(app)/repair-request.tsx` | Driver-raised fault report that PRECEDES a job card: scan or search asset, 12 fault categories, priority, meters, photos, signature | **`repair_requests`** - UNVERIFIED, see below | **YES** - `REPAIR_REQUEST` | no | `repairRequest` | `features/work_orders/` |
| Preventive maintenance | `app/(app)/maintenance.tsx` | Due and overdue PM plans plus a record-service modal | `pm_programs`, RPC `record_pm_service` | **NO** - deliberately, the RPC is transactional and role-gated | `feature/maintenance` | | `features/maintenance/` |
| Root cause analysis | `app/(app)/rca.tsx` | RCA register for tyre failures plus a create form with contributing factors | `rca_records` | **YES** - `RCA` | `feature/rca` - spec 44 | | `features/rca/` |
| Calendar | `app/(app)/calendar.tsx` | Agenda bucketed Overdue / Today / This week / Later from three sources, each fetched independently | `inspections`, `pm_programs`, `corrective_actions` | no | `feature/calendar` | `schedule` | **spec names no package** |
| Team roster | `app/(app)/team.tsx` | Read-only roster with search and pending-vs-active counts. Admin-only | `profiles` | no | `feature/team` - spec 40 flags five invented people with points and streaks | | `features/team/` |

`repair-request.tsx`, `lib/repairRequest.ts` and its test are UNTRACKED in git,
`lib/permissions.ts` and `lib/recordQueue.ts` carry uncommitted edits for it, and
`MIGRATIONS_V608_REPAIR_REQUEST_RFR.sql` states **"STATUS: AUTHORED - NOT YET
APPLIED."** So `repair_requests` does not exist in the live database and every
submit would fail today. Treat this as in-flight work, not shipped behaviour.

**Three surfaces read `corrective_actions` with three different status
vocabularies and three different write paths.** That is the clearest
consolidation target in the app - see section 6.

### 2.10 Stock

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Stock count | `app/(app)/stock.tsx` | Tyre stock grouped by derived size and location, quick plus/minus adjust, absolute stock-take modal, add-stock modal | `stock_records`, `stock_movements`, `vehicle_fleet`, RPC `set_stock_count`, `post_stock_movement` | **YES as a fallback only** - `STOCK_ADJUST` | `feature/inventory` - spec 45 flags invented tyre stock at Qiddiya | `stockSitePicker` | `features/stock/` |

`stock_records` has no `size` column. Size lives inside free-text `description`,
is parsed back out with a regex, and is prefixed on create so the parse keeps
working. Online writes go through two RPCs (absolute count, or a signed-by-type
delta) that compute the balance server-side. The offline fallback is ALWAYS an
absolute `stock_qty`, resolved against the last value the DEVICE saw, and writes
no `stock_movements` ledger row.

### 2.11 Notifications, reports, analytics and AI

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Notification inbox | `app/(app)/notifications.tsx`, `lib/notificationsInbox.ts` | Own notifications, optimistic mark-read, tap-to-route, realtime filtered to the user, mark-all | `notifications` | no | `feature/notifications` - spec 2 flags `POST notifications/{id}/read` as fabricated | `notificationRoutes` | `features/notifications/` |
| Push registration | `lib/notifications.ts` | Three Android channels, Expo push token written to BOTH `user_devices` and legacy `profiles.push_token`, local reminders | RPC `register_user_device` / `revoke_user_device`, `profiles` | no | `NotificationRepository.kt` | | `core/telemetry/` |
| Reports | `app/(app)/reports/index.tsx` | Executive report from ONE server aggregate, plus two operational exports. PDF rendered LOCALLY and shared. Admin-only | RPC `get_report_snapshot_authed`, `tyre_records`, `corrective_actions` | no | `feature/reports` | | `features/reports/` |
| Analytics | `app/(app)/analytics/index.tsx`, `lib/mobileAnalytics.ts` | Fleet KPIs, risk bands, top sites and brands from ONE aggregate row. Admin-only | RPC `get_mobile_analytics` | no | `feature/analytics` | `mobileAnalytics` | **spec names no package** |
| Fleet AI | `app/(app)/ai/index.tsx` | Chat: classify intent, fetch live paged context, call the edge function, render a structured reply with action buttons. Admin-only | Edge function `chat-ai`; context from `tyre_records`, `vehicle_fleet`, `corrective_actions`, `accidents` | no | `feature/ai`, `feature/ai_engineer` - spec 49 flags hard-coded predictions, an invented budget and an invented "Confidence: 87%" | | `features/ai/` |
| Inspection history | `app/(app)/history.tsx` | Merged view of queued and synced inspections, status filter, per-row PDF share. Admin-only | `inspections` | reads and syncs the inspection queue | `feature/records` | `offlineQueue` | `features/records/` |

`get_mobile_analytics` replaced a client-side scan of the whole `tyre_records`
table. Currency is never blended: on the All-countries view every cost arrives
null and the screen must render N/A and rank by volume. Unrated tyres are stated
separately rather than folded into Low, which would read as "checked and fine".

### 2.12 Profile and admin

| Feature | RN source | What it does | Backing surface | Offline | Kotlin | Tests | Flutter target |
|---|---|---|---|---|---|---|---|
| Profile | `app/(app)/profile.tsx` | Profile card, role-gated shortcuts, appearance, language, daily reminder, offline queue stats with sync / clear, sign out, deletion request, build version | `account_deletion_requests`, `profiles` | controls BOTH queues | `feature/profile`, `feature/settings` | `appVersionDisplay` | `features/profile/` |
| Admin console | `app/(app)/admin/index.tsx` | Six KPI cards, quick actions, super-admin access row, closure and approval banners, critical accident and alert lists | `vehicle_fleet`, `accidents`, `alerts`, `inspections`, `profiles`, `pending_uploads` | no | `feature/admin` | `adminIsAdminOnly`, `deniedIsNotASpinner` | `features/admin/` |
| User management | `app/(app)/admin/users.tsx` | Approve, lock, unlock, deactivate, change role, set country | RPC `admin_mobile_user_action`, `profiles` | no | `feature/admin` | `adminIsAdminOnly` | `features/admin/` |
| Sites and vehicles | `app/(app)/admin/sites.tsx` | Two tabs: sites CRUD grouped by country, and vehicle CRUD including delete, with per-site rollups | `sites`, `vehicle_fleet` | no | `feature/admin` - spec 45 flags four invented sites | `deniedIsNotASpinner` | `features/admin/` |
| Per-user access | `app/(app)/admin/access.tsx` | Super-admin only. Pick a user, set each mobile module to Default / Allow / Deny | `profiles`, `user_access_grants`, RPC `set_user_access_grant` / `revoke_user_access_grant` | no | no | `deniedIsNotASpinner` | `features/admin/` |
| Upload and closure approvals | `app/(app)/admin/approvals.tsx` | Pending uploads and accident closures, decided entirely through RPCs | `pending_uploads`, `accidents`, RPC `approve_pending_upload`, `reject_pending_upload`, `restamp_pending_upload_country`, `approve_accident_closure`, `reject_accident_closure` | no | `feature/approvals` | `adminIsAdminOnly`, `routeGuardRegistry` | `features/approvals/` |
| Admin AI chat | `app/(app)/admin/ai-chat.tsx` | Four-agent chat with per-agent prompts and a live fleet context string | Edge function `chat-ai`; `accidents`, `alerts`, `inspections` | no | `feature/ai_engineer` | | `features/ai/` |
| Saved signature | `components/SignatureField.tsx`, `lib/userSignature.ts`, `lib/savedSignature.ts` | Loads the approver's own saved mark into the pad, visibly, with one-tap redraw | `user_signatures` | no | `SignatureSvg.kt` - spec 21 flags a placeholder string stored instead of a signature | `savedSignature`, `signatureFieldKeys`, `signaturePen` | `shared/widgets/` |

### 2.13 Cross-cutting infrastructure

| Module | What it does | Tests |
|---|---|---|
| `lib/recordQueue.ts` (801 lines) | The typed offline queue. 16 commands, one table-name registry, a field allow-list per command, per-command idempotency | `queuedPhotoShapes`, `offlineQueue` |
| `lib/offlineQueue.ts` | The SEPARATE inspection queue under its own storage key | `offlineQueue` |
| `lib/photoUpload.ts`, `lib/durablePhotos.ts`, `lib/storageRefs.ts` | Resize ladder, durable document-dir copy, bounded upload, orphan sweep, 15-minute signed URLs | `queuedPhotoShapes`, `checklistPhotos` |
| `lib/fetchAll.ts`, `lib/fetchAllRows.ts` | The two PostgREST paging helpers, plus identity paging for set-returning RPCs | `fetchAll`, `listPagingLifecycle` |
| `lib/safeError.ts`, `lib/safeUrl.ts`, `lib/sentry.ts` | Message scrubbing against a 30-entry leak list, URL scheme allow-lists, PII redaction before Sentry | |
| `lib/theme.ts`, `lib/rtl.ts`, `components/ui/*` | The Daylight design system and RTL helpers | `animatedLifecycle`, `jsxTextNode` |
| `locales/en.json`, `ar.json`, `ur.json` | Three UI locales. A missing key does NOT fall back to English unless the key exists in `en.json` | `signatureFieldKeys` |

### 2.14 Mirror files - engines that exist twice today

Each of these carries an explicit "CHANGE BOTH" header, and several are pinned by
a web test that reads the MOBILE source as text and fails on a one-sided edit.
Artifacts 07 and 08 are the parity-test artifacts for the first two.

| Mobile | Web twin |
|---|---|
| `lib/tyreCompleteness.ts` | `src/lib/tyreCompleteness.js` (behavioural constants compared as TEXT) |
| `lib/tyreDiagramLayouts.ts` | `src/components/VehicleTyreDiagram.jsx`, `src/lib/vehicleTyreLayout.js` |
| `lib/checklistApproval.ts` | `src/lib/checklist/checklistApproval.js` (web test reads this file's source) |
| `lib/checklistMarks.ts`, `checklistI18n.ts`, `checklistIcons.ts`, `checklistRoles.ts` | `src/lib/checklist/*` |
| `lib/savedSignature.ts` | `src/lib/savedSignature.js` |
| `components/SignatureField.tsx` | `src/components/checklist/SignatureField.jsx` (both write the same `user_signatures` row) |
| `lib/workshopLive.ts` | `src/lib/workshopLive.js` |
| `lib/mobileModules.ts` equivalent | `src/lib/mobileModules.js` (the web Access Manager's mirror of `lib/permissions.ts`) |
| `lib/fetchAll.ts` | `src/lib/fetchAll.js` (deliberately shares its contract so both page identically) |

**For Flutter this becomes a three-way problem.** A Dart port makes each of these
a THIRD copy, and a text-comparing test cannot span languages. Decide the parity
mechanism before porting the first engine - artifacts 07 and 08 exist for exactly
this.

---

## 3. Summary counts

| Measure | Count | Basis |
|---|---|---|
| Files under `mobile/app/` | 53 | file count |
| Addressable routes | 49 | 53 minus 3 layouts and `+not-found` |
| Feature areas in this inventory | 13 | sections 2.1 to 2.13 (2.14 is a cross-reference, not an area) |
| Distinct user-facing features listed | 72 | counted table rows across sections 2.1 to 2.13 |
| Modules in the access registry | 31 | `MODULES` in `lib/permissions.ts` |
| Admin-only modules (`roles: []`) | 11 | records, history, workorders, overview, reports, analytics, stockManage, ai, team, admin, users |
| Admin-only or super-admin-only ROUTES | 15 | the 11 above plus admin/sites, admin/approvals, admin/ai-chat, admin/access |
| Routes that write offline | 14 | see below |
| Offline write paths | 17 | 16 record-queue commands plus `enqueueInspection` |
| Tables reached by a literal `.from()` | 31 | census across `app`, `lib`, `components`, `contexts`, `hooks` |
| Tables reached ONLY through the queue | 2 | `engine_hours_logs`, `repair_requests` |
| Distinct tables in total | 33 | 32 of which exist live; `repair_requests` does not |
| Test files | 37 | `mobile/__tests__/` |
| Feature areas with at least one behaviour-pinning test | 11 of 13 | the two with NONE are 2.6 assets and scanning, and 2.8 accidents |

**The 14 routes that write offline:** inspection/new, checklists/[templateId],
checklists/approvals/[submissionId], tyre-change, meter-logs, washing,
accident/report, workshop, stock, rca, report-issue, workorders/index,
work-orders, repair-request.

**Feature areas with NO dedicated test:** accidents (all four routes, including
the 1235-line report form), assets and scanning, tyres (tyre-change and serial
search), meters, reports, AI, maintenance, RCA, tasks, team, profile, and the
whole auth pair.

---

## 4. Features the Kotlin app invented that do not exist in production

The Kotlin project under `tyre_pulse_app/` has 33 feature packages and 277 Kotlin
files. The spec's audit findings are listed below with the REAL surface.

Two things matter before reading this table. First, artifact 02 already
establishes that the Retrofit endpoint layer was invented wholesale: there is no
application server, so `/approvals`, `/tasks`, `/replacements`, `/lookup_reasons`,
`/tyre_history` and `/workshop_events` have no backing object. Second, **the
Kotlin source now carries in-code "WHAT THIS REPLACED" headers on many of these,
recording that the fabrication was repaired in place after the spec was written.**
So a Kotlin file may today be correct about a surface the spec still flags. Read
the header before copying anything, and verify every claim against artifact 02.

| Spec section | What Kotlin invented | The real surface |
|---|---|---|
| 36 | A tyre replacement screen whose completion button wrote nothing, over three invented endpoints (`replacements/reasons`, `POST replacements`, `GET replacements/{id}`) | There is no `replacements` table and does not need to be one. A replacement is the pair of writes that closes one fitment and opens the next, both on `tyre_records`. Removal reasons are a COLUMN, not a lookup. The shipped path is the `TYRE_CHANGE` queue command |
| 36 | - | The order is not optional. `guard_tyre_active_fitment` (VERIFIED, referenced by 6 migrations) raises 23505 when a row is written active at an asset and position that already has an active tyre. Close before fitting |
| 40 | Twelve invented technicians with invented jobs and elapsed times, four invented workshop bays as a live board, and `Productivity(45, 10, 2)` as a hard-coded stub | `tech_activity_events` is the real append-only log. `lib/workshopLive.ts` computes status, segments and productivity from it. The fabricated bay grid was DELETED rather than re-pointed, because nothing real fed it |
| 40 | A gamified driver leaderboard built from five invented people with points, streaks and achievement badges | `profiles` carries a roster and nothing else. There is no points, streak or badge column anywhere. The production screen is a read-only roster |
| 41 | A job-details header that was a fixed picture of a job that does not exist, with a different invented job in its body and a five-item invented task checklist | `work_orders` plus `wo_tasks`. The route-id mismatch (`route = jobId`, ViewModel expected `workOrderId`) is a separate crash the spec calls out |
| 45 | Four invented tyre stock lines as the ViewModel's DEFAULT STATE, at a hard-coded site called "Qiddiya Site" | `stock_records`, filtered by `site`. An empty table must render "No stock records available" |
| 45 | Four invented sites - "Qiddiya Site", "NEOM Hub", "Dammam ..." - in site management | The `sites` table |
| 49 | A local `when` block over keywords returning hard-coded paragraphs with invented tyre readings, an invented budget of "AED 24,000-32,000" and an invented "Confidence: 87%" | The `chat-ai` edge function. The production AI screen renders a fixed error message on failure and invents nothing |
| 42 | A fabricated case card - "Status: Under Review", "Assigned Officer: Sarah ..." - shown for EVERY incident, because the screen took a `caseId` and ignored it | `accidents` plus `accident_case_workstreams`. There is no "assigned officer" field; spec 42 says so explicitly |
| 37 | Four hard-coded tyre-history timeline rows for every tyre, two of which describe events the system does not record | A filtered query over `tyre_records` by `serial_no` |
| 32 | Invented Home KPIs | Every production Home figure is a real count, and a failed read keeps the last known value rather than rendering 0 |
| 21 | A signature implementation that stored a placeholder STRING instead of a drawing | `SignaturePad` writes a self-contained SVG. The pen colour is baked into the stored SVG, so an illegible pen stores a signature nobody can ever see |
| 38 | Meter payloads whose fields did not match real database columns, and a hard-coded default of 124,500 km | `odometer_logs` and `engine_hours_logs`, with the `ODOMETER_LOG` and `ENGINE_HOURS_LOG` allow-lists |
| 50 | Dangerous fake toggles such as "Global Sync Pause" and "Maintenance Mode" | No such control exists on the backend. Mobile admin is users, access grants, sites, approvals and workshop activity |
| 2 | An "Offline Inventory Edge-Sync" screen listing three invented parts and a hard-coded "3 items awaiting network sync", with a worker POSTing the same invented parts | The real pending count is the live offline queue depth, broadcast on a device event |

**Three Kotlin packages have no production counterpart at all:** `diagnostics`,
`search` (global search is spec 34 and is NOT built on the phone today) and
`ai_engineer`. `scan` and `scanner`, and `meters` and `odometer`, are duplicate
pairs. Do not port a package just because it exists.

---

## 5. Production behaviour that is easy to lose in a rewrite

These are rules found in the source, each with the file that proves it and what
breaks if Flutter drops it. None is obvious from a screenshot.

### 5.1 A permission refusal must not render as loading

**Rule.** Loading and denied are opposite states: one ends by itself, the other
never will. They must render differently.

**Proof.** `__tests__/deniedIsNotASpinner.test.ts`. Four admin screens wrote
`if (guardLoading || !allowed) return <spinner/>`. `allowed` never becomes true
for somebody who is denied, so that spinner ran FOREVER. The owner reported it
as "I feel is spinner but in actual no access". `components/ModuleGuard.tsx`
exports `NoAccess` precisely so the two branches stay separate.

**If Flutter drops it.** A denied user sees an infinite spinner and reports the
app as broken. The test is scoped to UNWRAPPED screens deliberately, so removing
a guard wrapper starts failing it.

### 5.2 A guard must never redirect a denied user

**Rule.** `useModuleGuard` deliberately does NOT `router.replace('/')`.

**Proof.** `hooks/useRoleGuard.ts`: a screen that vanishes and dumps you on the
main page "reads as the app malfunctioning, not as 'you do not have access'".
The owner reported it that way twice.

**If Flutter drops it.** Every denial becomes an unexplained bounce to Home.

### 5.3 Guards fail CLOSED for sensitive modules

**Rule.** When the permission RPCs errored, `admin`, `users` and `approvals`
require a positive signal that does not depend on the failed data: super-admin,
the hard `admin` role, or an explicit per-user grant loaded before the failure.
Role default and role matrix are ignored.

**Proof.** `resolveGuardedAccess` in `lib/permissions.ts` lines 315-333.

**If Flutter drops it.** A fail-open empty permission matrix hands a non-admin an
administration surface.

### 5.4 Back must never be a no-op, and the navigator default breaks it

**Rule.** Two independent causes, both guarded. `backTo` pops with history and
REPLACES without, so it can never do nothing. And the Tabs navigator must carry
`backBehavior="history"`.

**Proof.** `lib/goBack.ts` and `__tests__/backNavigation.test.ts`. Every screen
under `app/(app)` is a TAB route with no nested Stack, and TabRouter defaults
`backBehavior` to `'firstRoute'`, which builds a history of exactly
`[routes[0], current]`. `routes[0]` is Home, so `canGoBack()` was true everywhere
and `back()` popped straight to Home. That is why earlier per-screen fallback
fixes were all partial: the fallback branch was never reached. The prop is
asserted at `app/(app)/_layout.tsx:178`.

**If Flutter drops it.** Backing out of a checklist jumps to Home instead of the
module it was opened from - reported three times by the product owner. A bare
back on a deep-linked or notification-tapped screen does nothing at all.

### 5.5 A fallback route must be a real route

**Rule.** Every back fallback and every notification target is resolved against a
route table read off the filesystem the way expo-router builds one.

**Proof.** `__tests__/notificationRoutes.test.ts`. `notificationRoute()` returned
`/(app)/inspection` and `/(app)/accident`, and NEITHER is a route: both are
DIRECTORIES with no index file. A literal grep for route strings found nothing,
because both were COMPUTED and returned from a function.

**If Flutter drops it.** A notification tap lands on the framework's unmatched
screen. In expo-router that screen also offered a Sitemap link enumerating every
route in the app, which is why `+not-found.tsx` exists.

### 5.6 A failed read is not an empty result

**Rule.** Secure storage answers ok / absent / unreadable / torn. "The Keystore
refused" and "there is nothing stored" are DIFFERENT answers. Every
read-modify-write refuses rather than saving over what it could not see.

**Proof.** `lib/secureStorage.ts` (`readItem`, `ReadStatus`),
`__tests__/secureStorageReadHealth.test.ts`, `__tests__/sessionDurability.test.ts`
(`classifyRestore`), and `QueueUnreadableError` in `lib/offlineQueue.ts`.

**If Flutter drops it.** Two failures, both silent. supabase-js reads `null` as
"no session on this device" and signs the user out - and these users did not
choose their credentials, so a sign-out is a person who cannot get back in at
all. And a torn queue read plus a save overwrites a field worker's unsynced
inspections with an empty list, with the only copy on that device. The stated
trade is deliberate: risk failing to save ONE new item rather than silently
destroying ALL of them.

### 5.7 A chunked write must be staged, and only the metadata write commits

**Rule.** Every write goes to a NEW generation of chunk keys; the metadata write
is the single commit point; the old generation is deleted only afterwards.

**Proof.** `lib/secureStorage.ts` and `__tests__/secureStorageAtomicity.test.ts`.
The old code called `removeItem` FIRST, leaving a window in which the previous
value was gone and the new one did not exist. Every way of landing in that gap is
real on this hardware: the Android Keystore is a binder IPC that can reject, and
the process can be killed the moment the user backgrounds it.

**If Flutter drops it.** An interrupted write destroys the session or the queue.
The stated cost of the fix is orphaned bytes from an interrupted write, which is
recoverable by reinstalling; a destroyed queue is not.

### 5.8 Only a definitive server answer may end a session

**Rule.** A dead network, an aborted request, a 5xx, a stalled Keystore or an
unreadable chunk are all TRANSIENT and leave the session where it was. What still
ends a session: the user taps Sign out, the server says locked or not approved,
or the refresh token is definitively rejected.

**Proof.** `lib/authLifecycle.ts` and `__tests__/sessionDurability.test.ts`. The
offline profile cache is valid for `PROFILE_CACHE_MAX_AGE_MS` = 90 days, and
fails closed on a wrong user id, a missing timestamp, `locked` or `approved:
false`. Token refresh follows AppState because React Native suspends JS timers
when backgrounded, so a phone left in a pocket overnight wakes with a dead JWT.

**If Flutter drops it.** A field worker on leave, or one whose phone slept, is
locked out of an app they cannot log back into, with queued work stranded behind
the login screen.

### 5.9 A queued photo has two shapes, and every step must handle both

**Rule.** A command payload's `photos` is either a flat `string[]` or a keyed
`Record<fieldId, string[]>` - the shape a CHECKLIST submits.

**Proof.** `__tests__/queuedPhotoShapes.test.ts`. All three photo steps began with
`Array.isArray(photos)`, so a keyed map fell through every one: it was never
copied into durable storage, never uploaded (the row inserted with a dead
device-local `file://` path while the submit reported success), and never marked
as referenced by the orphan sweep.

**If Flutter drops it.** A checklist filled in offline - the exact case a field
app exists for - reports success while its evidence is unreachable for everyone.
None of it is visible to a type checker: every shape compiles and the array path
works perfectly.

### 5.10 Draft photos need their own folder

**Rule.** `sweepOrphanQueuedPhotos` deletes every file in `queued-photos/` that no
live QUEUE entry references, and it runs after EVERY sync. A draft is not a queue
entry.

**Proof.** `lib/checklistDraft.ts` header and `lib/durablePhotos.ts`. The obvious
fix, reusing `persistPhotoForQueue`, is explicitly WRONG here and is recorded as
a trap a previous attempt fell into and had to revert.

**If Flutter drops it.** The next sync deletes the operator's draft photos,
turning a likely loss into a certain one.

### 5.11 A draft must never be a server row

**Rule.** A part-filled checklist lives ON THE DEVICE and never touches the
server. Nothing inserts, updates or reserves anything.

**Proof.** `lib/checklistDraft.ts` header, and `__tests__/checklistDraft.test.ts`.
`stamp_checklist_document_no` runs BEFORE INSERT, so the document number is minted
from a per (org, prefix, asset, year) counter the moment a row is inserted. A
server-side draft row would burn a number on every abandoned sheet and leave
permanent holes in a numbered register.

**If Flutter drops it.** The document register gains permanent gaps, which is
worse than having no resume feature at all. Drafts are keyed per user, template
and asset, are pruned by COUNT never by AGE, and every restored `file://` is
checked against the filesystem so a restore never lies about a photo.

### 5.12 Completeness cannot be measured from `condition`, and the mobile gate is stricter than the engine default

**Rule.** A wheel counts as filled when the inspector left EVIDENCE on it: a
pressure, a tread depth, a serial, a note, a photo, `checked === true`, or a
condition other than the seeded `Good`. The engine's defaults are
`{ missing: true, blank: false, incomplete: false }` - only `missing` blocks.

**But the mobile inspection screen overrides that.**
`app/(app)/inspection/new.tsx:222` passes `{ requireEvidence: true }`, so on the
phone a `blank` wheel DOES block submit. This is the single most consequential
deviation from the shared engine and it is easy to miss.

**What makes that override fair** is a marker that did not previously exist.
`handleTyreUpdate` (`new.tsx:439-445`) is the ONLY write path for a tyre edit, so
it stamps `checked: true` on every deliberate interaction "including tapping the
Good chip, which is otherwise indistinguishable from the seed and left an
inspector with no way to record 'I checked it and it is fine'". Only an explicit
`true` counts; the seed writes false. Without it the gate demands a reading from
somebody who has genuinely checked the tyre and has no gauge.

**Proof.** `lib/tyreCompleteness.ts` header and `__tests__/tyreCompleteness.test.ts`.
RECORDED measurements that decided each rule: `condition` is present on 100% of
entries and is useless, because BOTH capture forms pre-seed every position with
`Good` and a seeded Good is byte identical to a deliberate one. `tread_depth_mm`
is recorded on ZERO of 4,778 entries and `serial_number` on 7, so requiring
either makes every inspection unsubmittable. Running the `blank` rule over live
data refuses 97 of 401 inspections.

**If Flutter drops it.** Either every untouched wheel passes, or - if
`requireEvidence` is ported without the `checked` stamp - one inspection in four
becomes unsubmittable. Port both or neither.

**Gate ORDER is deliberate too.** Completeness is checked BEFORE the signature
check (`new.tsx:503-505`) "so the inspector is sent back to the tyres rather than
being asked to sign for wheels nobody looked at".

**Four honesty rules ride with it:** tyreless equipment reports "not applicable"
and never "0 of 0"; an unrecognised vehicle type blocks NOTHING, because
`resolveVehicleType` falls back to a 4-wheel Pickup and blocking against a
guessed wheel count is worse than the bug; a recorded position with no layout
slot is `extra` and can never block or be missing; and if no readings line up
with this machine's wheels at all it says so (`matched: false`) rather than
declaring every wheel missing on the strength of a vocabulary it failed to read.

**Mirror.** `src/lib/tyreCompleteness.js` compares the behavioural constants
across both files as TEXT, so a one-sided edit fails the suite.

### 5.12b A fault blocks CLOSING, never SUBMITTING

**Rule.** On the checklist fill screen a blocking fault mark raises a confirm
dialog ("Submit anyway"), it does not refuse the submit. It refuses the
APPROVAL, and the database enforces that.

**Proof.** `app/(app)/checklists/[templateId].tsx:1497-1508` and
`lib/checklistApproval.ts`. The reason is stated: a fault found on the last item
of the day must still be recordable. The server-side guard is
`guard_checklist_approval_stages`.

**If Flutter drops it.** Either a fitter cannot record the fault they found, or a
sheet closes with an open fault. On the approval screen the same rule has a
mirror: a blocking mark disables Approve but deliberately leaves Return enabled,
"because returning it to the field is how the fault gets fixed".

### 5.12c Autosave must be debounced away from the Keystore

**Rule.** Draft autosave is debounced 1200ms, flushed on AppState background or
inactive, and flushed on unmount.

**Proof.** `app/(app)/checklists/[templateId].tsx:1229-1234`: every write goes to
the Android Keystore over binder IPC, "and hammering it on each keystroke is what
caused the permanent-spinner ANR this app has already been reported for". Draft
writes are additionally serialised through a promise chain, because an autosave
racing a background flush let the slower write revert the faster one.

**If Flutter drops it.** The startup-path ANR returns, and drafts silently lose
their most recent edits to a write race.

### 5.13 A signature is per field on the FILL screen, and per rung on the APPROVAL screen

**Rule.** These are two different models and mixing them is the bug.

On the **fill** screen a checklist carries several signature fields, one per
trade, stored as `Signatures = Record<string, string>` keyed by `field.id`.
`isFieldAnswered` reads `signatures?.[field.id]`, and only signature fields the
template still has are rebuilt on submit. `signature_data` is kept as the single
PRIMARY sign-off so every existing reader, export and PDF is unchanged, and
`require_signature` is satisfied by the template-level pad OR any signature field
- "a sheet already carrying three trade signatures must not demand a fourth".

On the **approval** screen there is deliberately ONE slot
(`approvals/[submissionId].tsx:87`). Which column it lands in is decided by the
RUNG, not a field key: `supervisor_signature` when the next status is
`pending_area_manager`, otherwise `approver_signature`. Writing both "would make
one person look like two".

**Proof.** `lib/checklistFields.ts:124-136` and its header,
`components/SignatureField.tsx`, `__tests__/signatureFieldKeys.test.ts`, and the
`signatures` column in the `CHECKLIST_SUBMISSION` allow-list. RECORDED: every
signature field once shared ONE global slot, so signing the second overwrote the
first, only the last reached the database, and `isFieldAnswered` returned true
for EVERY signature field the moment any one was signed - progress read "3 of 3"
with one signature captured.

**If Flutter drops it.** Two of three trades' sign-offs vanish while the screen
reports completion; or a supervisor sign-off and a final approval are recorded as
the same event, which is exactly what V594 exists to prevent.

`startRedraw` emits `null` FIRST, because "leaving it attached while the pad
reads empty is how a stale signature reaches a decision nobody meant to sign
with it". And `locked` is set only when the status becomes `approved`: a
supervisor sign-off must leave the sheet editable, because the area manager may
send it back.

Two rules ride with it. **Pre-filling is not signing:** the saved mark is loaded
into the pad and SHOWN, and nothing is recorded until the approve button is
pressed, because a signature that appeared without being visible is
indistinguishable from the app signing on someone's behalf. And **the remember
switch starts ON for a person who has never saved a mark and OFF for someone who
has**, so a one-off signature cannot silently overwrite the mark they chose.

### 5.14 A missing locale key renders the raw key path

**Rule.** Mobile falls back to English only when the key exists in `en.json`.
Absent there too, the app renders the literal key path on screen.

**Proof.** `__tests__/signatureFieldKeys.test.ts` header. The test also asserts
the component asks for exactly the keys the locales carry and no others, so a key
added to a component but not to `ar.json` and `ur.json` fails at the source.

**If Flutter drops it.** A supervisor reading Arabic is asked to approve under
the words `signatureField.usingSaved`.

### 5.15 The phone must be able to tell the supervisory roles apart

**Rule.** `normaliseRole` silently turns any role it does not know into
`reporter`. Every supervisory role must be listed.

**Proof.** `__tests__/whoSigns.test.ts`. PMV Manager and Workshop Maintenance
Area Manager are two real people who were seen by the phone as reporters.
Tightening WHO SIGNS would have been meaningless while the phone could not tell
any of them apart from a reporter.

**If Flutter drops it.** A rule naming the signers reaches nobody. The test also
pins the tightening itself: a Manager may NOT reach an approvals queue, and a
Director still can, and only because exactly one person holds an area-manager
role and a closing rung nobody else can reach jams the moment they take leave.

### 5.15b Three checklist-approval gates disagree with each other, today

**This is a live defect found while writing this artifact, not a historical note.**
It is reported here and NOT patched: the Expo app is production and this document
is an audit.

Three independent gates decide who may sign a checklist, and they do not agree.
All three are VERIFIED from source:

| Gate | Where | Who passes |
|---|---|---|
| `approvals` module | `lib/permissions.ts` MODULES | director, maintenance_supervisor, workshop_supervisor, pmv_manager, workshop_area_manager, workshop_maintenance_area_manager, tyre_data_collector (+ admin implicitly). **No manager** |
| `canApproveChecklists(role)` | `lib/permissions.ts:363` = `isAdminOrAbove` = `lib/types.ts:76-78` | **admin, manager, director ONLY** |
| `APPROVAL_STAGES` rungs | `lib/checklistApproval.ts:43-61` | supervisor rung: Admin + the five supervisory roles + Tyre Data Collector, **no Manager, no Director**. Area-manager rung: Admin, Director, PMV Manager, Workshop Area Manager, Workshop Maintenance Area Manager |

The consequence, traced through the code:

- A **Maintenance Supervisor** (or Workshop Supervisor, PMV Manager, Workshop
  Area Manager, Workshop Maintenance Area Manager, Tyre Data Collector) passes
  `withModuleGuard(..., 'approvals')`, then hits
  `const allowed = canApproveChecklists(profile?.role)` at
  `checklists/approvals/index.tsx:142` and `[submissionId].tsx:100`, which is
  false for them, and is shown a locked "not available" state
  (`approvals/index.tsx:247-258`). **The exact people V600 named as the signers
  are refused at the screen.** The same helper also hides the approvals button on
  the checklists hub (`checklists/index.tsx:257`) and the Team scope toggle in
  history.
- A **Manager** is the mirror image: `canApproveChecklists` admits them, the
  module guard refuses them, and neither rung lists them.

**Why the test suite does not catch it.** `__tests__/whoSigns.test.ts` asserts
`moduleAllowedByRole('approvals', role)` for every supervisory role - the MODULE,
which is correct. Nothing asserts `canApproveChecklists`, so the second gate
drifted away from the first without failing anything.

**For Flutter.** Do not port three gates. Resolve approval authority once, from
the rung the submission is actually on, and let the module guard decide only
whether the queue is reachable. Spec section 31 says approval authority must come
from actual backend role state; `canActOnStage` already compares
case-insensitively because `profiles.role` is Title Case while `UserRole` is
snake_case, and a raw compare between the two matches nothing.

### 5.16 Ask the server for permission, never infer it from the role string

**Rule.** Scrap and unscrap are two SEPARATE server-answered rights, and both
fail closed.

**Proof.** `lib/tyreScrap.ts`. The button was once gated on `isAdmin(role)`, which
is wrong in both directions: `normaliseRole` collapsed a Tyre Data Collector to
`reporter` on the phone while the server saw the real role and would have allowed
the write, and a per-user capability grant was invisible to the client entirely.

**If Flutter drops it.** Real users are refused an action the server permits, and
per-user grants stop working.

### 5.17 A queued mutation must be an end state, never an increment

**Rule.** Absolute values only. Any command that cannot be phrased that way is
online-only.

**Proof.** `lib/stock.ts` and artifact 06 section 3. Both the absolute count and
the delta adjust collapse to the same queued write, with the delta resolved
against the device's last known quantity BEFORE enqueueing.

**If Flutter drops it.** Replaying "subtract 3" twice subtracts six. Two honest
limits ride with it: the offline path is a last-write-wins overwrite computed
from possibly-stale device state, and it writes NO `stock_movements` ledger row.
Only the online path is race-safe and audited.

### 5.18 Bound photo upload parallelism

**Rule.** `UPLOAD_CONCURRENCY = 2`, implemented as a serial loop over slices.

**Proof.** `lib/photoUpload.ts`. A `Promise.all` over every position decoded one
full-size bitmap per tyre simultaneously - 13 on a Tr-Mixer, roughly 600 MB peak
- which is a hard native out-of-memory crash on a 2 GB handset. The inspector
lost the work with no error, and the offline queue then REPLAYED it into the same
crash.

**If Flutter drops it.** The same crash loop. The resize ladder matters too:
1600px at q0.5, then 1024 at q0.45, then 720 at q0.4, because a single failed
resize used to fall back to the original multi-megapixel file, which then
exceeded the decode guard and was silently DROPPED - real evidence lost on a
13-photo inspection.

### 5.19 `.limit(N)` above 1000 is not a bound

**Rule.** PostgREST caps every response at 1000 rows whatever a limit says. Only
`.range()` paging gets past it, and a paged read MUST order on a unique column.

**Proof.** `lib/fetchAllRows.ts`, `__tests__/fetchAll.test.ts`,
`__tests__/stockSitePicker.test.ts`, and inline comments on the vehicles,
accident, admin/sites and records screens. `asset_no` is unique per COUNTRY, not
globally, so an `id` tiebreak is required or rows drop or repeat at a page
boundary. Artifact 02 section 4 carries the same rule for RPCs.

**If Flutter drops it.** Not a short list but a WRONG ANSWER that looks right. A
site-filter list that changed between loads; a fleet count that under-counted
every site rollup and dropped every site late in the alphabet; and, on the AI
screen, an assistant confidently stating a truncated number as fact.

### 5.20 A number the app cannot honestly compute renders N/A

**Rule.** Never 0, and never a blended total.

**Proof.** `__tests__/mobileAnalytics.test.ts` and `lib/mobileAnalytics.ts`. SAR,
AED and EGP are not addable, so on the All-countries view every cost arrives null
and the caller must rank by volume. Unrated tyres are stated explicitly rather
than folded into Low, "which would read as 'these tyres were checked and are
fine'". `lib/reportSnapshot.ts` never throws and returns `{ok: false, reason}`.

**If Flutter drops it.** This is spec section 32 and rule 4 of section 71 stated
as a testable invariant. A blended total is not a quantity of anything.

### 5.21 Auto-fill must never overwrite what a person typed

**Rule.** A `siteTouched` ref guards every auto-fill, and the debounce is 350ms
on lookups and 550ms on the accident form.

**Proof.** `meter-logs.tsx`, `repair-request.tsx`, `accident/report.tsx`. The
accident form is the deliberate exception and says so: the picked vehicle's OWN
site is authoritative and REPLACES a stale chip, because a leftover site on an
incident report is worse than a re-typed one.

**If Flutter drops it.** A late lookup response silently overwrites a value the
user chose.

### 5.22 A blank number field is not zero

**Rule.** `Number('')` is 0 and 0 IS finite. Blank, zero and invalid must stay
three separate states.

**Proof.** `lib/repairRequest.ts` `parseMeterInput`: "a blank box collapsed into a
real reading of zero is exactly how a fleet ends up with an asset that has
'driven 0 km'. Never fold these together."

**If Flutter drops it.** Fabricated meter readings enter the fleet history.

### 5.23 A pure validator returns codes, not prose

**Rule.** Validation returns error CODES that the UI translates.

**Proof.** `lib/repairRequest.ts`: "A pure module that returned prose would put an
untranslatable English string in front of an Arabic reader."

**If Flutter drops it.** RTL and localisation break at exactly the moment a user
is being refused.

### 5.24 The stored checklist answer is always English

**Rule.** Every resolver returns `{value, label}` pairs - English value to store,
translated label to show - so a caller cannot accidentally store the translation.

**Proof.** `lib/checklistI18n.ts`. A field may point at a SHARED option set on the
template, and the field's own `options` are a fallback the builder expects to
drift. Mobile once ignored `options_ref`, so once an admin edited the shared
legend, web users answered with the new vocabulary and phone users answered - and
were validated - against the old one.

**If Flutter drops it.** An answer whose meaning changes with the reader's
language cannot be compared across submissions, scored, exported or reported on.

### 5.25 One table-name registry, one field allow-list

**Rule.** `COMMANDS` is "the ONLY place a table name may appear on the client",
and `sanitize()` drops every key a command does not name.

**Proof.** `lib/recordQueue.ts` lines 99-102, and three separate comment blocks
recording that adding a column to the database alone changed nothing because the
payload was silently trimmed on the way out - the V212 `signatures` and `notes`
columns, and V594's supervisor rung.

**If Flutter drops it.** A column PostgREST cannot find fails the WHOLE request,
so one stray key kills a field worker's entire sync. And a field added to the
model but not the allow-list is dropped in silence.

### 5.26 Checklist CONTENT carries four languages; the UI shell ships three

**Rule.** `CHECKLIST_LANGS` is en, ar (rtl), hi, ur (rtl). The fill screen offers
only the languages the template actually carries, and that choice is INDEPENDENT
of the app UI language, persisted into the draft and restored on resume.

**Proof.** `lib/checklistI18n.ts:35-40`, `checklists/[templateId].tsx:654-672`.
The app itself ships `locales/en.json`, `ar.json`, `ur.json` - **no Hindi UI
locale**, so a Hindi template renders Hindi content inside English or Arabic
chrome. That is a deliberate content-vs-UI split, not an oversight.

**If Flutter drops it.** The translation feature stops at the office door, which
is the exact defect it was built to fix: the Arabic-, Hindi- and Urdu-reading
fitters read the sheet in English on the one device they actually fill it on.
Note that the checklist HUB card deliberately follows the app UI language
instead, because a sheet can carry languages the shell does not ship.

### 5.27 The list must not jump under the reviewer's thumb

**Rule.** `reconcileById` returns the VERY SAME array when nothing changed, and
is paired with `maintainVisibleContentPosition`.

**Proof.** `checklists/approvals/index.tsx:11-20`. Every refresh previously
replaced items with a brand-new array of brand-new objects, so the list
re-rendered from scratch and the reviewer was thrown back to the top after every
single decision.

**If Flutter drops it.** A reviewer clearing a queue loses their place on every
approval. The same file also records the opposite navigation choice from the
inspection screen and the reason for each: a checklist decision goes straight
back to the queue, while an inspection decision STAYS on the record, because
"I sign, I close, and I am on Home" was a reported bug.

### 5.28 A photo that cannot upload is dropped; the record still saves

**Rule.** `uploadPendingPhotos` returns `pending: true` so the caller keeps the
record queued rather than marking it synced. On the workshop event path a
failed photo is dropped and the event still records.

**Proof.** `lib/photoUpload.ts`, `lib/workshopApi.ts`.

**If Flutter drops it.** Either the operational record is lost with the photo, or
a dead local path is written to the database and the submit reports success.

---

## 6. Open questions for the product owner

**1. Three surfaces read `corrective_actions` with three vocabularies and three
write paths.** `workorders/index.tsx` uses `Open / In Progress / Resolved /
Closed` and a queued update writing `status` and `closed_at`. `tasks.tsx` uses a
DIRECT update writing `status`, `resolved_at` and `closed_by`. `report-issue.tsx`
queues the insert. The two resolve paths write DIFFERENT columns, so a task
resolved offline and one resolved online do not produce the same row. Which is
correct?

**2. `work-orders.tsx` is orphaned.** It is the only human surface that reads or
writes the real `work_orders` table, and nothing links to it: the Home hub, the
fleet-health tile and the tab bar all point at `/(app)/workorders`, which is the
corrective-actions register. It is reachable only by typing the deep link. Is the
work-orders screen meant to be live, or is it superseded?

**3. `workorders/index.tsx` is labelled "Work Orders" and is not one.** Same
question, different symptom: the tab, the Home tile and the screen's own header
all say Work Orders while the table is `corrective_actions`. Home's "open work
orders" figure has the same mislabel. Should the label change, or the table?

**4. `lib/routeAccess.ts` is imported by nothing.** Verified by grep across
`app`, `lib`, `components`, `hooks` and `__tests__`: zero consumers. Screens pass
their ModuleKey literally to `withModuleGuard`. So the registry that exists to
stop navigation permissions and route guards drifting apart is not consulted, and
they have already drifted - the registry maps `admin/ai-chat` to `ai` while the
screen guards on `admin`. Should the registry become the source of truth in
Flutter, or be deleted?

**5. `CHECKLIST_APPROVAL` is queued but should not be.** Artifact 06 section 4
sets this out in full and it is the single most important finding there. Verified
here: `decideApproval` in `lib/checklists.ts` line 475 calls
`saveCommand('CHECKLIST_APPROVAL', ...)`, a blind `update` matched by `id` that
bypasses the RPC which exists to enforce the rungs and the signature. Does
Flutter route approvals through the RPC and refuse to queue them?

**5b. The supervisory roles cannot open the checklist approval queue today.**
Section 5.15b traces it in full. `canApproveChecklists` is `admin | manager |
director`, so every role V600 named as a signer - Maintenance Supervisor,
Workshop Supervisor, PMV Manager, Workshop Area Manager, Workshop Maintenance
Area Manager, Tyre Data Collector - passes the `approvals` module guard and is
then shown a locked "not available" state. A Manager is admitted by that helper
and refused by the module guard. This is a LIVE contradiction between three
gates, not a historical note, and no test covers the helper. Which gate is
authoritative? This one needs an answer before the Flutter approvals package is
designed, and it may warrant a fix to the Expo app first.

**6. `repair-request` is untracked in-flight work against a table that does not
exist.** `MIGRATIONS_V608_REPAIR_REQUEST_RFR.sql` says "AUTHORED - NOT YET
APPLIED". Is the RFR flow in scope for the Flutter build, and will V608 be
applied first?

**7. Seven production features have no Flutter package in spec section 3.**
Alerts, Calendar, Analytics, Overview, Report an issue, Repair request, and
Serial search. Each is a real, reachable screen today. Should they map onto
existing packages, or does the folder list need extending?

**8. Two Kotlin capabilities have no production counterpart.** Global search
(spec 34) is specified but is NOT built on the phone today - only per-screen
search boxes exist. `engine_hours_logs` is written by mobile but never read, so
there is no meter HISTORY for hours the way there is for odometer. Are these
gaps to close or features to drop?

**9. The `permissions.ts` prose contradicts its own data, and the data is
right.** Lines 60-70 record an owner instruction from 2026-07-18 giving
`tyre_man` `history` and `reports` and `inspector` `reports`. Both modules are
`roles: []`. The contradiction is resolved by the comment immediately after -
"MOBILE IS A FIELD-CAPTURE APP, NOT A REPORTING CLIENT" - which superseded it,
but the stale paragraph was left in place and an implementer reading top-to-bottom
would build the wrong thing. Confirm the field-capture lockdown stands.

**10. UNVERIFIED and needing a live check.** The Supabase connector was not
authenticated when this was written. Before Flutter code depends on any of it:

- Does `repair_requests` exist? `select to_regclass('public.repair_requests');`
- Is `engine_hours_logs` populated by mobile, and how much?
  `select count(*), max(reading_date) from engine_hours_logs where source is not null;`
- Which of the 33 tables actually carry a `client_uuid` column plus a unique
  index, which is what makes queue idempotency real?
  `select t.table_name from information_schema.columns t where t.column_name = 'client_uuid' and t.table_schema = 'public';`
  then `select indexname, indexdef from pg_indexes where schemaname='public' and indexdef ilike '%client_uuid%';`
- Do the 33 tables and the `MODULES` registry agree with `module_permissions`?
  `select distinct module_key from module_permissions where module_key like 'mobile:%' order by 1;`
- Which roles exist in reality, so `normaliseRole` cannot silently collapse one?
  `select role, count(*) from profiles group by 1 order by 2 desc;`
