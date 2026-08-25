# Toolchain and verification boundary

Measured on the development machine on 2026-08-25, not assumed.

## What is installed

| Tool | Status | Checked by |
|---|---|---|
| Node | v26.7.0 | `node -v` |
| Flutter SDK | NOT INSTALLED | `which flutter` -> not found; no `C:\flutter`, `C:\src\flutter`, `%LOCALAPPDATA%\flutter`, `Program Files\flutter` |
| Dart SDK | NOT INSTALLED | `which dart` -> not found |
| Java / JDK | NOT INSTALLED | `java -version` -> command not found |
| Android SDK | NOT INSTALLED | no `Program Files\Android`, no `%LOCALAPPDATA%\Android` |
| macOS / Xcode | NOT AVAILABLE | host OS is Windows 11 |

## What this means, stated plainly

Nothing in this Flutter project can be compiled, analysed, tested or run on this
machine as it stands. Source can be authored here; it cannot be verified here.

iOS can never be built here regardless of what is installed, because Apple
toolchains require macOS. That is not a gap to close locally.

Spec rule 12 is "never claim a feature works without a test or a build". With no
local toolchain, any claim that Flutter code works is unverifiable until it runs
somewhere real. So the verification boundary moves to CI.

## The two ways to close this

### Option A - CI is the verification boundary (no local install needed)

GitHub Actions runs everything:

- `ubuntu-latest` + `subosito/flutter-action` -> `flutter pub get`,
  `flutter analyze`, `flutter test`, `flutter build apk --debug`
- `macos-latest` -> `flutter build ios --no-codesign`

Every push is verified by a machine that has the SDK. The developer machine
never needs one. This is the fastest path and it is the honest one: a green CI
run is evidence, a local opinion is not.

Cost: a slower feedback loop (minutes per push rather than seconds).

### Option B - install the toolchain locally as well

To build and run on a real Android phone from this machine:

1. Flutter SDK (stable channel)
2. JDK 17
3. Android SDK command-line tools + platform tools + a build-tools version
4. `flutter doctor` clean for the Android toolchain

iOS still needs a Mac, or a macOS CI runner, or a Mac build service.

Option A is required either way, because iOS has no local path. Option B only
shortens the Android loop.

## Recommendation

Set up Option A first so that every commit is verified from day one, and treat
Option B as a convenience to add whenever the owner wants a device build loop on
this machine.

Until CI exists, any Flutter source committed here is UNVERIFIED and must be
described that way.
