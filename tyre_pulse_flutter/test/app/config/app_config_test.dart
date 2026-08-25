import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/config/app_config.dart';

/// Builds a JWT-shaped string carrying the given role claim, so the
/// service-role guard is tested against a realistic payload rather than a
/// substring match on the whole key.
String jwtWithRole(String role) {
  String seg(Map<String, Object?> m) =>
      base64Url.encode(utf8.encode(jsonEncode(m))).replaceAll('=', '');
  final header = seg({'alg': 'HS256', 'typ': 'JWT'});
  final payload = seg({'iss': 'supabase', 'role': role});
  return '$header.$payload.signature';
}

void main() {
  const validUrl = 'https://example.supabase.co';

  group('AppConfig.validate', () {
    test('accepts a complete configuration', () {
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'production',
        sentryDsn: 'https://key@sentry.example/1',
      );

      expect(result, isA<AppConfigValid>());
      final config = (result as AppConfigValid).config;
      expect(config.supabaseUrl, validUrl);
      expect(config.isProduction, isTrue);
      expect(config.hasTelemetry, isTrue);
    });

    test('an empty Sentry DSN is valid and simply disables telemetry', () {
      // Telemetry being off is a deliberate build choice, not a failure. It
      // must never block startup.
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'development',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigValid>());
      expect((result as AppConfigValid).config.hasTelemetry, isFalse);
    });

    test('reports a missing URL as an instruction, not a stack trace', () {
      final result = AppConfig.validate(
        supabaseUrl: '',
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      final problems = (result as AppConfigInvalid).problems;
      expect(problems, hasLength(1));
      expect(problems.single, contains('SUPABASE_URL'));
    });

    test('reports a missing key', () {
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: '   ',
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      expect(
        (result as AppConfigInvalid).problems.single,
        contains('SUPABASE_ANON_KEY'),
      );
    });

    test('rejects a plain http URL', () {
      // An access token over site wifi in clear text.
      final result = AppConfig.validate(
        supabaseUrl: 'http://example.supabase.co',
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      expect((result as AppConfigInvalid).problems.single, contains('https'));
    });

    test('rejects a malformed URL', () {
      final result = AppConfig.validate(
        supabaseUrl: 'not a url',
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
    });

    test('refuses a service-role key in a mobile build', () {
      // A service-role key bypasses RLS and is extractable from any APK.
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: jwtWithRole('service_role'),
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      expect(
        (result as AppConfigInvalid).problems.single,
        contains('service-role'),
      );
    });

    test('allows an unrecognised key shape rather than blocking the build', () {
      // The guard is conservative on purpose: it reports only on a positive
      // match, so a key format it does not understand still builds.
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: 'sb_publishable_abc123',
        environment: 'production',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigValid>());
    });

    test('rejects an unknown APP_ENV and names the allowed values', () {
      final result = AppConfig.validate(
        supabaseUrl: validUrl,
        supabaseAnonKey: jwtWithRole('anon'),
        environment: 'prod',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      final problem = (result as AppConfigInvalid).problems.single;
      expect(problem, contains('prod'));
      expect(problem, contains('production'));
    });

    test('collects every problem rather than stopping at the first', () {
      // A developer with three things wrong should be told all three once.
      final result = AppConfig.validate(
        supabaseUrl: '',
        supabaseAnonKey: '',
        environment: 'nonsense',
        sentryDsn: '',
      );

      expect(result, isA<AppConfigInvalid>());
      expect((result as AppConfigInvalid).problems, hasLength(3));
    });

    test('trims surrounding whitespace from accepted values', () {
      final result = AppConfig.validate(
        supabaseUrl: '  $validUrl  ',
        supabaseAnonKey: '  ${jwtWithRole('anon')}  ',
        environment: 'staging',
        sentryDsn: '  ',
      );

      expect(result, isA<AppConfigValid>());
      final config = (result as AppConfigValid).config;
      expect(config.supabaseUrl, validUrl);
      expect(config.hasTelemetry, isFalse);
    });
  });
}
