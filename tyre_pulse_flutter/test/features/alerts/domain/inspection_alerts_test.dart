import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/alerts/domain/inspection_alerts.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';

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
          'RHF1': <String, Object?>{
            'condition': 'Good',
            'checked': true,
            'pressure_psi': 110,
          },
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

  test('same asset code in another country is a different vehicle', () {
    final alerts = alertsFromInspections(<Map<String, Object?>>[
      <String, Object?>{
        'id': 'u1',
        'country': 'UAE',
        'asset_no': 'GN103',
        'tyre_conditions': <String, Object?>{
          'LHF1': <String, Object?>{'condition': 'Good', 'checked': true},
        },
      },
      <String, Object?>{
        'id': 'k1',
        'country': 'KSA',
        'asset_no': 'GN103',
        'tyre_conditions': <String, Object?>{
          'LHF1': <String, Object?>{
            'condition': 'Puncture',
            'checked': true,
            'serial_number': 'SN-1',
            'tread_depth_mm': 4.5,
          },
        },
      },
    ]);
    expect(alerts, hasLength(1));
    expect(alerts.single.id, 'insp:k1:LHF1');
    expect(alerts.single.serialNo, 'SN-1');
    expect(alerts.single.treadDepthMm, 4.5);
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

  test('a rejected inspection is skipped and the next one speaks', () {
    final alerts = alertsFromInspections(<Map<String, Object?>>[
      <String, Object?>{
        'id': 'r1',
        'asset_no': 'TM1',
        'approval_status': 'rejected',
        'tyre_conditions': <String, Object?>{
          'LHF1': <String, Object?>{'condition': 'Flat', 'checked': true},
        },
      },
      <String, Object?>{
        'id': 'ok1',
        'asset_no': 'TM1',
        'tyre_conditions': <String, Object?>{
          'RHF1': <String, Object?>{'condition': 'Damaged', 'checked': true},
        },
      },
    ]);
    expect(alerts.map((a) => a.id), <String>['insp:ok1:RHF1']);
  });

  test('merge drops acked and duplicate wheels, critical first, then cut', () {
    const reg = TyreAlert(
      id: 'rec:1',
      riskLevel: 'High',
      assetNo: 'TM1',
      position: 'LHF1',
      issueDate: '2026-11-01',
    );
    const dup = TyreAlert(
      id: 'insp:a:LHF1',
      riskLevel: 'Critical',
      assetNo: 'tm1',
      position: 'lhf1',
      issueDate: '2026-11-20',
    );
    const crit = TyreAlert(
      id: 'insp:a:RHF1',
      riskLevel: 'Critical',
      assetNo: 'TM1',
      position: 'RHF1',
      issueDate: '2026-11-10',
    );
    const acked = TyreAlert(
      id: 'insp:b:LHF1',
      riskLevel: 'Critical',
      assetNo: 'TM2',
      position: 'LHF1',
    );
    final merged = mergeTyreAlerts(
      register: const <TyreAlert>[reg],
      inspection: const <TyreAlert>[dup, crit, acked],
      acknowledged: <String>{'insp:b:LHF1'},
    );
    expect(merged.map((a) => a.id), <String>['insp:a:RHF1', 'rec:1']);
    expect(
      mergeTyreAlerts(
        register: const <TyreAlert>[reg],
        inspection: const <TyreAlert>[crit],
        acknowledged: const <String>{},
        limit: 1,
      ).single.id,
      'insp:a:RHF1',
    );
  });
}
