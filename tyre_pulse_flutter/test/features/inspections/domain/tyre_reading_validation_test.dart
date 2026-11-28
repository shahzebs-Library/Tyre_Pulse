import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_reading_validation.dart';

void main() {
  test('pressure: hard range refuses, typical range warns, zero is real', () {
    expect(checkTyrePressure('').state, TyreReadingInputState.empty);
    expect(checkTyrePressure('110').state, TyreReadingInputState.ok);
    expect(checkTyrePressure('110').value, 110);
    expect(checkTyrePressure('0').state, TyreReadingInputState.unusual);
    expect(checkTyrePressure('0').value, 0);
    expect(checkTyrePressure('180').state, TyreReadingInputState.unusual);
    expect(checkTyrePressure('200').state, TyreReadingInputState.unusual);
    expect(checkTyrePressure('201').state, TyreReadingInputState.outOfRange);
    expect(checkTyrePressure('-1').state, TyreReadingInputState.outOfRange);
    expect(checkTyrePressure('abc').state, TyreReadingInputState.invalidNumber);
    expect(checkTyrePressure('1100').isStorable, isFalse);
  });

  test('tread: comma decimals, 0..30 hard, 1..25 typical', () {
    expect(checkTyreTread('8,5').value, 8.5);
    expect(checkTyreTread('8.5').state, TyreReadingInputState.ok);
    expect(checkTyreTread('0.5').state, TyreReadingInputState.unusual);
    expect(checkTyreTread('28').state, TyreReadingInputState.unusual);
    expect(checkTyreTread('30').isStorable, isTrue);
    expect(checkTyreTread('31').state, TyreReadingInputState.outOfRange);
  });

  test('serial difference ignores case and spaces, never on empty', () {
    expect(serialDiffersFromRecord('yma 55312', 'YMA55312'), isFalse);
    expect(serialDiffersFromRecord('YMA55313', 'YMA55312'), isTrue);
    expect(serialDiffersFromRecord('', 'YMA55312'), isFalse);
    expect(serialDiffersFromRecord('YMA55312', null), isFalse);
  });

  test('km run needs both readings and never goes negative', () {
    expect(
      kmRunSinceFitment(currentOdometerKm: 52000, kmAtFitment: 40000),
      12000,
    );
    expect(kmRunSinceFitment(currentOdometerKm: 52000), isNull);
    expect(kmRunSinceFitment(kmAtFitment: 40000), isNull);
    expect(
      kmRunSinceFitment(currentOdometerKm: 30000, kmAtFitment: 40000),
      isNull,
    );
  });
}
