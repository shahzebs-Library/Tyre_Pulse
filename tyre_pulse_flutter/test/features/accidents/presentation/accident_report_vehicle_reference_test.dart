import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/data/accident_report_vehicle_photo.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_report_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_map_section.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_damage_zone_sheet.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_report_intake_widgets.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_fleet_providers.dart';

const VehicleAsset _pump = VehicleAsset(
  id: 'pump-5-axle',
  assetNo: 'CP3012',
  make: 'SANY',
  vehicleType: 'SANY Concrete Pump 5 axle',
  site: 'Diriyah',
);

const VehicleAsset _loader = VehicleAsset(
  id: 'wheel-loader',
  assetNo: 'WL509',
  make: 'SANY',
  vehicleType: 'SANY Wheel Loader',
  site: 'Qiddiya G2',
);

Future<void> _pumpReport(WidgetTester tester) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        accidentVehiclePhotoSourceProvider.overrideWithValue(_NoPhotos()),
        vehicleFleetListProvider.overrideWith(
          (Ref ref) async => const VehicleFleetListLoaded(
            assets: <VehicleAsset>[_pump, _loader],
            truncated: false,
          ),
        ),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const AccidentReportScreen(route: AccidentReportRoute()),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

Future<void> _selectPump(WidgetTester tester) async {
  await tester.ensureVisible(find.text('Select fleet asset'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('Select fleet asset'));
  await tester.pumpAndSettle();
  await tester.tap(find.text('CP3012').last);
  await tester.pumpAndSettle();
  tester
      .state<ScrollableState>(find.byType(Scrollable).first)
      .position
      .jumpTo(0);
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('selected asset makes the five real views the damage surface', (
    WidgetTester tester,
  ) async {
    await _pumpReport(tester);
    await _selectPump(tester);
    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.step(AccidentIntakePage.damage)),
    );
    await tester.pumpAndSettle();

    expect(find.byType(AccidentDamageMapSection), findsOneWidget);
    expect(find.text('Step 4 of 7: Mark damage'), findsOneWidget);
    // A concrete pump opens on Top (M9: Top, Left, Right, Front, Rear).
    final Image top = tester.widget<Image>(
      find.byKey(const Key('accident.damage.multiview.top')),
    );
    expect(
      (top.image as AssetImage).assetName,
      'assets/vehicle_multiview_views/'
      'sany_concrete_pump_5axle_five_view_v1_top.png',
    );
    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.left)),
    );
    await tester.pumpAndSettle();
    final Image left = tester.widget<Image>(
      find.byKey(const Key('accident.damage.multiview.left')),
    );
    expect(
      (left.image as AssetImage).assetName,
      'assets/vehicle_multiview_views/'
      'sany_concrete_pump_5axle_five_view_v1_left.png',
    );

    await tester.tap(
      find.byKey(AccidentDamageMapSectionKeys.viewTab(AccidentDamageView.rear)),
    );
    await tester.pumpAndSettle();
    final Image rear = tester.widget<Image>(
      find.byKey(const Key('accident.damage.multiview.rear')),
    );
    expect(
      (rear.image as AssetImage).assetName,
      'assets/vehicle_multiview_views/'
      'sany_concrete_pump_5axle_five_view_v1_rear.png',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'focused asset search can select and leave during reverse animation safely',
    (WidgetTester tester) async {
      await _pumpReport(tester);
      await tester.ensureVisible(find.text('Select fleet asset'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Select fleet asset'));
      await tester.pumpAndSettle();

      final Finder search = find.byType(TextField).first;
      await tester.enterText(search, 'CP3012');
      await tester.pump();
      await tester.tap(
        find.byKey(AccidentReportIntakeKeys.matchRow('pump-5-axle')).last,
      );
      await tester.pump(const Duration(milliseconds: 20));
      await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('focused picker can be dismissed and report can leave safely', (
    WidgetTester tester,
  ) async {
    await _pumpReport(tester);
    await tester.ensureVisible(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Select fleet asset'));
    await tester.pumpAndSettle();
    final Finder search = find.byType(TextField).first;
    await tester.enterText(search, 'CP');
    Navigator.of(tester.element(search)).pop();
    await tester.pump(const Duration(milliseconds: 20));
    await tester.pumpWidget(const MaterialApp(home: SizedBox.shrink()));
    await tester.pumpAndSettle();

    expect(tester.takeException(), isNull);
  });

  testWidgets('changing the selected asset clears its previous damage marks', (
    WidgetTester tester,
  ) async {
    await _pumpReport(tester);
    await _selectPump(tester);
    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.step(AccidentIntakePage.damage)),
    );
    await tester.pumpAndSettle();

    await tester
        .ensureVisible(find.byKey(AccidentDamageMapSectionKeys.diagram));
    await tester.pumpAndSettle();
    final Rect diagram =
        tester.getRect(find.byKey(AccidentDamageMapSectionKeys.diagram));
    await tester.tapAt(
      Offset(
        diagram.left + diagram.width * .80,
        diagram.top + diagram.height * .45,
      ),
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(AccidentDamageZoneSheetKeys.save));
    await tester.pumpAndSettle();
    expect(
      find.byKey(AccidentDamageMapSectionKeys.marksSummary),
      findsOneWidget,
    );

    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(
        AccidentReportIntakeKeys.step(AccidentIntakePage.identifyAsset),
      ),
    );
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.matchRow('wheel-loader')).last,
    );
    await tester.pumpAndSettle();
    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();

    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.step(AccidentIntakePage.damage)),
    );
    await tester.pumpAndSettle();
    expect(
      find.byKey(AccidentDamageMapSectionKeys.marksSummary),
      findsNothing,
    );
    final Image loaderLeft = tester.widget<Image>(
      find.byKey(const Key('accident.damage.multiview.left')),
    );
    expect(
      (loaderLeft.image as AssetImage).assetName,
      'assets/vehicle_multiview_views/'
      'sany_wheel_loader_five_view_v1_left.png',
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'the incident site is chosen by the reporter and survives an asset change',
      (WidgetTester tester) async {
    await _pumpReport(tester);
    await _selectPump(tester);
    expect(find.text('Step 1 of 7: Identify asset'), findsOneWidget);
    expect(find.text('2 matching assets'), findsOneWidget);
    expect(find.text('Where did the incident occur?'), findsOneWidget);
    expect(find.text(_siteHelp), findsOneWidget);
    expect(find.text(_lockNote), findsOneWidget);

    // Mock M1: the fleet home site is never written in for the reporter.
    final Finder siteRow = find.byKey(AccidentReportIntakeKeys.incidentSite);
    await tester.ensureVisible(siteRow);
    await tester.pumpAndSettle();
    expect(
      find.descendant(
        of: siteRow,
        matching: find.text('Select incident site / location'),
      ),
      findsOneWidget,
    );

    await tester.tap(siteRow);
    await tester.pumpAndSettle();
    // The home site is offered first, labelled, as one choice among many.
    expect(
      find.byKey(AccidentReportIntakeKeys.siteChip('Diriyah')),
      findsOneWidget,
    );
    await tester.enterText(
      find.byKey(AccidentReportIntakeKeys.incidentSiteField),
      'Riyadh Metro',
    );
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(AccidentReportIntakeKeys.useTypedSite));
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: siteRow, matching: find.text('Riyadh Metro')),
      findsOneWidget,
    );

    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(
      find.byKey(AccidentReportIntakeKeys.matchRow('wheel-loader')).last,
    );
    await tester.pumpAndSettle();

    await tester.ensureVisible(siteRow);
    await tester.pumpAndSettle();
    expect(
      find.descendant(of: siteRow, matching: find.text('Riyadh Metro')),
      findsOneWidget,
      reason: 'the loader home site (Qiddiya G2) must not overwrite it',
    );
    expect(tester.takeException(), isNull);
  });
}

/// The English ARB copy of the intake notes (tests run in `en`).
const String _lockNote =
    'These details are sourced from fleet master and cannot be edited here. '
    'If any detail is incorrect, please update it in the fleet system.';
const String _siteHelp =
    'Select the site/location of this incident. This may be different from '
    "the asset's home site.";

final class _NoPhotos implements AccidentVehiclePhotoSource {
  @override
  Future<Map<String, String>> uploadedPhotoPaths() async =>
      const <String, String>{};

  @override
  Future<String> signedUrl(String path) async => throw StateError(path);
}
