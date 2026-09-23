---
name: flutter-app
description: Work on the Flutter (Dart) app in tyre_pulse_flutter/, the field application being migrated to from the Expo app. Use this skill for ANY change under tyre_pulse_flutter/ - adding or editing a screen, widget, ViewModel/notifier, repository, DTO/mapper, router entry, l10n string or test; fixing an analyzer or build error; regenerating goldens or generated sources; bumping the version; or preparing a build. Use it whenever the user says Flutter, Dart, tyre_pulse_flutter, "the Flutter app", golden test, ARB, l10n/localization key parity, "flutter analyze", "flutter test", pubspec, build_runner, gen-l10n, or "the migration app". Do NOT use it for the Expo/React Native app under mobile/ (see mobile-ui-design) or the native Kotlin app under tyre_pulse_app/ (see native-android) - both are READ-ONLY reference material from here, never edited.
---

# Tyre Pulse Flutter app

`tyre_pulse_flutter/` is the Flutter (Dart) field app that the project is
migrating TO. ~448 Dart files under `lib/`, ~264 test files, ~24 golden
(pixel-snapshot) images, three locales (en/ar/ur). It ships to Android and iOS.

**Read `tyre_pulse_flutter/AGENTS.md` first, every time.** It is the project's
own contract and it overrides anything here. Also skim
`tyre_pulse_flutter/docs/TOOLCHAIN.md` (what is installed and why CI is the
verification boundary), `docs/BOOTSTRAP.md` (why `android/`+`ios/` are absent),
`README.md` and `design-qa.md`.

> Note: AGENTS.md still points at a `docs/flutter-migration/` folder and a
> "Master Architecture and Migration Specification" doc. **Those paths no longer
> exist in the tree.** Do not go looking for them or cite them - use the docs
> that are actually present (listed above) and treat AGENTS.md's own text as the
> live contract.

## The single most important fact

**There is no Flutter SDK, no Dart SDK, no JDK and no Android SDK on this
machine, and the host is not macOS.** `flutter`, `dart`, `java` and `gradle`
do not exist here. You can AUTHOR Dart here; you cannot compile, analyse, test
or run it here. Verify before assuming otherwise:

```bash
which flutter dart java 2>&1   # not found
```

**CI is the verification boundary, not local opinion** (AGENTS.md rule 12: never
claim a feature works without a test or a build). The gate is
`.github/workflows/flutter-ci.yml`: `analyze_test` (dependencies -> generate
sources -> fail-if-generated-output-stale -> analyze -> test -> coverage) plus
`build_android` (debug APK) and `build_ios` (no code signing). iOS can never be
built here regardless - Apple toolchains need macOS.

## Never edit these seven wiring files (AGENTS.md)

Everything else in `lib/` is normal application code. These seven carry
guarantees the whole tree depends on; a human changes them, never an agent - even
for a "mechanical" edit like formatting or a codemod:

- `lib/app/router/routes.dart`
- `lib/app/router/app_router.dart`
- `lib/app/router/route_access.dart`
- `lib/app/router/shell_tabs.dart`
- `lib/core/sync/command_registry.dart`
- `lib/core/sync/queued_command_repository.dart`
- `lib/core/sync/sync_engine.dart`

## `mobile/` and `tyre_pulse_app/` are READ-ONLY reference

Behaviour source of truth, in order: the real Supabase schema
(`MIGRATIONS_V*.sql` at the repo root and the live DB) > the working React
Native app under `mobile/` > its verified tests under `mobile/__tests__/` >
findings (not code) from the Kotlin app in `tyre_pulse_app/` > new Flutter code.
Read those to learn the intended behaviour; **never edit them from this project.**
They are frozen source, not shared code.

## Rule 3 killed the last rebuild: there is no application server

Every remote call is exactly one of: PostgREST on a real table, a Postgres RPC
that already exists, or a Supabase Edge Function that already exists. **If you
cannot point at the migration file that creates the object, you may not call
it** - mark it UNVERIFIED and stop. Do not invent tables, endpoints or columns.
Never guess a column type: the Kotlin app treated `profiles.country` as a String
when the DB stores a `text[]` array and broke login for most users.

## Layering (AGENTS.md)

`Presentation -> Application/Domain -> Repository -> Local + Remote data sources`.
No Supabase call in a widget, no SQL in a screen, no permission logic in a
button, no tyre business rule in UI code. DTOs stay separate from domain models
so a column rename does not spread through the UI. Before any repository:
inspect the real table/RPC, verify columns/types/nullability/RLS/relationships,
then DTO -> mapper -> repository -> tests.

## Offline is not optional

Field sites have no signal. Every write path is queued through the command queue
or explicitly declared online-only with a reason. One registry owns table names
(do not scatter them). Every queued command carries a field allow-list - a
column PostgREST cannot find fails the whole request. Every queued insert is
idempotent on a stable client-generated id, unless the target is an append-only
log with no `client_uuid`. Decisions that depend on current server state (e.g.
approvals) are NOT blindly queued. Never delete a local photo before the server
confirms the upload. A local schema change never wipes local data - unsynced
work is the only copy.

## States are seven different things, and a spinner is none of them

Loading, empty, offline-cached, permission-denied, backend-unavailable,
not-configured and error each render differently. The test `deniedIsNotASpinner`
exists because this was got wrong once - keep the principle. Where a `0` would
falsely imply a real measurement, render `-` or `Unavailable`, not `0`.

## Golden (pixel-snapshot) tests - the CI trap to respect

`analyze_test` runs on **windows-latest** on purpose: the ~24 goldens under
`test/` were authored on the Windows renderer and are exact-pixel assertions.
Flutter is **pinned to 3.47.2** in CI so text does not re-render at sub-pixel
differences on each release and drift every golden red with no code change.

- Regenerate goldens with `flutter test --update-goldens` on **Flutter 3.47.2 on
  Windows** - a Linux/macOS regen produces goldens that fail CI's Windows job.
- A commit that intentionally updates goldens is conventionally marked
  `[update-goldens]` in its message (that is how the recent golden commits read).
- A golden failure uploads visual evidence as the `flutter-visual-failures` CI
  artifact - read it before deciding the code is wrong versus the golden is stale.

## ARB localization parity - update the pinned count when you add a key

Three catalogs must stay in lockstep: `lib/l10n/app_en.arb`, `app_ar.arb`,
`app_ur.arb`. `test/app/localization/arb_key_parity_test.dart` asserts all three
carry the **same exact number of translatable keys** (currently **870**) and
carries a running comment explaining every delta. When you add or remove a key:
change all three ARB files together, then bump the pinned number AND extend that
comment with the arithmetic (`N + k = M` and what the k keys are). A missing
Urdu key is a real gap, not "falls back to English" - supply all three. Never
duplicate a key that already exists under a general name (the comment history
documents retired stopgap keys - do not reintroduce them).

## Generated sources must be current

CI has a "fail if generated output is stale" step. l10n (`flutter gen-l10n`,
output under `lib/l10n/generated/`) and any `build_runner` output are generated -
if you change an ARB or an annotated source, the generated files must be
regenerated and committed. You cannot run the generator here, so when you touch
inputs, say plainly in the PR that generated output needs regenerating in CI/on a
real toolchain, or hand-edit the generated file only if you can produce exactly
what the generator would.

## Platform folders and versioning

`android/` and `ios/` are NOT committed - they are generated artifacts; CI
creates them when absent (see `docs/BOOTSTRAP.md`). Do not hand-fabricate them.
The Android versionCode is set by CI; `pubspec.yaml` `version:` should not be
lowered by hand - the production Play listing already has a version code and Play
rejects a lower one.

## What "done" means here

Author the change, keep Android and iOS compiling, preserve RTL and real back
navigation, add or update a test. Then state honestly that verification happens
in CI (`flutter analyze` + `flutter test` + the platform builds) because it
cannot happen on this machine. Do not report a Flutter change as working on the
strength of it looking finished.
