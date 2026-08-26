# AGENTS.md - Tyre Pulse Flutter

Rules for any coding agent or engineer working in `tyre_pulse_flutter/`.
Mandated by section 71 of
`docs/Tyre Pulse Flutter Mobile Master Architecture and Migration Specification.md`.

Read that spec before writing code. Read the audit artifacts in
`docs/flutter-migration/` before touching a feature. They are the contract.

---

## The 15 rules (spec section 71, verbatim intent)

1. Never fabricate fleet data.
2. Never invent Supabase tables.
3. Never invent backend endpoints.
4. Never hard-code KPIs.
5. Never silently swallow errors.
6. Never replace real data with sample data on failure.
7. Never implement a control that does nothing.
8. Never bypass permission checks.
9. Never remove offline persistence for convenience.
10. Never change tyre position IDs.
11. Never alter database schema without explicit migration.
12. Never claim a feature works without a test or a build.
13. Keep Android and iOS compiling.
14. Preserve RTL.
15. Preserve actual back navigation.

---

## Rule 3 is the one that killed the last rebuild

There is no application server. Read
`docs/flutter-migration/02-backend-table-rpc-map.md` before any repository work.

The Kotlin rebuild declared Retrofit endpoints for `/approvals`, `/tasks`,
`/replacements`, `/workshop/jobs` and `/notifications/{id}/read`. None of them
exist. Every call in Flutter is one of exactly three things:

- PostgREST on a real table
- a Postgres RPC that already exists
- a Supabase Edge Function that already exists

If you cannot point at the migration file that creates the object, you may not
call it. Add it to the artifact as UNVERIFIED and stop.

---

## Source of truth, in order

1. The real Supabase schema (`MIGRATIONS_V*.sql` at repo root, and the live DB)
2. Working React Native production behaviour under `mobile/`
3. Verified business logic and tests under `mobile/__tests__/`
4. Corrected architecture from `tyre_pulse_app/` (Kotlin) - findings only, not code
5. New Flutter implementation

`mobile/` and `tyre_pulse_app/` are READ-ONLY reference material. Never edit
them from this project. They are frozen source, not shared code.

---

## Seven files no agent may edit, under any circumstance

Everything else in `lib/` is normal application code: read it, extend it,
refactor it, fix it. These seven are the wiring every feature plugs into, and
an agent changing their logic - even with good intentions - can silently
break a guarantee every other file in the tree depends on:

- `lib/app/router/routes.dart`
- `lib/app/router/app_router.dart`
- `lib/app/router/route_access.dart`
- `lib/app/router/shell_tabs.dart`
- `lib/core/sync/command_registry.dart`
- `lib/core/sync/queued_command_repository.dart`
- `lib/core/sync/sync_engine.dart`

This is a stronger rule than "be careful": it applies even to a change that
looks purely mechanical, such as automated formatting or a codemod. If one of
these seven needs a real change, a human makes it.

---

## Before implementing any repository (spec section 62)

1. inspect the actual Supabase table or RPC
2. verify columns
3. verify types
4. verify nullable values
5. verify RLS
6. verify relationships
7. create DTO
8. create mapper
9. create repository
10. create tests

Never guess a column type. The Kotlin app treated `profiles.country` as a String
when the database stores an array, and that broke login for most users.

---

## Layering

```
Presentation -> Application/Domain -> Repository -> Local + Remote data sources
```

- No Supabase call inside a widget.
- No SQL inside a screen.
- No permission logic inside a button.
- No tyre business rule inside UI code.

DTOs stay separate from domain models so a column rename does not spread through
the UI.

---

## Offline is not optional

Field sites have no signal. Every write path is either queued through the
command queue or explicitly declared online-only with a reason.

- Read `docs/flutter-migration/06-offline-command-registry.md` first.
- One registry owns table names. Do not scatter them.
- Every queued command carries a field allow-list. A column PostgREST cannot
  find fails the whole request.
- Every queued insert is idempotent on a stable client-generated id, unless the
  target is an append-only log with no `client_uuid` column.
- Approvals and other decisions that depend on current server state are NOT
  blindly queued (spec section 14).
- Never delete a local photo before the server confirms the upload.
- A local schema change never wipes local data. Unsynced work is the only copy.

---

## States are not all the same thing

Loading, empty, offline-cached, permission-denied, backend-unavailable,
not-configured and error are seven different states with seven different
renderings. A spinner is none of them.

The production test `deniedIsNotASpinner` exists because this was got wrong
once. Keep the principle.

Where zero would falsely imply a measurement, render `-` or `Unavailable`, not
`0`.

---

## Verification

Nothing is done because it looks finished. See spec section 72. A change is not
claimed as working until `flutter analyze` and `flutter test` pass in CI, and
the affected platform builds.

The development machine currently has no Flutter SDK, no Android SDK and no
macOS. See `docs/TOOLCHAIN.md`. CI is the verification boundary, not local
opinion.
