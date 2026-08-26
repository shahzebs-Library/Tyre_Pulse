# Tyre Pulse - Flutter mobile app

One Flutter codebase for Android and iOS, replacing the Expo/React Native app in
`mobile/`. The web application stays React and Next.js and is not in scope.

## Read before writing code

| File | Why |
|---|---|
| `AGENTS.md` | The 15 rules. Non-negotiable. |
| `docs/TOOLCHAIN.md` | Nothing is verifiable on the current dev machine. CI is the boundary. |
| `docs/BOOTSTRAP.md` | The one-time `flutter create` that generates `android/` and `ios/`. |
| `../docs/flutter-migration/` | The nine audit artifacts. These are the contract. |
| `../docs/Tyre Pulse Flutter Mobile Master Architecture and Migration Specification.md` | The governing spec, 75 sections. |

Start with `../docs/flutter-migration/09-migration-matrix.md`. It sequences the
work into phases and lists the decisions that block each one.

## The one rule that matters most

**There is no application server.** Every backend call is PostgREST on a real
table, an existing Postgres RPC, or an existing Supabase Edge Function. The
previous native rebuild failed largely because it invented REST endpoints that
do not exist. If you cannot point at the migration that creates an object, you
may not call it.

`../docs/flutter-migration/02-backend-table-rpc-map.md` is the real surface.

## Layering

```
Presentation -> Application/Domain -> Repository -> Local + Remote data sources
```

No Supabase call in a widget. No SQL in a screen. No permission logic in a
button. No tyre business rule in UI code. DTOs stay separate from domain models
so a column rename does not spread into the UI.

## Structure

```
lib/
  app/        entry, config, router, theme, localisation
  core/       auth, database, sync, storage, permissions, workspace,
              errors, design_system, telemetry
  features/   one package per feature, each with data/ domain/ presentation/
  shared/     models, widgets, extensions, utilities
```

## Running it

You need a Flutter SDK. The machine this was authored on does not have one, so
follow `docs/BOOTSTRAP.md` first to generate the platform folders.

```
flutter pub get
dart run build_runner build --delete-conflicting-outputs
flutter analyze
flutter test
flutter run --dart-define=SUPABASE_URL=... --dart-define=SUPABASE_ANON_KEY=...
```

Credentials are compile-time only and never committed. The anon key is
publishable by design; RLS is the real boundary. A service-role key must never
reach a mobile binary, and the config layer refuses one.

Without those defines the app does not crash and does not show a blank screen -
it renders a page explaining which define is missing. That behaviour is
deliberate and tested.

## Generated code

`*.g.dart` is COMMITTED, not ignored. Most contributors have no local SDK, so a
reviewer cannot regenerate a file to read its diff. CI regenerates and fails if
a committed copy is stale.

## Verification

`.github/workflows/flutter-ci.yml` runs analyze, tests, an Android build and an
**iOS build** on every change. iOS is a day-one target (spec section 56), not a
later phase, so an iOS-breaking change fails on the commit that causes it.

Nothing is "working" until that run is green.
