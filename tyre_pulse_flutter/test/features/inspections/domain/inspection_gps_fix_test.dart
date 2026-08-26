/// Coverage for [InspectionGpsFix] and [inspectionGpsColumns] - the four
/// nullable columns a captured (or absent) fix resolves to.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_gps_fix.dart';

void main() {
  group('inspectionGpsColumns', () {
    test('a null fix spreads exactly four null columns', () {
      final Map<String, Object?> cols = inspectionGpsColumns(null);
      expect(cols.keys.toSet(), <String>{
        'gps_lat',
        'gps_lng',
        'gps_accuracy',
        'gps_captured_at',
      });
      expect(cols.values, everyElement(isNull));
    });

    test('a real fix spreads its own values', () {
      final InspectionGpsFix fix = InspectionGpsFix(
        latitude: 24.7136,
        longitude: 46.6753,
        accuracyMeters: 9.4,
        capturedAt: DateTime.utc(2026, 8, 20, 9, 15),
      );
      final Map<String, Object?> cols = inspectionGpsColumns(fix);
      expect(cols['gps_lat'], 24.7136);
      expect(cols['gps_lng'], 46.6753);
      expect(cols['gps_accuracy'], 9.4);
      expect(cols['gps_captured_at'], '2026-08-20T09:15:00.000Z');
    });

    test('a fix with no reported accuracy leaves gps_accuracy null, never '
        'fabricated as 0', () {
      final InspectionGpsFix fix = InspectionGpsFix(
        latitude: 1,
        longitude: 2,
        capturedAt: DateTime.utc(2026, 8, 20),
      );
      final Map<String, Object?> cols = inspectionGpsColumns(fix);
      expect(cols['gps_accuracy'], isNull);
    });
  });

  group('equality', () {
    test('two fixes with identical fields are equal', () {
      final DateTime at = DateTime.utc(2026, 8, 20);
      final InspectionGpsFix a = InspectionGpsFix(
        latitude: 1,
        longitude: 2,
        accuracyMeters: 3,
        capturedAt: at,
      );
      final InspectionGpsFix b = InspectionGpsFix(
        latitude: 1,
        longitude: 2,
        accuracyMeters: 3,
        capturedAt: at,
      );
      expect(a, b);
      expect(a.hashCode, b.hashCode);
    });
  });
}
