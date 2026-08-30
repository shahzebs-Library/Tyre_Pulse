/// Widget coverage for the screenshot-faithful, asset-first checklist hub.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/checklists/checklists_providers.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_draft_repository.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_models.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_remote_repository.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/presentation/checklists_home_screen.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'operator-1',
  role: UserRole.known(RoleId.inspector),
  effectivePermissions: AccessState(
    role: UserRole.known(RoleId.inspector),
  ),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  tenantId: 'org-1',
  companyId: 'org-1',
  activeCountry: 'UAE',
  fullName: 'Imran Nadeem',
);

const VehicleAsset _pumpVehicle = VehicleAsset(
  id: 'vehicle-cp-045',
  assetNo: 'CP-045',
  make: 'SANY',
  model: 'SYG5360THB',
  vehicleType: 'Concrete Pump',
  site: 'Dubai Industrial City',
  currentKm: 68420,
);

const ChecklistTemplateRecord _template = ChecklistTemplateRecord(
  template: ChecklistTemplate(
    id: 'pre-start',
    name: 'Pre-start equipment checklist',
    fields: <ChecklistField>[
      ChecklistField(id: 'brakes', type: 'boolean', label: 'Brakes'),
    ],
  ),
  description: 'Daily equipment safety check',
  category: 'Safety',
  status: 'published',
);

const ChecklistAssignmentRecord _assignment = ChecklistAssignmentRecord(
  id: 'assignment-1',
  templateId: 'pre-start',
  templateName: 'Pre-start equipment checklist',
  site: 'Dubai Industrial City',
  assetNo: 'CP-045',
  dueDate: 'Due now',
  status: 'overdue',
);

final class _ChecklistRemoteFake implements ChecklistRemoteRepository {
  @override
  Future<List<ChecklistTemplateRecord>> listTemplates({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  }) async =>
      const <ChecklistTemplateRecord>[_template];

  @override
  Future<List<ChecklistAssignmentRecord>> listAssignments({
    String? country,
    String? role,
    bool isSuperAdmin = false,
  }) async =>
      const <ChecklistAssignmentRecord>[_assignment];

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

final class _ChecklistDraftFake implements ChecklistDraftRepository {
  @override
  Future<List<ChecklistDraftHeader>> draftsForUser(String userId) async =>
      const <ChecklistDraftHeader>[];

  @override
  Future<bool> hasContent(String draftKey) async => false;

  @override
  dynamic noSuchMethod(Invocation invocation) => super.noSuchMethod(invocation);
}

Future<ProviderContainer> _pump(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  ThemeData? theme,
  Size size = const Size(390, 844),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final List<Override> overrides = <Override>[
    workspaceContextProvider.overrideWithValue(_workspace),
    checklistRemoteRepositoryProvider.overrideWithValue(
      _ChecklistRemoteFake(),
    ),
    checklistDraftRepositoryProvider.overrideWithValue(
      _ChecklistDraftFake(),
    ),
    vehicleFleetListProvider.overrideWith(
      (Ref ref) async => const VehicleFleetListLoaded(
        assets: <VehicleAsset>[_pumpVehicle],
        truncated: false,
      ),
    ),
  ];

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const ChecklistsHomeScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return ProviderScope.containerOf(
    tester.element(find.byType(ChecklistsHomeScreen)),
  );
}

void main() {
  test('content language selection is independent and normalizes bad values',
      () {
    final ProviderContainer container = ProviderContainer();
    addTearDown(container.dispose);

    expect(container.read(checklistContentLanguageProvider), 'en');
    container
        .read(checklistContentLanguageProvider.notifier)
        .select('ur');
    expect(container.read(checklistContentLanguageProvider), 'ur');
    container
        .read(checklistContentLanguageProvider.notifier)
        .select('unsupported');
    expect(container.read(checklistContentLanguageProvider), 'en');
  });

  testWidgets(
    'compact hub matches the asset-first screenshot hierarchy with real '
    'vehicle artwork',
    (WidgetTester tester) async {
      final ProviderContainer container = await _pump(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Checklists'), findsOneWidget);
      expect(find.text('Synced'), findsOneWidget);
      expect(find.text('Scan QR or enter asset number'), findsOneWidget);
      expect(find.byKey(ChecklistsHomeScreenKeys.selectedAsset), findsOneWidget);
      expect(find.textContaining('CP-045 · Concrete Pump'), findsOneWidget);
      expect(find.textContaining('Dubai Industrial City'), findsNWidgets(2));
      expect(find.text('68,420 km'), findsOneWidget);
      expect(find.text('Master data verified'), findsOneWidget);
      expect(find.text('Required for this asset'), findsOneWidget);

      final Finder selectedAsset = find.byKey(
        ChecklistsHomeScreenKeys.selectedAsset,
      );
      final Image image = tester.widget<Image>(
        find.descendant(of: selectedAsset, matching: find.byType(Image)),
      );
      expect(
        (image.image as AssetImage).assetName,
        'assets/vehicle_photos/concrete_pump.png',
      );

      expect(container.read(checklistContentLanguageProvider), 'en');
      await tester.tap(find.text('العربية'));
      await tester.pump();
      expect(container.read(checklistContentLanguageProvider), 'ar');

      await tester.drag(find.byType(ListView), const Offset(0, -700));
      await tester.pump();
      expect(find.text('General checklist library'), findsOneWidget);
      expect(find.text('Tyre inspection'), findsOneWidget);
      expect(find.text('Checklist history for CP-045'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Arabic RTL and dark mode keep every hub section usable without overflow',
    (WidgetTester tester) async {
      await _pump(
        tester,
        locale: const Locale('ar'),
        theme: TpTheme.dark,
      );

      expect(tester.takeException(), isNull);
      expect(
        Directionality.of(
          tester.element(find.byKey(ChecklistsHomeScreenKeys.brandHeader)),
        ),
        TextDirection.rtl,
      );
      expect(find.byKey(ChecklistsHomeScreenKeys.searchField), findsOneWidget);
      expect(
        find.byKey(ChecklistsHomeScreenKeys.languageSelector),
        findsOneWidget,
      );
      expect(
        find.byKey(ChecklistsHomeScreenKeys.requiredForAsset),
        findsOneWidget,
      );
      await tester.drag(find.byType(ListView), const Offset(0, -700));
      await tester.pump();
      expect(
        find.byKey(ChecklistsHomeScreenKeys.tyreInspection),
        findsOneWidget,
      );
      expect(find.byKey(ChecklistsHomeScreenKeys.history), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
