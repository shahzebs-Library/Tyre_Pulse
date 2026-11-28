/// Regression coverage that Flat and Puncture are real, selectable tyre
/// inspection conditions rather than diagram-only legend entries.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_condition_glyph.dart';

import '../../../core/design_system/design_system_test_support.dart';

void main() {
  test('stored condition vocabulary includes Flat and Puncture exactly once',
      () {
    expect(
      TyreReadingCondition.all,
      containsAll(<String>[
        TyreReadingCondition.flat,
        TyreReadingCondition.puncture,
      ]),
    );
    expect(
      TyreReadingCondition.all
          .where((String value) => value == TyreReadingCondition.flat),
      hasLength(1),
    );
    expect(
      TyreReadingCondition.all
          .where((String value) => value == TyreReadingCondition.puncture),
      hasLength(1),
    );
  });

  test('raw Flat and Puncture entries normalize and map to their risk bands',
      () {
    expect(normaliseCondition('Flat'), TyreCondition.flat);
    expect(normaliseCondition('flat'), TyreCondition.flat);
    expect(normaliseCondition('Puncture'), TyreCondition.puncture);
    expect(normaliseCondition('PUNCTURE'), TyreCondition.puncture);
    expect(
      wheelConditionFor(const <String, Object?>{'condition': 'Flat'}),
      TyreCondition.flat,
    );
    expect(
      wheelConditionFor(const <String, Object?>{'condition': 'Puncture'}),
      TyreCondition.puncture,
    );
  });

  testWidgets('inspection editor visibly offers Flat and Puncture', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(tester, onChanged: (_) {});

    expect(find.text('Flat'), findsOneWidget);
    expect(find.text('Puncture'), findsOneWidget);
  });

  test('display order puts Good first, Missing last, keeps stored values', () {
    expect(kTyreConditionDisplayOrder, <TyreCondition>[
      TyreCondition.good,
      TyreCondition.worn,
      TyreCondition.damaged,
      TyreCondition.puncture,
      TyreCondition.flat,
      TyreCondition.missing,
    ]);
    // Every condition appears exactly once.
    expect(kTyreConditionDisplayOrder.toSet(), TyreCondition.values.toSet());
    // The stored vocabulary is unchanged and each tile stores the value
    // that reads back as its own condition, whatever its place.
    expect(TyreReadingCondition.all, <String>[
      'Good',
      'Worn',
      'Damaged',
      'Puncture',
      'Flat',
      'Missing',
    ]);
    for (final TyreCondition c in TyreCondition.values) {
      expect(normaliseCondition(tyreReadingConditionValue(c)), c);
    }
  });

  test('each condition has its own colour; critical ones no longer share red',
      () {
    final Set<Color> fills = <Color>{
      for (final TyreCondition c in TyreCondition.values)
        tyreConditionSelectedFill(c),
    };
    expect(fills, hasLength(TyreCondition.values.length));
    expect(
      tyreConditionSelectedFill(TyreCondition.puncture),
      isNot(tyreConditionSelectedFill(TyreCondition.damaged)),
    );
    expect(
      tyreConditionSelectedFill(TyreCondition.flat),
      isNot(tyreConditionSelectedFill(TyreCondition.damaged)),
    );
    // Severity is unchanged: all three still sit in the critical band.
    for (final TyreCondition c in <TyreCondition>[
      TyreCondition.damaged,
      TyreCondition.puncture,
      TyreCondition.flat,
    ]) {
      expect(tyreConditionStatus(c), TpStatus.critical);
    }
  });

  testWidgets('tiles are laid out Good first, Missing last', (
    WidgetTester tester,
  ) async {
    await _pumpEditor(tester, onChanged: (_) {});

    // Reading order: top to bottom, then start to end.
    final List<Offset> at = <Offset>[
      for (final String label in _kShownOrder)
        tester.getTopLeft(find.text(label)),
    ];
    for (int i = 1; i < at.length; i++) {
      final Offset prev = at[i - 1];
      final Offset cur = at[i];
      final bool later = cur.dy > prev.dy + 1 ||
          ((cur.dy - prev.dy).abs() <= 1 && cur.dx > prev.dx);
      expect(
        later,
        isTrue,
        reason: '${_kShownOrder[i]} after ${_kShownOrder[i - 1]}',
      );
    }
  });

  testWidgets('selected tile uses the condition colour for outline and tick', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      TyrePositionEditorSheet(
        reading: TyrePositionReading.seed('RHR1-I').copyWith(
          condition: TyreReadingCondition.flat,
          checked: true,
        ),
        onChanged: (_) {},
        onCapturePhoto: (PhotoCaptureSource _) {},
      ),
    );

    final Material tile = tester.widget<Material>(
      find
          .ancestor(
            of: find.byKey(const ValueKey<String>('tyre-condition-Flat')),
            matching: find.byType(Material),
          )
          .first,
    );
    final RoundedRectangleBorder shape = tile.shape! as RoundedRectangleBorder;
    expect(
      shape.side.color,
      tyreConditionAccent(TyreCondition.flat, Brightness.light),
    );
    final Iterable<DecoratedBox> ticks = tester.widgetList<DecoratedBox>(
      find.descendant(
        of: find.byKey(const ValueKey<String>('tyre-condition-Flat')),
        matching: find.byType(DecoratedBox),
      ),
    );
    expect(
      ticks.any(
        (DecoratedBox d) =>
            d.decoration is BoxDecoration &&
            (d.decoration as BoxDecoration).color ==
                tyreConditionSelectedFill(TyreCondition.flat),
      ),
      isTrue,
    );
  });

  testWidgets('tapping Flat emits a Flat reading for the selected position', (
    WidgetTester tester,
  ) async {
    TyrePositionReading? emitted;
    await _pumpEditor(tester, onChanged: (value) => emitted = value);

    await tester.tap(find.text('Flat'));
    await tester.pump();

    expect(emitted, isNotNull);
    expect(emitted!.position, 'RHR1-I');
    expect(emitted!.condition, TyreReadingCondition.flat);
  });

  testWidgets(
    'tapping Puncture emits a Puncture reading for the selected position',
    (WidgetTester tester) async {
      TyrePositionReading? emitted;
      await _pumpEditor(tester, onChanged: (value) => emitted = value);

      await tester.tap(find.text('Puncture'));
      await tester.pump();

      expect(emitted, isNotNull);
      expect(emitted!.position, 'RHR1-I');
      expect(emitted!.condition, TyreReadingCondition.puncture);
    },
  );
}

// The order on screen: Good first, Missing last (owner, 2026-11-28).
const List<String> _kShownOrder = <String>[
  'Good',
  'Worn',
  'Damaged',
  'Puncture',
  'Flat',
  'Missing',
];

Future<void> _pumpEditor(
  WidgetTester tester, {
  required ValueChanged<TyrePositionReading> onChanged,
}) {
  return pumpTp(
    tester,
    TyrePositionEditorSheet(
      reading: TyrePositionReading.seed('RHR1-I'),
      onChanged: onChanged,
      onCapturePhoto: (PhotoCaptureSource _) {},
    ),
  );
}
