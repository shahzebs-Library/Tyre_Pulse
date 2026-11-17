import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/sign_in_identifier.dart';

void main() {
  group('normalizeSignInIdentifier', () {
    test('leaves a bare username, an id and an email as typed (trimmed)', () {
      expect(normalizeSignInIdentifier('  ali.k '), 'ali.k');
      expect(normalizeSignInIdentifier('10234'), '10234');
      expect(normalizeSignInIdentifier(' Ali@Company.com '), 'Ali@Company.com');
    });

    test('a backslash is a slash and spaces around the first slash go', () {
      expect(normalizeSignInIdentifier(r'ACME \ ali'), 'ACME/ali');
      expect(normalizeSignInIdentifier('ACME / ali'), 'ACME/ali');
      expect(normalizeSignInIdentifier('acme/ali'), 'acme/ali');
    });

    test('a leading slash does not make a code (mirrors the SQL split)', () {
      expect(normalizeSignInIdentifier('/ali'), '/ali');
    });

    test('blank stays blank', () {
      expect(normalizeSignInIdentifier('   '), '');
    });
  });

  group('splitSignInIdentifier', () {
    test('splits on the first slash only', () {
      final SignInIdentifierParts p = splitSignInIdentifier('ACME/ali/x');
      expect(p.companyCode, 'ACME');
      expect(p.name, 'ali/x');
      expect(p.hasCompanyCode, isTrue);
    });

    test('a bare name and an email carry no company code', () {
      expect(splitSignInIdentifier('ali').companyCode, isNull);
      expect(splitSignInIdentifier('a/b@c.com').companyCode, isNull);
      expect(splitSignInIdentifier('/ali').name, 'ali');
    });

    test('a code without a name is not a company sign-in', () {
      expect(splitSignInIdentifier('ACME/').hasCompanyCode, isFalse);
    });
  });
}
