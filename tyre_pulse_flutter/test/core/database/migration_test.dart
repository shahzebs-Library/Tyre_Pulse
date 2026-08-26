/// Migration tests. Spec section 61 makes these mandatory, and artifact 05
/// section 7.3 says why: a migration test that only checks the SCHEMA is not a
/// migration test - it passes while every field worker's queue is emptied.
///
/// So the assertion that matters here is not "the tables still exist". It is
/// "the unsynced command, its photo, its draft, its draft photo and its
/// signature all survived, with their payloads byte-identical".
library;

import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/migrations.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

import 'database_test_support.dart';

/// A deliberately ADDITIVE step, of the shape every real step must have.
///
/// It uses raw SQL against the version it upgrades FROM. A step must never call
/// a generated Dart mapper: a mapper compiled against today's class does not
/// match the table a device is actually carrying, and the failure surfaces as
/// corrupt data rather than as a compile error.
Future<void> addProbeColumn(Migrator m) async {
  await m.issueCustomQuery(
    'ALTER TABLE pending_commands ADD COLUMN migration_probe TEXT',
  );
}

/// The kind of step this project forbids, used only to prove the preservation
/// assertion is not vacuous.
///
/// It targets `checklist_drafts` rather than `pending_commands` because that
/// table has no incoming foreign key, so the delete succeeds whether or not
/// SQLite is enforcing keys during a migration. The destruction is then
/// unconditional, which is exactly what makes it a fair control.
Future<void> wipeTheDrafts(Migrator m) async {
  await m.issueCustomQuery('DELETE FROM checklist_drafts');
}

/// The ladder computes its whole plan before running a single step, so a
/// refusal happens before any write. That is asserted below, not assumed.
Matcher refusesTheUpgrade() {
  return throwsA(
    predicate<Object>(
      (Object e) =>
          e is AppError || e.toString().contains('missing migration step'),
      'refuses the upgrade with the ladder own error',
    ),
  );
}

void main() {
  group('migrationPlan', () {
    test('has nothing to do when the versions match', () {
      expect(
        migrationPlan(from: 3, to: 3, steps: <int, MigrationStep>{}),
        isEmpty,
      );
    });

    test('walks every rung in order and skips none', () {
      final calls = <String>[];
      Future<void> one(Migrator m) async {
        calls.add('1to2');
      }

      Future<void> two(Migrator m) async {
        calls.add('2to3');
      }

      Future<void> three(Migrator m) async {
        calls.add('3to4');
      }

      final List<MigrationStep> plan = migrationPlan(
        from: 1,
        to: 4,
        steps: <int, MigrationStep>{1: one, 2: two, 3: three},
      );

      expect(plan, hasLength(3));
      expect(identical(plan[0], one), isTrue);
      expect(identical(plan[1], two), isTrue);
      expect(identical(plan[2], three), isTrue);
      expect(calls, isEmpty, reason: 'planning must not execute anything');
    });

    test('refuses a gap rather than skipping a version', () {
      Future<void> one(Migrator m) async {}

      expect(
        () =>
            migrationPlan(from: 1, to: 3, steps: <int, MigrationStep>{1: one}),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.storage,
          ),
        ),
      );
    });

    test(
      'refuses a downgrade rather than writing an old shape over new data',
      () {
        expect(
          () => migrationPlan(from: 4, to: 2, steps: <int, MigrationStep>{}),
          throwsA(
            isA<AppError>().having(
              (AppError e) => e.technical,
              'technical',
              contains('downgrade refused'),
            ),
          ),
        );
      },
    );

    test('the refusal message is safe to show a person', () {
      try {
        migrationPlan(from: 4, to: 2, steps: <int, MigrationStep>{});
        fail('expected a refusal');
      } on AppError catch (e) {
        // Spec section 57: the person sees a sentence they can act on, and the
        // technical detail goes to telemetry.
        expect(e.message, isNot(contains('schema')));
        expect(e.message, isNot(contains('SQL')));
        expect(e.message.toLowerCase(), contains('newer version'));
        expect(e.technical, isNotNull);
      }
    });

    test(
      'the shipped ladder is empty because version 1 carries every table',
      () {
        expect(AppDatabase.latestSchemaVersion, 1);
        expect(migrationSteps, isEmpty);
      },
    );
  });

  group('upgrading a device that holds unsynced work', () {
    late Directory tempDir;
    late File dbFile;

    setUp(() {
      tempDir = Directory.systemTemp.createTempSync('tyre_pulse_migration');
      dbFile = File('${tempDir.path}/app.sqlite');
    });

    tearDown(() {
      if (tempDir.existsSync()) {
        tempDir.deleteSync(recursive: true);
      }
    });

    const String draftKey = '$testUser|tpl-1|TM514';

    /// Seeds a version 1 database with work that exists nowhere else, then
    /// closes it so the next open sees an existing installation.
    Future<void> seedVersionOne() async {
      final AppDatabase db = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 1,
        steps: const <int, MigrationStep>{},
      );

      await db.queueDao.enqueue(
        id: 'cmd-unsynced',
        commandType: 'INSPECTION',
        entityType: 'inspections',
        payloadJson: '{"asset_no":"TM514","odometer_km":0}',
        createdBy: testUser,
        workspaceId: workspaceA,
        now: testNow,
        idempotencyKey: 'idem-unsynced',
        attachments: <QueuedMediaAttachment>[queuedPhoto('q_lhf1.jpg')],
      );

      await db.draftsDao.saveChecklistDraft(
        userId: testUser,
        workspaceId: workspaceA,
        templateId: 'tpl-1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 2,
        assetNo: 'TM514',
        answersJson: '{"brakes":"ok"}',
        notesJson: '{"brakes":"pads thin"}',
        filled: 4,
        total: 49,
        now: testNow,
      );

      await db.mediaDao.addDraftPhoto(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: draftKey,
        localPath: '/data/user/0/app/files/draft-media/d_1.jpg',
        fileName: 'd_1.jpg',
        capturedAt: testNow,
      );
      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: draftKey,
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
      );

      await db.close();
    }

    test('the ladder preserves every unsynced row and its content', () async {
      await seedVersionOne();

      final AppDatabase upgraded = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 2,
        steps: <int, MigrationStep>{1: addProbeColumn},
      );
      addTearDown(upgraded.close);

      // The command survived, byte for byte.
      final command = await upgraded.queueDao.commandById('cmd-unsynced');
      expect(command, isNotNull);
      expect(command!.payloadJson, '{"asset_no":"TM514","odometer_km":0}');
      expect(
        command.idempotencyKey,
        'idem-unsynced',
        reason: 'a regenerated key would double-insert on the next attempt',
      );
      expect(command.status, CommandStatus.pending);
      expect(command.workspaceId, workspaceA);

      // Its photo survived, with the path that is the only handle on the file.
      final media = await upgraded.mediaDao.mediaForCommand('cmd-unsynced');
      expect(media, hasLength(1));
      expect(media.single.fileName, 'q_lhf1.jpg');
      expect(
        media.single.localPath,
        '/data/user/0/app/files/queue-media/q_lhf1.jpg',
      );

      // The part-filled sheet survived, with its answers, its remarks and its
      // version pin.
      final draft = await upgraded.draftsDao.checklistDraft(draftKey);
      expect(draft, isNotNull);
      expect(draft!.answersJson, '{"brakes":"ok"}');
      expect(draft.notesJson, '{"brakes":"pads thin"}');
      expect(draft.templateVersion, 2);
      expect(draft.filled, 4);

      // And its evidence survived with it.
      final photos = await upgraded.mediaDao.draftPhotosFor(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: draftKey,
      );
      expect(photos, hasLength(1));
      expect(photos.single.fileName, 'd_1.jpg');

      final signatures = await upgraded.mediaDao.signaturesFor(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: draftKey,
      );
      expect(signatures, hasLength(1));
      expect(signatures.single.payload, testSignatureSvg);
      expect(signatures.single.format, SignatureFormat.svg);
    });

    test('the ladder actually ran, and additively', () async {
      await seedVersionOne();

      final AppDatabase upgraded = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 2,
        steps: <int, MigrationStep>{1: addProbeColumn},
      );
      addTearDown(upgraded.close);

      final List<QueryRow> columns = await upgraded
          .customSelect('PRAGMA table_info(pending_commands)')
          .get();
      final Set<String> names = columns
          .map((QueryRow r) => r.read<String>('name'))
          .toSet();

      expect(
        names,
        contains('migration_probe'),
        reason: 'the step did not run, so the preservation test proves nothing',
      );
      // Additive means the old columns are all still there.
      expect(names, contains('idempotency_key'));
      expect(names, contains('payload_json'));

      final QueryRow version = await upgraded
          .customSelect('PRAGMA user_version')
          .getSingle();
      expect(version.read<int>('user_version'), 2);
    });

    test('the preservation assertion can fail: a destructive step trips it', () async {
      // The control for the test above. A step that deletes rows - exactly what
      // spec section 61 forbids - must make the work disappear, and therefore
      // must make the preservation assertion fail. If this test ever stops
      // finding the draft gone, the preservation test has stopped meaning
      // anything.
      await seedVersionOne();

      final AppDatabase upgraded = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 2,
        steps: <int, MigrationStep>{1: wipeTheDrafts},
      );
      addTearDown(upgraded.close);

      expect(
        await upgraded.draftsDao.checklistDraft(draftKey),
        isNull,
        reason:
            'a destructive step loses the only copy of a part-filled '
            'sheet, which is why migrationSteps must stay additive',
      );
    });

    test('a device that skips a release is refused, not half-migrated', () async {
      await seedVersionOne();

      final AppDatabase upgraded = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 3,
        // Rung 2 is missing. A phone that has been offline in a yard for three
        // months upgrades from whatever it had, so a gap must refuse.
        steps: <int, MigrationStep>{1: addProbeColumn},
      );
      addTearDown(upgraded.close);

      await expectLater(upgraded.queueDao.pendingCount(), refusesTheUpgrade());
    });

    test('a refused upgrade leaves the rows intact at the old version', () async {
      await seedVersionOne();

      final AppDatabase refused = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 3,
        steps: <int, MigrationStep>{1: addProbeColumn},
      );
      await expectLater(refused.queueDao.pendingCount(), refusesTheUpgrade());
      await refused.close();

      // Reopening at the version the file actually carries must still find the
      // work. A failed upgrade that eats the queue is worse than no upgrade,
      // and the ladder gets this right by computing the whole plan before
      // running any step: the refusal happens before the first write.
      final AppDatabase reopened = AppDatabase.forMigrationTest(
        NativeDatabase(dbFile),
        schemaVersion: 1,
        steps: const <int, MigrationStep>{},
      );
      addTearDown(reopened.close);

      final command = await reopened.queueDao.commandById('cmd-unsynced');
      expect(command, isNotNull);
      expect(command!.payloadJson, '{"asset_no":"TM514","odometer_km":0}');

      final draft = await reopened.draftsDao.checklistDraft(draftKey);
      expect(draft, isNotNull);
      expect(draft!.answersJson, '{"brakes":"ok"}');
    });
  });
}
