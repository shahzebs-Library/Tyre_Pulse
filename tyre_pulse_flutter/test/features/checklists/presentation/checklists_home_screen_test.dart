/// Widget coverage for the screenshot-faithful, asset-first checklist hub.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/module_registry.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
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
  effectivePermissions: AccessState(role: UserRole.known(RoleId.inspector)),
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
  const _ChecklistRemoteFake({
    this.assignments = const <ChecklistAssignmentRecord>[_assignment],
  });

  final List<ChecklistAssignmentRecord> assignments;

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
      assignments;

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
  Size size = const Size(360, 800),
  TextScaler textScaler = TextScaler.noScaling,
  ChecklistRemoteRepository remote = const _ChecklistRemoteFake(),
  VehicleDetailOutcome vehicleOutcome = const VehicleDetailLoaded(_pumpVehicle),
  int pendingSyncCount = 0,
  bool canScan = true,
  bool canInspect = true,
  bool canOpenVehicles = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final List<Override> overrides = <Override>[
    workspaceContextProvider.overrideWithValue(_workspace),
    checklistRemoteRepositoryProvider.overrideWithValue(remote),
    checklistDraftRepositoryProvider.overrideWithValue(_ChecklistDraftFake()),
    vehicleDetailProvider('CP-045')
        .overrideWith((Ref ref) async => vehicleOutcome),
    checklistPendingSyncCountProvider.overrideWith(
      (Ref ref) async => pendingSyncCount,
    ),
    canAccessModuleProvider(ModuleKey.scan).overrideWith((Ref ref) => canScan),
    canAccessModuleProvider(ModuleKey.inspect)
        .overrideWith((Ref ref) => canInspect),
    canAccessModuleProvider(ModuleKey.vehicles)
        .overrideWith((Ref ref) => canOpenVehicles),
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
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context).copyWith(textScaler: textScaler),
          child: child!,
        ),
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
  test(
    'content language selection is independent and normalizes bad values',
    () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(checklistContentLanguageProvider), 'en');
      container.read(checklistContentLanguageProvider.notifier).select('ur');
      expect(container.read(checklistContentLanguageProvider), 'ur');
      container
          .read(checklistContentLanguageProvider.notifier)
          .select('unsupported');
      expect(container.read(checklistContentLanguageProvider), 'en');
    },
  );

  testWidgets(
    'compact hub matches the asset-first screenshot hierarchy with real '
    'vehicle artwork',
    (WidgetTester tester) async {
      final ProviderContainer container = await _pump(tester);

      expect(tester.takeException(), isNull);
      expect(find.text('Checklists'), findsOneWidget);
      expect(find.text('Synced'), findsOneWidget);
      expect(find.text('Scan QR or enter asset number'), findsOneWidget);
      expect(
        find.byKey(ChecklistsHomeScreenKeys.selectedAsset),
        findsOneWidget,
      );
      expect(find.textContaining('CP-045 · Concrete Pump'), findsOneWidget);
      expect(find.textContaining('Dubai Industrial City'), findsNWidgets(2));
      expect(find.text('68,420 km'), findsOneWidget);
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
      expect(find.text('Checklist history'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Arabic RTL and dark mode keep every hub section usable without overflow',
    (WidgetTester tester) async {
      await _pump(tester, locale: const Locale('ar'), theme: TpTheme.dark);

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

  testWidgets(
    'site-wide assignments remain reachable when an asset is selected',
    (WidgetTester tester) async {
      const ChecklistAssignmentRecord globalAssignment =
          ChecklistAssignmentRecord(
        id: 'assignment-global',
        templateId: 'site-safety',
        templateName: 'Site safety briefing',
        site: 'Dubai Industrial City',
        status: 'pending',
      );
      await _pump(
        tester,
        remote: const _ChecklistRemoteFake(
          assignments: <ChecklistAssignmentRecord>[
            _assignment,
            globalAssignment,
          ],
        ),
      );

      expect(
        find.text('CP-045 · Concrete Pump · SANY · SYG5360THB'),
        findsOneWidget,
      );
      expect(find.text('Site safety briefing'), findsOneWidget);
      expect(find.text('Pending'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'multiple assigned assets require an explicit choice and refresh keeps it',
    (WidgetTester tester) async {
      const ChecklistAssignmentRecord secondAsset = ChecklistAssignmentRecord(
        id: 'assignment-2',
        templateId: 'pre-start',
        templateName: 'Second vehicle pre-start',
        site: 'Dubai Industrial City',
        assetNo: 'MP-093',
        status: 'pending',
      );
      await _pump(
        tester,
        remote: const _ChecklistRemoteFake(
          assignments: <ChecklistAssignmentRecord>[_assignment, secondAsset],
        ),
      );

      expect(find.byKey(ChecklistsHomeScreenKeys.selectedAsset), findsNothing);
      await tester.enterText(find.byType(TextField), 'CP-045');
      await tester.pump();
      await tester.tap(find.widgetWithText(ActionChip, 'CP-045'));
      await tester.pumpAndSettle();
      expect(
        find.byKey(ChecklistsHomeScreenKeys.selectedAsset),
        findsOneWidget,
      );

      await tester.drag(find.byType(ListView), const Offset(0, 320));
      await tester.pumpAndSettle();
      expect(find.textContaining('CP-045 · Concrete Pump'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('cached asset data is labelled offline and never claims synced', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      vehicleOutcome: const VehicleDetailFromCache(asset: _pumpVehicle),
    );

    expect(find.byKey(TpStateKeys.offlineCached), findsOneWidget);
    expect(find.text('Synced'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('pending offline work suppresses the synced claim', (
    WidgetTester tester,
  ) async {
    await _pump(tester, pendingSyncCount: 2);

    expect(find.text('Synced'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'narrow large-text layout keeps permission-gated actions usable',
    (WidgetTester tester) async {
      await _pump(
        tester,
        size: const Size(320, 700),
        textScaler: const TextScaler.linear(1.3),
        canScan: false,
        canInspect: false,
        canOpenVehicles: false,
      );

      expect(find.byIcon(Icons.qr_code_scanner_rounded), findsNothing);
      await tester.drag(find.byType(ListView), const Offset(0, -900));
      await tester.pump();
      expect(find.byKey(ChecklistsHomeScreenKeys.tyreInspection), findsNothing);
      expect(find.byKey(ChecklistsHomeScreenKeys.history), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
