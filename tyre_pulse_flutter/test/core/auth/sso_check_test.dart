// Mirrors mobile/__tests__ coverage of `interpretSsoCheck` in
// mobile/lib/ssoPolicy.ts: only an explicit `allowed: false` refuses a
// password sign-in; everything unclear fails OPEN.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';

void main() {
  group('ssoCheckAllows', () {
    test('refuses only on an explicit allowed:false', () {
      expect(
        ssoCheckAllows(<String, Object?>{
          'allowed': false,
          'reason': 'sso_required',
        }),
        isFalse,
      );
    });

    test('allows when the server says allowed:true', () {
      expect(
        ssoCheckAllows(<String, Object?>{
          'allowed': true,
          'reason': 'not_required',
        }),
        isTrue,
      );
    });

    test('fails open on null, a non-map or a missing key', () {
      expect(ssoCheckAllows(null), isTrue);
      expect(ssoCheckAllows('sso_required'), isTrue);
      expect(ssoCheckAllows(<String, Object?>{}), isTrue);
      expect(ssoCheckAllows(<String, Object?>{'allowed': null}), isTrue);
    });
  });
}
