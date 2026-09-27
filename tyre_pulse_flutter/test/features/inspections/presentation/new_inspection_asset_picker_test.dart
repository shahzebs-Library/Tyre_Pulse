// The asset scan / search / selection step of New Inspection.
//
// Pins the owner-mock layout (one full-width Scan action, a search field,
// class filter chips, rich result rows and a large selected-asset card with
// the continue action) AND the honesty rules behind it: chips come only from
// real asset-number prefixes, a typed search always covers the whole fleet,
// and no field the fleet row does not carry is ever rendered.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';
import 'package:tyre_pulse/features/inspections/inspections_providers.dart';
import 'package:tyre_pulse/features/inspections/presentation/controllers/inspection_wizard_controller.dart';
import 'package:tyre_pulse/features/inspections/presentation/new_inspection_screen.dart';
import 'package:tyre_pulse/features/inspections/presentation/state/inspection_wizard_state.dart';

const List<VehicleAsset> _fleet = <VehicleAsset>[
  VehicleAsset(
    id: 'tm-1',
    assetNo: 'TM214',
    vehicleType: 'Tr-Mixer',
    site: 'Jebel Ali',
    status: 'Active',
  ),
  VehicleAsset(
    id: 'tm-2',
    assetNo: 'TM215',
    vehicleType: 'Tr-Mixer',
    site: 'Jebel Ali',
  ),
  VehicleAsset(
    id: 'mp-1',
    assetNo: 'MP2104',
    vehicleType: 'HEAVY EQP',
    site: 'Al Sajaa',
    opsStatus: 'Breakdown',
    status: 'Active',
  ),
  // Tyreless plant: no site, no status - nothing may be invented for it.
  VehicleAsset(id: 'gn-1', assetNo: 'GN103', vehicleType: 'GENERATOR'),
];

Future<void> _pump(
  WidgetTester tester, {
  InspectionWizardState initialState = const InspectionWizardState(),
  List<VehicleAsset> fleet = _fleet,
  Locale locale = const Locale('en'),
  ThemeData? theme,
  Size size = const Size(390, 1400),
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        inspectionWizardControllerProvider.overrideWithBuild(
          (ref, controller) => initialState,
        ),
        inspectionRemoteRepositoryProvider.overrideWithValue(
          const _FakeInspectionRemoteRepository(),
        ),
        vehicleFleetListProvider.overrideWith(
          (ref) async => VehicleFleetListLoaded(
            assets: fleet,
            truncated: false,
          ),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: theme ?? TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const NewInspectionScreen(route: NewInspectionRoute()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Finder _id(String value) => find.byWidgetPredicate(
      (Widget w) => w is TpIdentifierText && w.value == value,
    );

Future<void> _tapChip(WidgetTester tester, String assetClass) async {
  final Finder chip = find.byKey(
    NewInspectionScreenKeys.pickerClassChip(assetClass),
  );
  await tester.ensureVisible(chip);
  await tester.pumpAndSettle();
  await tester.tap(chip);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('picker leads with one full-width primary Scan action', (
    WidgetTester tester,
  ) async {
    await _pump(tester);

    final Finder scan = find.byKey(NewInspectionScreenKeys.vehicleScanner);
    expect(scan, findsOneWidget);
    final TpButton button = tester.widget<TpButton>(
      find.descendant(of: scan, matching: find.byType(TpButton)),
    );
    expect(button.variant, TpButtonVariant.primary);
    expect(button.isFullWidth, isTrue);
    expect(button.label, 'Scan asset');
    final Rect section = tester.getRect(
      find.byKey(NewInspectionScreenKeys.vehicleSection),
    );
    expect(tester.getRect(scan).width, greaterThan(section.width * 0.8));
    // Scan sits above the search field.
    expect(
      tester.getRect(scan).bottom,
      lessThanOrEqualTo(tester.getRect(find.byType(TpSearchField)).top),
    );
    // No site or meter fields until an asset is chosen.
    expect(find.byKey(NewInspectionScreenKeys.detailsSection), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('class chips come from real asset-number prefixes only', (
    WidgetTester tester,
  ) async {
    await _pump(tester);

    expect(
      find.byKey(NewInspectionScreenKeys.pickerClassFilters),
      findsOneWidget,
    );
    expect(find.text('All (4)'), findsOneWidget);
    expect(find.text('TM (2)'), findsOneWidget);
    expect(find.text('MP (1)'), findsOneWidget);
    expect(find.text('GN (1)'), findsOneWidget);
    // No invented buckets.
    expect(find.text('Vehicles'), findsOneWidget); // the section title only
    expect(find.textContaining('Equipment'), findsNothing);
    expect(find.textContaining('Plant'), findsNothing);
    // Tyre-carrying classes sort before tyreless ones.
    expect(
      tester.getTopLeft(find.text('TM (2)')).dx,
      lessThan(tester.getTopLeft(find.text('GN (1)')).dx),
    );
  });

  testWidgets('a class chip browses that class with truthful rows', (
    WidgetTester tester,
  ) async {
    await _pump(tester);

    await _tapChip(tester, 'MP');

    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('MP2104')),
      findsOneWidget,
    );
    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('TM214')),
      findsNothing,
    );
    expect(
      tester
          .widget<Text>(
            find.byKey(NewInspectionScreenKeys.pickerVehicleClass('MP2104')),
          )
          .data,
      'Concrete pump',
    );
    expect(find.text('Al Sajaa'), findsOneWidget);
    // The operational status wins over the register status when recorded.
    final TpStatusChip chip = tester.widget<TpStatusChip>(
      find.descendant(
        of: find.byKey(NewInspectionScreenKeys.pickerRow('MP2104')),
        matching: find.byType(TpStatusChip),
      ),
    );
    expect(chip.label, 'Breakdown');
    // No data this screen does not have is rendered.
    expect(find.textContaining('PM due'), findsNothing);
    expect(find.textContaining('Inspected'), findsNothing);
  });

  testWidgets('tyreless plant row omits the site and status it does not have',
      (WidgetTester tester) async {
    await _pump(tester);

    await _tapChip(tester, 'GN');

    final Finder row = find.byKey(NewInspectionScreenKeys.pickerRow('GN103'));
    expect(row, findsOneWidget);
    expect(
      find.descendant(of: row, matching: find.byType(TpStatusChip)),
      findsNothing,
    );
    expect(
      find.descendant(
        of: row,
        matching: find.byIcon(Icons.location_on_outlined),
      ),
      findsNothing,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a typed search covers the whole fleet despite a class chip', (
    WidgetTester tester,
  ) async {
    await _pump(tester);

    await _tapChip(tester, 'MP');
    await tester.enterText(find.byType(TextField).first, 'GN103');
    await tester.pumpAndSettle();

    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('GN103')),
      findsOneWidget,
    );
  });

  testWidgets('more matches than the list shows says so', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      size: const Size(390, 4000),
      fleet: <VehicleAsset>[
        for (int i = 0; i < 35; i++)
          VehicleAsset(id: 'tm-$i', assetNo: 'TM${500 + i}'),
      ],
    );

    await _tapChip(tester, 'TM');

    expect(
      find.byKey(NewInspectionScreenKeys.pickerTruncated),
      findsOneWidget,
    );
    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('TM529')),
      findsOneWidget,
    );
    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('TM530')),
      findsNothing,
    );
  });

  testWidgets(
    'selected card shows photo, class badge, id, class, site, status and '
    'carries the continue action',
    (WidgetTester tester) async {
      await _pump(
        tester,
        initialState: const InspectionWizardState(
          selectedAssetNo: 'TM214',
          selectedVehicleType: 'Tr-Mixer',
          selectedSite: 'Jebel Ali',
        ),
      );

      final Finder card = find.byKey(NewInspectionScreenKeys.vehicleSection);
      Finder inCard(Finder f) => find.descendant(of: card, matching: f);
      expect(
        inCard(find.byKey(NewInspectionScreenKeys.selectedVehicleImage)),
        findsOneWidget,
      );
      expect(
        tester
            .getSize(find.byKey(NewInspectionScreenKeys.selectedVehicleImage))
            .height,
        greaterThanOrEqualTo(160),
      );
      expect(inCard(_id('TM')), findsOneWidget);
      expect(inCard(_id('TM214')), findsOneWidget);
      expect(
        tester
            .widget<Text>(
              find.byKey(NewInspectionScreenKeys.selectedVehicleClass),
            )
            .data,
        'Tri-mixer',
      );
      expect(inCard(find.text('Active')), findsOneWidget);
      expect(
        inCard(find.byKey(NewInspectionScreenKeys.detailsSection)),
        findsOneWidget,
      );
      final Finder continueButton = inCard(
        find.byKey(NewInspectionScreenKeys.selectedContinue),
      );
      expect(continueButton, findsOneWidget);
      final TpButton button = tester.widget<TpButton>(continueButton);
      expect(button.isFullWidth, isTrue);
      expect(button.onPressed, isNotNull);
      expect(
        inCard(find.byKey(NewInspectionScreenKeys.selectedChange)),
        findsOneWidget,
      );
      // One continue action on the step, not two.
      expect(find.text('Next: tyre positions'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('continue stays disabled until a site is set', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      initialState: const InspectionWizardState(
        selectedAssetNo: 'GN103',
        selectedVehicleType: '',
      ),
    );

    final TpButton button = tester.widget<TpButton>(
      find.byKey(NewInspectionScreenKeys.selectedContinue),
    );
    expect(button.onPressed, isNull);
    // Tyreless plant still renders a complete card without inventing data.
    expect(
      find.byKey(NewInspectionScreenKeys.selectedVehicleImage),
      findsOneWidget,
    );
    expect(find.byType(TpStatusChip), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic dark picker and selected card lay out without overflow',
      (WidgetTester tester) async {
    await _pump(
      tester,
      locale: const Locale('ar'),
      theme: TpTheme.dark,
      size: const Size(360, 1400),
    );
    await _tapChip(tester, 'MP');
    expect(
      find.byKey(NewInspectionScreenKeys.pickerRow('MP2104')),
      findsOneWidget,
    );
    // In RTL the row's status column sits on the leading (left) side.
    final Rect row = tester.getRect(
      find.byKey(NewInspectionScreenKeys.pickerRow('MP2104')),
    );
    final Rect id = tester.getRect(_id('MP2104'));
    expect(id.center.dx, greaterThan(row.center.dx));
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic dark selected card lays out without overflow', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      locale: const Locale('ar'),
      theme: TpTheme.dark,
      size: const Size(360, 1400),
      initialState: const InspectionWizardState(
        selectedAssetNo: 'MP2104',
        selectedVehicleType: '',
        selectedSite: 'Al Sajaa',
      ),
    );
    expect(
      find.byKey(NewInspectionScreenKeys.selectedContinue),
      findsOneWidget,
    );
    expect(find.text('Breakdown'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

final class _FakeInspectionRemoteRepository
    implements InspectionRemoteRepository {
  const _FakeInspectionRemoteRepository();

  @override
  Future<InspectionRecord?> byId(String id) async => null;

  @override
  Future<List<String>> listSites({String? country}) async =>
      const <String>['Jebel Ali', 'Al Sajaa'];

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async =>
      const <InspectionRecord>[];

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) async {}
}
