/// P0-4: odometer / hour meter text is parsed tolerantly, and unreadable
/// text is reported instead of silently becoming "no reading".
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/inspections/domain/meter_reading_input.dart';

void main() {
  test('blank is neither a reading nor an error', () {
    final MeterReadingInput input = MeterReadingInput.parse('   ');
    expect(input.value, isNull);
    expect(input.isInvalid, isFalse);
  });

  test('a decimal reading is kept, not dropped', () {
    expect(MeterReadingInput.parse('12345.5').value, 12345.5);
  });

  test('thousands separators and spaces are tolerated', () {
    expect(MeterReadingInput.parse('12,345').value, 12345);
    expect(MeterReadingInput.parse(' 1 234 567 ').value, 1234567);
    expect(MeterReadingInput.parse('1,234.5').value, 1234.5);
    expect(MeterReadingInput.parse('12٬345٫5').value, 12345.5);
  });

  test('zero is a real reading', () {
    final MeterReadingInput input = MeterReadingInput.parse('0');
    expect(input.value, 0);
    expect(input.isInvalid, isFalse);
  });

  test('unreadable or negative text is flagged invalid', () {
    for (final String bad in <String>['abc', '12km', '-5', '1.2.3']) {
      final MeterReadingInput input = MeterReadingInput.parse(bad);
      expect(input.isInvalid, isTrue, reason: bad);
      expect(input.value, isNull, reason: bad);
    }
  });

  test('wholeValue is only offered for a whole reading', () {
    expect(MeterReadingInput.parse('12,345').wholeValue, 12345);
    expect(MeterReadingInput.parse('12345.5').wholeValue, isNull);
    expect(MeterReadingInput.parse('').wholeValue, isNull);
  });
}
