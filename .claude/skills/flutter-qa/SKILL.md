---
name: flutter-qa
description: Quality gate for the Tyre Pulse Flutter field app (tyre_pulse_flutter/, package com.shahzebrahman.tyrepulse) - analyze, format, tests, goldens, layout overflow, SafeArea/keyboard, text scaling, device sizes, RTL, themes, offline, lifecycle, deep links, duplicate taps. Use for "check Flutter", "Flutter overflow", "RenderFlex", "test the app", or before any Flutter release. Pair with the flutter-app skill for conventions.
---

# Flutter QA

Read `.claude/skills/flutter-app/SKILL.md` first for architecture and conventions. Mobile builds and releases
are owner-only: never trigger `flutter-release-play.yml` or tag a release.

## Toolchain
- CI (`.github/workflows/flutter-ci.yml`) is the source of truth: `flutter pub get` ->
  `dart run build_runner build --delete-conflicting-outputs` -> format check -> `flutter analyze --fatal-infos` ->
  `flutter test --coverage` -> `flutter build apk --debug` / `ios --no-codesign`. Goldens are generated on
  **Windows** CI (`update_goldens` workflow input); Linux runs show ~1-2% font noise - do not regenerate goldens
  on Linux.
- No SDK is preinstalled in the cloud container. It can be downloaded into the session scratchpad
  (Flutter 3.47.x). Run pub get/tests in a **copy** of the tree when other sessions are editing it.
- If a local test run is blocked (e.g. a plugin hook), say so and rely on CI - never claim tests passed.

## Commands (from tyre_pulse_flutter/)
```bash
dart format --output=none --set-exit-if-changed lib test
flutter analyze --fatal-infos
flutter test                       # unit + widget + golden
flutter test integration_test      # only if the directory exists (currently none)
flutter gen-l10n                   # after ARB edits; ARB key parity test must pass
```

## Static search for risky layout (grep lib/, then inspect each hit)
- fixed sizes: `width: \d{3,}`, `height: \d{3,}`, `SizedBox(width: \d{3}`
- `MediaQuery.of(context).size.(width|height) *` used for component sizing
- `Row(` children with long `Text` and no `Expanded`/`Flexible`/`overflow`
- `ListView(` / `GridView(` inside `Column` without `Expanded`/`shrinkWrap` reasoning
- nested `SingleChildScrollView` / scrollables with the same axis
- `Expanded` outside a Flex parent; `Flexible` inside an unbounded axis
- `Text(` without `maxLines`/`overflow` in tight containers
Fix by making the layout adapt (wrap, flex, scroll, `LayoutBuilder`). **Never remove functionality or content to
make an overflow disappear.**

## Runtime checks (widget tests or device)
| Area | Check |
|---|---|
| Overflow | pump each screen at 320x568, 360x640, 375x667 (SE-like), 390x844, 412x915, 430x932, 800x1280 tablet, plus landscape; zero RenderFlex/overflow errors in `tester.takeException()` |
| Text scaling | `textScaler` 1.0, 1.3, 2.0: nothing clipped, tap targets >= 48 dp |
| SafeArea / keyboard | forms scroll above the keyboard (`viewInsets`), bottom nav and FABs not under system bars |
| Navigation | back button/gesture on every screen, dialogs and sheets dismiss, route reuse loads the right record (`didUpdateWidget`), deep links open the right screen, route restoration after process death where supported |
| Themes | light and dark: contrast AA, no hard-coded colors outside the theme (`TpPalette`) |
| Locales | en, ar (RTL), ur: no raw keys, mirroring correct (see localization-rtl) |
| States | loading, empty, error-with-retry, offline (queued work shown), slow network, permission denied (camera, location) |
| Duplicate taps | submit buttons disable while pending; offline queue idempotent (`client_uuid`) |
| Lifecycle | resume re-reads access/approval queues; rotation keeps form state |
| API retry | reads retry, writes do not double-submit; server errors mapped to plain messages |
| Access | modules gated by `module_registry.dart` + grants loaded at sign-in/resume, matching the web Access Manager |

## Pass / fail
PASS only when format, analyze and tests pass (locally or on CI for the exact commit), the overflow sweep is
clean for every changed screen at every listed size, and the runtime table has evidence for the touched areas.
Anything not run is reported as NOT RUN with the reason.
