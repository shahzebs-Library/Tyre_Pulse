/// Coverage for [TyrePositionReading]: the seed, the forgiving decode, the
/// exact key vocabulary [tyreCompleteness] depends on, and the disclosed
/// pressure-as-a-number divergence from `mobile/lib/types.ts`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

void main() {
  group('TyrePositionReading.seed', () {
    test('starts unchecked, condition Good, nothing else set', () {
      final TyrePositionReading r = TyrePositionReading.seed('LHF1');
      expect(r.position, 'LHF1');
      expect(r.condition, TyreReadingCondition.good);
      expect(r.checked, isFalse);
      expect(r.pressurePsi, isNull);
      expect(r.treadDepthMm, isNull);
      expect(r.serialNumber, isNull);
      expect(r.hasPhoto, isFalse);
      expect(r.isTouched, isFalse);
    });
  });

  group('toEntry / fromEntry round trip', () {
    test('a fully populated reading survives the round trip', () {
      const TyrePositionReading original = TyrePositionReading(
        position: 'RHR1-O',
        serialNumber: 'SN-100',
        pressurePsi: 112.5,
        treadDepthMm: 9.2,
        condition: TyreReadingCondition.worn,
        checked: true,
        photoUrl: 'https://example.test/photo.jpg',
        notes: 'Slight edge wear',
      );

      final Map<String, Object?> entry = original.toEntry();
      final TyrePositionReading decoded = TyrePositionReading.fromEntry(
        'RHR1-O',
        entry,
      );

      expect(decoded.position, original.position);
      expect(decoded.serialNumber, original.serialNumber);
      expect(decoded.pressurePsi, original.pressurePsi);
      expect(decoded.treadDepthMm, original.treadDepthMm);
      expect(decoded.condition, original.condition);
      expect(decoded.checked, original.checked);
      expect(decoded.photoUrl, original.photoUrl);
      expect(decoded.notes, original.notes);
    });

    test('a pressure of exactly 0.0 - a flat tyre - survives the round '
        'trip and is never treated as absent', () {
      // The single most important disclosed divergence from
      // `mobile/lib/types.ts`: pressure is a double here, not a string, so
      // a real 0 reading can never be discarded by a truthiness check.
      const TyrePositionReading flat = TyrePositionReading(
        position: 'LHF2',
        pressurePsi: 0,
        checked: true,
      );
      final Map<String, Object?> entry = flat.toEntry();
      expect(entry['pressure_psi'], 0.0);

      final TyrePositionReading decoded = TyrePositionReading.fromEntry(
        'LHF2',
        entry,
      );
      expect(decoded.pressurePsi, 0.0);
      expect(decoded.pressurePsi, isNotNull);
    });

    test('a null entry decodes to the seed', () {
      final TyrePositionReading decoded = TyrePositionReading.fromEntry(
        'LHR1',
        null,
      );
      expect(decoded.condition, TyreReadingCondition.good);
      expect(decoded.checked, isFalse);
    });

    test('fromEntry accepts the legacy field name aliases', () {
      final TyrePositionReading decoded = TyrePositionReading.fromEntry(
        'LHF1',
        <String, Object?>{
          'serial_no': 'ALIAS-1',
          'pressure': '108',
          'tread_depth': '7',
        },
      );
      expect(decoded.serialNumber, 'ALIAS-1');
      expect(decoded.pressurePsi, 108.0);
      expect(decoded.treadDepthMm, 7.0);
    });

    test('toEntry omits photo_uri once photo_url exists - the URL wins', () {
      const TyrePositionReading r = TyrePositionReading(
        position: 'LHF1',
        photoLocalPath: '/tmp/local.jpg',
        photoUrl: 'https://example.test/uploaded.jpg',
      );
      final Map<String, Object?> entry = r.toEntry();
      expect(entry['photo_url'], 'https://example.test/uploaded.jpg');
      expect(entry.containsKey('photo_uri'), isFalse);
    });
  });

  group('isTouched', () {
    test('false for the untouched seed', () {
      expect(TyrePositionReading.seed('LHF1').isTouched, isFalse);
    });

    test('true once checked is explicitly set, with nothing else filled', () {
      const TyrePositionReading r = TyrePositionReading(
        position: 'LHF1',
        checked: true,
      );
      expect(r.isTouched, isTrue);
    });

    test('true for a deliberately-chosen non-seed condition', () {
      const TyrePositionReading r = TyrePositionReading(
        position: 'LHF1',
        condition: TyreReadingCondition.flat,
      );
      expect(r.isTouched, isTrue);
    });

    test('true when only a pressure of 0 was entered', () {
      const TyrePositionReading r = TyrePositionReading(
        position: 'LHF1',
        pressurePsi: 0,
      );
      expect(r.isTouched, isTrue);
    });
  });

  group('copyWith clear flags', () {
    test('clearPressurePsi removes the value even when a new one is not '
        'supplied', () {
      const TyrePositionReading r = TyrePositionReading(
        position: 'LHF1',
        pressurePsi: 100,
      );
      final TyrePositionReading cleared = r.copyWith(clearPressurePsi: true);
      expect(cleared.pressurePsi, isNull);
    });
  });

  group('equality', () {
    test('two readings with identical fields are equal', () {
      const TyrePositionReading a = TyrePositionReading(
        position: 'LHF1',
        pressurePsi: 100,
        checked: true,
      );
      const TyrePositionReading b = TyrePositionReading(
        position: 'LHF1',
        pressurePsi: 100,
        checked: true,
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
  });
}
