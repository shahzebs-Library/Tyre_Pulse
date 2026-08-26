import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/tyres/domain/tyre_serial_code.dart';

void main() {
  group('sanitizeSerial', () {
    test('trims surrounding whitespace', () {
      expect(sanitizeSerial('  ABC123  '), 'ABC123');
    });

    test('strips characters that break an .or() filter', () {
      expect(sanitizeSerial('ABC(123)'), 'ABC123');
      expect(sanitizeSerial('ABC,123'), 'ABC123');
      expect(sanitizeSerial('A(B,C)D'), 'ABCD');
    });

    test('caps length at 64 characters', () {
      final String long = 'A' * 100;
      final String result = sanitizeSerial(long);
      expect(result.length, 64);
      expect(result, 'A' * 64);
    });

    test('is idempotent - sanitising twice equals sanitising once', () {
      const String input = '  ABC(123),  ';
      final String once = sanitizeSerial(input);
      final String twice = sanitizeSerial(once);
      expect(twice, once);
    });

    test('an already-clean serial is returned unchanged', () {
      expect(sanitizeSerial('EP0604207'), 'EP0604207');
    });

    test('a blank input sanitises to empty', () {
      expect(sanitizeSerial(''), '');
      expect(sanitizeSerial('   '), '');
    });
  });

  group('extractScanCode - bare text', () {
    test('a bare serial passes through, sanitised', () {
      expect(extractScanCode('  EP0604207  '), 'EP0604207');
    });

    test('empty input yields empty output, never throws', () {
      expect(extractScanCode(''), '');
      expect(extractScanCode('   '), '');
    });
  });

  group('extractScanCode - JSON payload', () {
    test('prefers serial_no when present', () {
      const String payload = '{"serial_no":"EP0604207","asset_no":"TM514"}';
      expect(extractScanCode(payload), 'EP0604207');
    });

    test('falls back through the alias list in order', () {
      expect(extractScanCode('{"serialNumber":"XYZ111"}'), 'XYZ111');
      expect(extractScanCode('{"asset_no":"TM514"}'), 'TM514');
      expect(extractScanCode('{"code":"Q999"}'), 'Q999');
    });

    test('ignores a key whose value is blank and tries the next one', () {
      const String payload = '{"serial_no":"","asset_no":"TM514"}';
      expect(extractScanCode(payload), 'TM514');
    });

    test('malformed JSON falls through to the raw text, sanitised', () {
      const String malformed = '{not really json}';
      expect(extractScanCode(malformed), sanitizeSerial(malformed));
    });

    test('a JSON object with none of the known keys falls through', () {
      const String payload = '{"unrelated_field":"value"}';
      expect(extractScanCode(payload), sanitizeSerial(payload));
    });

    test('a JSON value is sanitised the same way a bare code would be', () {
      const String payload = '{"serial_no":"EP(060)4207"}';
      expect(extractScanCode(payload), 'EP0604207');
    });
  });

  group('extractScanCode - URL payload', () {
    test('reads a recognised query parameter', () {
      const String url = 'https://app.tyrepulse.app/scan?serial=EP0604207';
      expect(extractScanCode(url), 'EP0604207');
    });

    test('falls back to the last non-empty path segment', () {
      const String url = 'https://app.tyrepulse.app/tyre/EP0604207';
      expect(extractScanCode(url), 'EP0604207');
    });

    test('a bare host-relative payload with a query mark is still parsed', () {
      const String payload = 'lookup?asset=TM514';
      expect(extractScanCode(payload), 'TM514');
    });

    test('a URL with neither a known query key nor a path segment falls '
        'through to the raw text', () {
      const String url = 'https://app.tyrepulse.app/?x=1';
      // No recognised query key and pathSegments is empty (root path), so
      // the whole string is sanitised as-is.
      expect(extractScanCode(url), sanitizeSerial(url));
    });

    test('a path segment containing a bare percent sign never throws', () {
      // Whether Uri.pathSegments has already decoded this segment is not
      // asserted here - only that a second decode attempt cannot crash a
      // function documented to never throw.
      const String url = 'https://app.tyrepulse.app/scan/EP50%OFF';
      expect(() => extractScanCode(url), returnsNormally);
    });
  });

  group('extractScanCode never throws', () {
    test('on input that looks like a URL but is not one', () {
      expect(() => extractScanCode('http://'), returnsNormally);
    });

    test('on a JSON-looking string with unbalanced braces', () {
      expect(() => extractScanCode('{"a":'), returnsNormally);
    });
  });
}
