/// Parity group A - the vehicle type resolver reaches every one of the 13
/// production layouts, and `diagramPositions` agrees with `kTyreDiagramLayouts`
/// for each one.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// A, cases 1-13. Every expectation was produced by EXECUTING the real
/// `mobile/lib/tyreDiagramLayouts.ts` resolver, per the artifact's own
/// section 2 table - that table IS the fixture this file asserts against.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  // Each entry: input, expected layout key, expected tyre count, expected
  // ordered slot ids (V1). The ordered-id assertion is what makes this a
  // parity suite rather than a count check.
  const List<(String, String, int, List<String>)>
  cases = <(String, String, int, List<String>)>[
    ('PICKUP', 'Pickup', 4, <String>['FL', 'FR', 'RL', 'RR']),
    ('WHEEL_LOADER', 'Wheel loader', 4, <String>['FL', 'FR', 'RL', 'RR']),
    ('SKID LOADER', 'Skid loader', 4, <String>['FL', 'FR', 'RL', 'RR']),
    ('CANTER', 'Canter', 6, <String>['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']),
    ('BUS', 'Bus', 6, <String>['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']),
    ('TATA', 'Tata', 6, <String>['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']),
    (
      'ASHOK LEYLAND',
      'Ashok Leyland',
      6,
      <String>['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo'],
    ),
    ('D TANKER', 'Tanker', 6, <String>['FL', 'FR', 'RLo', 'RLi', 'RRi', 'RRo']),
    (
      'TRAILER',
      'Trailer',
      8,
      <String>['R1Lo', 'R1Li', 'R1Ri', 'R1Ro', 'R2Lo', 'R2Li', 'R2Ri', 'R2Ro'],
    ),
    (
      'SPIDER PUMP',
      'Truck 6x4',
      10,
      <String>[
        'FL',
        'FR',
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
        'R2Lo',
        'R2Li',
        'R2Ri',
        'R2Ro',
      ],
    ),
    (
      'TR-MIXER',
      'Tri-mixer',
      12,
      <String>[
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
    ),
    (
      'LINE PUMP',
      'Line pump',
      12,
      <String>[
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
    ),
    (
      'PUMPS',
      'Concrete pump',
      14,
      <String>[
        'F1L',
        'F1R',
        'F2L',
        'F2R',
        'F3L',
        'F3R',
        'R1Lo',
        'R1Li',
        'R1Ri',
        'R1Ro',
        'R2Lo',
        'R2Li',
        'R2Ri',
        'R2Ro',
      ],
    ),
  ];

  group('case 1-13: resolver reaches every layout, count matches', () {
    for (final (String, String, int, List<String>) c in cases) {
      final String input = c.$1;
      final String expectLayout = c.$2;
      final int expectCount = c.$3;
      test("'$input' resolves to '$expectLayout' with $expectCount tyres", () {
        expect(resolveVehicleType(input), expectLayout);
        expect(kTyreDiagramLayouts[expectLayout]!.tyres.length, expectCount);
      });
    }
  });

  group(
    'diagramPositions agrees with kTyreDiagramLayouts ordered slot ids',
    () {
      for (final (String, String, int, List<String>) c in cases) {
        final String input = c.$1;
        final String expectLayout = c.$2;
        final List<String> ids = c.$4;
        test("'$input' -> $expectLayout's exact ordered id list", () {
          expect(diagramPositions(input), ids);
          expect(
            kTyreDiagramLayouts[expectLayout]!.tyres
                .map((TyreSlot t) => t.id)
                .toList(),
            ids,
          );
        });
      }
    },
  );
}
