# Flutter completion readiness — 2026-08-31

## Outcome

The implemented Flutter scope is buildable and ready for an Android device install.
The complete planned PMV product is **not yet 100% implemented**. This report keeps
those two claims separate.

## Verified in this run

- `flutter analyze`: **0 issues**
- Full Flutter suite: **2,427 / 2,427 passed**
- Current-run visual contracts: **71 / 71 passed**
- Android debug APK:
  - path: `build/app/outputs/flutter-apk/app-debug.apk`
  - package: `com.shahzebrahman.tyrepulse`
  - version: `0.1.0+3`
  - size: `293,674,603` bytes
  - SHA-256: `F9EECD28C7E6C19BCFC0F86BF682C0F9153C20A72FE4EE7949A6DCEE83FDE1FA`
- APK contains all **20** vehicle/equipment five-view boards.
- Protected router and sync files have no working-tree changes.
- `git diff --check`: clean.
- No phone was installed in this run; `adb devices -l` was empty, matching the
  request to install later.

Current-run captures are stored beside this report. They cover login, Home,
accident case, inspection approval, asset list/detail, and checklist runner
contracts in compact/wide and LTR/RTL variants where applicable.

## Completion fixes made in this audit

1. Added and integrated `mobile_scanner 7.4.0`.
   - Live QR/barcode camera capture now feeds the existing
     `ScannerController`.
   - Runtime permission denial and unsupported-camera states are explicit.
   - Manual entry remains available and uses the same lookup path.
   - Pure barcode-selection tests and scanner widget tests pass.
2. Wired the vehicle fleet repository to the app's canonical Drift
   `AppDatabase.cacheDao`.
   - Offline fleet fallback no longer defaults to a null cache.
   - A provider test proves the same database/DAO is used.
3. Removed the Team-screen Manage control that routed users into an unbuilt
   Admin Users placeholder.
4. Removed the deprecated `synthetic-package` localization option and
   regenerated localization output.
5. Updated stale dependency comments to match the scanner implementation.

## Screen and route inventory

- Declared `TpRouteId` values: **49**
- Feature-owned registered screens: **39**
- Production `*_screen.dart` files: **39**
- `boot` is a special root/session-decider route, not a feature screen.

The following planned route IDs do not have production screen registrations:

- `register` — deliberately excluded from current auth registration.
- `fleetAi` — screen not implemented.
- `repairRequest` — write contract is unverified; migration V608 is authored
  but not confirmed applied, and `REPAIR_REQUEST` is deliberately absent from
  the protected command registry.
- `adminConsole`
- `adminUsers`
- `adminAccess`
- `adminApprovals`
- `adminSites`
- `adminAiChat`

Global Search has a complete screen/controller/repository implementation, but it
is not reachable because the protected route model has no Global Search route
ID/path/GoRoute. This audit did not violate `AGENTS.md` by editing protected
router files.

## Functional work still requiring a separate implementation pass

- Full writable accident/insurance workflow: assessment handoffs, documents,
  claim registration/recovery, vendor/PO lifecycle, email notifications,
  signatures, SLA ownership, internal/external workshop completion, PMV
  approval, report generation, and PDF/share delivery. Current screens preserve
  verified read-only data and honest not-configured states instead of fabricating
  backend writes.
- Repair Request backend enablement after schema/RPC verification.
- Fleet AI and the six Admin screens listed above.
- Registration if self-service registration is an approved product requirement.
- Persisted appearance/display settings; the current display store is
  in-memory.
- Profile expansion beyond identity/access/sign-out.
- Four tyre action write paths (rotate, remove, retread, spare) after their
  server/queue contracts are verified.
- Global Search route integration by an authorized owner of the protected
  router files.

## Dependency and platform audit

- No dependency was reported discontinued, retracted, or advisory-flagged.
- No major upgrade was applied blindly. Notable available breaking upgrades
  include `geolocator 14.x` and `signature 6.x`; these need migration and
  regression work.
- Flutter reported a future compatibility warning because
  `mobile_scanner`, `sentry_flutter`, and `workmanager_android` still
  apply the Kotlin Gradle plugin directly. It does not block this APK.
- PDF/share/email packages are not present because the corresponding complete
  report-delivery flow is not yet implemented. Adding unused libraries would
  not make that workflow complete.
- Android local package ID: `com.shahzebrahman.tyrepulse`.
- Local iOS bundle ID and CI-generated IDs are not fully aligned with Android.
- Local Android release currently uses debug signing. Production signing and
  final package-ID ownership must be decided before a store release.
- iOS compilation cannot be verified on Windows.

## Git state

No commit or push was performed. The working tree contains the accumulated UI,
vehicle artwork, tests, generated goldens, scanner/cache changes, and prior
session work.

