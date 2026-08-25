/// Compile-time application configuration.
///
/// Supabase credentials arrive through `--dart-define` and are never committed.
/// The anon key is publishable by design (RLS is the real boundary), but the
/// service-role key must never reach a mobile binary.
///
/// Why this file validates rather than assumes: the web application shipped a
/// build with the Supabase environment variables missing and rendered a silent
/// white page, because the client threw at module load before any error
/// boundary existed. That is recorded in the project's own history. The mobile
/// app must say what is wrong instead of showing nothing.
library;

import 'dart:convert';

/// The outcome of resolving configuration. Either usable, or a stated reason.
sealed class AppConfigResult {
  const AppConfigResult();
}

/// Configuration is present and structurally valid.
final class AppConfigValid extends AppConfigResult {
  const AppConfigValid(this.config);

  final AppConfig config;
}

/// Configuration is missing or malformed. [problems] is shown on the
/// bootstrap failure screen, so every entry must read as an instruction to a
/// person, not as a stack trace.
final class AppConfigInvalid extends AppConfigResult {
  const AppConfigInvalid(this.problems);

  final List<String> problems;
}

/// Values resolved from the build environment.
class AppConfig {
  const AppConfig({
    required this.supabaseUrl,
    required this.supabaseAnonKey,
    required this.environment,
    required this.sentryDsn,
  });

  final String supabaseUrl;
  final String supabaseAnonKey;

  /// `development`, `staging` or `production`. Reported to telemetry so a
  /// crash from a test build is not counted against production.
  final String environment;

  /// Empty means telemetry is deliberately off for this build. That is a valid
  /// state, not an error - it must not block startup.
  final String sentryDsn;

  bool get hasTelemetry => sentryDsn.isNotEmpty;
  bool get isProduction => environment == 'production';

  static const String _urlKey = 'SUPABASE_URL';
  static const String _anonKey = 'SUPABASE_ANON_KEY';

  /// Reads the compile-time environment and validates it.
  ///
  /// Returns [AppConfigInvalid] rather than throwing. A throw here happens
  /// before any UI exists and produces a blank screen, which is precisely the
  /// failure this method is written to avoid.
  static AppConfigResult resolve() {
    const url = String.fromEnvironment(_urlKey);
    const anonKey = String.fromEnvironment(_anonKey);
    const environment =
        String.fromEnvironment('APP_ENV', defaultValue: 'development');
    const sentryDsn = String.fromEnvironment('SENTRY_DSN');

    return validate(
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      environment: environment,
      sentryDsn: sentryDsn,
    );
  }

  /// The pure half of [resolve], so it can be unit tested without a build
  /// environment.
  static AppConfigResult validate({
    required String supabaseUrl,
    required String supabaseAnonKey,
    required String environment,
    required String sentryDsn,
  }) {
    final problems = <String>[];

    if (supabaseUrl.trim().isEmpty) {
      problems.add(
        'The Supabase URL is missing. This build was compiled without '
        '--dart-define=$_urlKey.',
      );
    } else {
      final parsed = Uri.tryParse(supabaseUrl.trim());
      if (parsed == null || !parsed.hasScheme || parsed.host.isEmpty) {
        problems.add('The Supabase URL is not a valid address.');
      } else if (parsed.scheme != 'https') {
        // Refusing plain http is not pedantry: an access token would travel in
        // clear text over site wifi.
        problems.add('The Supabase URL must use https.');
      }
    }

    if (supabaseAnonKey.trim().isEmpty) {
      problems.add(
        'The Supabase key is missing. This build was compiled without '
        '--dart-define=$_anonKey.',
      );
    } else if (_looksLikeServiceRoleKey(supabaseAnonKey)) {
      // Worth failing the build over. A service-role key bypasses RLS, and one
      // shipped inside an APK is extractable by anyone who downloads it.
      problems.add(
        'The key supplied looks like a service-role key. A mobile build must '
        'use the publishable anon key only.',
      );
    }

    const allowedEnvironments = {'development', 'staging', 'production'};
    if (!allowedEnvironments.contains(environment)) {
      problems.add(
        'APP_ENV is "$environment". Expected one of: '
        '${allowedEnvironments.join(', ')}.',
      );
    }

    if (problems.isNotEmpty) {
      return AppConfigInvalid(List.unmodifiable(problems));
    }

    return AppConfigValid(
      AppConfig(
        supabaseUrl: supabaseUrl.trim(),
        supabaseAnonKey: supabaseAnonKey.trim(),
        environment: environment,
        sentryDsn: sentryDsn.trim(),
      ),
    );
  }

  /// A best-effort check on the JWT payload. Supabase keys are JWTs whose
  /// middle segment carries a `role` claim.
  ///
  /// Deliberately conservative: it only reports true on a positive match, so a
  /// key shape it does not recognise is allowed through rather than blocking a
  /// legitimate build.
  static bool _looksLikeServiceRoleKey(String key) {
    final parts = key.trim().split('.');
    if (parts.length != 3) return false;
    try {
      final payload = utf8.decode(base64Url.decode(base64Url.normalize(parts[1])));
      return payload.contains('"role":"service_role"') ||
          payload.contains('"role": "service_role"');
    } on FormatException {
      // Not a decodable JWT payload. Say nothing rather than guess.
      return false;
    }
  }
}
