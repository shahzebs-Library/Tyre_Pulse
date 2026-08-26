/// Deep link sanitising.
///
/// A deep link arrives from outside the app - a notification payload, an
/// intent, a scanned code - so it is untrusted input. The web application in
/// this project shipped an open redirect guard after a router advisory and had
/// to cover the BACKSLASH forms, because browsers normalise a backslash to a
/// forward slash.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/router/deep_links.dart';

/// A backslash, built rather than typed. This project has twice had a shell
/// heredoc eat a backslash and turn an attack fixture into a harmless string,
/// which would have made the test pass while testing nothing.
const String backslash = r'\';

void main() {
  test('the backslash fixture is real', () {
    // Asserted first, so the tests below cannot pass vacuously.
    expect(backslash.length, 1);
    expect(backslash.codeUnitAt(0), 0x5C);
  });

  group('accepts', () {
    test('an internal path', () {
      expect(sanitizeInternalLocation('/home'), '/home');
      expect(
        sanitizeInternalLocation('/accidents/acc-1/case'),
        '/accidents/acc-1/case',
      );
    });

    test('an internal path with a query', () {
      expect(
        sanitizeInternalLocation('/meter?assetNo=TM514'),
        '/meter?assetNo=TM514',
      );
    });

    test('surrounding whitespace, trimmed', () {
      expect(sanitizeInternalLocation('  /home  '), '/home');
    });
  });

  group('rejects', () {
    test('nothing at all', () {
      expect(sanitizeInternalLocation(null), isNull);
      expect(sanitizeInternalLocation(''), isNull);
      expect(sanitizeInternalLocation('   '), isNull);
    });

    test('an absolute URL', () {
      expect(sanitizeInternalLocation('https://evil.example/x'), isNull);
      expect(sanitizeInternalLocation('http://evil.example'), isNull);
    });

    test('a custom scheme', () {
      expect(sanitizeInternalLocation('tyrepulse://home'), isNull);
      expect(sanitizeInternalLocation('javascript:alert(1)'), isNull);
    });

    test('a protocol relative host', () {
      expect(sanitizeInternalLocation('//evil.example'), isNull);
    });

    test('the backslash forms a browser would normalise', () {
      expect(sanitizeInternalLocation('/${backslash}evil.example'), isNull);
      expect(
        sanitizeInternalLocation('$backslash${backslash}evil.example'),
        isNull,
      );
      expect(sanitizeInternalLocation('/home${backslash}x'), isNull);
    });

    test('a bare word', () {
      expect(sanitizeInternalLocation('home'), isNull);
    });

    test('control characters', () {
      // A newline can hide the rest of a string from whoever reviews a log.
      expect(sanitizeInternalLocation('/home\nX'), isNull);
      expect(sanitizeInternalLocation('/home\u0007X'), isNull);
      expect(sanitizeInternalLocation('/home\u007FX'), isNull);
    });
  });
}
