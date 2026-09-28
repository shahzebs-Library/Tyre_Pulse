/// [HomeDraftSource] over a real in-memory Drift database: the live draft
/// stream Home watches, and every filter it applies.
library;

import 'package:drift/drift.dart' show Value;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/drafts_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/features/home/data/home_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';

import '../../../core/database/database_test_support.dart';

Future<InspectionDraft> _save(
  AppDatabase db, {
  String userId = 'user-1',
  String workspaceId = 'org-1',
  String assetNo = 'CP045',
  int filled = 0,
  String? country = 'KSA',
  DateTime? at,
}) =>
    db.draftsDao.saveInspectionDraft(
      userId: userId,
      workspaceId: workspaceId,
      assetNo: assetNo,
      filled: filled,
      total: 10,
      now: at ?? testNow,
      country: country,
    );

Stream<InspectionDraftSummary?> _watch(AppDatabase db, {String? country}) =>
    HomeDraftSource(db).watchLatest(
      userId: 'user-1',
      workspaceIds: <String>{'org-1'},
      activeCountry: country ?? 'KSA',
    );

void main() {
  late AppDatabase db;
  setUp(() => db = newMemoryDatabase());
  tearDown(() => db.close());

  test('a draft with progress is offered', () async {
    await _save(db, filled: 3);
    final InspectionDraftSummary? draft = await _watch(db).first;
    expect(draft?.assetNo, 'CP045');
    expect(draft?.filled, 3);
  });

  test('a draft that was merely opened is not work to resume', () async {
    await _save(db);
    expect(await _watch(db).first, isNull);
  });

  test(
      'a draft holding only a photo still counts (hasContent, not '
      'hasProgress)', () async {
    final InspectionDraft row = await _save(db);
    await db.into(db.draftPhotos).insert(
          DraftPhotosCompanion.insert(
            id: 'photo-1',
            ownerKind: OwnerKind.inspectionDraft,
            ownerKey: row.draftKey,
            localPath: '/tmp/p1.jpg',
            fileName: 'p1.jpg',
            capturedAt: testNow,
            fieldKey: const Value<String?>('LHF1'),
          ),
        );
    expect((await _watch(db).first)?.assetNo, 'CP045');
  });

  test('another workspace, another user or another country is hidden',
      () async {
    await _save(db, filled: 2, workspaceId: 'org-2', assetNo: 'A1');
    await _save(db, filled: 2, userId: 'user-2', assetNo: 'A2');
    await _save(db, filled: 2, country: 'UAE', assetNo: 'A3');
    expect(await _watch(db).first, isNull);
    // The all-countries view still shows the UAE draft.
    expect((await _watch(db, country: 'All').first)?.assetNo, 'A3');
  });

  test('the stream follows a discard without being re-read', () async {
    final InspectionDraft row = await _save(db, filled: 4);
    final List<InspectionDraftSummary?> seen = <InspectionDraftSummary?>[];
    final sub = _watch(db).listen(seen.add);
    await pumpEventQueue();
    expect(seen.last?.assetNo, 'CP045');

    await db.draftsDao.discardInspectionDraft(row.draftKey);
    await pumpEventQueue();
    expect(seen.last, isNull);
    await sub.cancel();
  });

  test('the newest qualifying draft wins', () async {
    await _save(db, filled: 1, assetNo: 'OLD', at: testNow);
    await _save(
      db,
      filled: 1,
      assetNo: 'NEW',
      at: testNow.add(const Duration(minutes: 5)),
    );
    expect((await _watch(db).first)?.assetNo, 'NEW');
  });

  test('a submitted (detached, still queued) draft is not work to resume',
      () async {
    final InspectionDraft row = await _save(db, filled: 6);
    final List<InspectionDraftSummary?> seen = <InspectionDraftSummary?>[];
    final sub = _watch(db).listen(seen.add);
    await pumpEventQueue();
    expect(seen.last?.assetNo, 'CP045');

    await db.draftsDao.detachInspectionDraft(
      fromKey: row.draftKey,
      toKey: DraftsDao.submittedInspectionDraftKey(
        draftKey: row.draftKey,
        clientUuid: 'client-1',
      ),
    );
    await pumpEventQueue();
    expect(seen.last, isNull);
    await sub.cancel();
  });
}
