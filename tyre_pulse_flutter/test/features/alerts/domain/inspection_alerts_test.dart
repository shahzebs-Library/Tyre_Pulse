import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/alerts/domain/inspection_alerts.dart';

void main() {
  test('latest inspection per asset turns bad wheels into alerts', () {
    final alerts = alertsFromInspections(<Map<String, Object?>>[
      <String, Object?>{
        'id': 'i2',
        'asset_no': 'TM689',
        'site': 'NHC',
        'inspection_date': '2026-11-25',
        'tyre_conditions': <String, Object?>{
          'LHF1': <String, Object?>{'condition': 'Damaged', 'checked': true},
          'RHF1': <String, Object?>{'condition': 'Good', 'checked': true, 'pressure_psi': 110},
        },
      },
      // Older inspection of the same asset: superseded, not an alert.
      <String, Object?>{
        'id': 'i1',
        'asset_no': 'tm689',
        'tyre_conditions': <String, Object?>{
          'RHF1': <String, Object?>{'condition': 'Flat', 'checked': true},
        },
      },
    ]);
    expect(alerts, hasLength(1));
    expect(alerts.single.id, 'insp:i2:LHF1');
    expect(alerts.single.isCritical, isTrue);
    expect(alerts.single.assetNo, 'TM689');
  });

  test('rows without an asset or id are skipped', () {
    expect(
      alertsFromInspections(<Map<String, Object?>>[
        <String, Object?>{'id': 'x', 'asset_no': ''},
        <String, Object?>{'asset_no': 'TM1'},
      ]),
      isEmpty,
    );
  });
}
