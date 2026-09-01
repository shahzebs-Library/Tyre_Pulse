library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

TyreFitment _fitment({
  required String id,
  required String code,
  required String serial,
  DateTime? issued,
}) {
  return TyreFitment(
    id: id,
    serialNo: serial,
    positionCode: code,
    issueDate: issued,
  );
}

void main() {
  group('TyreFitment.fromRow', () {
    test('uses real lifecycle aliases without fabricating blank values', () {
      final TyreFitment fitment = TyreFitment.fromRow(const <String, Object?>{
        'id': ' tyre-id ',
        'serial_no': ' SER-100 ',
        'tyre_position': ' LHCO ',
        'brand': ' Michelin ',
        'size': ' 315/80 R22.5 ',
        'asset_no': ' TM514 ',
        'status': ' Active ',
        'issue_date': '2026-08-20',
      });

      expect(fitment.id, 'tyre-id');
      expect(fitment.serialNo, 'SER-100');
      expect(fitment.positionCode, 'LHCO');
      expect(fitment.brand, 'Michelin');
      expect(fitment.size, '315/80 R22.5');
      expect(fitment.assetNo, 'TM514');
      expect(fitment.issueDate, DateTime(2026, 8, 20));
    });

    test('rejects a row with no stable record id', () {
      expect(
        () => TyreFitment.fromRow(
          const <String, Object?>{'serial_no': 'S-1'},
        ),
        throwsFormatException,
      );
    });
  });

  group('fitmentsByInspectionSlot', () {
    test('maps canonical Tri-mixer codes to internal inspection slots', () {
      final Map<String, TyreFitment> mapped = fitmentsByInspectionSlot(
        vehicleType: 'TRANSIT MIXER',
        assetNo: 'TM514',
        fitments: <TyreFitment>[
          _fitment(id: '1', code: 'LHCO', serial: 'CENTRE-OUTER'),
          _fitment(id: '2', code: 'RHRO', serial: 'REAR-OUTER'),
        ],
      );

      expect(mapped['R1Lo']?.serialNo, 'CENTRE-OUTER');
      expect(mapped['R2Ro']?.serialNo, 'REAR-OUTER');
    });

    test('uses non-mixer rear codes for a concrete pump', () {
      final Map<String, TyreFitment> mapped = fitmentsByInspectionSlot(
        vehicleType: 'Concrete pump',
        assetNo: 'CP-045',
        fitments: <TyreFitment>[
          _fitment(id: '1', code: 'LHR1-O', serial: 'PUMP-REAR'),
        ],
      );

      expect(mapped['R1Lo']?.serialNo, 'PUMP-REAR');
    });

    test('newest lifecycle row wins and unknown positions are ignored', () {
      final Map<String, TyreFitment> mapped = fitmentsByInspectionSlot(
        vehicleType: 'Pickup',
        assetNo: 'PU-118',
        fitments: <TyreFitment>[
          _fitment(
            id: 'old',
            code: 'LHF1',
            serial: 'OLD',
            issued: DateTime(2026, 1, 1),
          ),
          _fitment(id: 'spare', code: 'Spare', serial: 'UNMAPPED'),
          _fitment(
            id: 'new',
            code: 'LHF1',
            serial: 'NEW',
            issued: DateTime(2026, 8, 1),
          ),
        ],
      );

      expect(mapped, hasLength(1));
      expect(mapped['FL']?.serialNo, 'NEW');
    });
  });
}
