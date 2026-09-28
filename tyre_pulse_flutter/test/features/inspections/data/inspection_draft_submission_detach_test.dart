/// Real-Drift coverage for the draft fixes: a submitted draft leaves the live
/// key (P0-3), a removed photo leaves the draft (P1-9), the header is
/// readable for resume (P1-6) and a scan pre-fill is not "checked" (P2).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

import '../../../core/database/database_test_support.dart';

void main() {
  late AppDatabase db;
  late DriftInspectionDraftRepository repo;
  const String user = 'user-1';

  setUp(() {
    db = newMemoryDatabase();
    repo = DriftInspectionDraftRepository(db.draftsDao, db.mediaDao);
  });

  tearDown(() async {
    await db.close();
  });

  Future<String> seedDraft() async {
    final String key = repo.draftKeyFor(userId: user, assetNo: 'TM514');
    await repo.saveHeader(
      userId: user,
      workspaceId: 'org-a',
      assetNo: 'TM514',
      filled: 1,
      total: 12,
      vehicleType: 'TR-MIXER',
      site: 'NHC',
      odometerKm: 145200,
      engineHours: 812.5,
      findings: 'Mud on steer axle',
    );
    await repo.saveTyreReading(
      key,
      const TyrePositionReading(position: 'LHF1', pressurePsi: 110),
    );
    await repo.addPhoto(
      draftKey: key,
      position: 'LHF1',
      localPath: '/drafts/lhf1.jpg',
      capturedAt: DateTime.utc(2026, 9, 1),
    );
    await repo.saveSignature(
      draftKey: key,
      payload: '<svg></svg>',
      source: 'drawn',
    );
    return key;
  }

  group('P0-3 detachForSubmission', () {
    test(
        'moves header, positions, photos and signature to the submitted key '
        'and hides it from unfinished work', () async {
      final String live = await seedDraft();
      final String submitted = DraftsDao.submittedInspectionDraftKey(
        draftKey: live,
        clientUuid: 'c-1',
      );

      expect(
        await repo.detachForSubmission(fromKey: live, toKey: submitted),
        isTrue,
      );

      expect(await repo.header(live), isNull);
      expect(await repo.tyreReadings(live), isEmpty);
      expect(await repo.photosFor(live), isEmpty);

      expect((await repo.header(submitted))!.odometerKm, 145200);
      expect((await repo.tyreReadings(submitted))['LHF1']!.pressurePsi, 110);
      expect(
        (await repo.photosFor(submitted)).single.localPath,
        '/drafts/lhf1.jpg',
      );
      expect((await repo.signature(submitted))!.payload, '<svg></svg>');

      final List<InspectionDraftSummary> unfinished =
          await repo.draftsForUser(user);
      expect(unfinished, isEmpty);
    });

    test(
        'a new inspection of the same machine starts fresh and survives the '
        'queued one being discarded on delivery', () async {
      final String live = await seedDraft();
      final String submitted = DraftsDao.submittedInspectionDraftKey(
        draftKey: live,
        clientUuid: 'c-1',
      );
      await repo.detachForSubmission(fromKey: live, toKey: submitted);

      // New sheet for TM514.
      expect(await repo.tyreReadingsWithPhotos(live), isEmpty);
      await repo.saveHeader(
        userId: user,
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 1,
        total: 12,
      );
      await repo.saveTyreReading(
        live,
        const TyrePositionReading(position: 'RHF1', pressurePsi: 95),
      );

      // Delivery of the queued sheet.
      await repo.discardDraft(submitted);

      expect((await repo.tyreReadings(live)).keys, <String>['RHF1']);
      expect((await repo.draftsForUser(user)).single.draftKey, live);
    });

    test('is idempotent and never pulls newer work across', () async {
      final String live = await seedDraft();
      final String submitted = DraftsDao.submittedInspectionDraftKey(
        draftKey: live,
        clientUuid: 'c-1',
      );
      await repo.detachForSubmission(fromKey: live, toKey: submitted);
      await repo.saveHeader(
        userId: user,
        workspaceId: 'org-a',
        assetNo: 'TM514',
        filled: 1,
        total: 12,
      );

      expect(
        await repo.detachForSubmission(fromKey: live, toKey: submitted),
        isTrue,
      );
      expect(await repo.header(live), isNotNull);
      expect(
        await repo.detachForSubmission(fromKey: 'nobody|X', toKey: 'nowhere'),
        isFalse,
      );
    });
  });

  test(
      'P1-9 removePhotos deletes the position\'s photo rows and returns '
      'their paths', () async {
    final String key = await seedDraft();
    expect(await repo.removePhotos(key, 'LHF1'), <String>['/drafts/lhf1.jpg']);
    expect(await repo.photosFor(key), isEmpty);
    expect(
      (await repo.tyreReadingsWithPhotos(key))['LHF1']!.photoLocalPath,
      isNull,
    );
  });

  test('P1-6 header returns what was saved, for resume', () async {
    final String key = await seedDraft();
    final InspectionDraftHeader header = (await repo.header(key))!;
    expect(header.odometerKm, 145200);
    expect(header.engineHours, 812.5);
    expect(header.findings, 'Mud on steer axle');
    expect(header.site, 'NHC');
    expect(header.vehicleType, 'TR-MIXER');
  });

  test('P2 a scan pre-fill is stored without marking the wheel checked',
      () async {
    final String key = await seedDraft();
    await repo.saveTyreReading(
      key,
      const TyrePositionReading(position: 'RHF1', serialNumber: 'SN-1'),
      markChecked: false,
    );
    final TyrePositionReading reading = (await repo.tyreReadings(key))['RHF1']!;
    expect(reading.serialNumber, 'SN-1');
    expect(reading.checked, isFalse);
  });
}
