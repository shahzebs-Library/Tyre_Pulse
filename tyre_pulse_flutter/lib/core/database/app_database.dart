/// The local Drift database.
///
/// Seventeen tables, from artifact 05. Twelve are named by spec section 11 -
/// one of them renamed for a collision with a real remote table - and five more
/// exist because the source proves they are needed.
///
/// Everything in here is either a copy of server data that can be refetched, or
/// work that exists NOWHERE ELSE. Telling those two apart is the whole job of
/// this file's migration strategy.
library;

import 'package:drift/drift.dart';
import 'package:drift_flutter/drift_flutter.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/migrations.dart';
import 'package:tyre_pulse/core/database/tables/cache_tables.dart';
import 'package:tyre_pulse/core/database/tables/draft_tables.dart';
import 'package:tyre_pulse/core/database/tables/queue_tables.dart';
import 'package:tyre_pulse/core/database/tables/sync_tables.dart';
import 'package:tyre_pulse/core/database/tables/workspace_tables.dart';

part 'app_database.g.dart';

/// The file name of the on-device database. Changing it strands every existing
/// device's unsynced work in a file nothing opens, so it is a constant rather
/// than a call-site literal.
const String tyrePulseDatabaseName = 'tyre_pulse';

/// Opens the real on-device database.
///
/// Test code does NOT use this: a test passes `NativeDatabase.memory()` or a
/// temporary file straight to the [AppDatabase] constructor, so no platform
/// plugin is needed to run the suite.
QueryExecutor openTyrePulseDatabase() =>
    driftDatabase(name: tyrePulseDatabaseName);

@DriftDatabase(
  tables: <Type>[
    WorkspaceScopes,
    CachedUsers,
    CachedSites,
    CachedAssets,
    CachedTyres,
    CachedChecklistTemplates,
    CachedPermissions,
    InspectionDrafts,
    InspectionDraftPositions,
    ChecklistDrafts,
    DraftPhotos,
    CapturedSignatures,
    PendingCommands,
    PendingMediaUploads,
    SyncFailures,
    SyncMetadata,
    RecentSearches,
  ],
  daos: <Type>[QueueDao, DraftsDao, MediaDao, CacheDao],
)
class AppDatabase extends _$AppDatabase {
  AppDatabase(super.e)
      : _schemaVersion = latestSchemaVersion,
        _steps = migrationSteps;

  /// A seam for migration tests ONLY.
  ///
  /// Drift's own step-by-step helper is generated from committed schema
  /// snapshots, which this project cannot produce until CI runs the generator.
  /// Until then a migration test needs some way to open the SAME database file
  /// at two different versions, and this is it. Nothing outside
  /// `test/core/database/` may call it.
  AppDatabase.forMigrationTest(
    super.e, {
    required int schemaVersion,
    required Map<int, MigrationStep> steps,
  })  : _schemaVersion = schemaVersion,
        _steps = steps;

  /// The version this build of the app understands.
  ///
  /// **A schema change NEVER wipes local data.** Spec section 61 and AGENTS.md
  /// rule 11. `pending_commands`, the two draft tables and both media tables
  /// hold work that exists nowhere else - a field worker's unsynced inspection
  /// is the only copy of it in the world - so a `deleteDatabase()` on version
  /// mismatch destroys it silently on upgrade day, at scale, across a fleet.
  ///
  /// To raise this: add a step to `migrationSteps` in `migrations.dart`, bump
  /// this number by exactly one, and add a migration test that seeds the
  /// PREVIOUS version with unsynced work and asserts every row and every
  /// payload survives. A migration test that only checks the schema is not a
  /// migration test: it passes while every field worker's queue is emptied.
  ///
  /// Version 1 deliberately ships with every table in artifact 05. Adding a
  /// table later is cheap; shipping a partial schema and then migrating a
  /// device that already holds unsynced work is where migrations go wrong.
  static const int latestSchemaVersion = 1;

  final int _schemaVersion;
  final Map<int, MigrationStep> _steps;

  @override
  int get schemaVersion => _schemaVersion;

  @override
  MigrationStrategy get migration => MigrationStrategy(
        onCreate: (Migrator m) async {
          await m.createAll();
        },
        onUpgrade: (Migrator m, int from, int to) async {
          // An explicit ladder. Every rung is walked in order, a gap refuses
          // rather than skips, and a downgrade refuses rather than writing an
          // old shape over newer data. There is no recreate-on-failure
          // fallback anywhere in this path, because that fallback is the thing
          // that eats a technician's queue.
          await runMigrationLadder(m, from: from, to: to, steps: _steps);
        },
        beforeOpen: (OpeningDetails details) async {
          // NOT optional. SQLite disables foreign keys per connection by
          // default, and without this the ON DELETE RESTRICT that stops the
          // pruner deleting a command whose photo has not been confirmed does
          // nothing at all, while every cascade silently leaves orphan rows.
          await customStatement('PRAGMA foreign_keys = ON');

          if (details.wasCreated || details.hadUpgrade) {
            final DateTime now = DateTime.now().toUtc();
            await into(syncMetadata).insertOnConflictUpdate(
              SyncMetadataCompanion.insert(
                key: SyncMetadataKeys.schemaMigratedAt,
                valueJson: now.toIso8601String(),
                updatedAt: now,
              ),
            );
          }
        },
      );
}
