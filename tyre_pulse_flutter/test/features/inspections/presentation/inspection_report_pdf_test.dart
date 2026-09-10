import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/presentation/reporting/inspection_report_pdf.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_fitment.dart';

const InspectionReportCopy _copy = InspectionReportCopy(
  title: 'Tyre inspection report',
  asset: 'Asset',
  vehicleType: 'Vehicle type',
  site: 'Site',
  date: 'Inspection date',
  inspector: 'Inspector',
  status: 'Status',
  odometer: 'Odometer',
  hourMeter: 'Hour meter',
  location: 'Location',
  summary: 'Condition summary',
  layout: 'Vehicle tyre layout',
  readings: 'Tyre readings',
  position: 'Position',
  currentFitment: 'Current fitted tyre',
  condition: 'Condition',
  pressure: 'Pressure',
  tread: 'Tread',
  notes: 'Notes',
  notRecorded: 'Not recorded',
  notAvailable: 'Not available',
  observations: 'Observations',
  generated: 'Generated',
  good: 'Good',
  worn: 'Worn',
  critical: 'Critical',
);

void main() {
  test('PDF uses canonical mixer positions and actual active fitment data',
      () async {
    final bytes = await buildInspectionReportPdf(
      InspectionReportData(
        id: '11111111-2222-3333-4444-555555555555',
        assetNo: 'TM-749',
        vehicleType: 'Transit mixer',
        site: 'Riyadh Yard',
        inspector: 'EMP-1048',
        inspectionDate: DateTime.utc(2026, 8, 28, 10, 48),
        status: 'Completed',
        approvalStatus: 'approved',
        odometerKm: 68420,
        hourMeter: 8742,
        gpsLat: 24.7136,
        gpsLng: 46.6753,
        findings: 'Rear centre tyre requires monitoring.',
        tyreConditions: <String, Map<String, Object?>>{
          // Inspection V1 key. The report must display the matching GCC V2
          // code without rewriting this historical storage value.
          'R1Lo': <String, Object?>{
            'condition': 'Worn',
            'pressure_psi': 92,
            'tread_depth_mm': 3.4,
            'checked': true,
            'photo_url': 'https://storage.example/private/evidence.jpg',
            'photo_uri': r'C:\private\inspection\evidence.jpg',
          },
        },
        installedTyres: <String, TyreFitment>{
          'R1Lo': const TyreFitment(
            id: 'fit-1',
            serialNo: 'SER-ACTIVE-88421',
            positionCode: 'LHCO',
            brand: 'Bridgestone',
            size: '315/80 R22.5',
            assetNo: 'TM-749',
            status: 'Active',
          ),
        },
      ),
      _copy,
      generatedAt: DateTime.utc(2026, 8, 28, 11),
    );

    expect(bytes.length, greaterThan(8000));
    expect(
      ascii.decode(bytes.sublist(0, 8), allowInvalid: true),
      startsWith('%PDF-'),
    );

    final String source = latin1.decode(bytes, allowInvalid: true);
    expect(source, contains('TM-749'));
    expect(source, contains('LHCO'));
    expect(source, contains('SER-ACTIVE-88421'));
    expect(source, contains('Bridgestone'));
    expect(source, contains('315/80'));
    expect(source, contains('R22.5'));
    expect(source, isNot(contains('storage.example')));
    expect(source, isNot(contains(r'C:\private\inspection')));
  });

  test('share filename is stable and filesystem safe', () {
    final String name = inspectionReportFileName(
      InspectionReportData(
        id: 'report-id',
        assetNo: 'TM / 749',
        vehicleType: 'Transit mixer',
        site: '',
        inspector: '',
        inspectionDate: DateTime(2026, 8, 28),
        status: '',
        tyreConditions: const <String, Map<String, Object?>>{},
        installedTyres: const <String, TyreFitment>{},
      ),
    );

    expect(name, 'tyre-inspection-TM-749-20260828.pdf');
  });
}
