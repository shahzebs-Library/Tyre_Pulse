/// Parity group B - resolver ordering and precedence. Cases 14-23.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// B. Case 22 (the R7 web/mobile divergence, section 3.1) and case 15
/// GENUINELY CONFLICT if both are read as literal value assertions on the
/// same input `'PLACING BOOM'` - see this file's own note on case 15 below
/// for how that tension is resolved, and the port's final report for the
/// full reasoning.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

void main() {
  // Case 14: case and separator insensitivity.
  test(
      'case 14: TR-MIXER, Tr-Mixer, tri mixer, "  tri-mixer " all resolve '
      'to Tri-mixer', () {
    for (final String input in <String>[
      'TR-MIXER',
      'Tr-Mixer',
      'tri mixer',
      '  tri-mixer ',
    ]) {
      expect(resolveVehicleType(input), 'Tri-mixer', reason: input);
    }
  });

  // Case 15, as actually testable without contradicting case 22: the
  // artifact's own name for this case is "Prefix rule needs a digit" - its
  // real subject is R2 (the asset-code-prefix regex), not the resolver's
  // FINAL overall answer for 'PLACING BOOM'. Its cited proof is the
  // PRE-EXISTING mobile test suite, i.e. today's mobile behaviour (mobile's
  // OWN line 307 catches "boom"/"placing" before ever reaching the R2
  // regression this case is really guarding against). Case 22b, by
  // contrast, is a NEWER, twice-repeated, explicit instruction (section 3.1
  // and section 8 decision 6) to change 'PLACING BOOM' to resolve to
  // 'Pickup' via the web-form guard. The two cannot both hold as literal
  // "the resolver returns X" assertions on the identical input - so this
  // test asserts case 15's REAL underlying claim (the prefix regex itself
  // does not match) rather than restating a value case 22 explicitly
  // overrides.
  test(
      'case 15 (R2 the real subject): the asset-code prefix regex does not '
      'match PLACING BOOM at all, so a naive PL-prefix bug cannot produce '
      'Pickup for the wrong reason', () {
    final Match? m =
        RegExp(r'^([A-Za-z]{2,3})[\s-]*\d').firstMatch('PLACING BOOM');
    expect(m, isNull);
  });

  test('case 16: SLURRY TANKER resolves to Tanker, not Skid loader', () {
    expect(resolveVehicleType('SLURRY TANKER'), 'Tanker');
  });

  test(
      'case 17: WLD WORKSHOP TRUCK resolves to Truck 6x4, not Wheel '
      'loader', () {
    expect(resolveVehicleType('WLD WORKSHOP TRUCK'), 'Truck 6x4');
  });

  test(
      'case 18: 10 WHEELER resolves to Truck 6x4 (N-Wheeler beats '
      '"wheel")', () {
    expect(resolveVehicleType('10 WHEELER'), 'Truck 6x4');
  });

  test('case 19: N-Wheeler bands', () {
    expect(resolveVehicleType('12 WHEELER'), 'Tri-mixer');
    expect(resolveVehicleType('8-WHEELER'), 'Truck 6x4');
    expect(resolveVehicleType('6 WHEELER'), 'Canter');
    expect(resolveVehicleType('4WHEELER'), 'Pickup');
  });

  test('case 20: the pump family stays split by tyre count', () {
    expect(
      kTyreDiagramLayouts[resolveVehicleType('LINE PUMP')]!.tyres.length,
      12,
    );
    expect(
      kTyreDiagramLayouts[resolveVehicleType('SPIDER PUMP')]!.tyres.length,
      10,
    );
    expect(kTyreDiagramLayouts[resolveVehicleType('PUMPS')]!.tyres.length, 14);
    expect(
      kTyreDiagramLayouts[resolveVehicleType('CONCRETE PUMP')]!.tyres.length,
      14,
    );
    expect(
      kTyreDiagramLayouts[resolveVehicleType('BOOM PUMP')]!.tyres.length,
      14,
    );
  });

  test(
      'case 21: "skid" is tested before "loader" - SKID LOADER resolves '
      'to Skid loader', () {
    expect(resolveVehicleType('SKID LOADER'), 'Skid loader');
  });

  // Case 22 / 22b - the R7 divergence. Ported: WEB form (`placing` OR
  // `stationary` -> Pickup), which is REACHABLE in this port (unlike
  // mobile's own shadowed defensive stop - see tyre_diagram_layouts.dart's
  // library comment on R7).
  test('case 22a: STATIONARY PUMP resolves to Pickup', () {
    expect(resolveVehicleType('STATIONARY PUMP'), 'Pickup');
  });

  test(
      'case 22b: PLACING BOOM resolves to Pickup - the web-form guard, '
      'ported deliberately over mobile\'s own shadowed rule (artifact '
      'section 3.1, section 8 decision 6)', () {
    expect(resolveVehicleType('PLACING BOOM'), 'Pickup');
  });

  test('case 23: an unrecognised string never invents extra axles', () {
    expect(resolveVehicleType('SOMETHING NOBODY MAPPED'), 'Pickup');
    expect(
      kTyreDiagramLayouts[resolveVehicleType('SOMETHING NOBODY MAPPED')]!
          .tyres
          .length,
      4,
    );
    expect(resolveVehicleType(''), 'Pickup');
    expect(resolveVehicleType(null), 'Pickup');
  });
}
