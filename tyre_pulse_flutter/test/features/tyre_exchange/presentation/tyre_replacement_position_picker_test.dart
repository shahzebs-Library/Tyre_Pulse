import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';
import 'package:tyre_pulse/features/tyre_exchange/domain/tyre_replacement_position.dart';
import 'package:tyre_pulse/features/tyre_exchange/presentation/widgets/tyre_replacement_position_picker.dart';

Future<void> _pumpPicker(
  WidgetTester tester, {
  required String vehicleType,
  required String assetNo,
  required String selectedCode,
  required ValueChanged<String> onSelected,
}) async {
  tester.view.physicalSize = const Size(390, 1400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);

  await tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: const Locale('en'),
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: SingleChildScrollView(
          padding: const EdgeInsets.all(16),
          child: TyreReplacementPositionPicker(
            vehicleType: vehicleType,
            assetNo: assetNo,
            options: tyreReplacementPositions(vehicleType, assetNo),
            selectedCode: selectedCode,
            onSelected: onSelected,
          ),
        ),
      ),
    ),
  );
  await tester.pump();
}

void main() {
  testWidgets(
    'five-axle concrete pump reuses the full 14-slot capture diagram',
    (WidgetTester tester) async {
      await _pumpPicker(
        tester,
        vehicleType: 'Concrete pump',
        assetNo: 'MP083',
        selectedCode: 'RHR1-I',
        onSelected: (_) {},
      );

      final VehicleTyreDiagram diagram = tester.widget<VehicleTyreDiagram>(
        find.byType(VehicleTyreDiagram),
      );
      expect(diagram.captureMode, isTrue);
      expect(diagram.compact, isTrue);
      expect(diagram.positions, hasLength(14));
      expect(diagram.positions, containsAll(<String>['R1Ri', 'R1Ro']));
      expect(diagram.selectedPosition, 'R1Ri');
      expect(
        find.byKey(TyreReplacementPositionPickerKeys.spare),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a visual slot tap emits the canonical replacement position code',
    (WidgetTester tester) async {
      String? selected;
      await _pumpPicker(
        tester,
        vehicleType: 'Tri-mixer',
        assetNo: 'TM514',
        selectedCode: '',
        onSelected: (String value) => selected = value,
      );

      final VehicleTyreDiagram diagram = tester.widget<VehicleTyreDiagram>(
        find.byType(VehicleTyreDiagram),
      );
      diagram.onPositionTap!('R1Li');
      expect(selected, 'LHCI');
    },
  );

  testWidgets(
    'Arabic keeps the vehicle coordinate system LTR and technical ids intact',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(390, 1400);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.reset);

      await tester.pumpWidget(
        MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: TpTheme.light,
          locale: const Locale('ar'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(
            body: Directionality(
              textDirection: TextDirection.rtl,
              child: SingleChildScrollView(
                padding: const EdgeInsets.all(16),
                child: TyreReplacementPositionPicker(
                  vehicleType: 'Tri-mixer',
                  assetNo: 'TM514',
                  options: tyreReplacementPositions('Tri-mixer', 'TM514'),
                  selectedCode: 'RHCO',
                  onSelected: (_) {},
                ),
              ),
            ),
          ),
        ),
      );
      await tester.pump();

      final Iterable<Directionality> directions = tester.widgetList(
        find.descendant(
          of: find.byKey(TyreReplacementPositionPickerKeys.diagram),
          matching: find.byType(Directionality),
        ),
      );
      expect(
        directions.any(
          (Directionality value) => value.textDirection == TextDirection.ltr,
        ),
        isTrue,
      );
      final VehicleTyreDiagram diagram = tester.widget<VehicleTyreDiagram>(
        find.byType(VehicleTyreDiagram),
      );
      expect(diagram.selectedPosition, 'R1Ro');
      expect(tester.takeException(), isNull);
    },
  );
}
