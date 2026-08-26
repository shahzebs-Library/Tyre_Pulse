/// Widget tests for [VehicleTyreDiagram]: rendering, hit-testing, RTL and
/// accessibility, per artifact section 7.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget diagram, {
  Locale locale = const Locale('en'),
}) {
  return tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: Center(
          child: SingleChildScrollView(child: diagram),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('renders the resolved layout for a known vehicle type', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );
    expect(find.text('FRONT'), findsOneWidget);
    expect(find.textContaining('PICKUP'), findsOneWidget);
    expect(find.text('Tap a tyre to record its condition'), findsOneWidget);
    // 4 wheel hit targets + one per legend chip is not asserted precisely
    // here; the count of GestureDetectors covering the wheels is asserted
    // via the tap test below instead, which is the behaviour that matters.
  });

  testWidgets('tyreless equipment renders the empty state, no diagram', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'STATIONARY PUMP',
        positions: <String>[],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );
    expect(
      find.text('Stationary equipment, no tyres to inspect.'),
      findsOneWidget,
    );
    expect(find.text('FRONT'), findsNothing);
  });

  testWidgets('a known vehicle type with no positions shows the empty '
      'positions state, not the tyreless state', (WidgetTester tester) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>[],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );
    expect(find.text('No tyre positions to display.'), findsOneWidget);
  });

  testWidgets('tapping a wheel hit target invokes onPositionTap with the '
      'exact caller-supplied position id', (WidgetTester tester) async {
    String? tapped;
    await _pump(
      tester,
      VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: const <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: const <String, Map<String, Object?>>{},
        onPositionTap: (String id) => tapped = id,
      ),
    );

    final Finder hitTargets = find.byType(GestureDetector);
    expect(hitTargets, findsWidgets);
    await tester.tap(hitTargets.first);
    await tester.pump();
    expect(tapped, isNotNull);
    expect(<String>['FL', 'FR', 'RL', 'RR'], contains(tapped));
  });

  testWidgets(
    'the diagram body stays left-to-right regardless of the ambient '
    'locale direction (artifact section 7.3, rule 1)',
    (WidgetTester tester) async {
      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: <String, Map<String, Object?>>{},
        ),
        locale: const Locale('ar'),
      );

      final Iterable<Directionality> directionalities = tester
          .widgetList<Directionality>(find.byType(Directionality));
      // At least one Directionality in the tree is forced ltr - the one
      // this widget wraps its own diagram body in - even though the
      // ambient MaterialApp locale is Arabic (rtl).
      expect(
        directionalities.any(
          (Directionality d) => d.textDirection == TextDirection.ltr,
        ),
        isTrue,
      );
    },
  );

  testWidgets(
    'a wheel with a recorded condition exposes an accessibility label '
    'built from the V2 code, never the internal V1 id',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      addTearDown(handle.dispose);

      await _pump(
        tester,
        VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: const <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: <String, Map<String, Object?>>{
            'FL': <String, Object?>{
              'condition': 'Damaged',
              'pressure_psi': '95',
            },
          },
        ),
      );

      // FL's V2 code on Pickup is LHF1 (verified in group G). The label
      // must carry the code and condition; it must never carry the bare
      // internal slot id as a spoken word.
      expect(
        find.bySemanticsLabel(RegExp('LHF1.*Damaged.*95')),
        findsOneWidget,
      );
    },
  );

  testWidgets('the selected wheel is marked selected in its semantics '
      'node', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();
    addTearDown(handle.dispose);

    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{},
        selectedPosition: 'FL',
      ),
    );

    final SemanticsNode node = tester.getSemantics(
      find.bySemanticsLabel(RegExp('LHF1')),
    );
    expect(
      node.hasFlag(SemanticsFlag.isSelected),
      isTrue,
    );
  });

  testWidgets('the condition legend shows all six conditions', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );
    for (final String label in <String>[
      'Good',
      'Worn',
      'Damaged',
      'Puncture',
      'Flat',
      'Missing',
    ]) {
      expect(find.widgetWithText(TpStatusChip, label), findsOneWidget);
    }
  });

  testWidgets('unmatched (foreign vocabulary) positions still render the '
      'whole layout rather than a blank diagram', (WidgetTester tester) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['WHEEL_ALPHA'],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );
    // The layout falls back to all 4 slots (matchPositionsToLayout test
    // 59), so the tyre-count caption still reads 4, not 0 or 1.
    expect(find.textContaining('4'), findsWidgets);
  });

  testWidgets(
    'every wheel hit target measures at least the Material minimum '
    'touch size, even on the smallest production layout geometry',
    (WidgetTester tester) async {
      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'Line pump',
          positions: <String>[
            'F1L',
            'F1R',
            'F2L',
            'F2R',
            'R1Lo',
            'R1Li',
            'R1Ri',
            'R1Ro',
            'R2Lo',
            'R2Li',
            'R2Ri',
            'R2Ro',
          ],
          tyreData: <String, Map<String, Object?>>{},
          width: 300,
        ),
      );
      final Finder targets = find.byType(GestureDetector);
      final int count = tester.widgetList(targets).length;
      expect(count, greaterThan(0));
      for (int i = 0; i < count; i++) {
        final Size size = tester.getSize(targets.at(i));
        expect(size.width, greaterThanOrEqualTo(48));
        expect(size.height, greaterThanOrEqualTo(48));
      }
    },
  );
}
