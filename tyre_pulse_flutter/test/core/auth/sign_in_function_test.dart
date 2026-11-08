// Decoding of the `sign-in` edge function's answers
// (supabase/functions/sign-in/index.ts). The function replaced the anonymous
// get_email_by_identifier lookup so a username never reveals an email.
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';

void main() {
  group('interpretSignInFunction', () {
    test('a 200 with both tokens is a session', () {
      final SignInFunctionResult r =
          interpretSignInFunction(200, <String, Object?>{
        'access_token': 'a',
        'refresh_token': 'r',
        'user': <String, Object?>{'id': 'u'},
      });
      expect(r, isA<SignInFunctionSession>());
      final SignInFunctionSession s = r as SignInFunctionSession;
      expect(s.accessToken, 'a');
      expect(s.refreshToken, 'r');
    });

    test('a JSON string body is decoded', () {
      expect(
        interpretSignInFunction(
          200,
          '{"access_token":"a","refresh_token":"r"}',
        ),
        isA<SignInFunctionSession>(),
      );
    });

    test('invalid_credentials is one generic rejection', () {
      expect(
        interpretSignInFunction(401, <String, Object?>{
          'error': 'invalid_credentials',
        }),
        isA<SignInFunctionRejected>(),
      );
    });

    test('locked carries the minutes, rounded up', () {
      final SignInFunctionResult r = interpretSignInFunction(
        429,
        <String, Object?>{'error': 'locked', 'retry_after_seconds': 61},
      );
      expect(r, isA<SignInFunctionLocked>());
      expect((r as SignInFunctionLocked).lock.locked, isTrue);
      expect(r.lock.lockoutMinutes, 2);
    });

    test('a 200 without tokens is unavailable, never wrong password', () {
      expect(
        interpretSignInFunction(200, <String, Object?>{}),
        isA<SignInFunctionUnavailable>(),
      );
    });

    test('a 503 or unreadable body is unavailable', () {
      expect(
        interpretSignInFunction(503, <String, Object?>{'error': 'unavailable'}),
        isA<SignInFunctionUnavailable>(),
      );
      expect(
        interpretSignInFunction(500, 'not json'),
        isA<SignInFunctionUnavailable>(),
      );
      expect(
        interpretSignInFunction(500, null),
        isA<SignInFunctionUnavailable>(),
      );
    });
  });
}
