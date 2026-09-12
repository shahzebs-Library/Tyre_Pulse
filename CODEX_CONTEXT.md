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

- Installed Expo approvals (2026-09-12): fixes `8536a2bc`, `881c5a33` and `1acb332e` are on remote `main`. Restored workshop manager checklist access and separate approval shortcuts; added governed checklist/inspection review, operational work-order/tyre-change queues, delegation/reassignment/recovery and durable decision retries. Full mobile suite passed (549 tests); final focused notification/governed regressions passed (51 tests), final TypeScript check and Android/iOS bundle exports passed. Production OTA [run 34687917477](https://github.com/shahzebs-Library/Tyre_Pulse/actions/runs/34687917477) succeeded for runtime `1.6.0`; update group `27be85f1-ab26-4619-8c41-efaa3ab1e4a6`. Both production manifests served the final updates created `2026-09-12T10:16:53.644Z`. This supersedes the earlier history-only OTA below. Publication is verified; installation on every phone is not. Flutter remains unchanged/deferred.
- Approval acceptance boundary (2026-09-12): authenticated production web check was under Shahzeb Rahman's account, not VINAY KUMAR T. It showed 21 workshop checklists and three inspections; a workshop review opened with answers, signatures and approve/return/reject controls. Current workshop records await supervisor sign-off before the area-manager stage. Read-only backend checks confirmed VINAY's scope and legacy decision eligibility; his browser session still needs verification. No real approval was submitted. Production had no approval policies or delegations; new policy activation still requires confirmed roles/order/scope and the existing independent second-administrator review. Do not mark manager acceptance or policy activation complete.

- Checklist history correction (2026-09-12): older workshop sheets were present but synced September 10/12. Live check found 12 August-dated sheets but only one received in August; receipt-date filtering excluded the other 11. Web commit `7adf98d0` is on remote `main` and deployed: month reports use recorded sheet dates across paged history, the list distinguishes checklist/received dates, and the silent 200-row register cap is removed. Historical records, signatures, photos and signed PDFs were not rewritten.
- Inspection Planner completion: implementation is on `main` and deployed; the former Audit Trail missing exports are resolved. `7adf98d0` also fixes incomplete-history warnings when pagination crosses its ceiling. Verification: 56 planner/workflow tests, 13 pagination tests, focused checklist regressions, full web lint/build, and desktop dark/mobile light/Arabic RTL browser checks passed. Planner browser checks used fixture auth/data; production release/login were checked separately, not authenticated operational workflows.
- Installed Expo phone history (2026-09-12): `ce608969` is on remote `main`. `mobile/` now displays template-derived Checklist date separately from Received date in English/Arabic/Urdu, fetches only date answers for listed records, and discards stale scope responses. 24 history tests, TypeScript checking and Android/iOS update-bundle exports passed. Production OTA publication succeeded through [GitHub run 34686403538](https://github.com/shahzebs-Library/Tyre_Pulse/actions/runs/34686403538); Android/iOS production manifests for runtime `1.6.0` served the update created `2026-09-12T09:41:25.327Z`. Local EAS CLI was not signed in; the existing GitHub workflow supplied release authentication. Publication is verified, installation on every phone is not. Flutter was not changed or released by this task.

- Web/backend completion (2026-09-12): recovered web commit `cec8a221` was live; approval follow-up `d60a7954` is included in this rollout. Applied the governed approval, administration/configuration, import and accident-concurrency migrations, plus `20260912091451_bridge_tenant_capability_configuration` and `20260912091652_lock_approval_helper_search_paths`. Migration registry versions were aligned to repository filenames after MCP deployment. Capability saves/enforcement now use tenant settings; existing platform capability/feature-flag baselines are retained per existing tenant. Attributable company settings are retained; unknown-owner legacy configuration stays archived. Existing documents remain on legacy approval routes until a policy is explicitly published. PM/service/shift/tyre-service tables remain empty; approved operational setup is still required. Flutter rollout remains deferred by the user. Verification: 127 web regressions, 63 backend regressions, capability bridge and accident-concurrency regressions passed; web lint/build passed; live Admin/Fleet Supervisor/Data Monitor read/RBAC checks passed. Browser account journeys still need authenticated acceptance.

- Operational/report corrections (2026-09-10): commits `8dd9b215` and `bd7e066d` correct web module scope/history, inspection/checklist PDFs and anomaly calculations. User preference: corrected rules apply to new submissions and newly generated reports; preserve historical records, signed PDFs, signatures, photos and audit history. Never rewrite old evidence or guess replacement meter readings. Historical invalid values may be flagged for review. These are React web changes, not an installed-mobile rollout. PM intervals/shift timings and historical reading/photo corrections still need confirmed operational inputs.
- Verification for those corrections: web lint/build and focused regressions passed. Latest full web run had 9,248 passes and four UI failures; all three affected files passed with one worker (25 tests). No second full-suite run was performed. Reviews: `audit/operational-module-review-2026-09-10.md` and `audit/checklist-report-review/review.md`.

- Production React Native sync repair (2026-09-10): applied migrations `20260910095436_fix_meter_log_upsert_indexes` and `20260910095446_fix_mobile_queue_indexes_and_wash_permissions`. Full client_uuid indexes now support installed-client upserts for meter logs, checklists, accidents, and workshop events; Fleet Supervisor can insert washes within existing org/country/site restrictions. Isolated retry/RLS regression passed and live EXPLAIN verified all five indexes. TM651 mobile km/hour records were subsequently observed; delivery of every queued device record remains unconfirmed; repair_requests is still absent.
- Web vehicle meter workspace (2026-09-10): `/odometer-logs` now supports applicable km/hours in one row, dated history, current-region filtering and audited corrections. Migration `20260910102622_web_vehicle_meter_workspace` is applied: atomic/idempotent save and correction RPCs use caller RLS and Admin checks. Web changes require frontend deployment. Database regression: `node --test supabase/tests/web_vehicle_meters.test.mjs`; focused web tests: `npm.cmd run test:run -- src/test/vehicleMeters.test.js src/test/vehicleMeters.page.test.jsx src/test/vehicleMeters.api.test.js`.
- Web release notes: add a new newest-first entry to `src/data/releases.json` for each user-facing web release (English/Arabic and affected module keys; no customer data). `scripts/release-build.mjs` embeds the same versioned notes in the app and waiting service worker. The update prompt reads that worker directly; Settings > Update history shows the installed history, filtered by effective module access. Keep prior entries so users who skip releases see all applicable changes.
- Default branch: `main`.
- Home access (2026-09-10): operational users open `MyWorkspace`, whose links reuse the permitted sidebar catalog. Dashboard OFF issues no summary reads; ON uses count-only RLS-scoped reads for permitted fleet/washing/inspection modules. Admin/Super Admin retain the executive dashboard. Its eager preload is removed; the shell alert badge queries only allowed source modules. Permission/country changes discard old workspace state and abort its count requests. Existing database table permissions are unchanged; this is not a global RLS permission overhaul.
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
