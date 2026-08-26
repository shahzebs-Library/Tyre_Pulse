/// Tests [SupabaseGlobalSearchRepository] source by source.
///
/// [searchAssets] is tested against a REAL in-memory [CacheDao] (the same
/// local cache `features/assets` already populates and searches) - no fake,
/// because this source never touches Supabase and the whole point is
/// proving it reuses that cache's real predicate rather than a second copy
/// of it. [searchTyres] and [searchInspections] are tested against fakes of
/// [TyreLookupRepository]/[InspectionRemoteRepository], the same pattern
/// `serial_search_controller_test.dart` already establishes for this
/// codebase.
///
/// [searchWorkOrders] is DELIBERATELY NOT independently tested here. It is
/// the one method in this repository that reaches a `supabase_flutter`
/// query-builder chain directly (`.from(...).select(...).ilike(...)
/// .limit(...)`) rather than an RPC call, and there is no test seam for
/// that shape anywhere in this codebase - see
/// `tyre_lookup_repository_test.dart`'s own library comment on why its
/// Supabase-touching calls are proven only through `.withRpcCaller`, never
/// against a constructed or mocked [SupabaseClient], in an environment with
/// no Flutter SDK to verify that API against. `.withoutClient` exists on
/// this repository so exactly the three methods below can be exercised with
/// no client at all; `searchWorkOrders`'s CONTROLLER-level behaviour (that
/// it is called, that its results are grouped correctly, that its failure
/// does not blank the other three) is instead proven in
/// `presentation/global_search_controller_test.dart` against a fully faked
/// [GlobalSearchRepository].
library;

import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/cache_dao.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/search/data/global_search_repository.dart';
import 'package:tyre_pulse/features/search/domain/search_result.dart';
import 'package:tyre_pulse/features/tyres/data/tyre_lookup_repository.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_scrap_mark.dart';

import '../../../core/database/database_test_support.dart';

/// Implements every member [TyreLookupRepository] declares, but only
/// [lookupBySerial] is ever scripted or called by anything under test here.
class _FakeTyreLookupRepository implements TyreLookupRepository {
  TyreLookupRecord? lookupResult;
  int lookupCalls = 0;
  String? lastSerial;

  @override
  Future<TyreLookupRecord?> lookupBySerial(String rawSerial) async {
    lookupCalls++;
    lastSerial = rawSerial;
    return lookupResult;
  }

  @override
  Future<ScrapMark?> getScrapMark(String rawSerial) async => null;

  @override
  Future<bool> canScrap() async => false;

  @override
  Future<bool> canUnscrap() async => false;

  @override
  Future<int> scrapBySerial(String rawSerial, {String? reason}) async => 0;

  @override
  Future<void> unscrapBySerial(String rawSerial) async {}
}

/// Implements every member [InspectionRemoteRepository] declares, but only
/// [byId] is ever scripted or called by anything under test here.
class _FakeInspectionRemoteRepository implements InspectionRemoteRepository {
  InspectionRecord? byIdResult;
  int byIdCalls = 0;
  String? lastId;

  @override
  Future<InspectionRecord?> byId(String id) async {
    byIdCalls++;
    lastId = id;
    return byIdResult;
  }

  @override
  Future<List<String>> listSites({String? country}) async => const <String>[];

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async {}

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      const <InspectionRecord>[];
}

InspectionRecord _inspectionRow({
  required String id,
  String assetNo = 'TM514',
  String site = 'NHC',
  String status = 'Done',
  String inspectionDate = '2026-08-01',
}) {
  return InspectionRecord(
    id: id,
    title: 'Daily check',
    site: site,
    assetNo: assetNo,
    vehicleType: 'Tr-Mixer',
    inspector: 'A. Inspector',
    inspectionDate: inspectionDate,
    status: status,
    tyreConditions: const <String, Map<String, Object?>>{},
  );
}

void main() {
  group('searchAssets - against a real in-memory cache', () {
    late AppDatabase db;

    setUp(() {
      db = newMemoryDatabase();
    });

    tearDown(() => db.close());

    test(
        'matches an asset by its fleet number - the gap this feature '
        'closed in CacheDao.searchAssets', () async {
      // CachedAssetsCompanion.insert is constructed directly here rather
      // than through database_test_support.dart's own `assetRow` helper,
      // because that helper does not accept a fleetNumber - this is the
      // one field this test genuinely needs to set that the shared fixture
      // does not offer, so a one-off companion is built instead of widening
      // a shared helper for a single call site.
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          CachedAssetsCompanion.insert(
            id: 'a-1',
            workspaceId: workspaceA,
            assetNo: 'TM514',
            assetNoNorm: normaliseLookupKey('TM514'),
            cachedAt: testNow,
            fleetNumber: const Value<String?>('FL-900'),
          ),
        ],
      );

      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      final List<AssetSearchResult> results =
          await repo.searchAssets('FL-900', scope: scopeA);

      expect(results, hasLength(1));
      expect(results.single.assetNo, 'TM514');
      expect(results.single.fleetNumber, 'FL-900');
    });

    test('a blank term returns no rows without touching the cache', () async {
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      expect(await repo.searchAssets('   ', scope: scopeA), isEmpty);
    });

    test(
        'a null scope (no signed-in workspace) answers empty rather than '
        'throwing', () async {
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      expect(
        await repo.searchAssets('TM514', scope: null),
        isEmpty,
      );
    });

    test('never reveals a row cached for a different workspace', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );

      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      expect(await repo.searchAssets('TM514', scope: scopeB), isEmpty);
    });
  });

  group('searchTyres', () {
    // These tests never actually query the cache - searchTyres delegates
    // entirely to the fake TyreLookupRepository below - but `cacheDao` is a
    // required constructor parameter regardless, so a real (never-read)
    // in-memory database is still opened and closed, matching this
    // codebase's own discipline in `cache_dao_test.dart` rather than
    // constructing and leaking a throwaway one per test.
    late AppDatabase db;

    setUp(() {
      db = newMemoryDatabase();
    });

    tearDown(() => db.close());

    test('delegates straight to TyreLookupRepository.lookupBySerial', () async {
      final _FakeTyreLookupRepository tyres = _FakeTyreLookupRepository()
        ..lookupResult = const TyreLookupRecord(
          id: 'row-1',
          assetNo: 'TM514',
          brand: 'Michelin',
          size: '315/80R22.5',
          tyrePosition: 'LHF1',
        );
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: tyres,
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      final List<TyreSearchResult> results =
          await repo.searchTyres('EP0604207');

      expect(tyres.lookupCalls, 1);
      expect(tyres.lastSerial, 'EP0604207');
      expect(results, hasLength(1));
      expect(results.single.assetNo, 'TM514');
      expect(results.single.brand, 'Michelin');
      expect(results.single.position, 'LHF1');
    });

    test('no match answers an empty list, not an error', () async {
      final _FakeTyreLookupRepository tyres = _FakeTyreLookupRepository();
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: tyres,
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      expect(await repo.searchTyres('DOES-NOT-EXIST'), isEmpty);
    });

    test('a blank term never reaches the repository', () async {
      final _FakeTyreLookupRepository tyres = _FakeTyreLookupRepository();
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: tyres,
        inspectionRemoteRepository: _FakeInspectionRemoteRepository(),
      );

      await repo.searchTyres('   ');
      expect(tyres.lookupCalls, 0);
    });
  });

  group('searchInspections', () {
    // Same reasoning as the `searchTyres` group above: `cacheDao` is a
    // required constructor parameter this method never reads.
    late AppDatabase db;

    setUp(() {
      db = newMemoryDatabase();
    });

    tearDown(() => db.close());

    test(
        'a uuid-shaped term resolves through InspectionRemoteRepository'
        '.byId', () async {
      const String id = '550e8400-e29b-41d4-a716-446655440000';
      final _FakeInspectionRemoteRepository inspections =
          _FakeInspectionRemoteRepository()
            ..byIdResult = _inspectionRow(id: id);
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: inspections,
      );

      final List<InspectionSearchResult> results =
          await repo.searchInspections(id);

      expect(inspections.byIdCalls, 1);
      expect(inspections.lastId, id);
      expect(results, hasLength(1));
      expect(results.single.id, id);
      expect(results.single.assetNo, 'TM514');
    });

    test(
        'a non-uuid term never reaches the repository - the gate a '
        'malformed id would otherwise turn into a real PostgREST error',
        () async {
      final _FakeInspectionRemoteRepository inspections =
          _FakeInspectionRemoteRepository();
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: inspections,
      );

      final List<InspectionSearchResult> results =
          await repo.searchInspections('TM514');

      expect(inspections.byIdCalls, 0);
      expect(results, isEmpty);
    });

    test('a well-shaped uuid with no match answers empty, not an error',
        () async {
      const String id = '550e8400-e29b-41d4-a716-446655440000';
      final _FakeInspectionRemoteRepository inspections =
          _FakeInspectionRemoteRepository();
      final SupabaseGlobalSearchRepository repo =
          SupabaseGlobalSearchRepository.withoutClient(
        cacheDao: db.cacheDao,
        tyreLookupRepository: _FakeTyreLookupRepository(),
        inspectionRemoteRepository: inspections,
      );

      expect(await repo.searchInspections(id), isEmpty);
    });
  });
}
