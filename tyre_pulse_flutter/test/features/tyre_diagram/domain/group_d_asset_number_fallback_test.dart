/// Parity group D - asset-number fallback. Cases 32-40.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// D. Proves `resolveVehicleType(vt, assetNo)`'s fallback chain: the type
/// always wins when it resolves to anything at all; the asset number is
/// consulted only when the type resolves to nothing.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

void main() {
  test('case 32: a genuine asset code alone - TM634 -> Tri-mixer', () {
    expect(resolveVehicleType('TM634'), 'Tri-mixer');
  });

  test('case 33: a genuine asset code alone - MP083 -> Concrete pump', () {
    expect(resolveVehicleType('MP083'), 'Concrete pump');
  });

  test('case 34: a genuine asset code alone - PL12, PL077 -> Pickup', () {
    expect(resolveVehicleType('PL12'), 'Pickup');
    expect(resolveVehicleType('PL077'), 'Pickup');
  });

  test('all eight tyre-carrying fleet prefixes select their real layout', () {
    const Map<String, String> expected = <String, String>{
      'TM514': 'Tri-mixer',
      'MP083': 'Concrete pump',
      'PL077': 'Pickup',
      'WL003': 'Wheel loader',
      'BH021': 'Bus',
      'SL019': 'Skid loader',
      'LP003': 'Line pump',
      'MB003': 'Bus',
    };

    for (final MapEntry<String, String> entry in expected.entries) {
      expect(
        resolveVehicleType('HEAVY EQP', entry.key),
        entry.value,
        reason: entry.key,
      );
    }
  });

  test('real separated fleet codes keep the same class fallback', () {
    expect(resolveVehicleType('HEAVY EQP', 'BH-037'), 'Bus');
    expect(resolveVehicleType('HEAVY EQP', 'PL-090'), 'Pickup');
    expect(resolveVehicleType('HEAVY EQP', 'MP-1042'), 'Concrete pump');
    expect(resolveVehicleType('HEAVY EQP', 'LP 003'), 'Line pump');
  });

  test('case 35: a junk type falls back to the asset number', () {
    expect(resolveVehicleType('HEAVY EQP', 'WL003'), 'Wheel loader');
  });

  test('case 36: a 3-letter prefix truncates to its first 2 letters', () {
    expect(resolveVehicleType('HEAVY EQP', 'SLP001'), 'Skid loader');
    expect(resolveVehicleType('HEAVY EQP', 'SLP12'), 'Skid loader');
    expect(resolveVehicleType('HEAVY EQP', 'SL001'), 'Skid loader');
  });

  test(
      'case 37: an unmapped prefix is never guessed - IP is not read as '
      '"ice plant"', () {
    expect(resolveVehicleType('HEAVY EQP', 'IP064'), 'Pickup');
  });

  test('case 38: nothing known resolves to Pickup, not an error', () {
    expect(resolveVehicleType('HEAVY EQP', 'ZZ999'), 'Pickup');
    expect(resolveVehicleType('HEAVY EQP', null), 'Pickup');
  });

  test('case 39: a real type always beats the asset number', () {
    expect(resolveVehicleType('TR-MIXER', 'DT001'), 'Tri-mixer');
  });

  test('case 40: a real type always beats the asset number, again', () {
    expect(resolveVehicleType('PICKUP', 'WL003'), 'Pickup');
  });
}
