import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
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
      await tester.tap(find.widgetWithText(ListTile, 'CP3012').last);
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
    await tester.tap(find.widgetWithText(ListTile, 'WL509').last);
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

  testWidgets('an incident site the reporter typed survives an asset change', (
    WidgetTester tester,
  ) async {
    await _pumpReport(tester);
    await _selectPump(tester);
    expect(find.text('Step 1 of 7: Identify asset'), findsOneWidget);
    expect(find.text('2 matching assets'), findsOneWidget);
    expect(find.text('Where did the incident occur?'), findsOneWidget);
    expect(find.text(accidentIncidentSiteHelp), findsOneWidget);
    expect(find.text(accidentFleetMasterLockNote), findsOneWidget);

    final Finder siteField = find.descendant(
      of: find.byKey(AccidentReportIntakeKeys.incidentSite),
      matching: find.byType(TextField),
    );
    await tester.ensureVisible(siteField);
    expect(tester.widget<TextField>(siteField).controller?.text, 'Diriyah');
    await tester.enterText(siteField, 'Riyadh Metro');
    await tester.pumpAndSettle();

    tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .jumpTo(0);
    await tester.pumpAndSettle();
    await tester.ensureVisible(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(find.text('Change asset').first);
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(ListTile, 'WL509').last);
    await tester.pumpAndSettle();

    expect(
      tester.widget<TextField>(siteField).controller?.text,
      'Riyadh Metro',
      reason: 'the loader home site (Qiddiya G2) must not overwrite it',
    );
    expect(tester.takeException(), isNull);
  });
}
