---
name: native-android
description: Work on the native Kotlin/Compose Android app in tyre_pulse_app/ (package com.shahzebrahman.tyrepulse.native). Use this skill for ANY change under tyre_pulse_app/ - adding or editing a screen, ViewModel, repository, Hilt module, Gradle config or workflow; fixing a compile error; bumping a version; or preparing a Play release. Use it whenever the user says the native app, the Kotlin app, the Android app, gradle, Compose, Hilt, KSP, AGP, "the build is failing", "unresolved reference", "it does not compile", or asks to run or build the Android app. Also use it when a task mentions the app under tyre_pulse_app even indirectly - "the new android app", "the native one", "tyre_pulse_app". Do NOT use it for the Expo/React Native app under mobile/, which is a different app and is read-only from here.
---

# Tyre Pulse native Android

`tyre_pulse_app/` is a native Kotlin + Jetpack Compose app: Hilt, Room, Retrofit,
DataStore, WorkManager, Paging 3, ~255 Kotlin files. It ships to Google Play as
`com.shahzebrahman.tyrepulse.native` on the **internal** track, separate from the
Expo app.

Read `tyre_pulse_app/AGENTS.md` and `tyre_pulse_app/docs/NEXT_WORK.md` first. They
are the project's own contract and its current state; both override anything here.

## The single most important fact

**There is no JDK and no Android SDK on this machine.** `./gradlew` cannot run,
`java` does not exist, there is no emulator and no device. Verify before assuming
otherwise:

```bash
java -version 2>&1 | head -1      # command not found
```

The consequence drives everything else: **GitHub Actions is the only compiler**.
Every guess you push costs a full CI run to learn one error. The repository's history
is a run of exactly that - `fix: add missing clickable import`, `fix: resolve
HomeScreen compile errors`, `fix: provide ChecklistApi in NetworkModule` - each one
commit, each one CI run, each one error.

Do not add to that pile. Verify statically first.

## Before you push: run all three checkers

```bash
cd tyre_pulse_app
node tools/check-kotlin-symbols.mjs   # missing imports, incl. Compose/OkHttp extensions
node tools/check-hilt-graph.mjs       # unsatisfied @Inject bindings, and DI cycles
node tools/check-navigation.mjs       # routes that crash, and unreachable screens
node tools/check-call-arity.mjs        # call sites missing a required argument
node tools/check-experimental-optin.mjs # experimental Compose API without @OptIn
```

All three are mutation-tested and each found a real defect the first time it ran.

Exit 0 means what each tool says it means - **no missing imports**, **no unsatisfied
binding**, **no unregistered route**. None of them is a type checker, so none of them
means "this compiles". Report it that way.

If a checker reports nothing on a change you know is broken, **check your mutation
before you trust the tool**. That is how a real gap was found: the symbol checker was
blind to lowercase extension functions and was handing out meaningless green lights.
The Hilt checker had two more - a 400-character window let an earlier `data class`
bridge to a later class's `@Inject constructor` and steal its identity, and cycles
through module `@Provides` were invisible until their parameters were modelled.

## No fabricated data, ever

The worst defects in this codebase were not crashes. They were screens presenting
invented records as real: a Home dashboard with hard-coded KPIs, work orders and
approvals and stock and team all returning made-up rows, and a checklist signature
saved as the literal string `signature_data_url_mock_<timestamp>`. People act on that.

An empty list is honest. An error is honest. An invention is neither.

When a number cannot be measured, model it as `null` and render it as a dash - never
as `0`, which reads as a fact, and never as a placeholder that looks like data. When a
read fails, say so; do not substitute an empty result, because "nothing to approve"
and "we could not check" are opposite statements.

## The API layer is PostgREST, not a bespoke REST backend

Tables are served at `/rest/v1/<table>`, filters are query parameters, and there are
no nested resource routes. Paths shaped like `workshop/jobs/{id}/start`,
`tasks/{id}/status` or `notifications/{id}/read` cannot work, and several declared
tables do not exist at all (`approvals`, `workshop_events`, `tyre_history`,
`replacements`, `lookup_reasons`). Check the schema before adding an endpoint -
`docs/NEXT_WORK.md` section 1 has the full inventory.

`WorkshopApi.getWorkOrdersRows` plus `WorkOrderDto` is the correct pattern to copy:
a DTO whose fields match the real columns, all nullable, with a `SELECT` constant kept
in step with them, and tolerant folding of free-text status values onto the domain
enum.

Auth and Storage are **not** under `/rest/v1/` - each needs its own Retrofit built on
`SUPABASE_URL`, as `provideAuthApi` and `provideStorageApi` do.

## Toolchain: the versions must agree

They did not, for weeks: AGP 8.7.0 against Gradle 9.4.1 cannot configure, so the build
never reached the Kotlin compiler. Current set, chosen from the published matrices:

| Piece | Version | Constraint |
|---|---|---|
| AGP | 8.11.1 | max compileSdk **36**; needs Gradle 8.13 |
| Gradle | 8.13 | AGP 8.11's minimum and default |
| Kotlin | 2.2.21 | Gradle to 8.14, AGP to exactly 8.11.1 |
| KSP | 2.2.21-2.0.5 | must track Kotlin exactly |
| Room | 2.8.4 | 2.6.1 predates KSP2 |
| Hilt | 2.57.2 | KSP2 / Kotlin 2.2 |
| compileSdk / targetSdk | 36 | Play requires 36 from 31 Aug 2026 |

Before changing `agp`, `kotlin`, `ksp`, `room`, `hilt` or `composeBom` in
`gradle/libs.versions.toml`, or `distributionUrl` in
`gradle/wrapper/gradle-wrapper.properties`, check the pair against the release notes
rather than picking a newer number. Bumping one alone is how this broke: AGP was
dropped 8.13.2 to 8.7.0 inside an unrelated port commit while the wrapper stayed on
Gradle 9.

**Compose BOM is deliberately held at 2024.09.02.** The screens were only just
repaired for Material3 1.3.0's `PullToRefreshBox`; move it separately, once there is a
green build to compare against.

## House rules from AGENTS.md

- `mobile/` (the Expo app) is **READ ONLY**. Inspect it for business logic and
  workflows; never edit it from native-app work.
- **Never restart completed work.** Read `docs/IMPLEMENTATION_STATUS.md`, then inspect
  the code, then continue only what is missing or broken. That document is a claim,
  not evidence - it declared the app "100% feature-complete" while
  `TokenManager.refreshToken()` was a stub returning `null` and five modules were
  serving invented data. It now carries corrections at the top.
- Source-of-truth order: backend/business logic > web implementation > `mobile/`
  implementation > current native code.
- Multi-tenant always: Tenant -> Company -> Country -> Project/Site. Never assume one
  global role or scope.
- CI/CD already exists. Do not trigger builds for release purposes unless asked.
  **Bump `versionCode` and `versionName` in `app/build.gradle.kts` before pushing a
  `native-v*` tag** - the tag is what triggers `build-native-android.yml`.

## Error classes this codebase actually hits

**Missing Compose import.** The symbol checker catches it and names the exact import.

**Hilt graph.** A new `@Inject` constructor parameter needs a binding; a new Retrofit
API interface needs a `@Provides` in `NetworkModule`. KSP reports it only at build
time - `check-hilt-graph.mjs` reports it now.

**Hilt dependency cycles.** `AuthApi -> OkHttpClient -> AuthInterceptor ->
TokenManager` already exists, so injecting `AuthApi` into `TokenManager` closes it and
fails the build. Break it with a bare `OkHttpClient` (what `refreshToken` does) or
`Provider`/`Lazy`.

**Deleted routes left wired.** A `navigate()` to an unregistered route is a runtime
crash that nothing else catches. Tapping a tyre on the Inspection Form crashed the app
this way for exactly that reason.

**Regex mass-refactors.** `refactor.py`, `refactor.ps1` and `ensure_imports.ps1` at
the project root are what stripped imports across many screens in the first place.
Prefer targeted edits; if a sweep is unavoidable, run the checkers after it and read
the diff.

## Where things are

```
tyre_pulse_app/
  app/build.gradle.kts        flavors dev|prod, signing, R8, SDK levels
  gradle/libs.versions.toml   the version catalog - the coupling above lives here
  tools/                      check-kotlin-symbols, check-hilt-graph, check-navigation
  docs/NEXT_WORK.md           what is actually left, with evidence
  docs/IMPLEMENTATION_STATUS.md   claims, now annotated with corrections
  app/src/main/java/com/example/tyre_pulse_app/
    core/       authentication, network (api/, dto/, di/), designsystem, model
    feature/    one package per module, each ui/ + data/
```

Note the mismatch, and do not "fix" it casually: the Kotlin package is
`com.example.tyre_pulse_app` while the applicationId is
`com.shahzebrahman.tyrepulse.native`. Renaming the package touches every file and the
Hilt/KSP generated code.

## Reporting

Because you cannot build, be exact about what you verified:

- "The checkers report no missing imports, no unsatisfied bindings and no unregistered
  routes" - true and useful.
- "This compiles" - you cannot know that. Do not say it.
- "This works on a device" - you cannot know that either.

State which findings are measured, which come from documentation, and which are
unverified because no JDK exists here.
