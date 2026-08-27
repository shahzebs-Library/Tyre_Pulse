/// Widget coverage for [TyreDiagramBoard]: the Total/OK/Monitor/Critical
/// stat row, the Layout/List toggle, and that a wheel tap in EITHER mode
/// reaches the caller with the exact same position id.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_board.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

/// The stat row + mode toggle sit ABOVE the diagram itself, so the combined
/// column is taller than the default 600-logical-pixel test surface. Left
/// at the default size, `SingleChildScrollView` clips the diagram's own
/// hit-testable area out of the viewport and a tap on it silently lands on
/// nothing - not a test bug in the widget, a test-surface-size bug in the
/// harness. Widen the surface instead of shrinking the board.
Future<void> _pump(WidgetTester tester, Widget board) {
  tester.view.physicalSize = const Size(900, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  return tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: SingleChildScrollView(child: board),
      ),
    ),
  );
}

/// A tyre position identifier such as `FL` is rendered through
/// [TpIdentifierText], which wraps it in bidi isolate marks (spec section
/// 52) so it can never be reordered inside translated prose. `find.text`
/// matches the literal rendered string, isolate marks included - so a bare
/// `find.text('FL')` never matches. Search for the isolated form instead.
Finder _identifierText(String value) =>
    find.text(TpDirection.isolateLtr(value));

void main() {
  testWidgets('the stat row and both mode chips render for a known vehicle',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const TyreDiagramBoard(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{
          'FL': <String, Object?>{'condition': 'Damaged'},
          'FR': <String, Object?>{'condition': 'Worn'},
        },
      ),
    );

    expect(find.text('Total tyres'), findsOneWidget);
    expect(find.text('OK'), findsOneWidget);
    expect(find.text('Monitor'), findsOneWidget);
    expect(find.text('Critical'), findsOneWidget);
    expect(find.text('4'), findsOneWidget);
    expect(find.text('Layout view'), findsOneWidget);
    expect(find.text('List view'), findsOneWidget);

    // Layout mode is the default - the diagram's own caption is visible.
    expect(find.text('FRONT'), findsOneWidget);
  });

  testWidgets(
      'switching to List view shows the flat position list instead '
      'of the diagram', (WidgetTester tester) async {
    await _pump(
      tester,
      const TyreDiagramBoard(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );

    expect(find.text('FRONT'), findsOneWidget);
    await tester.tap(find.text('List view'));
    await tester.pumpAndSettle();

    expect(find.text('FRONT'), findsNothing);
    expect(find.textContaining('Not recorded'), findsWidgets);
  });

  testWidgets(
      'a wheel tap in Layout mode reaches the caller with the '
      'caller-supplied position id', (WidgetTester tester) async {
    String? tapped;
    await _pump(
      tester,
      TyreDiagramBoard(
        vehicleType: 'PICKUP',
        positions: const <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: const <String, Map<String, Object?>>{},
        onPositionTap: (String id) => tapped = id,
      ),
    );

    // `find.byType(GestureDetector)` also matches the two [TpSegmented]
    // options above the diagram (`InkWell` wraps one internally), so scope
    // the search to descendants of the diagram itself - the only wheel hit
    // targets left are the four this test cares about.
    final Finder wheelHitTargets = find.descendant(
      of: find.byType(VehicleTyreDiagram),
      matching: find.byType(GestureDetector),
    );
    expect(wheelHitTargets, findsNWidgets(4));
    await tester.tap(wheelHitTargets.first);
    await tester.pump();
    expect(tapped, isNotNull);
    expect(<String>['FL', 'FR', 'RL', 'RR'], contains(tapped));
  });

  testWidgets('a row tap in List mode reaches the caller too', (
    WidgetTester tester,
  ) async {
    String? tapped;
    await _pump(
      tester,
      TyreDiagramBoard(
        vehicleType: 'PICKUP',
        positions: const <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: const <String, Map<String, Object?>>{},
        onPositionTap: (String id) => tapped = id,
      ),
    );

    await tester.tap(find.text('List view'));
    await tester.pumpAndSettle();
    await tester.tap(_identifierText('FL'));
    await tester.pump();
    expect(tapped, 'FL');
  });

  testWidgets('tyreless equipment shows the empty state with no stat row',
      (WidgetTester tester) async {
    await _pump(
      tester,
      const TyreDiagramBoard(
        vehicleType: 'GENERATOR',
        positions: <String>[],
        tyreData: <String, Map<String, Object?>>{},
      ),
    );

    expect(find.text('Total tyres'), findsNothing);
    expect(find.text('Layout view'), findsNothing);
  });
}
