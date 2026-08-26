import 'package:drift/drift.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/query_scope.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';

import 'database_test_support.dart';

void main() {
  late AppDatabase db;

  setUp(() {
    db = newMemoryDatabase();
  });

  tearDown(() async {
    await db.close();
  });

  group('workspace scoping', () {
    test('a cached read under workspace B cannot see workspace A rows',
        () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
          assetRow(id: 'a-2', workspaceId: workspaceA, assetNo: 'TM515'),
        ],
      );

      expect(await db.cacheDao.searchAssets(scope: scopeA), hasLength(2));

      // Switching workspace must not reveal the other tenant's fleet. The read
      // looks like a caching bug; the write that follows it - a command naming
      // an asset the new workspace has never heard of - is a cross-tenant data
      // error.
      expect(
        await db.cacheDao.searchAssets(scope: scopeB),
        isEmpty,
        reason: 'an unscoped cache serves company A fleet to company B',
      );
      expect(
        await db.cacheDao.assetByCode(scope: scopeB, code: 'TM514'),
        isNull,
      );
    });

    test('replacing one workspace cache leaves the other alone', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );
      await db.cacheDao.replaceAssets(
        scope: scopeB,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'b-1', workspaceId: workspaceB, assetNo: 'BP041'),
        ],
      );

      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-2', workspaceId: workspaceA, assetNo: 'TM600'),
        ],
      );

      final a = await db.cacheDao.searchAssets(scope: scopeA);
      expect(a.map((CachedAsset r) => r.assetNo).toList(), <String>['TM600']);
      final b = await db.cacheDao.searchAssets(scope: scopeB);
      expect(b.map((CachedAsset r) => r.assetNo).toList(), <String>['BP041']);
    });

    test('the write side refuses a row stamped for another workspace',
        () async {
      await expectLater(
        db.cacheDao.replaceAssets(
          scope: scopeA,
          now: testNow,
          rows: <CachedAssetsCompanion>[
            assetRow(id: 'b-1', workspaceId: workspaceB, assetNo: 'BP041'),
          ],
        ),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.validation,
          ),
        ),
      );

      expect(await db.cacheDao.searchAssets(scope: scopeB), isEmpty);
    });
  });

  group('the country filter is null-safe', () {
    setUp(() async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(
            id: 'ksa-1',
            workspaceId: workspaceA,
            assetNo: 'TM514',
            country: 'KSA',
          ),
          assetRow(
            id: 'uae-1',
            workspaceId: workspaceA,
            assetNo: 'TM900',
            country: 'UAE',
          ),
          assetRow(
            id: 'none-1',
            workspaceId: workspaceA,
            assetNo: 'REC01',
          ),
        ],
      );
    });

    test('a country scope sees its own rows AND the country-less ones',
        () async {
      const WorkspaceScopeFilter ksa = WorkspaceScopeFilter(
        workspaceId: workspaceA,
        country: 'KSA',
      );

      final assets = await db.cacheDao.searchAssets(scope: ksa);

      expect(
        assets.map((CachedAsset r) => r.assetNo),
        unorderedEquals(<String>['REC01', 'TM514']),
        reason: 'a strict equality on country silently hid 55,606 '
            'country-less rows on the web',
      );
    });

    test('no country narrowing means every country the user may see', () async {
      final assets = await db.cacheDao.searchAssets(scope: scopeA);
      expect(assets, hasLength(3));
    });
  });

  group('asset identity', () {
    test('the same code in two countries is two different machines', () async {
      // RECORDED: GN103 is a Caterpillar generator in KSA and a Sany one in
      // UAE. A unique index on the code alone would silently merge them.
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(
            id: 'ksa-gn103',
            workspaceId: workspaceA,
            assetNo: 'GN103',
            country: 'KSA',
          ),
          assetRow(
            id: 'uae-gn103',
            workspaceId: workspaceA,
            assetNo: 'GN103',
            country: 'UAE',
          ),
        ],
      );

      expect(await db.cacheDao.searchAssets(scope: scopeA), hasLength(2));
    });

    test('the same code twice in one country is refused', () async {
      await expectLater(
        db.cacheDao.replaceAssets(
          scope: scopeA,
          now: testNow,
          rows: <CachedAssetsCompanion>[
            assetRow(
              id: 'one',
              workspaceId: workspaceA,
              assetNo: 'TM514',
              country: 'KSA',
            ),
            assetRow(
              id: 'two',
              workspaceId: workspaceA,
              assetNo: 'tm514 ',
              country: 'KSA',
            ),
          ],
        ),
        throwsA(isA<Exception>()),
      );
    });

    test('a scanned code resolves however it was typed', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );

      for (final String typed in <String>['TM514', 'tm514', '  tm514  ']) {
        final asset = await db.cacheDao.assetByCode(scope: scopeA, code: typed);
        expect(asset, isNotNull, reason: 'lookup failed for "$typed"');
        expect(
          asset!.assetNo,
          'TM514',
          reason: 'the verbatim server value is what a command must carry',
        );
      }
    });

    test('an empty code matches nothing rather than everything', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );

      expect(await db.cacheDao.assetByCode(scope: scopeA, code: '   '), isNull);
    });
  });

  group('truncation', () {
    test('a short page is recorded, not swallowed', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        truncated: true,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );

      expect(
        await db.cacheDao.cacheIsTruncated('cached_assets'),
        isTrue,
        reason: 'a silently short list reads to a user as "that asset was '
            'never created"',
      );

      final rowCount = await db.cacheDao
          .readMetadata(SyncMetadataKeys.cacheRowCount('cached_assets'));
      expect(rowCount!.valueJson, '1');
      expect(await db.cacheDao.cacheLastSyncedAt('cached_assets'), isNotNull);
    });

    test('a complete page clears the flag', () async {
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        truncated: true,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );
      await db.cacheDao.replaceAssets(
        scope: scopeA,
        now: testNow,
        rows: <CachedAssetsCompanion>[
          assetRow(id: 'a-1', workspaceId: workspaceA, assetNo: 'TM514'),
        ],
      );

      expect(await db.cacheDao.cacheIsTruncated('cached_assets'), isFalse);
    });

    test('a table that has never synced reports no timestamp, not zero',
        () async {
      expect(await db.cacheDao.cacheLastSyncedAt('cached_tyres'), isNull);
    });
  });

  group('tyres', () {
    CachedTyresCompanion tyre({
      required String id,
      required String serialNo,
      String assetNo = 'TM514',
      DateTime? lastSeenAt,
    }) {
      return CachedTyresCompanion.insert(
        id: id,
        workspaceId: workspaceA,
        lastSeenAt: lastSeenAt ?? testNow,
        cachedAt: testNow,
        serialNo: Value<String?>(serialNo),
        serialNoNorm: Value<String?>(normaliseLookupKey(serialNo)),
        assetNo: Value<String?>(assetNo),
        position: const Value<String?>('LHF1'),
      );
    }

    test('serial search is case-insensitive but returns the stored value',
        () async {
      // RECORDED: the server serial column is case-split, and normalising it
      // would turn a split-history problem into a cannot-find-the-tyre problem
      // in the field. So the local lookup folds case; the stored value does
      // not.
      await db.cacheDao.upsertTyres(
        scope: scopeA,
        rows: <CachedTyresCompanion>[
          tyre(id: 't-1', serialNo: 'k507B403590'),
        ],
      );

      final found = await db.cacheDao.tyresBySerial(
        scope: scopeA,
        serial: 'K507B403590',
      );

      expect(found, hasLength(1));
      expect(found.single.serialNo, 'k507B403590');
    });

    test('tyres are scoped like everything else', () async {
      await db.cacheDao.upsertTyres(
        scope: scopeA,
        rows: <CachedTyresCompanion>[tyre(id: 't-1', serialNo: 'ABC123')],
      );

      expect(
        await db.cacheDao.tyresBySerial(scope: scopeB, serial: 'ABC123'),
        isEmpty,
      );
      expect(
        await db.cacheDao.tyresForAsset(scope: scopeB, assetNo: 'TM514'),
        isEmpty,
      );
    });

    test('the cap keeps the most recently seen tyres', () async {
      await db.cacheDao.upsertTyres(
        scope: scopeA,
        rows: <CachedTyresCompanion>[
          for (int i = 0; i < 5; i++)
            tyre(
              id: 't-$i',
              serialNo: 'S$i',
              lastSeenAt: testNow.add(Duration(minutes: i)),
            ),
        ],
      );

      await db.cacheDao.pruneTyresToCap(cap: 3);

      final remaining = await db.cacheDao.tyresForAsset(
        scope: scopeA,
        assetNo: 'TM514',
      );
      expect(remaining, hasLength(3));
      expect(
        remaining.map((CachedTyre t) => t.serialNo),
        unorderedEquals(<String>['S2', 'S3', 'S4']),
      );
    });
  });

  group('permissions', () {
    test('an expired grant is not returned at all', () async {
      await db.cacheDao.replacePermissions(
        userId: testUser,
        workspaceId: workspaceA,
        now: testNow,
        rows: <CachedPermissionsCompanion>[
          CachedPermissionsCompanion.insert(
            userId: testUser,
            moduleKey: 'records',
            workspaceId: workspaceA,
            effect: PermissionEffect.grant,
            capability: 'view',
            cachedAt: testNow,
            expiresAt: Value<DateTime?>(
              testNow.subtract(const Duration(days: 1)),
            ),
          ),
          CachedPermissionsCompanion.insert(
            userId: testUser,
            moduleKey: 'inspect',
            workspaceId: workspaceA,
            effect: PermissionEffect.grant,
            capability: 'view',
            cachedAt: testNow,
          ),
        ],
      );

      final live = await db.cacheDao.permissionsFor(
        userId: testUser,
        workspaceId: workspaceA,
        now: testNow,
      );

      expect(
        live.map((CachedPermission p) => p.moduleKey).toList(),
        <String>['inspect'],
      );
    });

    test('an empty table is a cache miss, not a denial', () async {
      // Nothing here decides access; it decides which screens are offered. The
      // resolver must read an empty table as "permissions have not loaded" and
      // render the role default. RLS remains the real boundary either way.
      final live = await db.cacheDao.permissionsFor(
        userId: testUser,
        workspaceId: workspaceA,
        now: testNow,
      );
      expect(live, isEmpty);
    });
  });

  group('recent searches', () {
    test('searching the same term twice updates rather than duplicates',
        () async {
      await db.cacheDao.recordSearch(
        userId: testUser,
        workspaceId: workspaceA,
        term: 'tm514',
        now: testNow,
      );
      await db.cacheDao.recordSearch(
        userId: testUser,
        workspaceId: workspaceA,
        term: 'TM514 ',
        now: testNow.add(const Duration(minutes: 5)),
        resultKind: 'asset',
        resultId: 'a-1',
      );

      final recents = await db.cacheDao.recentSearchesFor(
        userId: testUser,
        workspaceId: workspaceA,
      );
      expect(recents, hasLength(1));
      expect(recents.single.term, 'TM514 ');
      expect(recents.single.resultId, 'a-1');
    });

    test('sign-out clears them so a shared handset does not leak', () async {
      await db.cacheDao.recordSearch(
        userId: testUser,
        workspaceId: workspaceA,
        term: 'tm514',
        now: testNow,
      );
      await db.cacheDao.recordSearch(
        userId: 'someone-else',
        workspaceId: workspaceA,
        term: 'bp041',
        now: testNow,
      );

      await db.cacheDao.clearSearchesForUser(testUser);

      expect(
        await db.cacheDao.recentSearchesFor(
          userId: testUser,
          workspaceId: workspaceA,
        ),
        isEmpty,
      );
      expect(
        await db.cacheDao.recentSearchesFor(
          userId: 'someone-else',
          workspaceId: workspaceA,
        ),
        hasLength(1),
      );
    });

    test('the list is capped by count', () async {
      for (int i = 0; i < RetentionLimits.recentSearches + 3; i++) {
        await db.cacheDao.recordSearch(
          userId: testUser,
          workspaceId: workspaceA,
          term: 'term-$i',
          now: testNow.add(Duration(seconds: i)),
        );
      }

      final recents = await db.cacheDao.recentSearchesFor(
        userId: testUser,
        workspaceId: workspaceA,
        limit: 1000,
      );
      expect(recents, hasLength(RetentionLimits.recentSearches));
    });
  });

  group('active workspace', () {
    Future<void> addWorkspace(String id) async {
      await db.cacheDao.upsertWorkspace(
        WorkspaceScopesCompanion.insert(
          workspaceId: id,
          siteIdsJson: '["ALL"]',
          userId: testUser,
          role: 'Tyre Man',
          lastVerifiedAt: testNow,
        ),
      );
    }

    test('there is none until one is established', () async {
      expect(await db.cacheDao.activeWorkspace(), isNull);
    });

    test('exactly one workspace is active at a time', () async {
      await addWorkspace(workspaceA);
      await addWorkspace(workspaceB);

      await db.cacheDao.setActiveWorkspace(workspaceA);
      expect((await db.cacheDao.activeWorkspace())!.workspaceId, workspaceA);

      await db.cacheDao.setActiveWorkspace(workspaceB);
      final active = await db.cacheDao.activeWorkspace();
      expect(active!.workspaceId, workspaceB);

      final all = await db.cacheDao.allWorkspaces();
      expect(all.where((WorkspaceScopeRow w) => w.isActive), hasLength(1));
    });

    test('currency and country stay unset rather than being invented',
        () async {
      await addWorkspace(workspaceA);

      final row = (await db.cacheDao.allWorkspaces()).single;
      expect(
        row.currency,
        isNull,
        reason: 'hard-coding SAR is the recorded defect spec section 8 names',
      );
      expect(row.country, isNull);
    });
  });
}
