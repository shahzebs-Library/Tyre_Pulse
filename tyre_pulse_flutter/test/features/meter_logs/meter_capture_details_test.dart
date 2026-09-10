import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/meter_logs/data/meter_capture_details.dart';

void main() {
  test('distance uses measured values and does not invent missing distance',
      () {
    expect(distanceSinceLastReading(1240.5, 1200), 40.5);
    expect(distanceSinceLastReading(1200, 1200), 0);
    expect(distanceSinceLastReading(1200, null), isNull);
    expect(distanceSinceLastReading(null, 1200), isNull);
    expect(distanceSinceLastReading(1100, 1200), isNull);
    expect(distanceSinceLastReading(double.nan, 1200), isNull);
  });
  test('manual and photo transcription remain distinct in persisted notes', () {
    expect(
      meterCaptureNotes('Driver note', MeterEntrySource.manual),
      startsWith('Driver note\n'),
    );
    expect(
      meterCaptureNotes(null, MeterEntrySource.manual),
      contains('manually read from gauge'),
    );
    expect(
      meterCaptureNotes(null, MeterEntrySource.photo),
      contains('manually transcribed from photo'),
    );
  });
}
