/// Widget tests for [VehicleTyreDiagram]: rendering, hit-testing, RTL and
/// accessibility, per artifact section 7.
library;

import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_body_painter.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/vehicle_tyre_diagram.dart';

Future<void> _pump(
  WidgetTester tester,
  Widget diagram, {
  Locale locale = const Locale('en'),
  TextScaler textScaler = TextScaler.noScaling,
}) {
  return tester.pumpWidget(
    MaterialApp(
      debugShowCheckedModeBanner: false,
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      builder: (BuildContext context, Widget? child) => MediaQuery(
        data: MediaQuery.of(context).copyWith(textScaler: textScaler),
        child: child!,
      ),
      home: Scaffold(
        body: Center(child: SingleChildScrollView(child: diagram)),
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

  testWidgets(
      'a known vehicle type with no positions shows the empty '
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

  testWidgets(
      'tapping a wheel hit target invokes onPositionTap with the '
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
      'locale direction (artifact section 7.3, rule 1)', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{},
      ),
      locale: const Locale('ar'),
    );

    final Iterable<Directionality> directionalities =
        tester.widgetList<Directionality>(find.byType(Directionality));
    // At least one Directionality in the tree is forced ltr - the one
    // this widget wraps its own diagram body in - even though the
    // ambient MaterialApp locale is Arabic (rtl).
    expect(
      directionalities.any(
        (Directionality d) => d.textDirection == TextDirection.ltr,
      ),
      isTrue,
    );
  });

  testWidgets(
    'a wheel with a recorded condition exposes an accessibility label '
    'built from the V2 code, never the internal V1 id',
    (WidgetTester tester) async {
      // Disposed with an explicit call at the end of the test body, not via
      // addTearDown: the binding's own end-of-test invariant check (no
      // SemanticsHandle left active) runs before addTearDown callbacks
      // fire, so an addTearDown-only disposal reads as a leak every time.
      // This is the exact pattern flutter_test's own `matchesSemantics`
      // doc comment uses.
      final SemanticsHandle handle = tester.ensureSemantics();

      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: <String>['FL', 'FR', 'RL', 'RR'],
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

      handle.dispose();
    },
  );

  testWidgets(
    'an unchecked seeded Good wheel is announced as not recorded, never Good',
    (WidgetTester tester) async {
      final SemanticsHandle handle = tester.ensureSemantics();
      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: <String, Map<String, Object?>>{
            'FL': <String, Object?>{
              'condition': 'Good',
              'checked': false,
            },
          },
        ),
      );

      expect(
        find.bySemanticsLabel(RegExp('LHF1.*Not recorded')),
        findsOneWidget,
      );
      expect(
        find.bySemanticsLabel(RegExp('LHF1.*Good')),
        findsNothing,
      );

      handle.dispose();
    },
  );

  testWidgets(
      'the selected wheel is marked selected in its semantics '
      'node', (WidgetTester tester) async {
    final SemanticsHandle handle = tester.ensureSemantics();

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
    // `hasFlag` is deprecated in this resolved Flutter version in favour of
    // `flagsCollection`.
    expect(node.flagsCollection.isSelected, Tristate.isTrue);

    handle.dispose();
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

  testWidgets(
    'selected flat tyre has a persistent warning summary with pressure',
    (WidgetTester tester) async {
      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: <String, Map<String, Object?>>{
            'FL': <String, Object?>{
              'condition': 'Flat',
              'pressure_psi': 0,
            },
          },
          selectedPosition: 'FL',
        ),
      );

      expect(find.text('LHF1'), findsOneWidget);
      expect(find.text('Flat'), findsNWidgets(2));
      expect(find.textContaining('0'), findsWidgets);
      expect(find.byIcon(Icons.report_problem_outlined), findsWidgets);
    },
  );

  testWidgets('puncture remains visible in the selected tyre summary', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'PICKUP',
        positions: <String>['FL', 'FR', 'RL', 'RR'],
        tyreData: <String, Map<String, Object?>>{
          'FR': <String, Object?>{'condition': 'Puncture'},
        },
        selectedPosition: 'FR',
      ),
    );

    expect(find.text('RHF1'), findsOneWidget);
    expect(find.text('Puncture'), findsNWidgets(2));
  });

  testWidgets(
      'unmatched (foreign vocabulary) positions still render the '
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
      'touch size, even on the smallest production layout geometry', (
    WidgetTester tester,
  ) async {
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
  });

  testWidgets(
    'focused pickup capture uses the approved real photo and preserves ids',
    (WidgetTester tester) async {
      String? tapped;
      await _pump(
        tester,
        VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: const <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: const <String, Map<String, Object?>>{},
          width: 366,
          compact: true,
          captureMode: true,
          onPositionTap: (String id) => tapped = id,
        ),
      );

      expect(
        find.byKey(const Key('tyre.diagram.figma_capture_stage')),
        findsOneWidget,
      );
      expect(
        find.byKey(
          const ValueKey<String>('assets/vehicle_photos/pickup.png'),
        ),
        findsOneWidget,
      );

      await tester.tap(find.bySemanticsLabel(RegExp('LHF1')).first);
      await tester.pump();
      expect(tapped, 'FL');
      expect(tester.takeException(), isNull);
    },
  );

  for (final MapEntry<String, String> vehicle in <String, String>{
    'Wheel loader':
        'assets/vehicle_multiview_views/sany_wheel_loader_five_view_v1_top.png',
    'Skid loader': 'assets/vehicle_photos/skid_loader_top_down_v2.png',
    'Tri-mixer': 'assets/vehicle_photos/tri_mixer_top_down.webp',
    'Line pump': 'assets/vehicle_photos/line_pump_top_down_v2.png',
    'Concrete pump': 'assets/vehicle_photos/concrete_pump_top_down.webp',
    'Bus':
        'assets/vehicle_multiview_views/generic_staff_bus_five_view_v1_top.png',
  }.entries) {
    testWidgets(
      '${vehicle.key} capture uses its orthographic production photo',
      (WidgetTester tester) async {
        final DiagramLayout layout = kTyreDiagramLayouts[vehicle.key]!;
        await _pump(
          tester,
          VehicleTyreDiagram(
            vehicleType: vehicle.key,
            positions: layout.tyres.map((TyreSlot tyre) => tyre.id).toList(),
            tyreData: const <String, Map<String, Object?>>{},
            width: 366,
            compact: true,
            captureMode: true,
          ),
        );

        expect(
          find.byKey(ValueKey<String>(vehicle.value)),
          findsOneWidget,
        );
        if (vehicle.value.contains('vehicle_multiview_views')) {
          final Finder image = find.byKey(ValueKey<String>(vehicle.value));
          expect(tester.widget<Image>(image).fit, BoxFit.cover);
          final RotatedBox rotation = tester.widget<RotatedBox>(
            find.ancestor(of: image, matching: find.byType(RotatedBox)).first,
          );
          expect(rotation.quarterTurns, 2);
        }
        expect(
          find.byKey(
            const ValueKey<String>('assets/vehicle_photos/concrete_pump.png'),
          ),
          findsNothing,
        );
        expect(tester.takeException(), isNull);
      },
    );
  }

  test('heavy vehicles keep truthful SVGs until verified top views exist', () {
    for (final MapEntry<TyreDiagramBodyKey, String> fallback
        in <TyreDiagramBodyKey, String>{
      TyreDiagramBodyKey.canter: 'assets/vehicle_diagram/canter.svg',
      TyreDiagramBodyKey.tata: 'assets/vehicle_diagram/tata.svg',
      TyreDiagramBodyKey.ashokLeyland:
          'assets/vehicle_diagram/ashok_leyland.svg',
    }.entries) {
      expect(tyreDiagramVehiclePhotoSpec(fallback.key), isNull);
      expect(tyreDiagramBodyAsset(fallback.key), fallback.value);
    }
  });

  testWidgets(
    'capture gives each concrete-pump dual wheel its own full row, outer '
    'above inner, grouped under its physical axle',
    (WidgetTester tester) async {
      final DiagramLayout layout = kTyreDiagramLayouts['Concrete pump']!;
      await _pump(
        tester,
        VehicleTyreDiagram(
          vehicleType: 'Concrete pump',
          positions: layout.tyres.map((TyreSlot tyre) => tyre.id).toList(),
          tyreData: const <String, Map<String, Object?>>{},
          width: 366,
          compact: true,
          captureMode: true,
        ),
      );

      // Three single steer axles plus two rear dual axles per side.
      expect(
        find.byKey(const ValueKey<String>('tyre.diagram.axle.left.4')),
        findsOneWidget,
      );
      expect(
        find.byKey(const ValueKey<String>('tyre.diagram.axle.right.4')),
        findsOneWidget,
      );
      Finder identifier(String value) => find.byWidgetPredicate(
            (Widget widget) =>
                widget is TpIdentifierText && widget.value == value,
          );
      expect(identifier('LHR1-O'), findsOneWidget);
      expect(identifier('LHR1-I'), findsOneWidget);
      expect(identifier('RHR1-I'), findsOneWidget);
      expect(identifier('RHR1-O'), findsOneWidget);

      final Rect leftOuter = tester.getRect(identifier('LHR1-O'));
      final Rect leftInner = tester.getRect(identifier('LHR1-I'));
      final Rect rightInner = tester.getRect(identifier('RHR1-I'));
      final Rect rightOuter = tester.getRect(identifier('RHR1-O'));
      // One column per side, outer row first, never side by side.
      expect((leftOuter.center.dx - leftInner.center.dx).abs(), lessThan(1));
      expect((rightOuter.center.dx - rightInner.center.dx).abs(), lessThan(1));
      expect(leftOuter.center.dy, lessThan(leftInner.center.dy));
      expect(rightOuter.center.dy, lessThan(rightInner.center.dy));
      // Both rows of one axle live inside that axle's group.
      final Rect axleGroup = tester.getRect(
        find.byKey(const ValueKey<String>('tyre.diagram.axle.left.3')),
      );
      expect(axleGroup.contains(leftOuter.center), isTrue);
      expect(axleGroup.contains(leftInner.center), isTrue);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'capture position codes grow with the text scale and are never clipped',
    (WidgetTester tester) async {
      final DiagramLayout layout = kTyreDiagramLayouts['Concrete pump']!;
      final VehicleTyreDiagram diagram = VehicleTyreDiagram(
        vehicleType: 'Concrete pump',
        positions: layout.tyres.map((TyreSlot tyre) => tyre.id).toList(),
        tyreData: const <String, Map<String, Object?>>{},
        width: 366,
        compact: true,
        captureMode: true,
      );
      Finder identifier(String value) => find.byWidgetPredicate(
            (Widget widget) =>
                widget is TpIdentifierText && widget.value == value,
          );

      await _pump(tester, diagram);
      final double baseHeight = tester.getRect(identifier('LHF1')).height;

      // 1.3x: a short code has room across the card, so it simply grows
      // instead of staying pinned to a fixed 10px size in a 12dp box.
      await _pump(tester, diagram, textScaler: const TextScaler.linear(1.3));
      expect(tester.takeException(), isNull);
      expect(
        tester.getRect(identifier('LHF1')).height,
        greaterThan(baseHeight * 1.2),
      );

      // 2x: the row around every code grows with it, so no code is cut off
      // vertically (a long code narrows to the card width, never clipped).
      await _pump(tester, diagram, textScaler: const TextScaler.linear(2));
      expect(tester.takeException(), isNull);
      for (final String value in <String>['LHF1', 'LHR1-O', 'RHR1-I']) {
        final Finder label = identifier(value);
        final Rect text = tester.getRect(label);
        final Rect row = tester.getRect(
          find.ancestor(of: label, matching: find.byType(SizedBox)).first,
        );
        expect(row.top, lessThanOrEqualTo(text.top + 0.01));
        expect(row.bottom, greaterThanOrEqualTo(text.bottom - 0.01));
        expect(row.left, lessThanOrEqualTo(text.left + 0.01));
        expect(row.right, greaterThanOrEqualTo(text.right - 0.01));
      }
    },
  );

  testWidgets(
    'capture cards show pressure and tread only when recorded, never a '
    'placeholder value',
    (WidgetTester tester) async {
      await _pump(
        tester,
        const VehicleTyreDiagram(
          vehicleType: 'PICKUP',
          positions: <String>['FL', 'FR', 'RL', 'RR'],
          tyreData: <String, Map<String, Object?>>{
            // Pressure and tread both recorded.
            'FL': <String, Object?>{
              'pressure_psi': 34.0,
              'tread_depth_mm': 7.1,
              'condition': 'Good',
              'checked': true,
            },
            // Pressure only - tread must stay hidden.
            'FR': <String, Object?>{
              'pressure_psi': 0,
              'condition': 'Flat',
              'checked': true,
            },
            // Checked with no reading - the condition label, no numbers.
            'RL': <String, Object?>{'condition': 'Worn', 'checked': true},
            // RR carries no entry at all: not recorded.
          },
          width: 366,
          compact: true,
          captureMode: true,
        ),
      );

      expect(find.text('34 psi'), findsOneWidget);
      expect(find.text('7.1 mm'), findsOneWidget);
      // A 0 psi flat is a real reading, not "not recorded".
      expect(find.text('0 psi'), findsOneWidget);
      expect(find.textContaining(' mm'), findsOneWidget);
      expect(find.text('Worn'), findsOneWidget);
      // The unrecorded card carries the mock's call to action; the honest
      // status stays in what a screen reader announces.
      expect(find.text('Add details'), findsOneWidget);
      expect(
        find.bySemanticsLabel(RegExp('RHR1.*Not recorded')),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('capture mode keeps the tyreless empty state', (
    WidgetTester tester,
  ) async {
    await _pump(
      tester,
      const VehicleTyreDiagram(
        vehicleType: 'STATIONARY PUMP',
        positions: <String>['FL', 'FR'],
        tyreData: <String, Map<String, Object?>>{},
        width: 366,
        compact: true,
        captureMode: true,
      ),
    );
    expect(
      find.byKey(const Key('tyre.diagram.figma_capture_stage')),
      findsNothing,
    );
    expect(
      find.text('Stationary equipment, no tyres to inspect.'),
      findsOneWidget,
    );
  });

  // Every production layout, at every capture width the board can hand the
  // stage (it clamps to 300-380; a 360-390dp phone lands at 328-358).
  for (final DiagramLayout layout in kTyreDiagramLayouts.values) {
    for (final double width in <double>[300, 328, 358, 380]) {
      testWidgets(
        '${layout.key} capture at ${width.toInt()}dp: one card per wheel, '
        'no overflow, nothing outside the stage, no overlapping rows',
        (WidgetTester tester) async {
          tester.view.physicalSize = const Size(420, 1400);
          tester.view.devicePixelRatio = 1;
          addTearDown(tester.view.reset);
          String? tapped;
          await _pump(
            tester,
            VehicleTyreDiagram(
              vehicleType: layout.key,
              positions: layout.tyres.map((TyreSlot tyre) => tyre.id).toList(),
              tyreData: const <String, Map<String, Object?>>{},
              width: width,
              compact: true,
              captureMode: true,
              onPositionTap: (String id) => tapped = id,
            ),
          );
          expect(tester.takeException(), isNull);

          final Finder stage = find.byKey(
            const Key('tyre.diagram.figma_capture_stage'),
          );
          expect(stage, findsOneWidget);
          final Rect stageRect = tester.getRect(stage);
          final Finder cards = find.descendant(
            of: stage,
            matching: find.byType(InkWell),
          );
          expect(cards, findsNWidgets(layout.tyres.length));

          final List<Rect> rects = <Rect>[
            for (int i = 0; i < layout.tyres.length; i++)
              tester.getRect(cards.at(i)),
          ];
          for (final Rect rect in rects) {
            expect(rect.left, greaterThanOrEqualTo(stageRect.left - 0.5));
            expect(rect.right, lessThanOrEqualTo(stageRect.right + 0.5));
            expect(rect.top, greaterThanOrEqualTo(stageRect.top - 0.5));
            expect(rect.bottom, lessThanOrEqualTo(stageRect.bottom + 0.5));
            expect(rect.height, greaterThanOrEqualTo(48));
          }
          for (int a = 0; a < rects.length; a++) {
            for (int b = a + 1; b < rects.length; b++) {
              expect(
                rects[a].overlaps(rects[b]),
                isFalse,
                reason: 'cards $a and $b overlap',
              );
            }
          }

          await tester.tap(cards.last);
          await tester.pump();
          expect(
            layout.tyres.map((TyreSlot tyre) => tyre.id),
            contains(tapped),
          );
        },
      );
    }
  }

  for (final String vehicleClass in <String>[
    'Tri-mixer',
    'Line pump',
    'Concrete pump',
  ]) {
    testWidgets(
      '$vehicleClass compact map routes every rear inner/outer wheel centre '
      'to its exact empty position',
      (WidgetTester tester) async {
        final DiagramLayout layout = kTyreDiagramLayouts[vehicleClass]!;
        String? tapped;
        await _pump(
          tester,
          VehicleTyreDiagram(
            vehicleType: vehicleClass,
            positions: layout.tyres.map((TyreSlot tyre) => tyre.id).toList(),
            tyreData: const <String, Map<String, Object?>>{},
            onPositionTap: (String id) => tapped = id,
            width: 190,
            compact: true,
          ),
        );

        final Offset viewportOrigin = tester.getTopLeft(
          find.byType(TyreDiagramBody),
        );
        final TyreDiagramViewport viewport = TyreDiagramViewport(
          width: 190,
          viewH: layout.viewH,
        );
        final List<TyreSlot> rearDuals = layout.tyres
            .where((TyreSlot tyre) => tyre.id.startsWith('R'))
            .toList();

        for (final TyreSlot wheel in rearDuals) {
          tapped = null;
          final Offset paintedCentre = viewportOrigin +
              viewport.wheelRect(wheel.x, wheel.y, wheel.w, wheel.h).center;
          await tester.tapAt(paintedCentre);
          await tester.pump();
          expect(
            tapped,
            wheel.id,
            reason: '$vehicleClass ${wheel.id} empty-wheel tap was swapped',
          );
        }
      },
    );
  }
}
