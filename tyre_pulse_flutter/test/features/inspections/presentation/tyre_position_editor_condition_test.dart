/// Regression coverage that Flat and Puncture are real, selectable tyre
/// inspection conditions rather than diagram-only legend entries.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_capture.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/inspections/presentation/widgets/tyre_position_editor_sheet.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';

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
