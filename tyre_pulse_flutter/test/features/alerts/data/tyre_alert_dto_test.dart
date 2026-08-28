library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/features/alerts/data/alerts_repository.dart';
import 'package:tyre_pulse/features/alerts/data/tyre_alert_dto.dart';

void main() {
  test('decodes verified tyre record columns and numeric strings', () {
    final alert = TyreAlertDto.fromRow(<String, dynamic>{
      'id': 'record-1',
      'asset_no': ' PMV-2104 ',
      'site': 'Qiddiya',
      'brand': 'Michelin',
      'tyre_position': 'R3 O',
      'risk_level': 'Critical',
      'serial_no': 'TR938201',
      'tread_depth': '2.8',
      'issue_date': '2026-08-28',
    }).toDomain();

    expect(alert.id, 'record-1');
    expect(alert.assetNo, 'PMV-2104');
    expect(alert.position, 'R3 O');
    expect(alert.treadDepthMm, 2.8);
  });

  test('rejects unidentified or non-alert rows loudly', () {
    expect(
      () => TyreAlertDto.fromRow(<String, dynamic>{
        'id': '',
        'risk_level': 'Low',
      }),
      throwsA(
        isA<AppError>().having(
          (AppError error) => error.kind,
          'kind',
          AppErrorKind.validation,
        ),
      ),
    );
  });

  test('country filter trims and preserves the null-inclusive RLS read', () {
    expect(alertsCountryFilter(null), isNull);
    expect(alertsCountryFilter('  '), isNull);
    expect(alertsCountryFilter('All'), isNull);
    expect(
      alertsCountryFilter('  KSA  '),
      'country.eq.KSA,country.is.null',
    );
  });
}
