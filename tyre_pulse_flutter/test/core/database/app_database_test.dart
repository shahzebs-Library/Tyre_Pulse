import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';

import 'database_test_support.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = newMemoryDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  group('schema', () {
    test('opens at the current version', () async {
      expect(db.schemaVersion, AppDatabase.latestSchemaVersion);

      final QueryRow row = await db
          .customSelect('PRAGMA user_version')
          .getSingle();
      expect(row.read<int>('user_version'), AppDatabase.latestSchemaVersion);
    });

    test('creates every table artifact 05 specifies', () async {
      final List<QueryRow> rows = await db
          .customSelect("SELECT name FROM sqlite_master WHERE type = 'table'")
          .get();
      final Set<String> names = rows
          .map((QueryRow r) => r.read<String>('name'))
          .toSet();

      // The 12 from spec section 11, with `pending_uploads` renamed to
      // `pending_media_uploads` because the former is a real REMOTE table, plus
      // the 5 the source proves are also needed.
      const List<String> expected = <String>[
        'workspace_scope',
        'cached_users',
        'cached_sites',
        'cached_assets',
        'cached_tyres',
        'cached_checklist_templates',
        'cached_permissions',
        'inspection_drafts',
        'inspection_draft_positions',
        'checklist_drafts',
        'draft_photos',
        'captured_signatures',
        'pending_commands',
        'pending_media_uploads',
        'sync_failures',
        'sync_metadata',
        'recent_searches',
      ];
      expect(expected, hasLength(17));
      for (final String table in expected) {
        expect(names, contains(table), reason: '$table is missing');
      }

      // The local table must NOT be called `pending_uploads`: that name belongs
      // to a real remote table with its own approve/reject RPCs, and two
      // meanings for one name is how the previous rebuild drifted.
      expect(names, isNot(contains('pending_uploads')));
    });

    test('records when the ladder last ran', () async {
      // Forces the connection to open, which is when beforeOpen runs.
      await db.queueDao.pendingCount();

      final entry = await db.cacheDao.readMetadata(
        SyncMetadataKeys.schemaMigratedAt,
      );
      expect(entry, isNotNull);
      expect(DateTime.tryParse(entry!.valueJson), isNotNull);
    });
  });

  group('foreign keys', () {
    test('are enabled on every connection', () async {
      final QueryRow row = await db
          .customSelect('PRAGMA foreign_keys')
          .getSingle();
      expect(
        row.read<int>('foreign_keys'),
        1,
        reason:
            'without this pragma the RESTRICT that protects an unconfirmed '
            'photo from its own pruner does nothing at all',
      );
    });

    test(
      'RESTRICT refuses to delete a command that still holds a photo',
      () async {
        await seedCommand(
          db,
          id: 'cmd-1',
          attachments: <QueuedMediaAttachment>[queuedPhoto('q_1.jpg')],
        );

        await expectLater(
          (db.delete(
            db.pendingCommands,
          )..where((t) => t.id.equals('cmd-1'))).go(),
          throwsA(isA<Exception>()),
        );

        // The command survived, so the photo's only reference survived with it.
        expect(await db.queueDao.commandById('cmd-1'), isNotNull);
      },
    );

    test('a draft position cascades when its draft is deleted', () async {
      await db.draftsDao.saveInspectionDraft(
        userId: testUser,
        workspaceId: workspaceA,
        assetNo: 'TM514',
        filled: 1,
        total: 13,
        now: testNow,
      );
      final String key = DraftsDao.inspectionDraftKey(
        userId: testUser,
        assetNo: 'TM514',
      );
      await db.draftsDao.saveInspectionPosition(
        draftKey: key,
        position: 'LHF1',
        now: testNow,
        condition: 'Good',
      );
      expect(await db.draftsDao.inspectionPositions(key), hasLength(1));

      await db.draftsDao.discardInspectionDraft(key);

      expect(await db.draftsDao.inspectionPositions(key), isEmpty);
    });
  });
}
