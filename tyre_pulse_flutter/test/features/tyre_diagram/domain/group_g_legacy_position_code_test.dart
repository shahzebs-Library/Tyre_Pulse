/// Parity group G - `legacyPositionCode` and derived labels. Cases 61-67.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// G. Case 67 is the load-time relabel the RN source performs once, at
/// module load, for every layout - here expressed as a derived assertion
/// over all 98 slots, since [legacyPositionCode] is a pure function computed
/// on demand rather than a stored mutation.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

void main() {
  test('case 61: the base map', () {
    expect(legacyPositionCode('Pickup', 'FL'), 'LHF1');
    expect(legacyPositionCode('Canter', 'RLo'), 'LHRO');
    expect(legacyPositionCode('Truck 6x4', 'R1Lo'), 'LHR1-O');
  });

  test(
      'case 62: the Tri-mixer centre-axle override - the sharpest parity '
      'trap in the whole engine', () {
    expect(legacyPositionCode('Tri-mixer', 'R1Lo'), 'LHCO');
    expect(legacyPositionCode('Tri-mixer', 'R1Li'), 'LHCI');
    expect(legacyPositionCode('Tri-mixer', 'R1Ri'), 'RHCI');
    expect(legacyPositionCode('Tri-mixer', 'R1Ro'), 'RHCO');
  });

  test('case 63: the Tri-mixer second axle is the REAR axle, not R2', () {
    expect(legacyPositionCode('Tri-mixer', 'R2Lo'), 'LHRO');
  });

  test(
      'case 64: the override is keyed on the layout name - Line pump '
      'contains neither "tri" nor "mixer" and is unaffected', () {
    expect(legacyPositionCode('Line pump', 'R1Lo'), 'LHR1-O');
  });

  test(
      'case 65: override matching is case-insensitive and substring - '
      'TRANSIT MIXER', () {
    expect(legacyPositionCode('TRANSIT MIXER', 'R1Lo'), 'LHCO');
  });

  test('case 66: an unmapped id passes through unchanged, never invented', () {
    expect(legacyPositionCode('Pickup', 'WHEEL_ALPHA'), 'WHEEL_ALPHA');
    expect(legacyPositionCode('Pickup', ''), '');
  });

  test(
      "case 67: every one of the 13 layouts' labels match the section-2 "
      'table, computed fresh for all 98 slots', () {
    const Map<String, List<String>> expectedLabels = <String, List<String>>{
      'Pickup': <String>['LHF1', 'RHF1', 'LHR1', 'RHR1'],
      'Wheel loader': <String>['LHF1', 'RHF1', 'LHR1', 'RHR1'],
      'Skid loader': <String>['LHF1', 'RHF1', 'LHR1', 'RHR1'],
      'Canter': <String>['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'],
      'Bus': <String>['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'],
      'Tata': <String>['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'],
      'Ashok Leyland': <String>['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'],
      'Tanker': <String>['LHF1', 'RHF1', 'LHRO', 'LHRI', 'RHRI', 'RHRO'],
      'Trailer': <String>[
        'LHR1-O',
        'LHR1-I',
        'RHR1-I',
        'RHR1-O',
        'LHR2-O',
        'LHR2-I',
        'RHR2-I',
        'RHR2-O',
      ],
      'Truck 6x4': <String>[
        'LHF1',
        'RHF1',
        'LHR1-O',
        'LHR1-I',
        'RHR1-I',
        'RHR1-O',
        'LHR2-O',
        'LHR2-I',
        'RHR2-I',
        'RHR2-O',
      ],
      'Tri-mixer': <String>[
        'LHF1',
        'RHF1',
        'LHF2',
        'RHF2',
        'LHCO',
        'LHCI',
        'RHCI',
        'RHCO',
        'LHRO',
        'LHRI',
        'RHRI',
        'RHRO',
      ],
      'Line pump': <String>[
        'LHF1',
        'RHF1',
        'LHF2',
        'RHF2',
        'LHR1-O',
        'LHR1-I',
        'RHR1-I',
        'RHR1-O',
        'LHR2-O',
        'LHR2-I',
        'RHR2-I',
        'RHR2-O',
      ],
      'Concrete pump': <String>[
        'LHF1',
        'RHF1',
        'LHF2',
        'RHF2',
        'LHF3',
        'RHF3',
        'LHR1-O',
        'LHR1-I',
        'RHR1-I',
        'RHR1-O',
        'LHR2-O',
        'LHR2-I',
        'RHR2-I',
        'RHR2-O',
      ],
    };

    expect(expectedLabels.length, 13);
    int totalSlots = 0;
    for (final MapEntry<String, List<String>> entry in expectedLabels.entries) {
      final DiagramLayout layout = kTyreDiagramLayouts[entry.key]!;
      final List<String> actual = <String>[
        for (final TyreSlot t in layout.tyres)
          legacyPositionCode(entry.key, t.id),
      ];
      expect(actual, entry.value, reason: entry.key);
      totalSlots += layout.tyres.length;
    }
    expect(totalSlots, 98);
  });
}
