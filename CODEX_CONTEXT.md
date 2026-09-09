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

- Default branch: `main`.
- Security remediation (2026-09-09): client/report safeguards and reproducible test gates are implemented. Supabase is Git-linked to main, so deployable functions and migrations remain unchanged to protect installed mobile clients. Reviewed backend replacements and migrations live in `supabase/security-rollout/`; its tests exercise pending code, not production. Anonymous login RPC abuse still needs a coordinated client rollout; image-size/pptxgenjs advisories and historical native signing-key rotation remain open.
- Flutter UI, biometric login, real vehicle artwork, tyre layouts, field workflows, reports, maintenance, accidents, and approval presentation have already received substantial implementation.
- Open PR #347 contains an asset-first Flutter checklist hub but is behind `main` and needs conflict resolution plus fresh CI.
- Open PR #348 changes Flutter CI behavior and test artifacts; it requires GitHub Actions approval before it can be trusted or merged.
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
