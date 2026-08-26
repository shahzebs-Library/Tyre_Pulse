library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/records/domain/models/tyre_record.dart';

Map<String, dynamic> _row(Map<String, dynamic> overrides) {
  return <String, dynamic>{
    'id': 'row-1',
    'asset_no': 'TM514',
    'serial_no': 'SN123',
    'brand': 'Bridgestone',
    'site': 'NHC',
    'position': null,
    'tyre_position': 'LHF1',
    'issue_date': '2026-01-15',
    'risk_level': 'Medium',
    'category': 'Steer',
    'cost_per_tyre': 900,
    'km_at_fitment': 1000,
    'km_at_removal': 41000,
    'description': null,
    'remarks': null,
    'country': 'KSA',
    ...overrides,
  };
}

void main() {
  group('TyreRecord.fromRow', () {
    test('decodes every column from a full row', () {
      final TyreRecord record = TyreRecord.fromRow(_row(<String, dynamic>{}));
      expect(record.id, 'row-1');
      expect(record.assetNo, 'TM514');
      expect(record.serialNo, 'SN123');
      expect(record.brand, 'Bridgestone');
      expect(record.site, 'NHC');
      expect(record.tyrePosition, 'LHF1');
      expect(record.issueDate, '2026-01-15');
      expect(record.riskLevel, 'Medium');
      expect(record.category, 'Steer');
      expect(record.costPerTyre, 900);
      expect(record.kmAtFitment, 1000);
      expect(record.kmAtRemoval, 41000);
      expect(record.country, 'KSA');
    });

    test('throws a validation AppError when id is missing', () {
      final Map<String, dynamic> row = _row(<String, dynamic>{})..remove('id');
      expect(
        () => TyreRecord.fromRow(row),
        throwsA(
          isA<AppError>().having((AppError e) => e.kind, 'kind', AppErrorKind.validation),
        ),
      );
    });

    test('throws when id is blank', () {
      expect(
        () => TyreRecord.fromRow(_row(<String, dynamic>{'id': '   '})),
        throwsA(isA<AppError>()),
      );
    });

    test('every other column is optional and decodes to null when absent',
        () {
      final TyreRecord record = TyreRecord.fromRow(<String, dynamic>{'id': 'x'});
      expect(record.assetNo, isNull);
      expect(record.serialNo, isNull);
      expect(record.brand, isNull);
      expect(record.riskLevel, isNull);
      expect(record.costPerTyre, isNull);
    });

    test('a blank string column decodes to null, not an empty string', () {
      final TyreRecord record =
          TyreRecord.fromRow(_row(<String, dynamic>{'brand': '   '}));
      expect(record.brand, isNull);
    });

    test('accepts a numeric column encoded as a JSON string', () {
      // PostgREST can encode a Postgres `numeric` column as a JSON string
      // depending on server configuration.
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'cost_per_tyre': '1234.50'}),
      );
      expect(record.costPerTyre, 1234.50);
    });

    test('ignores an unparsable numeric string rather than throwing', () {
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'cost_per_tyre': 'not-a-number'}),
      );
      expect(record.costPerTyre, isNull);
    });
  });

  group('TyreRecord.bestPosition', () {
    test('prefers tyrePosition over the legacy position column', () {
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'position': 'legacy', 'tyre_position': 'LHF1'}),
      );
      expect(record.bestPosition, 'LHF1');
    });

    test('falls back to position when tyrePosition is absent', () {
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'position': 'legacy', 'tyre_position': null}),
      );
      expect(record.bestPosition, 'legacy');
    });

    test('is null when neither is recorded', () {
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'position': null, 'tyre_position': null}),
      );
      expect(record.bestPosition, isNull);
    });
  });

  group('TyreRecord.tyreLifeKm', () {
    test('is the difference when removal is genuinely after fitment', () {
      final TyreRecord record = TyreRecord.fromRow(
        _row(<String, dynamic>{'km_at_fitment': 1000, 'km_at_removal': 41000}),
      );
      expect(record.tyreLifeKm, 40000);
    });

    test('is null when either meter is missing', () {
      final TyreRecord a = TyreRecord.fromRow(
        _row(<String, dynamic>{'km_at_fitment': null, 'km_at_removal': 41000}),
      );
      final TyreRecord b = TyreRecord.fromRow(
        _row(<String, dynamic>{'km_at_fitment': 1000, 'km_at_removal': null}),
      );
      expect(a.tyreLifeKm, isNull);
      expect(b.tyreLifeKm, isNull);
    });

    test('is null when removal is not after fitment - a reversed or equal '
        'pair of readings is not a measured life', () {
      final TyreRecord equal = TyreRecord.fromRow(
        _row(<String, dynamic>{'km_at_fitment': 1000, 'km_at_removal': 1000}),
      );
      final TyreRecord reversed = TyreRecord.fromRow(
        _row(<String, dynamic>{'km_at_fitment': 41000, 'km_at_removal': 1000}),
      );
      expect(equal.tyreLifeKm, isNull);
      expect(reversed.tyreLifeKm, isNull);
    });
  });

  group('equality', () {
    test('two records decoded from the same row are equal', () {
      final Map<String, dynamic> row = _row(<String, dynamic>{});
      expect(TyreRecord.fromRow(row), TyreRecord.fromRow(row));
    });

    test('records with a different id are not equal', () {
      final TyreRecord a = TyreRecord.fromRow(_row(<String, dynamic>{'id': 'a'}));
      final TyreRecord b = TyreRecord.fromRow(_row(<String, dynamic>{'id': 'b'}));
      expect(a, isNot(equals(b)));
    });
  });
}
