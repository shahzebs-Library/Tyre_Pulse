import 'package:drift/native.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';

void main() {
  test('fleet cache uses the application database cache DAO', () async {
    final AppDatabase database = AppDatabase(NativeDatabase.memory());
    final ProviderContainer container = ProviderContainer(
      overrides: <Override>[
        appDatabaseProvider.overrideWithValue(database),
      ],
    );
    addTearDown(() async {
      container.dispose();
      await database.close();
    });

    expect(
      container.read(vehicleFleetCacheDaoProvider),
      same(database.cacheDao),
    );
  });

  group('vehicleInspectionDraftProvider', () {
    const WorkspaceContext workspace = WorkspaceContext(
      userId: 'user-1',
      role: UserRole.known(RoleId.inspector),
      effectivePermissions: AccessState(role: UserRole.known(RoleId.inspector)),
      countryScope: CountryScope.none,
      siteScope: SiteScope.none,
      companyId: 'org-a',
      activeCountry: 'KSA',
    );

    Future<(ProviderContainer, AppDatabase)> harness() async {
      final AppDatabase database = AppDatabase(NativeDatabase.memory());
      final ProviderContainer container = ProviderContainer(
        overrides: <Override>[
          appDatabaseProvider.overrideWithValue(database),
          workspaceContextProvider.overrideWithValue(workspace),
        ],
      );
      addTearDown(() async {
        container.dispose();
        await database.close();
      });
      return (container, database);
    }

    Future<void> save(
      AppDatabase db, {
      String workspaceId = 'org-a',
      String? country = 'KSA',
      int filled = 3,
      int total = 12,
    }) =>
        db.draftsDao.saveInspectionDraft(
          userId: 'user-1',
          workspaceId: workspaceId,
          assetNo: 'tm514',
          filled: filled,
          total: total,
          now: DateTime.utc(2026, 9, 27),
          country: country,
        );

    test('returns this workspace and country draft, matched on asset case',
        () async {
      final (ProviderContainer container, AppDatabase db) = await harness();
      await save(db);
      final InspectionDraftSummary? draft =
          await container.read(vehicleInspectionDraftProvider('TM514 ').future);
      expect(draft, isNotNull);
      expect(draft!.filled, 3);
      expect(draft.total, 12);
    });

    test('a draft captured under another workspace is not shown', () async {
      final (ProviderContainer container, AppDatabase db) = await harness();
      await save(db, workspaceId: 'org-b');
      expect(
        await container.read(vehicleInspectionDraftProvider('TM514').future),
        isNull,
      );
    });

    test('the same code in another country is a different machine', () async {
      final (ProviderContainer container, AppDatabase db) = await harness();
      await save(db, country: 'UAE');
      expect(
        await container.read(vehicleInspectionDraftProvider('TM514').future),
        isNull,
      );
    });

    test('a merely opened sheet and a total-less draft are not shown',
        () async {
      final (ProviderContainer container, AppDatabase db) = await harness();
      await save(db, filled: 0);
      expect(
        await container.read(vehicleInspectionDraftProvider('TM514').future),
        isNull,
      );
      await save(db, filled: 2, total: 0);
      container.invalidate(vehicleInspectionDraftProvider('TM514'));
      expect(
        await container.read(vehicleInspectionDraftProvider('TM514').future),
        isNull,
      );
    });

    test('draftWorkspaceIdsFor accepts the canonical and wizard spellings', () {
      expect(draftWorkspaceIdsFor(workspace), <String>{'org-a'});
      const WorkspaceContext blankCompany = WorkspaceContext(
        userId: 'u',
        role: UserRole.known(RoleId.inspector),
        effectivePermissions:
            AccessState(role: UserRole.known(RoleId.inspector)),
        countryScope: CountryScope.none,
        siteScope: SiteScope.none,
        companyId: ' ',
        tenantId: 'tenant-1',
      );
      expect(draftWorkspaceIdsFor(blankCompany), <String>{' ', 'tenant-1'});
    });
  });
}
