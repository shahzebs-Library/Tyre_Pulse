# Bootstrap

What a developer with a Flutter SDK runs ONCE to make this project buildable on
a real device. Read `TOOLCHAIN.md` first for why this step is not already done.

## Why android/ and ios/ are not in the repository

They are generated artifacts. An Xcode project in particular is a large
machine-written file, and hand-fabricating one is a reliable way to produce a
project that opens and then fails to build for reasons nobody can trace. The
machine this scaffold was authored on has no Flutter SDK, so `flutter create`
could not be run.

CI works around this: `flutter-ci.yml` generates the platform folders when they
are absent, so the build jobs are green from the first commit. That is a
stopgap, not the destination - a real device build needs them committed.

## The one-time command

From `tyre_pulse_flutter/`:

```
flutter create --platforms=android,ios --org com.shahzebrahman --project-name tyre_pulse .
```

This fills in `android/` and `ios/` without touching `lib/`, `test/`,
`pubspec.yaml` or anything else already present.

Then:

```
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze
flutter test
```

## What must be set immediately afterwards

1. **Application id.** Spec section 69 is explicit: confirm the production
   package id, the Play signing key, the upload key and the current version
   code BEFORE anything is published. Publishing Flutter under a different id
   creates a second, unrelated listing. Do not guess this - read it off the
   Play Console.
2. **minSdkVersion.** The existing Expo app ships minSdk 24. Going higher drops
   devices that are in the field today.
3. **iOS deployment target.** Set it once, in `ios/Podfile` and the Xcode
   project, and keep them equal.
4. **Permission usage strings.** iOS refuses to launch a feature with a missing
   `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` or
   `NSLocationWhenInUseUsageDescription`. Add them when the phase that needs
   them lands, not before.
5. **Supabase credentials.** Passed at compile time, never committed:

   ```
   flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
   ```

   The anon key is publishable by design; RLS is the actual boundary. The
   service-role key must never appear in a mobile binary.

## Dependency versions

Every version in `pubspec.yaml` was read from pub.dev on 2026-08-25, not
recalled from memory:

| Package | Version verified |
|---|---|
| flutter_riverpod | 3.4.2 |
| go_router | 18.0.0 |
| supabase_flutter | 2.17.2 |
| drift | 2.34.3 |
| drift_flutter | 0.3.1 |
| drift_dev | 2.34.5 |
| path_provider | 2.1.6 |
| flutter_secure_storage | 11.0.0 |
| shared_preferences | 2.5.5 |
| connectivity_plus | 7.3.1 |
| workmanager | 0.10.9 |
| sentry_flutter | 9.27.0 |
| uuid | 4.6.0 |
| flutter_lints | 6.0.0 |
| build_runner | 2.16.0 |
| mocktail | 1.0.5 |

Two notes on these:

- **flutter_riverpod is 3.x.** Riverpod 3 changed API surface from 2.x. Any
  tutorial or snippet written for Riverpod 2 will not compile. Check the
  version before copying an example.
- **intl is pinned by the Flutter SDK.** `flutter_localizations` depends on a
  specific `intl`, so `^0.20.2` may be adjusted by pub to match. Let pub win.

Packages for later phases (camera, image compression, mobile_scanner, SVG,
signature capture, PDF, sharing, permission_handler) are deliberately absent
from `pubspec.yaml`. Versions checked on the same day, for when those phases
land: mobile_scanner 7.4.0, signature 6.4.0, permission_handler 13.0.1.

## UNVERIFIED

- The Dart SDK constraint `>=3.6.0 <4.0.0` is a deliberately broad floor rather
  than a measured value. pub.dev did not surface each package's own SDK
  constraint on the pages read. The first CI run settles it: if a dependency
  needs a higher floor, pub says so precisely and the constraint is raised then.
