/// Coverage for the fleet register data layer: the pure paging loop, the
/// pure search/class filters, and [VehicleFleetRepository]'s orchestration
/// of a live read against a read-only offline-cache fallback.
///
/// [SupabaseVehicleFleetSource] itself is NOT exercised here - see this
/// feature's report for why, and the identical decision already made (and
/// left untested) for `SupabaseAuthRepository`/`SupabaseProfileRepository`
/// in this same codebase. Everything the repository actually branches on is
/// reachable through the plain-Dart [VehicleFleetSource] interface, which
/// [_FakeVehicleFleetSource] implements with no Supabase type in sight.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show PostgrestException;
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

import '../../../core/database/database_test_support.dart';

// ---------------------------------------------------------------------------
// A row-generating helper. Only `id` and `asset_no` are load-bearing for
// paging tests; the rest exist so VehicleAsset.fromRow never throws.
// ---------------------------------------------------------------------------

Map<String, dynamic> _row(int n) => <String, dynamic>{
      'id': 'row-$n',
      'asset_no': 'TM${n.toString().padLeft(4, '0')}',
    };

// ---------------------------------------------------------------------------
// fetchAllPages - pure, no Supabase type involved.
// ---------------------------------------------------------------------------

void main() {
  group('fetchAllPages', () {
    test(
        'an exact multiple of pageSize reads every full page then a final '
        'empty one confirms the end', () async {
      // 6 rows over a pageSize of 3: page 0 (rows 0-2, full), page 1 (rows
      // 3-5, full - the SAME length as the window, so the loop cannot yet
      // tell this was the end), page 2 (empty, shorter than its window -
      // this is what proves it).
      final List<(int, int)> windows = <(int, int)>[];
      final PagedRows<Map<String, dynamic>> result =
          await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) async {
          windows.add((from, to));
          if (from >= 6) {
            return const <Map<String, dynamic>>[];
          }
          final int end = (from + 3).clamp(0, 6);
          return List<Map<String, dynamic>>.generate(
            end - from,
            (int i) => _row(from + i),
          );
        },
        pageSize: 3,
        maxRows: 100,
      );

      expect(result.rows.length, 6);
      expect(result.truncated, isFalse);
      expect(windows, <(int, int)>[(0, 2), (3, 5), (6, 8)]);
    });

    test(
      'a short final page stops the loop without a further round trip',
      () async {
        int calls = 0;
        final PagedRows<Map<String, dynamic>> result =
            await fetchAllPages<Map<String, dynamic>>(
          (int from, int to) async {
            calls++;
            if (from == 0) {
              return List<Map<String, dynamic>>.generate(3, _row);
            }
            return const <Map<String, dynamic>>[];
          },
          pageSize: 5,
          maxRows: 100,
        );

        expect(result.rows.length, 3);
        expect(result.truncated, isFalse);
        expect(calls, 1);
      },
    );

    test(
      'an empty first page returns an empty, non-truncated result',
      () async {
        final PagedRows<Map<String, dynamic>> result =
            await fetchAllPages<Map<String, dynamic>>(
          (int from, int to) async => const <Map<String, dynamic>>[],
          pageSize: 10,
          maxRows: 100,
        );
        expect(result.rows, isEmpty);
        expect(result.truncated, isFalse);
      },
    );

    test(
      'reaching maxRows with every window still full reports truncated',
      () async {
        final PagedRows<Map<String, dynamic>> result =
            await fetchAllPages<Map<String, dynamic>>(
          (int from, int to) async =>
              List<Map<String, dynamic>>.generate(to - from + 1, _row),
          pageSize: 4,
          maxRows: 12,
        );
        expect(result.rows.length, 12);
        expect(result.truncated, isTrue);
      },
    );

    test(
        'pageSize above 1000 is clamped to 1000, PostgREST own response '
        'cap', () async {
      final List<(int, int)> windows = <(int, int)>[];
      await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) async {
          windows.add((from, to));
          return const <Map<String, dynamic>>[];
        },
        pageSize: 5000,
        maxRows: 5000,
      );
      // The first (only) window must span exactly 1000 rows: 0..999.
      expect(windows.single, (0, 999));
    });

    test(
        'pageSize below 1 is clamped up to 1, never a zero-width or '
        'infinite-loop window', () async {
      int calls = 0;
      final PagedRows<Map<String, dynamic>> result =
          await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) async {
          calls++;
          return const <Map<String, dynamic>>[];
        },
        pageSize: 0,
        maxRows: 3,
      );
      expect(result.rows, isEmpty);
      expect(calls, 1);
    });

    test(
      'a maxRows narrower than pageSize is raised to pageSize rather than '
      'reporting a full page as truncated when it could not have been',
      () async {
        // pageSize 10 but maxRows 3: the cap must be raised to 10 (the
        // boundedPageSize), so a single window of the FULL 10 is requested,
        // and returning fewer than 10 correctly reports NOT truncated.
        final List<(int, int)> windows = <(int, int)>[];
        final PagedRows<Map<String, dynamic>> result =
            await fetchAllPages<Map<String, dynamic>>(
          (int from, int to) async {
            windows.add((from, to));
            return List<Map<String, dynamic>>.generate(2, _row);
          },
          pageSize: 10,
          maxRows: 3,
        );
        expect(windows.single, (0, 9));
        expect(result.rows.length, 2);
        expect(result.truncated, isFalse);
      },
    );

    test(
        'a narrowed final window that comes back exactly full is judged '
        'against ITS OWN width, not the nominal pageSize, and correctly '
        'reports truncated', () async {
      // pageSize 5, maxRows 12: windows are (0,4) width 5, (5,9) width 5,
      // (10,11) width 2 - the LAST window is narrower than pageSize by
      // construction. A page that exactly fills that narrowed window is not
      // evidence the data ends there.
      final List<(int, int)> windows = <(int, int)>[];
      final PagedRows<Map<String, dynamic>> result =
          await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) async {
          windows.add((from, to));
          return List<Map<String, dynamic>>.generate(to - from + 1, _row);
        },
        pageSize: 5,
        maxRows: 12,
      );
      expect(windows, <(int, int)>[(0, 4), (5, 9), (10, 11)]);
      expect(result.rows.length, 12);
      expect(result.truncated, isTrue);
    });
  });

  // ---------------------------------------------------------------------------
  // vehicleMatchesSearch / applyVehicleFilters
  // ---------------------------------------------------------------------------

  group('vehicleMatchesSearch', () {
    final VehicleAsset asset = VehicleAsset.fromRow(<String, dynamic>{
      'id': 'row-1',
      'asset_no': 'TM514',
      'fleet_number': 'FN-88',
      'make': 'Sinotruk',
      'model': 'HOWO',
      'vehicle_type': 'TR-MIXER',
      'operator_name': 'A. Rahman',
      'registration_no': 'ABC-1234',
      'site': 'NHC',
    });

    test('matches each of the eight searched fields, case-insensitively', () {
      expect(vehicleMatchesSearch(asset, 'tm514'), isTrue);
      expect(vehicleMatchesSearch(asset, 'FN-88'), isTrue);
      expect(vehicleMatchesSearch(asset, 'sinotruk'), isTrue);
      expect(vehicleMatchesSearch(asset, 'howo'), isTrue);
      expect(vehicleMatchesSearch(asset, 'tr-mixer'), isTrue);
      expect(vehicleMatchesSearch(asset, 'rahman'), isTrue);
      expect(vehicleMatchesSearch(asset, 'abc-1234'), isTrue);
      expect(vehicleMatchesSearch(asset, 'nhc'), isTrue);
    });

    test('an empty or whitespace-only term matches every asset', () {
      expect(vehicleMatchesSearch(asset, ''), isTrue);
      expect(vehicleMatchesSearch(asset, '   '), isTrue);
    });

    test('a term matching nothing on the row returns false', () {
      expect(vehicleMatchesSearch(asset, 'no-such-thing'), isFalse);
    });
  });

  group('applyVehicleFilters', () {
    final List<VehicleAsset> assets = <VehicleAsset>[
      VehicleAsset.fromRow(<String, dynamic>{'id': '1', 'asset_no': 'TM001'}),
      VehicleAsset.fromRow(<String, dynamic>{'id': '2', 'asset_no': 'GN001'}),
      VehicleAsset.fromRow(<String, dynamic>{'id': '3', 'asset_no': 'MP001'}),
    ];

    test(
        'a non-blank search term bypasses the class filter entirely - a '
        'chip only shapes browsing and must never hide a real match', () {
      final List<VehicleAsset> result = applyVehicleFilters(
        assets,
        assetClassFilter: 'TM',
        searchTerm: 'GN001',
      );
      expect(result.map((VehicleAsset a) => a.assetNo), <String>['GN001']);
    });

    test(
        'the tyreAssetClassFilter sentinel narrows to tyre-carrying '
        'classes only', () {
      final List<VehicleAsset> result = applyVehicleFilters(
        assets,
        assetClassFilter: tyreAssetClassFilter,
      );
      expect(result.map((VehicleAsset a) => a.assetNo).toSet(), <String>{
        'TM001',
        'MP001',
      });
    });

    test('a specific class code narrows to exactly that class', () {
      final List<VehicleAsset> result = applyVehicleFilters(
        assets,
        assetClassFilter: 'GN',
      );
      expect(result.map((VehicleAsset a) => a.assetNo), <String>['GN001']);
    });

    test('no filter and no search returns every asset, unmodified order', () {
      final List<VehicleAsset> result = applyVehicleFilters(assets);
      expect(result, assets);
    });

    test('an empty input list produces an empty output', () {
      expect(applyVehicleFilters(const <VehicleAsset>[]), isEmpty);
    });
  });

  // ---------------------------------------------------------------------------
  // vehicleCacheScopeFor
  // ---------------------------------------------------------------------------

  group('vehicleCacheScopeFor', () {
    test(
        'a null workspace yields no scope - there is nothing to fall '
        'back by', () {
      expect(vehicleCacheScopeFor(null), isNull);
    });

    test(
        'a workspace with no companyId yields no scope, even with a '
        'country selected', () {
      final WorkspaceContext workspace = _workspace(
        companyId: null,
        activeCountry: 'KSA',
      );
      expect(vehicleCacheScopeFor(workspace), isNull);
    });

    test(
      'a workspace with a companyId and an active country resolves both',
      () {
        final WorkspaceContext workspace = _workspace(
          companyId: workspaceA,
          activeCountry: 'KSA',
        );
        final WorkspaceScopeFilter? scope = vehicleCacheScopeFor(workspace);
        expect(scope, isNotNull);
        expect(scope!.workspaceId, workspaceA);
        expect(scope.country, 'KSA');
      },
    );

    test(
        'a workspace with a companyId but no active country resolves a '
        'country-less scope - "every country this workspace may see", not '
        'a missing value', () {
      final WorkspaceContext workspace = _workspace(companyId: workspaceA);
      final WorkspaceScopeFilter? scope = vehicleCacheScopeFor(workspace);
      expect(scope, isNotNull);
      expect(scope!.country, isNull);
    });
  });

  // ---------------------------------------------------------------------------
  // VehicleFleetRepository.loadAll
  // ---------------------------------------------------------------------------

  group('VehicleFleetRepository.loadAll', () {
    test(
        'a successful multi-page read returns every row, decoded, with the '
        'paging result\'s own truncated flag carried through', () async {
      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        pages: <List<Map<String, dynamic>>>[
          List<Map<String, dynamic>>.generate(1000, _row),
          List<Map<String, dynamic>>.generate(3, (int i) => _row(1000 + i)),
        ],
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(source);

      final VehicleFleetListOutcome outcome = await repo.loadAll(
        scope: null,
        country: 'KSA',
      );

      expect(outcome, isA<VehicleFleetListLoaded>());
      final VehicleFleetListLoaded loaded = outcome as VehicleFleetListLoaded;
      expect(loaded.assets.length, 1003);
      expect(loaded.truncated, isFalse);
      expect(source.fetchPageCalls, 2);
    });

    test(
      'a connectivity failure falls back to a matching cache entry',
      () async {
        final AppDatabase db = newMemoryDatabase();
        addTearDown(db.close);
        await db.cacheDao.replaceAssets(
          scope: scopeA,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
            assetRow(id: 'c2', workspaceId: workspaceA, assetNo: 'TM515'),
          ],
          now: testNow,
        );

        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnFetch: const SocketException('no route to host'),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(
          source,
          cacheDao: db.cacheDao,
        );

        final VehicleFleetListOutcome outcome = await repo.loadAll(
          scope: scopeA,
          country: null,
        );

        expect(outcome, isA<VehicleFleetListFromCache>());
        final VehicleFleetListFromCache fromCache =
            outcome as VehicleFleetListFromCache;
        expect(fromCache.assets.length, 2);
        expect(
          fromCache.assets.map((VehicleAsset a) => a.assetNo).toSet(),
          <String>{'TM514', 'TM515'},
        );
        expectSameInstant(fromCache.cachedAt!, testNow);
      },
    );

    test(
      'a connectivity failure with no CacheDao configured fails cleanly',
      () async {
        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnFetch: const SocketException('no route to host'),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(source);

        final VehicleFleetListOutcome outcome = await repo.loadAll(
          scope: scopeA,
          country: null,
        );

        expect(outcome, isA<VehicleFleetListFailed>());
        final VehicleFleetListFailed failed = outcome as VehicleFleetListFailed;
        expect(failed.error.kind, AppErrorKind.network);
      },
    );

    test(
        'a connectivity failure with a CacheDao but a null scope fails - '
        'there is nothing to filter the cache read by', () async {
      final AppDatabase db = newMemoryDatabase();
      addTearDown(db.close);
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
        now: testNow,
      );

      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        throwOnFetch: const SocketException('no route to host'),
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(
        source,
        cacheDao: db.cacheDao,
      );

      final VehicleFleetListOutcome outcome = await repo.loadAll(
        scope: null,
        country: null,
      );

      expect(outcome, isA<VehicleFleetListFailed>());
    });

    test(
      'a connectivity failure with a CacheDao but no rows for that '
      'scope fails, rather than surfacing another workspace\'s cache',
      () async {
        final AppDatabase db = newMemoryDatabase();
        addTearDown(db.close);
        await db.cacheDao.replaceAssets(
          scope: scopeB,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'c1', workspaceId: workspaceB, assetNo: 'TM999'),
          ],
          now: testNow,
        );

        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnFetch: const SocketException('no route to host'),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(
          source,
          cacheDao: db.cacheDao,
        );

        final VehicleFleetListOutcome outcome = await repo.loadAll(
          scope: scopeA,
          country: null,
        );

        expect(outcome, isA<VehicleFleetListFailed>());
      },
    );

    test(
        'a NON-connectivity failure never consults the cache, even when a '
        'matching entry exists - a permission refusal is a fact about this '
        'read, not about being offline', () async {
      final AppDatabase db = newMemoryDatabase();
      addTearDown(db.close);
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
        now: testNow,
      );

      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        throwOnFetch: const PostgrestException(
          message: 'permission denied for table vehicle_fleet',
          code: '42501',
        ),
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(
        source,
        cacheDao: db.cacheDao,
      );

      final VehicleFleetListOutcome outcome = await repo.loadAll(
        scope: scopeA,
        country: null,
      );

      expect(outcome, isA<VehicleFleetListFailed>());
      final VehicleFleetListFailed failed = outcome as VehicleFleetListFailed;
      expect(failed.error.kind, AppErrorKind.authorization);
    });

    test(
        'a row that fails to decode (no usable id) is a validation error, '
        'not a connectivity one, so it never falls back to the cache '
        'either', () async {
      final AppDatabase db = newMemoryDatabase();
      addTearDown(db.close);
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
        now: testNow,
      );

      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        pages: <List<Map<String, dynamic>>>[
          <Map<String, dynamic>>[
            <String, dynamic>{'asset_no': 'TM001'}, // no id
          ],
        ],
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(
        source,
        cacheDao: db.cacheDao,
      );

      final VehicleFleetListOutcome outcome = await repo.loadAll(
        scope: scopeA,
        country: null,
      );

      expect(outcome, isA<VehicleFleetListFailed>());
      final VehicleFleetListFailed failed = outcome as VehicleFleetListFailed;
      expect(failed.error.kind, AppErrorKind.validation);
    });
  });

  // ---------------------------------------------------------------------------
  // VehicleFleetRepository.byAssetNo
  // ---------------------------------------------------------------------------

  group('VehicleFleetRepository.byAssetNo', () {
    test('a successful lookup returns the decoded vehicle', () async {
      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        detailRow: _row(1),
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(source);

      final VehicleDetailOutcome outcome = await repo.byAssetNo(
        scope: null,
        assetNo: 'TM0001',
        country: 'KSA',
      );

      expect(outcome, isA<VehicleDetailLoaded>());
      expect((outcome as VehicleDetailLoaded).asset.id, 'row-1');
    });

    test(
      'the source returning null is a genuine not-found, not an error',
      () async {
        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource();
        final VehicleFleetRepository repo = VehicleFleetRepository(source);

        final VehicleDetailOutcome outcome = await repo.byAssetNo(
          scope: null,
          assetNo: 'TM9999',
          country: null,
        );

        expect(outcome, isA<VehicleDetailNotFound>());
      },
    );

    test(
        'a blank asset number is not-found WITHOUT ever calling the '
        'source - there is no value in `vehicle_fleet` an empty string '
        'could ever match', () async {
      final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
        detailRow: _row(1),
      );
      final VehicleFleetRepository repo = VehicleFleetRepository(source);

      final VehicleDetailOutcome outcome = await repo.byAssetNo(
        scope: null,
        assetNo: '   ',
        country: null,
      );

      expect(outcome, isA<VehicleDetailNotFound>());
      expect(source.fetchByAssetNoCalls, 0);
    });

    test(
      'a connectivity failure falls back to a matching cached detail row',
      () async {
        final AppDatabase db = newMemoryDatabase();
        addTearDown(db.close);
        await db.cacheDao.replaceAssets(
          scope: scopeA,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
          ],
          now: testNow,
        );

        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnDetail: const SocketException('no route to host'),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(
          source,
          cacheDao: db.cacheDao,
        );

        final VehicleDetailOutcome outcome = await repo.byAssetNo(
          scope: scopeA,
          assetNo: 'TM514',
          country: null,
        );

        expect(outcome, isA<VehicleDetailFromCache>());
        final VehicleDetailFromCache fromCache =
            outcome as VehicleDetailFromCache;
        expect(fromCache.asset.assetNo, 'TM514');
        expectSameInstant(fromCache.cachedAt!, testNow);
      },
    );

    test(
      'a connectivity failure with no cached match for that asset fails',
      () async {
        final AppDatabase db = newMemoryDatabase();
        addTearDown(db.close);
        await db.cacheDao.replaceAssets(
          scope: scopeA,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
          ],
          now: testNow,
        );

        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnDetail: const SocketException('no route to host'),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(
          source,
          cacheDao: db.cacheDao,
        );

        final VehicleDetailOutcome outcome = await repo.byAssetNo(
          scope: scopeA,
          assetNo: 'TM999',
          country: null,
        );

        expect(outcome, isA<VehicleDetailFailed>());
      },
    );

    test(
      'a NON-connectivity failure fails without consulting the cache',
      () async {
        final AppDatabase db = newMemoryDatabase();
        addTearDown(db.close);
        await db.cacheDao.replaceAssets(
          scope: scopeA,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'c1', workspaceId: workspaceA, assetNo: 'TM514'),
          ],
          now: testNow,
        );

        final _FakeVehicleFleetSource source = _FakeVehicleFleetSource(
          throwOnDetail: const PostgrestException(
            message: 'permission denied for table vehicle_fleet',
            code: '42501',
          ),
        );
        final VehicleFleetRepository repo = VehicleFleetRepository(
          source,
          cacheDao: db.cacheDao,
        );

        final VehicleDetailOutcome outcome = await repo.byAssetNo(
          scope: scopeA,
          assetNo: 'TM514',
          country: null,
        );

        expect(outcome, isA<VehicleDetailFailed>());
      },
    );
  });
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/// A plain-Dart [VehicleFleetSource] the repository tests drive directly -
/// no `supabase_flutter` type appears anywhere in this class.
class _FakeVehicleFleetSource implements VehicleFleetSource {
  _FakeVehicleFleetSource({
    this.pages = const <List<Map<String, dynamic>>>[],
    this.detailRow,
    this.throwOnFetch,
    this.throwOnDetail,
  });

  /// One entry per expected [fetchPage] call, in order. A call past the end
  /// of this list returns an empty page, matching a real exhausted read.
  final List<List<Map<String, dynamic>>> pages;
  final Map<String, dynamic>? detailRow;
  final Object? throwOnFetch;
  final Object? throwOnDetail;

  int fetchPageCalls = 0;
  int fetchByAssetNoCalls = 0;

  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) async {
    fetchPageCalls++;
    if (throwOnFetch != null) {
      throw throwOnFetch!; // ignore: only_throw_errors - deliberate arbitrary-error injection
    }
    final int index = fetchPageCalls - 1;
    if (index < pages.length) {
      return pages[index];
    }
    return const <Map<String, dynamic>>[];
  }

  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) async {
    fetchByAssetNoCalls++;
    if (throwOnDetail != null) {
      throw throwOnDetail!; // ignore: only_throw_errors
    }
    return detailRow;
  }
}

/// Builds a minimal [WorkspaceContext], mirroring the exact shape already
/// established in `test/core/sync/sync_workspace_id_test.dart` - the only
/// fields [vehicleCacheScopeFor] reads are [WorkspaceContext.companyId] and
/// [WorkspaceContext.activeCountry], but the type has no lighter-weight
/// constructor than the real one.
WorkspaceContext _workspace({String? companyId, String? activeCountry}) {
  const UserRole role = UserRole.known(RoleId.reporter);
  const AccessState access = AccessState(role: role);
  return WorkspaceContext(
    userId: testUser,
    role: role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: companyId,
    activeCountry: activeCountry,
  );
}
