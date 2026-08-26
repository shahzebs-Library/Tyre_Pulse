/// Pins the three payload shapes [extractScanCode] must unwrap, and the
/// sanitising rules [sanitizeScanCode] applies to every one of them.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/scanning/domain/scan_payload.dart';

void main() {
  group('sanitizeScanCode', () {
    test('trims surrounding whitespace', () {
      expect(sanitizeScanCode('  TM514  '), 'TM514');
    });

    test('strips parentheses and commas, which break a PostgREST filter',
        () {
      expect(sanitizeScanCode('TM(514),X'), 'TM514X');
    });

    test('caps length at 64 characters', () {
      final String tooLong = 'A' * 80;
      final String result = sanitizeScanCode(tooLong);
      expect(result.length, 64);
      expect(result, 'A' * 64);
    });

    test('does not touch a value already within limits', () {
      expect(sanitizeScanCode('short'), 'short');
    });

    test('is idempotent - sanitizing twice equals sanitizing once', () {
      const String raw = '  (weird, code)  ';
      final String once = sanitizeScanCode(raw);
      final String twice = sanitizeScanCode(once);
      expect(twice, once);
    });

    test('does not change letter case', () {
      expect(sanitizeScanCode(' trk-001 '), 'trk-001');
    });

    test('an all-whitespace value sanitizes to empty', () {
      expect(sanitizeScanCode('   '), '');
    });
  });

  group('extractScanCode - empty input', () {
    test('an empty string returns empty', () {
      expect(extractScanCode(''), '');
    });

    test('a whitespace-only string returns empty', () {
      expect(extractScanCode('   \n\t  '), '');
    });
  });

  group('extractScanCode - bare code', () {
    test('a plain code passes through sanitised', () {
      expect(extractScanCode('  TRK-001  '), 'TRK-001');
    });

    test('a code with forbidden characters is cleaned', () {
      expect(extractScanCode('TM(514)'), 'TM514');
    });
  });

  group('extractScanCode - JSON payload', () {
    test('reads asset_no', () {
      expect(extractScanCode('{"asset_no":"TM514"}'), 'TM514');
    });

    test('reads assetNo (camelCase) when asset_no is absent', () {
      expect(extractScanCode('{"assetNo":"TM515"}'), 'TM515');
    });

    test('asset_no wins over assetNo when both are present', () {
      expect(
        extractScanCode('{"asset_no":"WINS","assetNo":"LOSES"}'),
        'WINS',
      );
    });

    test('falls back to asset when neither asset field is present', () {
      expect(extractScanCode('{"asset":"TM516"}'), 'TM516');
    });

    test('falls back to fleet_number ahead of serial fields', () {
      expect(
        extractScanCode('{"fleet_number":"F900","serial":"S100"}'),
        'F900',
      );
    });

    test('falls back to serial_number, then serial', () {
      expect(extractScanCode('{"serial_number":"SN1"}'), 'SN1');
      expect(extractScanCode('{"serial":"SN2"}'), 'SN2');
    });

    test('falls back to a bare code key', () {
      expect(extractScanCode('{"code":"C1"}'), 'C1');
    });

    test('falls back to id as the last resort', () {
      expect(extractScanCode('{"id":"ID1"}'), 'ID1');
    });

    test('sanitises the extracted value', () {
      expect(extractScanCode('{"asset_no":" TM(517) "}'), 'TM517');
    });

    test('a numeric JSON value is stringified before sanitising', () {
      expect(extractScanCode('{"id":12345}'), '12345');
    });

    test('malformed JSON falls through to the bare-code path', () {
      expect(extractScanCode('{not valid json}'), '{not valid json}');
    });

    test(
        'valid JSON with none of the known keys falls through to the '
        'bare-code path, sanitised as a whole string', () {
      final String raw = '{"unrelated":"value"}';
      expect(extractScanCode(raw), sanitizeScanCode(raw));
    });

    test('a blank value for the first key is skipped in favour of the next',
        () {
      expect(
        extractScanCode('{"asset_no":"  ","assetNo":"TM520"}'),
        'TM520',
      );
    });
  });

  group('extractScanCode - URL payload', () {
    test('reads a known query parameter from a full URL', () {
      expect(
        extractScanCode('https://app.example/asset?asset=TM600'),
        'TM600',
      );
    });

    test('prefers asset over asset_no, code and serial query parameters',
        () {
      expect(
        extractScanCode(
          'https://x?asset=WINS&asset_no=L1&code=L2&serial=L3',
        ),
        'WINS',
      );
    });

    test('falls back to asset_no, then code, then serial', () {
      expect(extractScanCode('https://x?asset_no=A1'), 'A1');
      expect(extractScanCode('https://x?code=A2'), 'A2');
      expect(extractScanCode('https://x?serial=A3'), 'A3');
    });

    test('falls back to the last path segment when no known query '
        'parameter is present', () {
      expect(
        extractScanCode('https://app.example/asset/TM514'),
        'TM514',
      );
    });

    test('percent-decodes the path segment, matching decodeURIComponent',
        () {
      expect(
        extractScanCode('https://app.example/asset/TM%20514'),
        'TM 514',
      );
    });

    test('a bare query-string wrapper with no scheme is still recognised '
        'as a URL', () {
      expect(extractScanCode('asset?code=TM99'), 'TM99');
    });

    test('sanitises the value taken from a URL', () {
      // %28 / %29 are the percent-encoded forms of ( and ) - encoding them
      // rather than embedding them literally keeps this test on the
      // well-defined part of URI parsing (percent-decoding), rather than on
      // whether an unencoded sub-delimiter in a query value round-trips.
      expect(
        extractScanCode('https://x?code=%20TM%28600%29%20'),
        'TM600',
      );
    });

    test('a URL with neither a known query parameter nor a path segment '
        'falls through to the bare-code path', () {
      final String raw = 'https://app.example/';
      expect(extractScanCode(raw), sanitizeScanCode(raw));
    });
  });

  group('extractScanCode - does not change case', () {
    test('a mixed-case bare code keeps its case', () {
      expect(extractScanCode('  Tm514  '), 'Tm514');
    });

    test('a mixed-case JSON value keeps its case', () {
      expect(extractScanCode('{"asset_no":"Tm514"}'), 'Tm514');
    });
  });
}
