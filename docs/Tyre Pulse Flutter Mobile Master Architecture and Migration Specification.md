# Tyre Pulse Flutter Mobile Master Architecture and Migration Specification

## 1. Objective

Rebuild the existing Tyre Pulse mobile application as one production-grade Flutter application for:

- Android
- iOS

Do not redesign the business system from imagination.

The existing React Native Tyre Pulse application and the existing Kotlin Android project must be audited and used as source material.

Priority of truth:

1. Existing backend and real Supabase database schema
2. Working React Native production behavior
3. Verified business logic and tests from the React Native application
4. Corrected architecture and useful implementations from Kotlin
5. New Flutter implementation

Never copy fabricated, placeholder, mock or guessed functionality from either legacy project.

---

# 2. Final Technology Decision

Mobile application:

- Flutter
- Dart
- Android
- iOS

Web application remains:

- React
- Next.js
- TypeScript

Backend remains:

- Supabase
- PostgreSQL
- Supabase Auth
- PostgREST
- Supabase Storage
- Supabase Realtime
- RPC functions where already required
- Supabase Edge Functions where already required

Do not rebuild the web application in Flutter.

Do not introduce an imaginary REST backend.

The Kotlin audit identified this as a major failure. Several native endpoints such as:

- `/approvals`
- `/tasks`
- `/replacements`
- `/workshop/jobs`
- `/notifications/{id}/read`

were written as though a custom REST API existed.

It does not.

Flutter must connect to the actual Supabase schema and existing valid server functions.

Use the official Supabase Flutter client for Auth, database, Storage, Realtime and Edge Functions.

---

# 3. Core Flutter Architecture

Use feature-first architecture with strict separation between:

```text
Presentation
      ↓
Application / Domain
      ↓
Repository
      ↓
Local + Remote Data Sources
```

The application must not become:

```text
screens/
services/
helpers/
utils/
everything_else/
```

Use:

```text
lib/
│
├── app/
│   ├── app.dart
│   ├── bootstrap.dart
│   ├── router/
│   ├── theme/
│   ├── localization/
│   └── configuration/
│
├── core/
│   ├── auth/
│   ├── database/
│   ├── network/
│   ├── sync/
│   ├── storage/
│   ├── permissions/
│   ├── telemetry/
│   ├── errors/
│   ├── security/
│   ├── connectivity/
│   ├── files/
│   └── design_system/
│
├── features/
│   ├── home/
│   ├── authentication/
│   ├── profile/
│   ├── assets/
│   ├── tyres/
│   ├── inspections/
│   ├── tyre_replacement/
│   ├── checklists/
│   ├── approvals/
│   ├── workshop/
│   ├── work_orders/
│   ├── maintenance/
│   ├── meter_logs/
│   ├── washing/
│   ├── stock/
│   ├── accidents/
│   ├── rca/
│   ├── records/
│   ├── notifications/
│   ├── reports/
│   ├── scanning/
│   ├── search/
│   ├── team/
│   ├── tasks/
│   ├── admin/
│   └── ai/
│
└── shared/
    ├── models/
    ├── widgets/
    ├── extensions/
    └── utilities/
```

Inside each important feature:

```text
inspections/
│
├── data/
│   ├── local/
│   ├── remote/
│   ├── dto/
│   └── inspection_repository.dart
│
├── domain/
│   ├── models/
│   ├── rules/
│   └── use_cases/
│
└── presentation/
    ├── screens/
    ├── widgets/
    ├── controllers/
    └── state/
```

No database query directly inside a screen.

No Supabase call directly inside a widget.

No permission logic duplicated in buttons.

No tyre business rule buried inside UI code.

---

# 4. State Management

Use Riverpod.

Flutter's architecture guidance allows state libraries such as Riverpod while preserving the recommended separation between views, state logic and repositories.

Use Riverpod for:

- dependency injection
- asynchronous state
- feature controllers
- repository exposure
- session state
- workspace state
- permissions
- connectivity
- sync state
- feature state

Do not create one giant global provider containing the entire application.

Example:

```text
inspectionRepositoryProvider
inspectionControllerProvider
inspectionDraftProvider
inspectionSyncStatusProvider
vehicleTyresProvider
```

Widgets observe state.

Widgets do not own business rules.

---

# 5. Navigation

Use GoRouter.

Requirements:

- nested navigation
- deep links
- role-aware destinations
- bottom navigation
- real back history
- state restoration
- notification routing
- protected routes

The existing React Native application contains an important navigation lesson.

Its tab router originally returned users directly to Home when they pressed Back. This was fixed using real history behavior.

Flutter must preserve this rule:

> Back means return to where the user actually came from.

Examples:

```text
Global Search
    ↓
Vehicle
    ↓
Inspection

Back:
Inspection → Vehicle → Search
```

Another:

```text
Notification
    ↓
Work Order

Back:
Work Order → Workshop → Home
```

Never globally implement:

```text
Back → Home
```

GoRouter supports nested navigation, redirects, shell routes and state restoration. Use `StatefulShellRoute` or equivalent stable architecture for the main mobile navigation.

---

# 6. Authentication

Port the real authentication lifecycle from React Native.

Existing behavior to preserve:

- login by allowed Tyre Pulse credentials
- session restore
- profile loading
- transient network failure handling
- foreground revalidation
- sign out
- locked account handling
- unapproved account handling
- minimum supported app version gate
- admin-approved mobile access

Important lesson from Kotlin:

Do not assume profile field types.

The Kotlin project incorrectly treated:

```text
profiles.country
```

as a String although the database stores it as an array.

This broke login for most users.

Flutter DTOs must be generated or explicitly verified against the real Supabase schema.

Never guess column types.

---

# 7. Secure Storage

Sensitive values must not be stored in normal preferences.

Use secure storage for:

- sensitive local secrets where needed
- device-level protected information
- session-related protected values if not handled by Supabase's storage implementation

The Flutter secure-storage ecosystem uses platform-specific protected storage, including Apple Keychain and encrypted Android storage.

Non-sensitive preferences can use normal local preferences.

---

# 8. Multi-Tenancy and Workspace Scope

Tyre Pulse must continue supporting:

```text
Tenant
Company
Country
Site
User
Role
Permission
```

Every repository must understand the active workspace.

Never hard-code:

```text
Saudi Arabia
SAR
one company
one site
```

The Kotlin project previously hard-coded Saudi Arabia and SAR for every user. That must never exist in Flutter.

Workspace context should provide:

```text
tenantId
companyId
country
currency
siteIds
userId
role
effectivePermissions
```

Changing workspace must:

1. update the active context
2. invalidate scoped providers
3. refresh affected local cache
4. preserve safe offline transactions
5. reload permitted navigation modules

---

# 9. Permissions

Port the effective permission logic from the React application.

The existing mobile app already contains:

- module permissions
- admin guard
- role guard
- mobile grants
- grant/revoke overlay
- admin access management

Flutter must calculate:

```text
effective access =
role default
+
user grants
-
user revocations
```

UI visibility is not security.

Supabase RLS remains the real backend security boundary.

The Flutter app must still prevent confusing or inaccessible screens from appearing to unauthorized users.

---

# 10. App Navigation by Role

The mobile shell must adapt to actual permissions.

Possible primary navigation:

### Field / Tyre Technician

```text
Home
Inspect
Work
Scan
Profile
```

### Supervisor

```text
Home
Approvals
Fleet
Work
Profile
```

### Workshop User

```text
Home
Jobs
Fleet
Scan
Profile
```

### Administrator

```text
Home
Operations
Approvals
Reports
Profile
```

Do not create completely separate applications by role.

Use one app with permission-driven experiences.

---

# 11. Offline-First Architecture

This is a mandatory Tyre Pulse requirement.

The application must remain useful at sites with poor or no connectivity.

Use a relational local database.

Recommended:

- Drift
- SQLite

Drift currently provides typed SQLite persistence, transactions, schema migrations and reactive queries, which fits the offline requirements of Tyre Pulse.

Use local tables such as:

```text
cached_users
cached_sites
cached_assets
cached_tyres
cached_checklist_templates
inspection_drafts
checklist_drafts
pending_commands
pending_uploads
sync_failures
sync_metadata
recent_searches
```

---

# 12. Command Queue

Preserve and improve the React application's offline queue model.

Every offline write must become a typed operation.

Example:

```text
PendingCommand

id
commandType
entityType
entityId
payload
createdAt
createdBy
workspaceId
retryCount
nextRetryAt
status
lastError
idempotencyKey
```

Statuses:

```text
pending
processing
retry
blocked
failed
synced
```

Do not simply save raw JSON without type information.

---

# 13. Idempotency

All queue-safe operations must have a stable client-generated ID.

Example:

```text
inspection:
client_id = UUID

photo:
client_id = UUID

meter log:
client_id = UUID
```

If the app sends the same queued command twice because the network response was interrupted:

```text
Server must not create two records.
```

This is essential.

---

# 14. Do Not Offline-Queue Unsafe Decisions

The Kotlin audit correctly identified that not every action is safe to replay later.

For example:

- approval decisions
- some assignments
- administrative access changes

may depend on current server state.

These should normally require connectivity or use server-side conflict checking.

Do not blindly queue an approval such as:

```text
APPROVE SUBMISSION
```

and replay it five hours later after somebody else already rejected or changed it.

Use optimistic concurrency or online-only behavior for such operations.

---

# 15. Sync Engine

Create one central Sync Engine.

Trigger sync on:

- app startup
- successful login
- network reconnection
- app foreground
- user manual sync
- appropriate background opportunity

Flow:

```text
Network detected
      ↓
Acquire sync lock
      ↓
Read pending operations
      ↓
Validate workspace/session
      ↓
Process by dependency/order
      ↓
Upload records
      ↓
Upload media
      ↓
Confirm remote result
      ↓
Mark local operation synced
      ↓
Refresh affected cache
```

Never allow two sync engines to process the same queue simultaneously.

---

# 16. Background Work

Use Workmanager for opportunistic background processing on Android and iOS.

Important:

Background execution must be considered helpful but not guaranteed, especially on iOS.

Therefore the system must also sync when:

- the app opens
- connectivity returns
- the app resumes
- the user taps Sync

Never make data safety depend entirely on an OS background job.

---

# 17. Offline Status UI

Always show meaningful status.

Examples:

```text
Offline
12 changes waiting to sync
```

or:

```text
Syncing
8 of 12
```

or:

```text
3 items need attention
```

Do not show a permanent spinner.

The existing React tests already contain the principle:

```text
deniedIsNotASpinner
```

Keep that philosophy throughout Flutter.

A denied, unavailable or empty state must explain itself.

---

# 18. Draft Preservation

Port checklist and inspection draft behavior.

Drafts must:

- autosave
- survive app termination
- survive network loss
- restore answers
- restore tyre selections
- restore photos
- restore signatures
- show last saved time
- support discard
- support resume

Checklist drafts currently use user, template and asset identity.

Flutter should preserve equivalent uniqueness.

Never silently overwrite a different user's draft on a shared device.

---

# 19. Photos

Build a durable photo pipeline.

Flow:

```text
Take Photo
    ↓
Save original locally
    ↓
Create media record
    ↓
Compress appropriately
    ↓
Attach to business transaction
    ↓
Queue upload
    ↓
Continue workflow immediately
```

The field worker must not wait for every photo upload before moving to the next tyre.

Upload state:

```text
local
queued
uploading
uploaded
verified
failed
```

Never delete the local source file until the server upload is confirmed.

---

# 20. Photo Recovery

The React application already contains durable-photo logic.

Port the behavior, not necessarily the implementation.

If the app closes halfway through an inspection:

```text
answers remain
photos remain
signature remains
selected vehicle remains
selected tyre remains
```

The user must be able to resume.

---

# 21. Signatures

Port the real signature behavior.

The Kotlin audit discovered that one implementation stored a placeholder string instead of an actual signature.

Flutter must store an actual signature representation.

Recommended:

- vector points or SVG-like representation for durable reconstruction
- optional PNG rendering for reports
- metadata:
  - signer user ID
  - signer name
  - timestamp
  - role
  - form field key

Checklist forms can have multiple signature fields.

Do not assume one global signature field.

---

# 22. Tyre Diagram Engine

This is one of the most important Tyre Pulse modules.

Port the real React logic from:

```text
tyreLayout.ts
tyreDiagramLayouts.ts
VehicleTyreDiagram.tsx
```

Do not port the primitive Kotlin hard-coded layout.

The existing engine understands position identifiers including:

```text
FL
FR
FL1
FR1
FL2
FR2

RL
RR

RL1
RL2
RL3
RL4

RR1
RR2
RR3
RR4

SL
SR

AxleL1
AxleR1
AxleL2
AxleR2

Spare
```

These identifiers must remain canonical storage keys.

Do not rename tyre positions only for visual convenience.

---

# 23. Vehicle Diagram Architecture

Separate:

```text
Vehicle geometry
```

from:

```text
Tyre data
```

Model:

```text
VehicleLayoutDefinition
 ├── vehicleType
 ├── bodyClass
 ├── axles
 ├── slots
 └── spareSlots
```

Each:

```text
TyreSlot
 ├── positionId
 ├── axle
 ├── side
 ├── wheelType
 ├── x
 ├── y
 ├── width
 └── height
```

Then overlay:

```text
TyreInstallation
TyreCondition
InspectionResult
```

Do not hard-code tyre serials into diagram widgets.

---

# 24. Flutter Diagram Rendering

Use:

- CustomPainter where appropriate
- SVG assets where appropriate
- Flutter widgets for interactive tyre nodes

Do not use one giant static image with invisible buttons.

Each tyre position must have:

- proper touch target
- visible state
- accessibility label
- selected state
- condition state
- installed/uninstalled state
- inspection-complete state

Tap opens tyre details or the inspection entry panel.

---

# 25. Vehicle Types

The diagram engine must support the fleet configuration rather than one truck.

Include the existing fleet classes and future expansion such as:

- transit mixer
- concrete pump
- truck
- tractor head
- trailer
- loader
- backhoe
- pickup
- mobile equipment
- other configured asset classes

Layout should ultimately come from vehicle/asset configuration rather than scattered `if vehicleType == ...` conditions.

---

# 26. Inspection Workflow

Target flow:

```text
New Inspection
      ↓
Site
      ↓
Asset
      ↓
Vehicle context
      ↓
Meter reading if required
      ↓
Tyre diagram
      ↓
Select tyre
      ↓
Pressure
      ↓
Tread depth
      ↓
Condition
      ↓
Damage reason
      ↓
Photos
      ↓
Repeat tyres
      ↓
Review
      ↓
Signature if required
      ↓
Submit locally
      ↓
Sync
```

Inspection must never lose progress because another screen was opened.

---

# 27. Inspection Completeness

Port the existing completeness logic.

Before final submission, validate things such as:

- required tyre positions inspected
- required values entered
- mandatory evidence attached
- required signatures present
- asset selected
- site selected
- required meter value entered
- conditions have valid values

Show exactly what is missing.

Do not just say:

```text
Form invalid
```

---

# 28. Dynamic Checklists

The React application contains significant checklist logic. Preserve it.

Required field types include the existing system's supported types and references.

Important capabilities:

- text
- number
- date/time
- yes/no
- choice
- multi-select
- photo
- signature
- asset reference
- site reference
- user reference
- auto-value
- layout/display fields
- conditional fields

---

# 29. Conditional Checklist Logic

Port `visibleWhen` behavior.

Example:

```text
Is tyre damaged?
Yes
    ↓
Show:
Damage type
Photo
Remarks
```

No:

```text
Hide those fields
```

Conditional evaluation must stay in domain logic.

Do not scatter it across Flutter widgets.

---

# 30. Checklist Auto Values

Preserve values such as:

```text
current_user
today
```

Resolve them through a controlled field engine.

---

# 31. Checklist Approval

Preserve the existing approval ladder.

The React application contains:

```text
Supervisor
      ↓
Area Manager when required
```

Templates may be:

```text
single-stage
two-stage
```

Keep:

- stage determination
- who can act
- next status
- rejection
- fully closed state
- progress visualization

Approval authority must come from actual backend role/permission state.

---

# 32. Home Screen

Do not repeat the Kotlin mistake of showing invented KPIs.

Every card must come from actual data.

If data does not exist:

```text
-
Unavailable
Not configured
```

rather than:

```text
0
```

when zero would falsely imply measured data.

Home should prioritize actions.

Example:

```text
Good evening, Shahzeb

Site / Workspace

Pending Sync
Inspections
Approvals
Open Jobs
Critical Issues

Quick Actions

Inspect Vehicle
Scan
Tyre Change
Checklist
Report Accident
Meter Log
```

No oversized decorative dashboards.

---

# 33. Assets / Fleet

Provide:

- search
- filter
- asset classes
- site filter
- recent assets
- scan-to-open
- current odometer
- vehicle details
- fitted tyres
- inspection history
- work orders
- accidents where permitted

Large data must use pagination/cached queries.

Do not download an entire fleet dataset on every screen open.

---

# 34. Global Search

Search should understand:

- asset number
- registration
- chassis
- fleet number
- tyre serial
- work order
- accident reference
- inspection reference

Save recent searches locally.

Search state must survive back navigation.

---

# 35. Scanner

Support:

- QR
- barcode
- camera scanning

Architecture must leave room for:

- NFC
- RFID
- Bluetooth TPMS

If specialist industrial hardware later requires Android native SDKs:

```text
Flutter
   ↓
Platform Channel
   ↓
Kotlin
   ↓
Vendor SDK
```

For iOS:

```text
Flutter
   ↓
Platform Channel
   ↓
Swift
```

Do not rewrite the whole app for a hardware integration.

---

# 36. Tyre Replacement

Port the real working logic only.

The Kotlin audit identified a fake replacement screen where the completion button wrote nothing.

Flutter must implement a transactional replacement.

Example:

```text
Select Asset
     ↓
Select Position
     ↓
Current tyre
     ↓
Removal reason
     ↓
Condition
     ↓
Removed tyre destination
     ↓
Replacement tyre
     ↓
Installation
     ↓
Meter / KM
     ↓
Photos if required
     ↓
Submit
```

The operation must correctly:

1. close the current fitment
2. update removed tyre status/location
3. create new fitment
4. update replacement tyre status
5. record meter
6. create history/audit records
7. remain idempotent

Prefer a server transaction/RPC where multiple database mutations must succeed together.

---

# 37. Tyre History

History must show the actual life of the tyre:

```text
Received
Installed
Inspected
Rotated
Removed
Repaired
Reinstalled
Transferred
Scrapped
Warranty
```

where data exists.

Do not invent events from missing data.

---

# 38. Meter Logs

Support:

- odometer
- engine hours

Validate which field applies to the asset.

Do not guess both.

The Kotlin audit found meter payload problems caused by fields not matching actual database columns.

Flutter must use verified DTOs.

Offline meter commands should have explicit field allow-lists.

---

# 39. Washing

Preserve the working washing module.

Support:

- due schedule
- log wash
- vehicle
- site
- timestamp
- user
- evidence if configured
- history

Do not accidentally hide the module through duplicate route definitions like the earlier React tab issue.

---

# 40. Workshop

Workshop should contain real work data only.

Support:

```text
Workshop Home
Open Jobs
My Jobs
Work Orders
Job Details
Technician Activity
Create Work Order where permitted
```

Never show invented:

- technician names
- job numbers
- costs
- parts
- productivity metrics

If the backend does not support a metric, show an unavailable state.

---

# 41. Work Order Details

Route IDs must use one canonical name.

The Kotlin project had:

```text
route = jobId
ViewModel expected = workOrderId
```

which caused crashes.

In Flutter define typed route parameters and a canonical domain identifier.

Example:

```text
WorkOrderRoute(workOrderId)
```

not stringly typed values scattered around the application.

---

# 42. Accident Management

Port the current React accident workflow.

Include:

- accident dashboard/list
- report accident
- accident detail
- case workstreams
- insurance process
- photos/evidence
- claims
- approvals
- repair/workshop status
- RCA where applicable
- audit history
- PDF/report export where needed

Preserve workstream status logic.

Do not invent "assigned officer" if no such backend field exists.

---

# 43. Accident Evidence

Photos and supporting records must be linked through stable IDs.

Allow:

- photo
- document metadata
- timestamps
- uploader
- evidence category

Offline accident creation may be supported where safe.

High-risk approval/claim decisions should require current backend state.

---

# 44. RCA

Root Cause Analysis should use real corrective-action data where available.

Do not generate fake safety conclusions.

---

# 45. Stock

Stock must read actual stock records.

Support:

- site
- item
- tyre serial where applicable
- quantity
- availability
- transfer where supported
- scan
- search

The Kotlin project once displayed invented tyre stock at Qiddiya. Flutter must never use fallback fake records.

An empty table should produce:

```text
No stock records available
```

not sample data.

---

# 46. Notifications

The system has real notification data.

Build:

- inbox
- read/unread
- badge
- notification detail
- deep linking
- mark read
- mark all read where supported
- device push registration

Never show:

```text
No notifications
```

without querying the actual source.

---

# 47. Realtime

Use Supabase Realtime selectively.

Suitable for:

- notifications
- workshop activity
- approval queues
- important live status

Do not subscribe every screen to every table.

Subscriptions must be disposed correctly.

Reconnect safely after foreground/background changes.

---

# 48. Reports

Mobile reporting should focus on useful field outputs.

Examples:

- inspection report
- accident report
- checklist report
- tyre history export

Heavy analytics remain mainly on the web application.

Generate PDFs only from actual records.

---

# 49. AI

Do not show fake predictive analytics.

The Kotlin audit found hard-coded failure predictions.

Flutter AI screens must display only:

- real Edge Function/API results
- explicit loading state
- explicit failure state
- source/context where appropriate

If there is no AI result:

```text
No analysis available
```

not invented insights.

---

# 50. Admin Mobile Scope

Mobile admin should remain operationally useful.

Potential mobile admin:

- users
- access/grants
- sites
- approvals
- workshop activity

System-wide platform configuration should remain in the web console unless specifically required.

Do not place dangerous fake toggles such as:

```text
Global Sync Pause
Maintenance Mode
```

unless those controls genuinely exist on the backend.

---

# 51. Localization

Preserve:

- English
- Arabic
- Urdu

Use Flutter localization with generated locale resources.

All user-facing strings must come from localization files.

Do not hard-code English inside feature screens.

---

# 52. RTL

Arabic must use true RTL.

Test:

- app bars
- back icons
- tyre labels
- cards
- lists
- form fields
- dialog alignment
- bottom sheets
- numbers
- mixed Arabic and English asset numbers

Tyre position IDs such as:

```text
FL
RR2
```

should remain technically readable and should not be accidentally reversed.

---

# 53. Theme

Use a clean enterprise field design.

Primary goals:

- sunlight readability
- fast scanning
- large enough touch targets
- compact information density
- minimal visual clutter

Keep:

- light theme as primary
- optional dark theme
- high contrast status colors
- consistent cards/buttons/form controls

Do not make the field application dependent on translucent decorative effects.

Performance and readability come first.

---

# 54. Design System

Create reusable:

```text
TpScaffold
TpAppBar
TpButton
TpCard
TpInput
TpDropdown
TpSearchField
TpStatusChip
TpEmptyState
TpErrorState
TpLoadingState
TpOfflineBanner
TpSyncIndicator
TpStatCard
TpAssetCard
TpTyreChip
TpBottomSheet
TpDialog
```

No feature should invent its own version of basic UI controls.

---

# 55. Device Support

Tyre Pulse runs in mixed field environments.

Optimize for:

- lower-memory Android phones
- older supported Android versions
- current Android
- iPhones
- tablets where practical
- weak connections
- bright sunlight

Avoid keeping giant result sets in memory.

Avoid unnecessary animations.

Compress large images.

Paginate long lists.

Dispose controllers/subscriptions.

---

# 56. iOS

Flutter must be treated as Android + iOS from day one.

Do not build Android first and postpone all iOS decisions.

Test:

- permissions
- camera
- files
- notifications
- location
- background tasks
- secure storage
- deep links
- app lifecycle
- keyboards
- safe areas
- RTL

Platform-specific implementation is allowed where required.

---

# 57. Error Handling

Use typed errors.

Categories:

```text
network
authentication
authorization
validation
conflict
storage
sync
server
unknown
```

User-facing errors should be understandable.

Example:

Bad:

```text
PostgrestException PGRST116
```

Good:

```text
This inspection has changed on the server. Refresh it before approving.
```

Log technical details to telemetry.

---

# 58. Empty States

Empty does not equal error.

Support separate UI for:

```text
Loading
Empty
Offline cached
Permission denied
Backend unavailable
Not configured
Error
```

Never use a spinner indefinitely to represent all of these.

---

# 59. Observability

Continue using Sentry.

Capture:

- crashes
- unhandled errors
- API errors with safe metadata
- sync failure categories
- screen performance
- app version
- platform
- workspace ID where privacy-safe
- route
- build environment

Do not upload passwords, access tokens or sensitive image content to logs.

---

# 60. App Version Control

Port the current minimum-version gate.

Admin/backend configuration can define:

```text
minimum supported mobile version
```

If app is below it:

```text
Update Required
```

Allow safe sign-out.

Do not destroy unsynced local data during version gating.

---

# 61. Database Migrations

Flutter local database changes must use explicit migrations.

Never simply delete local data when the schema changes.

Maintain:

```text
schemaVersion
migration1to2
migration2to3
...
```

Migration tests are mandatory.

---

# 62. Server Schema Discipline

Before implementing any repository:

1. inspect the actual Supabase table/RPC
2. verify columns
3. verify types
4. verify nullable values
5. verify RLS
6. verify relationships
7. create DTO
8. create mapper
9. create repository
10. create tests

Do not create endpoint names based on what sounds logical.

---

# 63. Data Models

Keep remote DTOs separate from domain models.

Example:

```text
TyreRowDto
     ↓ mapper
Tyre
```

This prevents database column changes from spreading throughout UI code.

---

# 64. Recommended Flutter Stack

Core:

```text
Flutter
Dart
Riverpod
GoRouter
Supabase Flutter
Drift / SQLite
Workmanager
Sentry Flutter
Flutter Secure Storage
```

Additional packages should be chosen carefully for:

- camera
- image processing
- permissions
- connectivity
- SVG
- QR/barcode
- signature capture
- PDF
- sharing
- file paths
- localization

Do not add a package merely because an agent wants to shorten five lines of code.

---

# 65. Testing Strategy

Port important behavioral tests from React.

Existing tests reveal valuable business contracts including:

- admin-only access
- back navigation
- checklist drafts
- checklist history
- checklist photos
- checklist targeting
- inspection approvals
- offline queue
- photo queue shape
- repair requests
- route guards
- saved signatures
- schedules
- secure storage
- session durability
- signature keys
- stock site picker
- tyre completeness
- tyre diagram layouts
- washing
- signer rules
- workshop live behavior

These should become Flutter tests.

---

# 66. Test Pyramid

### Unit tests

For:

- tyre layout engine
- condition rules
- checklist branching
- approval logic
- permissions
- version comparisons
- formatting
- sync command mapping
- DTO mapping

### Repository tests

For:

- local-first reads
- Supabase mapping
- queue creation
- conflict handling

### Widget tests

For:

- screens
- route guards
- forms
- error states
- RTL
- permissions

### Integration tests

For:

```text
Login → Inspect → Offline Submit → Reconnect → Sync
```

and:

```text
Login → Checklist → Draft → Close App → Resume → Submit
```

and:

```text
Notification → Work Order → Back
```

and:

```text
Tyre Change → Close old fitment → Install new tyre
```

---

# 67. Migration Strategy

Do not rewrite all 30+ screens simultaneously.

Use controlled vertical slices.

## Phase 0: Freeze Source Applications

React Native:

```text
legacy/react-native
```

Kotlin:

```text
legacy/android-native
```

No destructive deletion.

Use them as references.

---

## Phase 1: Flutter Foundation

Build:

- project structure
- environments
- Supabase connection
- logging
- Sentry
- secure storage
- Drift
- Riverpod
- GoRouter
- localization
- theme
- permission system
- workspace context

No business feature migration until this foundation passes tests.

---

## Phase 2: Authentication and Shell

Implement:

- splash/bootstrap
- session restoration
- login
- profile
- access gate
- minimum-version gate
- workspace
- main navigation
- Home
- Profile
- offline banner

---

## Phase 3: Fleet Foundation

Implement:

- asset list
- asset detail
- global search
- tyre list
- tyre detail
- tyre history
- serial search
- scanner

---

## Phase 4: Tyre Diagram

Port and test:

- canonical vehicle type resolver
- position parser
- axle grouping
- dual tyre positioning
- steer tyres
- lift/tag axle
- trailer axles
- spare
- all current diagram layouts

The tyre diagram must achieve test parity before inspection migration continues.

---

## Phase 5: Inspection

Implement:

- new inspection
- local draft
- tyre editor
- conditions
- pressure
- tread
- photos
- completeness
- signature
- offline submission
- history
- detail

---

## Phase 6: Generic Checklist Engine

Implement:

- template library
- runner
- dynamic fields
- conditional visibility
- photos
- signatures
- asset/site/user references
- drafts
- history
- submission

Then approvals.

---

## Phase 7: Tyre Replacement and Meters

Implement:

- replacement
- meter logs
- engine hours
- odometer
- washing

---

## Phase 8: Workshop

Implement:

- workshop hub
- open work orders
- my jobs
- work order detail
- technician activity
- maintenance/calendar

Only real backend-supported features.

---

## Phase 9: Accidents

Implement:

- list/dashboard
- reporting
- case detail
- workstreams
- evidence
- claims
- RCA
- PDFs

---

## Phase 10: Operational Modules

Implement:

- stock
- notifications
- reports
- team
- admin
- AI where real backend support exists

---

## Phase 11: iOS Completion

iOS should be compiling throughout development, but this phase closes all remaining platform differences.

Complete:

- APNs
- permissions
- background modes
- deep links
- Apple signing
- TestFlight
- iOS-specific UI QA

---

## Phase 12: Parallel Production Validation

Do not immediately replace the React Native production app.

Run:

```text
React production app
vs
Flutter candidate
```

with selected users.

Compare:

- submission counts
- tyre positions
- photos
- signatures
- sync
- approvals
- data fields
- crash rate
- loading time
- navigation

Only promote Flutter after functional parity is proven.

---

# 68. Data Migration

Existing users may have unsynced React Native data.

Before production migration:

1. require legacy app to sync
2. verify pending queue = 0
3. warn users before upgrade
4. maintain server-side records
5. validate Flutter login
6. download required offline cache

Do not assume React AsyncStorage structures can simply be read by Flutter.

Treat server data as migration authority.

---

# 69. Package Identity

Before replacing the production Android app, confirm:

- current production package ID
- Play signing key
- upload key
- version code
- version name

The Kotlin project currently appears to use a different native app listing.

Do not accidentally publish Flutter as another unrelated Tyre Pulse application unless intentionally running a pilot.

---

# 70. Security Issue to Fix

The Kotlin audit reports a signing key and password were committed into repository history.

Treat that key as compromised.

Do not copy:

```text
release.jks
passwords
service secrets
```

into the new Flutter repository.

Use:

- CI secrets
- local environment files excluded from git
- Play App Signing
- secure iOS signing configuration

Rotate compromised credentials where necessary.

---

# 71. Repository Rules

Add an `AGENTS.md` for coding agents.

Critical rules:

```text
1. Never fabricate fleet data.
2. Never invent Supabase tables.
3. Never invent backend endpoints.
4. Never hard-code KPIs.
5. Never silently swallow errors.
6. Never replace real data with sample data on failure.
7. Never implement a control that does nothing.
8. Never bypass permission checks.
9. Never remove offline persistence for convenience.
10. Never change tyre position IDs.
11. Never alter database schema without explicit migration.
12. Never claim a feature works without a test/build.
13. Keep Android and iOS compiling.
14. Preserve RTL.
15. Preserve actual back navigation.
```

---

# 72. Definition of Done

A feature is NOT complete because:

```text
screen looks finished
```

It is complete only when:

- real backend connected
- real table/RPC verified
- permission rules implemented
- loading state implemented
- empty state implemented
- failure state implemented
- offline behavior defined
- navigation tested
- back behavior tested
- Android tested
- iOS tested
- RTL tested where applicable
- unit/widget tests pass
- no fabricated fallback values
- Sentry error handling included

---

# 73. Critical Tyre Pulse Principle

Tyre Pulse is not simply a collection of forms.

It is an operational fleet platform.

The Flutter app must be designed around:

```text
Asset
Tyre
Person
Site
Inspection
Checklist
Work
Incident
Evidence
Transaction
History
```

Every important action must leave an auditable history.

---

# 74. Final Product Architecture

```text
                         TYRE PULSE

             ┌──────────────┴──────────────┐
             │                             │
             │                             │
      Web Administration              Mobile Field App
      Next.js / React                    Flutter
      TypeScript                         Dart
                                             │
                                  ┌──────────┴──────────┐
                                  │                     │
                               Android                 iOS
                                  │                     │
                                  └──────────┬──────────┘
                                             │
                                       Repositories
                                             │
                              ┌──────────────┴──────────────┐
                              │                             │
                         Local SQLite                   Supabase
                            Drift                          │
                              │                    PostgreSQL / Auth
                         Offline Queue              Storage / Realtime
                              │                    RPC / Edge Functions
                              └──────────────┬──────────────┘
                                             │
                                         Sync Engine
```

---

# 75. Final Instruction to the Development Agent

Do not begin by coding screens.

First audit the existing React Native and Kotlin implementations against the actual Supabase schema.

Create:

1. feature inventory
2. backend table/RPC map
3. mobile route map
4. role/permission matrix
5. local database schema
6. offline command registry
7. tyre layout parity tests
8. checklist engine parity tests
9. migration matrix

Then build the Flutter foundation.

For every feature, identify:

```text
SOURCE LOGIC
React Native file(s)

CORRECTIONS
Kotlin audit findings

BACKEND
Verified Supabase source

FLUTTER TARGET
Feature package

OFFLINE STRATEGY
Online / cached / queued / online-only

TESTS
Parity requirements
```

Do not remove existing production behavior unless there is evidence that it is broken or the product owner explicitly changes the requirement.

The objective is not merely to reproduce the current app.

The objective is to produce one maintainable Tyre Pulse mobile platform that preserves the proven business logic, removes the technical mistakes found in both previous implementations, works properly offline, supports Android and iOS, and can continue growing without another rewrite.