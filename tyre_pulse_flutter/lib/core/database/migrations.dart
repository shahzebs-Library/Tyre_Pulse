/// The local migration ladder.
///
/// **A schema change NEVER wipes local data.** Spec section 61 states it and
/// AGENTS.md rule 11 repeats it. The reason is not tidiness: the queue table,
/// the two draft tables and both media tables hold work that exists NOWHERE
/// ELSE. A field worker's unsynced inspection is the only copy of it in the
/// world, and `deleteDatabase()` on a version mismatch - a common Drift starter
/// pattern - destroys it silently on upgrade day, at scale, across a fleet.
///
/// This file therefore contains no delete, no drop and no recreate-on-failure
/// fallback, and [migrationPlan] refuses rather than improvises whenever it
/// cannot see a safe path. A destructive step is permitted for `cached_*`
/// tables only, because those are a copy of server data and can be refetched -
/// and even there it is a truncate plus a reset of the matching
/// `sync_metadata` timestamp, never a drop, with a re-syncing state shown to
/// the user rather than an empty picker.
///
/// Two further rules bind anyone adding a step:
///
/// 1. **A step must never call generated Dart mappers.** It uses the `Migrator`
///    and raw SQL for its own version. A mapper compiled against today's Dart
///    class does not match the table a device is actually carrying, and the
///    failure surfaces as corrupt data rather than a compile error.
/// 2. **Downgrade is refused, not attempted.** If the version on disk is
///    greater than this build's, the app must not touch a byte. An older binary
///    writing to a newer schema is how a rolled-back device signs the user out
///    and then reads a full offline queue as empty.
library;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

/// One rung of the ladder. Receives the migrator for the version it upgrades
/// FROM.
typedef MigrationStep = Future<void> Function(Migrator m);

/// The ladder, keyed by the version each step upgrades FROM.
///
/// Version 1 ships with every table in artifact 05, so this map is empty today.
/// That is deliberate: adding a table later is cheap, while shipping a partial
/// schema and then migrating a device that already holds unsynced work is where
/// migrations go wrong.
///
/// To add version 2, write a top-level function and register it here:
///
/// ```dart
/// Future<void> _from1To2(Migrator m) async {
///   // Additive only. `m.addColumn`, `m.createTable`, `m.createIndex`.
///   // Never `deleteFrom`, never drop-and-recreate.
/// }
///
/// const Map<int, MigrationStep> migrationSteps = <int, MigrationStep>{
///   1: _from1To2,
/// };
/// ```
///
/// Then bump `AppDatabase.latestSchemaVersion` to 2 and add a migration test
/// that seeds a version 1 database with unsynced work and asserts every row and
/// every payload survives. A migration test that only checks the schema is not
/// a migration test: it passes while every field worker's queue is emptied.
const Map<int, MigrationStep> migrationSteps = <int, MigrationStep>{
  // 1: _from1To2,
};

/// Resolves the ordered steps needed to move a database from [from] to [to].
///
/// Pure and total: it either returns the exact list of steps to run, in order,
/// or it throws. It never returns a partial plan and it never falls back to
/// recreating anything, because both of those lose data.
///
/// Throws an [AppError] when:
///
/// - [from] is greater than [to]. The database on disk was written by a newer
///   build. Refuse and let the caller tell the user, rather than writing an old
///   shape over new data.
/// - a rung is missing. A gap means the ladder cannot be walked, and skipping a
///   version silently applies version N+2's assumptions to version N's data.
List<MigrationStep> migrationPlan({
  required int from,
  required int to,
  Map<int, MigrationStep> steps = migrationSteps,
}) {
  if (from > to) {
    throw AppError(
      kind: AppErrorKind.storage,
      message:
          'This device holds data saved by a newer version of the app. '
          'Update the app to open it. Nothing on this device has been '
          'changed.',
      technical: 'local schema downgrade refused: onDisk=$from appSupports=$to',
    );
  }

  final List<MigrationStep> plan = <MigrationStep>[];
  for (int version = from; version < to; version++) {
    final MigrationStep? step = steps[version];
    if (step == null) {
      throw AppError(
        kind: AppErrorKind.storage,
        message:
            'This app cannot upgrade the data already on this device. '
            'Nothing has been changed or deleted. Contact your administrator '
            'before reinstalling.',
        technical:
            'missing migration step from version $version '
            '(walking $from to $to)',
      );
    }
    plan.add(step);
  }
  return plan;
}

/// Executes [migrationPlan] one rung at a time.
///
/// Every step runs inside the migration transaction Drift already opened, so a
/// step that throws rolls the whole upgrade back and leaves the database
/// openable at its previous version with its rows intact.
Future<void> runMigrationLadder(
  Migrator m, {
  required int from,
  required int to,
  Map<int, MigrationStep> steps = migrationSteps,
}) async {
  final List<MigrationStep> plan = migrationPlan(
    from: from,
    to: to,
    steps: steps,
  );
  for (final MigrationStep step in plan) {
    await step(m);
  }
}
