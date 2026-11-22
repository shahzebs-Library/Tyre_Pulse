import 'package:flutter_test/flutter_test.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/core/auth/auth_repository.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_captcha.dart';
import 'package:tyre_pulse/features/extras/data/self_registration_repository.dart';

void main() {
  group('parseTurnstileMessage', () {
    test('reads ready, token, expired and error', () {
      expect(parseTurnstileMessage('{"e":"ready"}'), isA<TurnstileReady>());
      final TurnstileEvent token =
          parseTurnstileMessage('{"e":"token","v":"abc"}');
      expect(token, isA<TurnstileToken>());
      expect((token as TurnstileToken).token, 'abc');
      expect(parseTurnstileMessage('{"e":"expired"}'), isA<TurnstileExpired>());
      final TurnstileEvent error =
          parseTurnstileMessage('{"e":"error","v":"110200"}');
      expect((error as TurnstileFailed).code, '110200');
    });

    test('anything malformed is a failure, never a token', () {
      for (final String raw in <String>[
        'not json',
        '[]',
        '{"e":"token"}',
        '{"e":"token","v":"  "}',
        '{"e":"token","v":42}',
        '{"e":"bogus"}',
      ]) {
        expect(parseTurnstileMessage(raw), isA<TurnstileFailed>(), reason: raw);
      }
    });
  });

  group('TurnstileState', () {
    const TurnstileState start = TurnstileState.loading();

    test('ready then token holds the token', () {
      final TurnstileState s =
          start.apply(const TurnstileReady()).apply(const TurnstileToken('t1'));
      expect(s.status, TurnstileStatus.solved);
      expect(s.token, 't1');
      expect(s.canRetry, isFalse);
    });

    test('expiry and failure drop the token and offer retry', () {
      final TurnstileState solved = start.apply(const TurnstileToken('t1'));
      final TurnstileState expired = solved.apply(const TurnstileExpired());
      expect(expired.token, isNull);
      expect(expired.canRetry, isTrue);
      final TurnstileState failed = solved.apply(const TurnstileFailed('x'));
      expect(failed.token, isNull);
      expect(failed.status, TurnstileStatus.failed);
      expect(failed.canRetry, isTrue);
    });

    test('reset after an attempt is unsolved with no token', () {
      final TurnstileState s =
          start.apply(const TurnstileToken('t1')).afterReset();
      expect(s.status, TurnstileStatus.waiting);
      expect(s.token, isNull);
    });

    test('timeout only applies while still loading', () {
      expect(start.timedOut().status, TurnstileStatus.timedOut);
      final TurnstileState ready = start.apply(const TurnstileReady());
      expect(ready.timedOut(), ready);
    });

    test('a late ready does not discard a token', () {
      final TurnstileState solved = start.apply(const TurnstileToken('t1'));
      expect(solved.apply(const TurnstileReady()).token, 't1');
    });
  });

  group('isCaptchaRefusal', () {
    test('reads the code first, then the message', () {
      expect(
        isCaptchaRefusal(
          const AuthException('x', statusCode: '400', code: 'captcha_failed'),
        ),
        isTrue,
      );
      expect(
        isCaptchaRefusal(
          const AuthException('captcha protection: request disallowed'),
        ),
        isTrue,
      );
      expect(
        isCaptchaRefusal(
          const AuthException(
            'Invalid login credentials',
            code: 'invalid_credentials',
          ),
        ),
        isFalse,
      );
      expect(isCaptchaRefusal('captcha verification process failed'), isTrue);
      expect(isCaptchaRefusal(null), isFalse);
      expect(isCaptchaRefusal(StateError('captcha')), isFalse);
    });
  });

  group('turnstileHtml', () {
    test('embeds the key as a JSON string literal and the theme', () {
      final String html =
          turnstileHtml(siteKey: '0x4AAA"</script><b>', dark: true);
      expect(html, contains(r'sitekey:"0x4AAA\"</script><b>"'));
      expect(html, contains('theme:"dark"'));
      expect(html, contains(kTurnstileChannel));
      expect(html, contains('challenges.cloudflare.com/turnstile/v0/api.js'));
      expect(turnstileHtml(siteKey: 'k', dark: false), contains('"light"'));
    });
  });

  group('sign-in function', () {
    test('body carries captcha_token only when a token exists', () {
      expect(
        signInFunctionBody('ali', 'pw', null),
        <String, Object?>{'identifier': 'ali', 'password': 'pw'},
      );
      expect(
        signInFunctionBody('ali', 'pw', '').containsKey('captcha_token'),
        isFalse,
      );
      expect(signInFunctionBody('ali', 'pw', 'tok')['captcha_token'], 'tok');
    });

    test('captcha_failed is its own result, not a wrong password', () {
      expect(
        interpretSignInFunction(
          400,
          <String, Object?>{'error': 'captcha_failed'},
        ),
        isA<SignInFunctionCaptchaFailed>(),
      );
      expect(
        interpretSignInFunction(
          401,
          <String, Object?>{'error': 'invalid_credentials'},
        ),
        isA<SignInFunctionRejected>(),
      );
    });
  });

  group('sign-up refusal', () {
    test('with a token sent, a captcha refusal asks for the check again', () {
      expect(
        classifySignUpError(
          'captcha verification process failed',
          captchaSent: true,
        ),
        SelfRegistrationResult.captchaFailed,
      );
    });

    test('without a token, a captcha refusal still reads as closed', () {
      expect(
        classifySignUpError('captcha verification process failed'),
        SelfRegistrationResult.closed,
      );
    });
  });

  group('AppConfig', () {
    AppConfig valid(String key) {
      final AppConfigResult result = AppConfig.validate(
        supabaseUrl: 'https://x.supabase.co',
        supabaseAnonKey: 'anon',
        environment: 'production',
        sentryDsn: '',
        turnstileSiteKey: key,
      );
      return (result as AppConfigValid).config;
    }

    test('an empty site key means the CAPTCHA is off', () {
      expect(valid('').hasCaptcha, isFalse);
      expect(valid('   ').hasCaptcha, isFalse);
    });

    test('a site key is trimmed and turns the CAPTCHA on', () {
      final AppConfig config = valid(' 0x4AAAAAA ');
      expect(config.turnstileSiteKey, '0x4AAAAAA');
      expect(config.hasCaptcha, isTrue);
    });

    test('tests are built without the define, so the provider default is off',
        () {
      expect(AppConfig.turnstileSiteKeyFromEnvironment, isEmpty);
    });
  });
}
