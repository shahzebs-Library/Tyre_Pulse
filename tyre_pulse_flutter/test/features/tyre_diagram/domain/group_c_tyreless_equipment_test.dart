/// Parity group C - tyreless equipment. Cases 24-31, plus the negative
/// control 31b.
///
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5, group
/// C. For every positive case: `isTyrelessEquipment` is true, the resolved
/// tyre count is 0, and `diagramPositions` is empty. The negative control
/// (31b) is what proves the keyword match is not simply swallowing every
/// input - "without which the group proves nothing".
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

void _expectTyreless(String input) {
  expect(isTyrelessEquipment(input), isTrue, reason: input);
  expect(diagramPositions(input), isEmpty, reason: input);
}

void main() {
  test('case 24: PLACING BOOM', () => _expectTyreless('PLACING BOOM'));
  test('case 25: BT-PLANT', () => _expectTyreless('BT-PLANT'));
  test('case 26: ICE PLANT', () => _expectTyreless('ICE PLANT'));

  test('case 27: WATER TREATMENT PLANT, BATCHING PLANT', () {
    _expectTyreless('WATER TREATMENT PLANT');
    _expectTyreless('BATCHING PLANT');
  });

  test('case 28: BUILDINGS', () => _expectTyreless('BUILDINGS'));
  test('case 29: GENERATOR', () => _expectTyreless('GENERATOR'));

  test('case 30: CHILLER, RECLAIMER, COMPRESSOR, TOWER LIGHT', () {
    _expectTyreless('CHILLER');
    _expectTyreless('RECLAIMER');
    _expectTyreless('COMPRESSOR');
    _expectTyreless('TOWER LIGHT');
  });

  test('case 31: STATIONARY PUMP, case-insensitively', () {
    _expectTyreless('STATIONARY PUMP');
    _expectTyreless('Stationary pump');
  });

  test(
    'case 31b (negative control): a wheeled machine is never swallowed by '
    'the tyreless keyword match',
    () {
      expect(isTyrelessEquipment('TR-MIXER'), isFalse);
      expect(isTyrelessEquipment('LINE PUMP'), isFalse);
      expect(isTyrelessEquipment('PUMPS'), isFalse);
    },
  );
}
