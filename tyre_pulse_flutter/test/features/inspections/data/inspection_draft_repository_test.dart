/// Coverage for [DriftInspectionDraftRepository] against a real in-memory
/// Drift database - this is risk R2's actual proof: every write here lands
/// in a real row before the method returns, exercising `DraftsDao` and
/// `MediaDao` exactly as [InspectionWizardController] does, rather than
/// through a fake that could silently drift from the real schema.
///
/// Uses the shared `newMemoryDatabase()` fixture the rest of this
/// codebase's Drift-backed tests already rely on
/// (`test/core/database/database_test_support.dart`), per this phase's own
/// instruction to mirror the established in-memory-database test pattern.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

import '../../../core/database/database_test_support.dart';

void main() {
  late AppDatabase db;
  late DriftInspectionDraftRepository repo;

  setUp(() {
    db = newMemoryDatabase();
    repo = DriftInspectionDraftRepository(db.draftsDao, db.mediaDao);
  });

  tearDown(() async {
    await db.close();
  });

  group('draftKeyFor', () {
    test('is deterministic for the same user and asset', () {
      final String a = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      final String b = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      expect(a, b);
    });

    test('differs for a different asset', () {
      final String a = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      final String b = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM515');
      expect(a, isNot(b));
    });
  });

  group('saveHeader / draftsForUser', () {
    test('a saved header appears in the unfinished-work list for its user',
        () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 0,
        total: 12,
        vehicleType: 'Tr-Mixer',
        site: 'NHC',
      );

      final List<InspectionDraftSummary> drafts =
          await repo.draftsForUser('user-1');
      expect(drafts, hasLength(1));
      expect(drafts.single.draftKey, key);
      expect(drafts.single.assetNo, 'TM514');
      expect(drafts.single.total, 12);
      expect(drafts.single.filled, 0);
    });

    test('a draft for a different user is invisible to this one', () async {
      await repo.saveHeader(
        userId: 'user-2',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 0,
        total: 12,
      );
      expect(await repo.draftsForUser('user-1'), isEmpty);
    });

    test('saving the header twice for the same user+asset updates the '
        'same row rather than creating a second one', () async {
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 1,
        total: 12,
      );
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 5,
        total: 12,
      );
      final List<InspectionDraftSummary> drafts =
          await repo.draftsForUser('user-1');
      expect(drafts, hasLength(1));
      expect(drafts.single.filled, 5);
    });
  });

  group('saveTyreReading / tyreReadings - the single write path', () {
    test('a saved reading is readable back with checked stamped true',
        () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 0,
        total: 1,
      );

      // The interface's own contract: checked is ALWAYS stamped true by
      // this write path, whatever the caller passes in - confirmed by
      // deliberately passing checked: false here.
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(
          position: 'LHF1',
          pressurePsi: 108,
          checked: false,
        ),
      );

      final Map<String, TyrePositionReading> readings =
          await repo.tyreReadings(key);
      expect(readings['LHF1'], isNotNull);
      expect(readings['LHF1']!.pressurePsi, 108.0);
      expect(readings['LHF1']!.checked, isTrue);
    });

    test('a pressure of exactly 0 survives the write and the read back',
        () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(position: 'LHF2', pressurePsi: 0),
      );
      final Map<String, TyrePositionReading> readings =
          await repo.tyreReadings(key);
      expect(readings['LHF2']!.pressurePsi, 0.0);
      expect(readings['LHF2']!.pressurePsi, isNotNull);
    });

    test('saving the same position twice overwrites rather than '
        'duplicating', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(position: 'LHF1', pressurePsi: 100),
      );
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(position: 'LHF1', pressurePsi: 115),
      );
      final Map<String, TyrePositionReading> readings =
          await repo.tyreReadings(key);
      expect(readings.length, 1);
      expect(readings['LHF1']!.pressurePsi, 115.0);
    });
  });

  group('photos and tyreReadingsWithPhotos', () {
    test('a photo attached to a position is folded into '
        'tyreReadingsWithPhotos as photoLocalPath', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(position: 'LHF1', condition: 'Worn'),
      );
      await repo.addPhoto(
        draftKey: key,
        position: 'LHF1',
        localPath: '/tmp/lhf1_1.jpg',
        capturedAt: DateTime.utc(2026, 8, 20, 9),
      );

      final Map<String, TyrePositionReading> merged =
          await repo.tyreReadingsWithPhotos(key);
      expect(merged['LHF1']!.photoLocalPath, '/tmp/lhf1_1.jpg');
      expect(merged['LHF1']!.condition, 'Worn');
    });

    test('when a position has two photos (a retake), the most recently '
        'captured one wins', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.addPhoto(
        draftKey: key,
        position: 'LHF1',
        localPath: '/tmp/older.jpg',
        capturedAt: DateTime.utc(2026, 8, 20, 9, 0),
      );
      await repo.addPhoto(
        draftKey: key,
        position: 'LHF1',
        localPath: '/tmp/newer.jpg',
        capturedAt: DateTime.utc(2026, 8, 20, 9, 5),
      );

      final Map<String, TyrePositionReading> merged =
          await repo.tyreReadingsWithPhotos(key);
      expect(merged['LHF1']!.photoLocalPath, '/tmp/newer.jpg');
    });

    test('a position with a photo but no separate reading row still '
        'appears, seeded', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.addPhoto(
        draftKey: key,
        position: 'RHR1-O',
        localPath: '/tmp/photo-only.jpg',
        capturedAt: DateTime.utc(2026, 8, 20),
      );
      final Map<String, TyrePositionReading> merged =
          await repo.tyreReadingsWithPhotos(key);
      expect(merged['RHR1-O']!.photoLocalPath, '/tmp/photo-only.jpg');
      expect(merged['RHR1-O']!.condition, TyreReadingCondition.good);
    });
  });

  group('signature', () {
    test('a saved signature is readable back for the same draft', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      expect(await repo.signature(key), isNull);

      await repo.saveSignature(
        draftKey: key,
        payload: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        source: 'drawn',
        signerUserId: 'user-1',
      );

      final InspectionDraftSignature? sig = await repo.signature(key);
      expect(sig, isNotNull);
      expect(sig!.payload, contains('<svg'));
      expect(sig.source, 'drawn');
    });

    test('saving a second signature replaces the first - there is exactly '
        'one signing slot per draft', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveSignature(
        draftKey: key,
        payload: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>',
        source: 'drawn',
      );
      await repo.saveSignature(
        draftKey: key,
        payload:
            '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1"/></svg>',
        source: 'drawn',
      );
      final InspectionDraftSignature? sig = await repo.signature(key);
      expect(sig!.payload, contains('M1 1'));
    });
  });

  group('discardDraft', () {
    test('removes the header, positions, photos and signature, and hands '
        'back the removed photo paths', () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 1,
        total: 1,
      );
      await repo.saveTyreReading(
        key,
        const TyrePositionReading(position: 'LHF1', pressurePsi: 100),
      );
      await repo.addPhoto(
        draftKey: key,
        position: 'LHF1',
        localPath: '/tmp/to-delete.jpg',
        capturedAt: DateTime.utc(2026, 8, 20),
      );
      await repo.saveSignature(
        draftKey: key,
        payload: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
        source: 'drawn',
      );

      final List<String> orphaned = await repo.discardDraft(key);
      expect(orphaned, contains('/tmp/to-delete.jpg'));

      expect(await repo.draftsForUser('user-1'), isEmpty);
      expect(await repo.tyreReadings(key), isEmpty);
      expect(await repo.photosFor(key), isEmpty);
      expect(await repo.signature(key), isNull);
    });

    test('discarding a draft that never existed is a safe no-op', () async {
      final List<String> orphaned = await repo.discardDraft('never-existed');
      expect(orphaned, isEmpty);
    });
  });

  group('hasContent', () {
    test('a header with no positions, photos or signature has no content',
        () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 0,
        total: 12,
      );
      expect(await repo.hasContent(key), isFalse);
    });

    test('a header with at least one filled position has content',
        () async {
      final String key = repo.draftKeyFor(userId: 'user-1', assetNo: 'TM514');
      await repo.saveHeader(
        userId: 'user-1',
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 1,
        total: 12,
      );
      expect(await repo.hasContent(key), isTrue);
    });
  });
}
