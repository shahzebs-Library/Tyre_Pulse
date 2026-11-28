import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_previous_tyre_readings.dart';

void main() {
  test('maps slot ids and printed codes onto the layout slots', () {
    final Map<String, PreviousTyreReading> out = previousReadingsBySlot(
      layoutKey: 'Tri-mixer',
      inspectionDate: DateTime(2026, 11, 12),
      tyreConditions: <String, Object?>{
        // A printed code with stray whitespace (Tri-mixer R1Lo = LHCO).
        ' LHCO ': <String, Object?>{'pressure_psi': 110, 'tread_depth_mm': 8.5},
        'F1L': <String, Object?>{'pressure_psi': 0},
        // Nothing to show: dropped.
        'F1R': <String, Object?>{'condition': 'Good'},
        // Places nowhere on this layout: dropped, never guessed.
        'ZZZ': <String, Object?>{'pressure_psi': 99},
      },
    );
    expect(out.keys, unorderedEquals(<String>['R1Lo', 'F1L']));
    expect(out['R1Lo']!.pressurePsi, 110);
    expect(out['R1Lo']!.treadDepthMm, 8.5);
    expect(out['R1Lo']!.inspectionDate, DateTime(2026, 11, 12));
    // A flat tyre's 0 psi is a real reading.
    expect(out['F1L']!.pressurePsi, 0);
  });

  test('an unreadable payload is empty, not an error', () {
    expect(
      previousReadingsBySlot(layoutKey: 'Pickup', tyreConditions: 'not json'),
      isEmpty,
    );
    expect(
      previousReadingsBySlot(layoutKey: 'Pickup', tyreConditions: null),
      isEmpty,
    );
  });
}
