/// Unit coverage for the [VehicleAsset] domain model: decoding, the derived
/// identity/navigability getters, the status-tone mapping, the odometer
/// formatter and the backend-unavailable classifier.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

Map<String, dynamic> _fullRow({Map<String, dynamic> overrides = const {}}) {
  final Map<String, dynamic> row = <String, dynamic>{
    'id': 'row-1',
    'asset_no': 'TM514',
    'fleet_number': 'FN-88',
    'make': 'Sinotruk',
    'model': 'HOWO',
    'vehicle_type': 'TR-MIXER',
    'site': 'NHC',
    'status': 'Active',
    'operator_name': 'A. Rahman',
    'tyre_size': '315/80R22.5',
    'current_km': 128000,
    'country': 'KSA',
    'department': 'Operations',
    'region': 'Central',
    'registration_no': 'ABC-1234',
    'year': 2019,
  };
  row.addAll(overrides);
  return row;
}

void main() {
  group('VehicleAsset.fromRow', () {
    test('decodes every column from a full row', () {
      final VehicleAsset asset = VehicleAsset.fromRow(_fullRow());
      expect(asset.id, 'row-1');
      expect(asset.assetNo, 'TM514');
      expect(asset.fleetNumber, 'FN-88');
      expect(asset.make, 'Sinotruk');
      expect(asset.model, 'HOWO');
      expect(asset.vehicleType, 'TR-MIXER');
      expect(asset.site, 'NHC');
      expect(asset.status, 'Active');
      expect(asset.operatorName, 'A. Rahman');
      expect(asset.tyreSize, '315/80R22.5');
      expect(asset.currentKm, 128000);
      expect(asset.country, 'KSA');
      expect(asset.department, 'Operations');
      expect(asset.region, 'Central');
      expect(asset.registrationNo, 'ABC-1234');
      expect(asset.year, 2019);
    });

    test('missing optional columns decode to null, never a fabricated '
        'empty string or zero', () {
      final VehicleAsset asset = VehicleAsset.fromRow(<String, dynamic>{
        'id': 'row-2',
      });
      expect(asset.assetNo, isNull);
      expect(asset.fleetNumber, isNull);
      expect(asset.make, isNull);
      expect(asset.model, isNull);
      expect(asset.vehicleType, isNull);
      expect(asset.site, isNull);
      expect(asset.status, isNull);
      expect(asset.operatorName, isNull);
      expect(asset.tyreSize, isNull);
      expect(asset.currentKm, isNull);
      expect(asset.country, isNull);
      expect(asset.department, isNull);
      expect(asset.region, isNull);
      expect(asset.registrationNo, isNull);
      expect(asset.year, isNull);
    });

    test('whitespace-only string columns decode to null, matching '
        '`_stringOrNull`\'s trim-then-empty-check rule', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'asset_no': '   '}),
      );
      expect(asset.assetNo, isNull);
    });

    test('leading/trailing whitespace on a real value is trimmed', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'asset_no': '  TM514  '}),
      );
      expect(asset.assetNo, 'TM514');
    });

    test('a non-string value in a string column decodes to null rather '
        'than being coerced', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'make': 42}),
      );
      expect(asset.make, isNull);
    });

    test('current_km and year accept a plain int', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'current_km': 500, 'year': 2020}),
      );
      expect(asset.currentKm, 500);
      expect(asset.year, 2020);
    });

    test('current_km and year accept a double and truncate toward zero, '
        'since PostgREST can return a numeric column as either shape', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(
          overrides: <String, dynamic>{'current_km': 500.9, 'year': 2020.0},
        ),
      );
      expect(asset.currentKm, 500);
      expect(asset.year, 2020);
    });

    test('a non-numeric value in an int column decodes to null', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'current_km': 'unknown'}),
      );
      expect(asset.currentKm, isNull);
    });

    test('throws a validation AppError when id is missing', () {
      expect(
        () => VehicleAsset.fromRow(<String, dynamic>{'asset_no': 'TM514'}),
        throwsA(
          isA<AppError>().having(
            (AppError e) => e.kind,
            'kind',
            AppErrorKind.validation,
          ),
        ),
      );
    });

    test('throws a validation AppError when id is blank', () {
      expect(
        () => VehicleAsset.fromRow(<String, dynamic>{'id': ''}),
        throwsA(isA<AppError>()),
      );
    });

    test('throws a validation AppError when id is not a string', () {
      expect(
        () => VehicleAsset.fromRow(<String, dynamic>{'id': 12345}),
        throwsA(isA<AppError>()),
      );
    });
  });

  group('displayIdentity', () {
    test('prefers assetNo over fleetNumber when both are present', () {
      final VehicleAsset asset = VehicleAsset.fromRow(_fullRow());
      expect(asset.displayIdentity, 'TM514');
    });

    test('falls back to fleetNumber when assetNo is blank', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'asset_no': null}),
      );
      expect(asset.displayIdentity, 'FN-88');
    });

    test('is null when neither is present', () {
      final VehicleAsset asset = VehicleAsset.fromRow(<String, dynamic>{
        'id': 'row-3',
      });
      expect(asset.displayIdentity, isNull);
    });
  });

  group('hasNavigableAssetNo', () {
    test('true when assetNo is a real value', () {
      final VehicleAsset asset = VehicleAsset.fromRow(_fullRow());
      expect(asset.hasNavigableAssetNo, isTrue);
    });

    test('false when assetNo is blank, even with a fleetNumber present', () {
      final VehicleAsset asset = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'asset_no': '  '}),
      );
      expect(asset.hasNavigableAssetNo, isFalse);
    });
  });

  group('vehicleStatusTone', () {
    test('active and operational map to ok', () {
      expect(vehicleStatusTone('Active'), TpStatus.ok);
      expect(vehicleStatusTone('operational'), TpStatus.ok);
      expect(vehicleStatusTone('ACTIVE'), TpStatus.ok);
    });

    test('maintenance maps to warning', () {
      expect(vehicleStatusTone('Maintenance'), TpStatus.warning);
    });

    test('repair maps to critical', () {
      expect(vehicleStatusTone('Repair'), TpStatus.critical);
    });

    test('inactive, retired and sold map to neutral', () {
      expect(vehicleStatusTone('Inactive'), TpStatus.neutral);
      expect(vehicleStatusTone('retired'), TpStatus.neutral);
      expect(vehicleStatusTone('SOLD'), TpStatus.neutral);
    });

    test('null, empty or an uncatalogued word all map to unknown - never '
        'to neutral, which would claim a considered "no judgement" answer', () {
      expect(vehicleStatusTone(null), TpStatus.unknown);
      expect(vehicleStatusTone(''), TpStatus.unknown);
      expect(vehicleStatusTone('   '), TpStatus.unknown);
      expect(vehicleStatusTone('scrapped'), TpStatus.unknown);
    });
  });

  group('formatVehicleOdometer', () {
    test('groups digits in threes from the right', () {
      expect(formatVehicleOdometer(128000), '128,000');
      expect(formatVehicleOdometer(1000000), '1,000,000');
    });

    test('does not insert a leading separator for fewer than four digits', () {
      expect(formatVehicleOdometer(0), '0');
      expect(formatVehicleOdometer(9), '9');
      expect(formatVehicleOdometer(999), '999');
    });

    test('a boundary value of exactly four digits gets one separator', () {
      expect(formatVehicleOdometer(1000), '1,000');
    });

    test('a negative value keeps its sign outside the grouping', () {
      expect(formatVehicleOdometer(-1234), '-1,234');
    });
  });

  group('isBackendUnavailableError', () {
    test('true for a network-classified AppError', () {
      expect(isBackendUnavailableError(const AppError.network()), isTrue);
    });

    test('false for a validation-classified AppError', () {
      expect(
        isBackendUnavailableError(
          const AppError(kind: AppErrorKind.validation, message: 'invalid'),
        ),
        isFalse,
      );
    });

    test('false for an authorization-classified AppError', () {
      expect(
        isBackendUnavailableError(
          const AppError.authorization(message: 'denied'),
        ),
        isFalse,
      );
    });
  });

  group('VehicleAsset value equality', () {
    test('two decodes of the same row are equal', () {
      final VehicleAsset a = VehicleAsset.fromRow(_fullRow());
      final VehicleAsset b = VehicleAsset.fromRow(_fullRow());
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });

    test('a single differing field makes the rows unequal', () {
      final VehicleAsset a = VehicleAsset.fromRow(_fullRow());
      final VehicleAsset b = VehicleAsset.fromRow(
        _fullRow(overrides: <String, dynamic>{'status': 'Maintenance'}),
      );
      expect(a, isNot(b));
    });

    test('toString names the id and both identity fields without throwing', () {
      final VehicleAsset asset = VehicleAsset.fromRow(_fullRow());
      expect(asset.toString(), contains('row-1'));
      expect(asset.toString(), contains('TM514'));
      expect(asset.toString(), contains('FN-88'));
    });
  });
}
