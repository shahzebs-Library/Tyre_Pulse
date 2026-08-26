/// Unit coverage for [tyreReplacementPositions], the per-vehicle-type
/// position derivation this feature builds on top of the already-verified
/// `features/tyre_diagram` engine.
///
/// Every expected code below was hand-derived by reading
/// `tyre_diagram_layouts.dart`'s own `kTyreDiagramLayouts`,
/// `_kLegacyBase` and `_kLegacyTriMixer` tables directly (not guessed), so
/// this test is pinning the SAME facts that module's own parity tests
/// already pin, from the caller's side - if either drifts, this test
/// catches it too.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_exchange/domain/tyre_replacement_position.dart';

/// Extracts just the codes, in order - the shape most of these assertions
/// care about.
List<String> _codes(List<TyreReplacementPositionOption> options) =>
    options.map((TyreReplacementPositionOption o) => o.code).toList();

void main() {
  group('the Spare option', () {
    test(
        'is always last, always carries the literal code, and always has '
        'no diagram slot id', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Pickup');
      final TyreReplacementPositionOption spare = options.last;
      expect(spare.code, tyreReplacementSparePositionCode);
      expect(spare.code, 'Spare');
      expect(spare.diagramSlotId, isNull);
    });

    test(
        'is present even for tyreless equipment, which offers no derived '
        'positions at all', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Generator', 'GN101');
      expect(options, hasLength(1));
      expect(options.single.code, 'Spare');
    });
  });

  group(
      'unknown or absent vehicle type falls back to the neutral Pickup '
      'default, never an empty picker', () {
    test('null vehicle type and no asset number', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions(null);
      expect(_codes(options), <String>[
        'LHF1',
        'RHF1',
        'LHR1',
        'RHR1',
        'Spare',
      ]);
    });

    test('blank vehicle type and no asset number', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('   ');
      expect(_codes(options), <String>[
        'LHF1',
        'RHF1',
        'LHR1',
        'RHR1',
        'Spare',
      ]);
    });

    test('an unrecognised vehicle type with no matching asset prefix', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Something Nobody Has Catalogued');
      expect(_codes(options), <String>[
        'LHF1',
        'RHF1',
        'LHR1',
        'RHR1',
        'Spare',
      ]);
    });
  });

  group(
      'the asset number resolves the vehicle type when the type itself '
      'says nothing useful', () {
    test(
        'a TM-prefixed asset number resolves to the Tri-mixer layout, with '
        'its centre-axle relabelling applied', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions(null, 'TM634');
      expect(_codes(options), <String>[
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
        'Spare',
      ]);
    });

    test('a real vehicle type always wins over an asset-number guess', () {
      // 'PL' would resolve to Pickup from the asset number alone - the
      // explicit vehicle type must not be overridden by it.
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Tri-mixer', 'PL077');
      expect(options.length, 13); // 12 Tri-mixer positions + Spare.
      expect(options.first.code, 'LHF1');
    });
  });

  group(
      'Tri-mixer: the sharpest parity trap in the underlying engine - '
      'the FIRST rear axle is the CENTRE drive axle, not a rear one', () {
    test('exact layout-key match, case/spacing-insensitive', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('  tri-MIXER ');
      expect(_codes(options), <String>[
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
        'Spare',
      ]);
    });

    test('the real fleet spelling "TRANSIT MIXER" resolves the same way', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('TRANSIT MIXER');
      expect(_codes(options).contains('LHCO'), isTrue);
      expect(_codes(options).contains('LHR1'), isFalse);
    });

    test('every derived option carries the diagram slot id it came from', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Tri-mixer');
      final TyreReplacementPositionOption centreOuterLeft = options.firstWhere(
        (o) => o.code == 'LHCO',
      );
      expect(centreOuterLeft.diagramSlotId, 'R1Lo');
    });
  });

  group(
      'Concrete pump: 14 positions, non-tri-mixer labelling (R1/R2 '
      'suffixed, not centre-axle relabelled)', () {
    test('all 14 derived codes plus Spare, in layout order', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('Concrete pump');
      expect(_codes(options), <String>[
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
        'Spare',
      ]);
    });

    test(
        'the generic "pump" keyword also resolves to the concrete-pump '
        'layout', () {
      final List<TyreReplacementPositionOption> options =
          tyreReplacementPositions('MP Concrete Pump');
      expect(options.length, 15);
    });
  });

  group('tyreless equipment offers nothing but Spare', () {
    test('a generator', () {
      expect(_codes(tyreReplacementPositions('Generator')), <String>['Spare']);
    });

    test(
        'a stationary concrete pump - a real fleet distinction from the '
        'truck-mounted pump above, which DOES have 14 wheels', () {
      expect(_codes(tyreReplacementPositions('STATIONARY PUMP')), <String>[
        'Spare',
      ]);
    });

    test('a placing boom - mast-mounted gear, not the wheeled truck pump', () {
      expect(_codes(tyreReplacementPositions('Placing Boom')), <String>[
        'Spare',
      ]);
    });
  });

  group('TyreReplacementPositionOption value semantics', () {
    test('equality and hashCode are field-based', () {
      const TyreReplacementPositionOption a = TyreReplacementPositionOption(
        code: 'LHF1',
        diagramSlotId: 'FL',
      );
      const TyreReplacementPositionOption b = TyreReplacementPositionOption(
        code: 'LHF1',
        diagramSlotId: 'FL',
      );
      const TyreReplacementPositionOption c = TyreReplacementPositionOption(
        code: 'RHF1',
        diagramSlotId: 'FR',
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
      expect(a == c, isFalse);
    });

    test(
        'the constant Spare code matches the value every Spare option '
        'carries', () {
      expect(tyreReplacementSparePositionCode, 'Spare');
    });
  });
}
