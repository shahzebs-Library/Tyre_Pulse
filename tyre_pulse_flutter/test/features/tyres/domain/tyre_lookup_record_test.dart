import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_lookup_record.dart';

void main() {
  group('TyreLookupRecord.fromRow', () {
    test('decodes every column', () {
      final TyreLookupRecord record = TyreLookupRecord.fromRow(
        <String, dynamic>{
          'id': 'row-1',
          'brand': 'Michelin',
          'size': '315/80R22.5',
          'position': 'Left Front Outer',
          'tyre_position': 'LHF1',
          'asset_no': 'TM514',
          'site': 'NHC',
          'tread_depth': 9.5,
          'pressure_reading': 120,
        },
      );

      expect(record.id, 'row-1');
      expect(record.brand, 'Michelin');
      expect(record.size, '315/80R22.5');
      expect(record.position, 'Left Front Outer');
      expect(record.tyrePosition, 'LHF1');
      expect(record.assetNo, 'TM514');
      expect(record.site, 'NHC');
      expect(record.treadDepth, '9.5');
      expect(record.pressureReading, '120');
    });

    test('a missing id throws a FormatException', () {
      expect(
        () => TyreLookupRecord.fromRow(<String, dynamic>{'brand': 'X'}),
        throwsFormatException,
      );
    });

    test('an empty-string id throws a FormatException', () {
      expect(
        () => TyreLookupRecord.fromRow(<String, dynamic>{'id': ''}),
        throwsFormatException,
      );
    });

    test('a non-string id throws a FormatException', () {
      expect(
        () => TyreLookupRecord.fromRow(<String, dynamic>{'id': 42}),
        throwsFormatException,
      );
    });

    test('every optional column may be absent', () {
      final TyreLookupRecord record =
          TyreLookupRecord.fromRow(<String, dynamic>{'id': 'row-2'});

      expect(record.brand, isNull);
      expect(record.size, isNull);
      expect(record.position, isNull);
      expect(record.tyrePosition, isNull);
      expect(record.assetNo, isNull);
      expect(record.site, isNull);
      expect(record.treadDepth, isNull);
      expect(record.pressureReading, isNull);
    });

    test('a blank string column decodes to null, not an empty string', () {
      final TyreLookupRecord record = TyreLookupRecord.fromRow(
        <String, dynamic>{'id': 'row-3', 'brand': '   '},
      );
      expect(record.brand, isNull);
    });

    test('an explicit JSON null column decodes to null', () {
      final TyreLookupRecord record = TyreLookupRecord.fromRow(
        <String, dynamic>{'id': 'row-4', 'asset_no': null},
      );
      expect(record.assetNo, isNull);
    });
  });

  group('bestPosition', () {
    test('prefers the canonical tyre_position over the legacy column', () {
      final TyreLookupRecord record = TyreLookupRecord.fromRow(
        <String, dynamic>{
          'id': 'row-5',
          'position': 'Left Front Outer',
          'tyre_position': 'LHF1',
        },
      );
      expect(record.bestPosition, 'LHF1');
    });

    test('falls back to the legacy column when tyre_position is absent', () {
      final TyreLookupRecord record = TyreLookupRecord.fromRow(
        <String, dynamic>{'id': 'row-6', 'position': 'Left Front Outer'},
      );
      expect(record.bestPosition, 'Left Front Outer');
    });

    test('is null when neither column was recorded', () {
      final TyreLookupRecord record =
          TyreLookupRecord.fromRow(<String, dynamic>{'id': 'row-7'});
      expect(record.bestPosition, isNull);
    });
  });

  group('equality', () {
    test('two records with identical fields are equal', () {
      TyreLookupRecord build() => TyreLookupRecord.fromRow(
            <String, dynamic>{'id': 'row-8', 'brand': 'Bridgestone'},
          );
      expect(build(), build());
      expect(build().hashCode, build().hashCode);
    });

    test('a different id makes two records unequal', () {
      final TyreLookupRecord a = TyreLookupRecord.fromRow(
        <String, dynamic>{'id': 'row-a'},
      );
      final TyreLookupRecord b = TyreLookupRecord.fromRow(
        <String, dynamic>{'id': 'row-b'},
      );
      expect(a, isNot(b));
    });
  });
}
