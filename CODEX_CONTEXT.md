# Tyre Pulse compact context

This is the small startup map for coding agents. Keep it factual and brief.

## Current direction

Tyre Pulse is a commercial multi-tenant fleet, tyre, inspection, workshop, accident, reporting, and field-operations platform. The Flutter application under `tyre_pulse_flutter/` is the primary Android/iOS implementation. It must preserve actual vehicle artwork, tyre-position identifiers, offline field work, permissions, signatures, localization, RTL, dark mode, and platform parity.

## Repository map

| Area | Path | Notes |
|---|---|---|
| Web console | `src/` | React/Vite production web application |
| Primary mobile | `tyre_pulse_flutter/` | Flutter Android and iOS |
| Legacy mobile | `mobile/` | React Native behavioral reference; read-only by default |
| Native Android | `tyre_pulse_app/` | Kotlin reference/alternate implementation |
| Database/backend | `supabase/`, `MIGRATIONS_*.sql` | Supabase tables, RPCs, RLS, functions |
| Marketing | `marketing/` | Next.js marketing site |
| Services | `services/` | Supporting services |
| CI | `.github/workflows/` | Required verification gates |

## Sources of truth

Use this order:

1. Current production schema, migrations, RLS, RPCs, and Edge Functions.
2. Existing working behavior and tests.
3. Approved UI references and supplied production mocks.
4. Current implementation in the target app.
5. Old plans and handoff notes only when needed.

Do not treat a proposal, mock value, old branch, or stale handoff as production truth.

## Active repository state

- Operational/report corrections (2026-09-10): commits `8dd9b215` and `bd7e066d` correct web module scope/history, inspection/checklist PDFs and anomaly calculations. User preference: corrected rules apply to new submissions and newly generated reports; preserve historical records, signed PDFs, signatures, photos and audit history. Never rewrite old evidence or guess replacement meter readings. Historical invalid values may be flagged for review. These are React web changes, not an installed-mobile rollout. PM intervals/shift timings and historical reading/photo corrections still need confirmed operational inputs.
- Verification for those corrections: web lint/build and focused regressions passed. Latest full web run had 9,248 passes and four UI failures; all three affected files passed with one worker (25 tests). No second full-suite run was performed. Reviews: `audit/operational-module-review-2026-09-10.md` and `audit/checklist-report-review/review.md`.

- Production React Native sync repair (2026-09-10): applied migrations `20260910095436_fix_meter_log_upsert_indexes` and `20260910095446_fix_mobile_queue_indexes_and_wash_permissions`. Full client_uuid indexes now support installed-client upserts for meter logs, checklists, accidents, and workshop events; Fleet Supervisor can insert washes within existing org/country/site restrictions. Isolated retry/RLS regression passed and live EXPLAIN verified all five indexes. TM651 mobile km/hour records were subsequently observed; delivery of every queued device record remains unconfirmed; repair_requests is still absent.
- Web vehicle meter workspace (2026-09-10): `/odometer-logs` now supports applicable km/hours in one row, dated history, current-region filtering and audited corrections. Migration `20260910102622_web_vehicle_meter_workspace` is applied: atomic/idempotent save and correction RPCs use caller RLS and Admin checks. Web changes require frontend deployment. Database regression: `node --test supabase/tests/web_vehicle_meters.test.mjs`; focused web tests: `npm.cmd run test:run -- src/test/vehicleMeters.test.js src/test/vehicleMeters.page.test.jsx src/test/vehicleMeters.api.test.js`.
- Web release notes: add a new newest-first entry to `src/data/releases.json` for each user-facing web release (English/Arabic and affected module keys; no customer data). `scripts/release-build.mjs` embeds the same versioned notes in the app and waiting service worker. The update prompt reads that worker directly; Settings > Update history shows the installed history, filtered by effective module access. Keep prior entries so users who skip releases see all applicable changes.
- Default branch: `main`.
- Home access (2026-09-10): operational users open `MyWorkspace`, whose links reuse the permitted sidebar catalog. Dashboard OFF issues no summary reads; ON uses count-only RLS-scoped reads for permitted fleet/washing/inspection modules. Admin/Super Admin retain the executive dashboard. Its eager preload is removed; the shell alert badge queries only allowed source modules. Permission/country changes discard old workspace state and abort its count requests. Existing database table permissions are unchanged; this is not a global RLS permission overhaul.
- Security remediation (2026-09-09): client/report safeguards and reproducible test gates are implemented. Supabase is Git-linked to main, so deployable functions and migrations remain unchanged to protect installed mobile clients. Reviewed backend replacements and migrations live in `supabase/security-rollout/`; its tests exercise pending code, not production. Anonymous login RPC abuse still needs a coordinated client rollout; image-size/pptxgenjs advisories and historical native signing-key rotation remain open.
- Local Flutter completion work includes the asset-first checklist hub from PR #347, persisted theme/language, Home search with permission/scope resets, Fleet AI, operational Admin screens, and accident status/waiver/claim registration.
- PR #347 remains open/conflicted remotely; its changes were integrated locally while preserving newer working-tree changes. PR #348 remains open; the SDK pin to 3.47.2 was adopted locally with strict formatting retained.
- Android release signing now requires private `android/key.properties`; the release workflow uses the committed Android project instead of overwriting it.
- Live schema checked 2026-09-07: `repair_requests` is absent; no verified atomic rotate/remove/retread/spare RPCs were found. These are still unavailable.
- Prepared local migration `supabase/migrations/20260907075433_serialize_accident_closure_and_claim_registration.sql` for closure RPC concurrency and first-claim registration races; isolated PostgreSQL regression harness passed. It has NOT been applied live. Claim finance/settlement and assignment still need completion; do not call the entire product release-ready.
- Local verification on 2026-09-07: source generation, formatting, and final fatal-info analysis passed (zero issues). Full suite finished with 2,598 passes and six failures; all six were resolved and passed in targeted reruns (7 approvals tests and 98 Search/Home tests). No skipped tests were reported. No second clean full-suite run was performed. Android debug APK built successfully with existing public backend configuration and APP_ENV=staging, at `tyre_pulse_flutter/build/app/outputs/flutter-apk/app-debug.apk`. Signed release, iOS, and real-device verification remain outstanding. Logs are in Windows TEMP: `tyre-pulse-flutter-final-test.log`, `tyre-pulse-admin-approvals-retest.log`, `tyrepulse-final-analyze.log`, `tyrepulse-final-android-build.log`. This is not release approval.
- Local SDK exists at `C:/Users/Tyre_Engineer/flutter_sdk_extract/flutter` (3.47.1), Android SDK at `C:/Users/Tyre_Engineer/android_sdk`, JDK under `C:/Users/Tyre_Engineer/jdk17_extract`. Older no-toolchain notes are stale. Windows cannot build iOS.
- Vercel checks can fail because private organization repositories require an appropriate Vercel plan. Do not confuse that account-level limitation with an application compile failure.

Always recheck GitHub before relying on this status section.

## Common commands

### Web console

```bash
npm ci
npm run lint
npm run test:run
npm run build
```

Run a focused Vitest file while iterating when possible.

### Flutter

```bash
cd tyre_pulse_flutter
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter gen-l10n
dart format --set-exit-if-changed .
flutter analyze --fatal-infos
flutter test
flutter build apk --debug
flutter build ios --no-codesign
```

Generated output, formatting, analysis, tests, Android, and iOS are release gates. If the local machine lacks the toolchain, use CI and report that boundary.

## Protected Flutter wiring

Do not edit these without explicit human direction:

- `lib/app/router/routes.dart`
- `lib/app/router/app_router.dart`
- `lib/app/router/route_access.dart`
- `lib/app/router/shell_tabs.dart`
- `lib/core/sync/command_registry.dart`
- `lib/core/sync/queued_command_repository.dart`
- `lib/core/sync/sync_engine.dart`

## Definition of done

A change is done only when the requested behavior exists, affected tests pass, required builds pass, no real data or artwork regressed, and any remaining blocker is explicitly named.
