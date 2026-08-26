import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
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

  Future<InspectionDraft> saveInspection({
    String userId = testUser,
    String assetNo = 'TM514',
    int filled = 1,
    DateTime? now,
  }) {
    return db.draftsDao.saveInspectionDraft(
      userId: userId,
      workspaceId: workspaceA,
      assetNo: assetNo,
      filled: filled,
      total: 13,
      now: now ?? testNow,
    );
  }

  group('draft identity', () {
    test('the same machine typed differently is one sheet, not three',
        () async {
      await saveInspection(assetNo: 'tm514');
      await saveInspection(assetNo: 'TM514');
      await saveInspection(assetNo: '  TM514  ');

      final drafts = await db.draftsDao.inspectionDraftsForUser(testUser);
      expect(
        drafts,
        hasLength(1),
        reason: 'without normalising the asset the operator finishes one of '
            'three drafts of the same job',
      );
      expect(drafts.single.assetNo, 'TM514');
    });

    test('two people on one handset keep separate work', () async {
      await saveInspection(userId: 'tyre-man');
      await saveInspection(userId: 'electrician');

      expect(
        await db.draftsDao.inspectionDraftsForUser('tyre-man'),
        hasLength(1),
      );
      expect(
        await db.draftsDao.inspectionDraftsForUser('electrician'),
        hasLength(1),
      );
      expect(
        DraftsDao.inspectionDraftKey(userId: 'tyre-man', assetNo: 'TM514'),
        isNot(
          DraftsDao.inspectionDraftKey(
            userId: 'electrician',
            assetNo: 'TM514',
          ),
        ),
        reason: 'the user id is inside the primary key, so overwriting is not '
            'possible rather than merely avoided',
      );
    });

    test('no signed-in user offers nothing at all, not everything', () async {
      await saveInspection();
      await db.draftsDao.saveChecklistDraft(
        userId: testUser,
        workspaceId: workspaceA,
        templateId: 'tpl-1',
        templateName: 'Workshop Daily Checklist',
        templateVersion: 2,
        assetNo: 'TM514',
        answersJson: '{}',
        notesJson: '{}',
        filled: 1,
        total: 49,
        now: testNow,
      );

      expect(await db.draftsDao.inspectionDraftsForUser(''), isEmpty);
      expect(await db.draftsDao.checklistDraftsForUser(''), isEmpty);
      expect(
        await db.draftsDao.resumeCandidates(userId: '', templateId: 'tpl-1'),
        isEmpty,
      );
    });

    test('an autosave never resets how old the work is', () async {
      final first = await saveInspection(now: testNow);
      final DateTime later = testNow.add(const Duration(hours: 3));
      final second = await saveInspection(filled: 7, now: later);

      expectSameInstant(second.createdAt, first.createdAt);
      expectSameInstant(second.updatedAt, later);
      expect(second.filled, 7);
    });

    test('the unfinished list is newest first', () async {
      await saveInspection(assetNo: 'TM100', now: testNow);
      await saveInspection(
        assetNo: 'TM200',
        now: testNow.add(const Duration(minutes: 5)),
      );

      final drafts = await db.draftsDao.inspectionDraftsForUser(testUser);
      expect(
        drafts.map((InspectionDraft d) => d.assetNo).toList(),
        <String>['TM200', 'TM100'],
      );
    });
  });

  group('tyre positions', () {
    test('a seeded position does not count as attended to', () async {
      // RECORDED: both capture forms pre-seed every wheel with condition Good,
      // so a seeded Good and a deliberate Good are byte-identical and no
      // completeness rule can tell them apart. The explicit marker is what
      // separates them, and it must default to false.
      await saveInspection();
      final String key = DraftsDao.inspectionDraftKey(
        userId: testUser,
        assetNo: 'TM514',
      );

      await db.into(db.inspectionDraftPositions).insert(
            InspectionDraftPositionsCompanion.insert(
              id: 'seeded-lhf1',
              draftKey: key,
              position: 'LHF1',
              updatedAt: testNow,
              condition: const Value<String?>('Good'),
            ),
          );

      expect(await db.draftsDao.inspectionPositions(key), hasLength(1));
      expect(
        await db.draftsDao.checkedPositions(key),
        isEmpty,
        reason: 'counting a seeded Good makes the completeness gate vacuous',
      );
    });

    test('a real edit stamps the marker', () async {
      await saveInspection();
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

      expect(await db.draftsDao.checkedPositions(key), <String>{'LHF1'});
    });

    test('zero pressure is a flat tyre, not a missing reading', () async {
      await saveInspection();
      final String key = DraftsDao.inspectionDraftKey(
        userId: testUser,
        assetNo: 'TM514',
      );

      await db.draftsDao.saveInspectionPosition(
        draftKey: key,
        position: 'LHF1',
        now: testNow,
        condition: 'Flat',
        pressurePsi: 0,
      );

      final positions = await db.draftsDao.inspectionPositions(key);
      expect(
        positions.single.pressurePsi,
        0,
        reason: 'a truthiness check throws away the most important reading on '
            'the screen',
      );
      expect(positions.single.pressurePsi, isNot(isNull));
    });

    test('one row per wheel, however many times it is edited', () async {
      await saveInspection();
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
      await db.draftsDao.saveInspectionPosition(
        draftKey: key,
        position: 'LHF1',
        now: testNow.add(const Duration(minutes: 1)),
        condition: 'Worn',
        treadDepthMm: 4.5,
      );

      final positions = await db.draftsDao.inspectionPositions(key);
      expect(positions, hasLength(1));
      expect(positions.single.condition, 'Worn');
      expect(positions.single.treadDepthMm, 4.5);
    });
  });

  group('resume', () {
    setUp(() async {
      for (final String asset in <String>['TM514', 'TM515']) {
        await db.draftsDao.saveChecklistDraft(
          userId: testUser,
          workspaceId: workspaceA,
          templateId: 'tpl-1',
          templateName: 'Workshop Daily Checklist',
          templateVersion: 2,
          assetNo: asset,
          answersJson: '{}',
          notesJson: '{}',
          filled: 2,
          total: 49,
          now: testNow,
        );
      }
    });

    test('offers every sheet for the template while no machine is picked',
        () async {
      final candidates = await db.draftsDao.resumeCandidates(
        userId: testUser,
        templateId: 'tpl-1',
      );
      expect(candidates, hasLength(2));
    });

    test('narrows to one machine once an asset is known', () async {
      final candidates = await db.draftsDao.resumeCandidates(
        userId: testUser,
        templateId: 'tpl-1',
        assetNo: 'tm515',
      );
      expect(candidates, hasLength(1));
      expect(candidates.single.assetNo, 'TM515');
    });

    test('the version pin travels with the draft', () async {
      final draft =
          await db.draftsDao.checklistDraft('$testUser|tpl-1|TM514');
      expect(
        draft!.templateVersion,
        2,
        reason: 'a resume against a changed version must warn rather than '
            'silently re-map answers given to different questions',
      );
    });
  });

  group('discard', () {
    test('takes the photos, the signatures and the positions with it',
        () async {
      await saveInspection();
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
      await db.mediaDao.addDraftPhoto(
        ownerKind: OwnerKind.inspectionDraft,
        ownerKey: key,
        localPath: '/data/user/0/app/files/draft-media/d_1.jpg',
        fileName: 'd_1.jpg',
        capturedAt: testNow,
      );
      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.inspectionDraft,
        ownerKey: key,
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
      );

      final List<String> files =
          await db.draftsDao.discardInspectionDraft(key);

      expect(files, <String>['/data/user/0/app/files/draft-media/d_1.jpg']);
      expect(await db.draftsDao.inspectionDraft(key), isNull);
      expect(await db.draftsDao.inspectionPositions(key), isEmpty);
      expect(
        await db.mediaDao.draftPhotosFor(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: key,
        ),
        isEmpty,
      );
      expect(
        await db.mediaDao.hasAnySignature(
          ownerKind: OwnerKind.inspectionDraft,
          ownerKey: key,
        ),
        isFalse,
      );
    });

    test('leaves another user work untouched', () async {
      await saveInspection(userId: 'tyre-man');
      await saveInspection(userId: 'electrician');

      await db.draftsDao.discardInspectionDraft(
        DraftsDao.inspectionDraftKey(userId: 'tyre-man', assetNo: 'TM514'),
      );

      expect(
        await db.draftsDao.inspectionDraftsForUser('electrician'),
        hasLength(1),
      );
    });

    test('discarding one draft does not touch queue media', () async {
      await saveInspection();
      final String key = DraftsDao.inspectionDraftKey(
        userId: testUser,
        assetNo: 'TM514',
      );
      await seedCommand(db, id: 'cmd-1');

      await db.draftsDao.discardInspectionDraft(key);

      expect(await db.queueDao.commandById('cmd-1'), isNotNull);
    });
  });

  group('what counts as work in progress', () {
    test('a sheet somebody merely opened is not a draft', () async {
      // The fill screen seeds auto fields the instant a template opens, so a
      // draft judged by "are any answers non-blank" would be written for every
      // template anybody looked at.
      expect(
        await db.draftsDao.draftHasContent(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'never-touched',
          filled: 0,
        ),
        isFalse,
      );
    });

    test('a sheet whose only content is a photograph of a fault is real work',
        () async {
      await db.mediaDao.addDraftPhoto(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        localPath: '/data/user/0/app/files/draft-media/d_1.jpg',
        fileName: 'd_1.jpg',
        capturedAt: testNow,
      );

      expect(
        await db.draftsDao.draftHasContent(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          filled: 0,
        ),
        isTrue,
      );
    });

    test('a signature alone is real work', () async {
      await db.mediaDao.saveSignature(
        ownerKind: OwnerKind.checklistDraft,
        ownerKey: 'draft-1',
        fieldKey: primaryField,
        payload: testSignatureSvg,
        source: SignatureSource.drawn,
        signedAt: testNow,
      );

      expect(
        await db.draftsDao.draftHasContent(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          filled: 0,
        ),
        isTrue,
      );
    });

    test('recorded progress is real work', () async {
      expect(
        await db.draftsDao.draftHasContent(
          ownerKind: OwnerKind.checklistDraft,
          ownerKey: 'draft-1',
          filled: 1,
        ),
        isTrue,
      );
    });
  });

  group('the draft cap', () {
    test('trims the oldest by COUNT and hands back their files', () async {
      for (int i = 0; i < 5; i++) {
        await saveInspection(
          assetNo: 'TM${100 + i}',
          now: testNow.add(Duration(minutes: i)),
        );
      }
      await db.mediaDao.addDraftPhoto(
        ownerKind: OwnerKind.inspectionDraft,
        ownerKey: DraftsDao.inspectionDraftKey(
          userId: testUser,
          assetNo: 'TM100',
        ),
        localPath: '/data/user/0/app/files/draft-media/oldest.jpg',
        fileName: 'oldest.jpg',
        capturedAt: testNow,
      );

      final List<String> files = await db.draftsDao.pruneDraftsToCap(
        userId: testUser,
        inspectionCap: 3,
      );

      final remaining = await db.draftsDao.inspectionDraftsForUser(testUser);
      expect(remaining, hasLength(3));
      expect(
        remaining.map((InspectionDraft d) => d.assetNo),
        unorderedEquals(<String>['TM102', 'TM103', 'TM104']),
      );
      expect(
        files,
        contains('/data/user/0/app/files/draft-media/oldest.jpg'),
        reason: 'the caller deletes the files after the rows, never before',
      );
    });

    test('nothing is pruned by age', () async {
      // A sheet abandoned for two months is still the operator's work. It is
      // listed with its age so a person decides.
      final DateTime longAgo = testNow.subtract(const Duration(days: 90));
      await saveInspection(now: longAgo);

      await db.draftsDao.pruneDraftsToCap(userId: testUser);

      expect(
        await db.draftsDao.inspectionDraftsForUser(testUser),
        hasLength(1),
      );
    });

    test('no signed-in user prunes nothing', () async {
      await saveInspection();
      expect(await db.draftsDao.pruneDraftsToCap(userId: ''), isEmpty);
      expect(
        await db.draftsDao.inspectionDraftsForUser(testUser),
        hasLength(1),
      );
    });
  });
}
