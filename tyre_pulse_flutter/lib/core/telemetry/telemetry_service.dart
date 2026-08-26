/// Sentry wiring (spec section 59).
///
/// [TelemetryService] is the one place `package:sentry_flutter` is imported
/// outside this file's own navigator observer. Everything the rest of the app
/// touches is [TelemetryReporter], which this implements.
///
/// ## What is deliberately never sent
///
/// Spec section 59: "Do not upload passwords, access tokens or sensitive
/// image content to logs." Concretely, in this file:
///
/// - [captureAppError] and [captureSupabaseFailure] read ONLY [AppError.message]
///   and [AppError.technical] - both declared safe to log by `app_error.dart`
///   itself - and NEVER [AppError.cause], which may be the original,
///   unredacted driver exception. See [_SanitizedFailure].
/// - [captureSupabaseFailure] never reads `SupabaseFailure.rawMessage`.
///   That field exists FOR a telemetry sink, but this one already has
///   everything it needs from `.error`, and reading a second, wider field
///   "just in case" is exactly how a redaction boundary erodes over time.
/// - [reportFlutterError] and [reportPlatformDispatcherError] handle
///   genuinely UNCLASSIFIED errors - anything that reached them escaped every
///   typed error path in the app - so they route the raw object through
///   `classifySupabaseError` first. That is the SAME redaction the rest of
///   the app already trusts (JWT- and bearer-shaped substrings stripped),
///   applied here rather than reinvented.
/// - Screenshots and view-hierarchy attachment are never opted into. This
///   file never sets those options; leaving them off is the SDK's own
///   default, and this file must never turn them on - an inspection or
///   accident photo on screen is exactly the "sensitive image content" spec
///   section 59 forbids.
/// - Passwords and access tokens are never constructed as tags, extras or
///   thrown objects anywhere in this file. There is no parameter on any
///   method here shaped to accept one.
///
/// ## Why capturing is behind an injectable seam, not a bare Sentry call
///
/// [captureAppError]'s actual delivery goes through [_capture], an injected
/// function defaulting to a call into the real SDK. A test built with
/// [TelemetryService.forTesting] substitutes it, so "what would have been
/// sent" is asserted directly - a real Sentry Hub is neither available nor
/// meaningfully instrumentable in this project's unit-test environment, and
/// this way nothing about that gap weakens what the sanitisation guarantees
/// above can prove.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:sentry_flutter/sentry_flutter.dart';
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_reporter.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_sync_failure.dart';

/// The exact call [TelemetryService] makes into the Sentry SDK to deliver one
/// event. Injectable so a test can capture what would have been sent without
/// a live Sentry Hub.
typedef SentryCaptureFunction = Future<void> Function(
  Object exception, {
  required Map<String, String> tags,
  StackTrace? stackTrace,
});

/// A stand-in for an [AppError] that is safe to hand to a telemetry SDK.
///
/// Sentry reports whatever [toString] returns for the object it is given,
/// plus that object's runtime type name. Constructing this - rather than
/// forwarding the [AppError] itself, and certainly rather than
/// [AppError.cause] - means the only text that can EVER reach the sink is
/// [AppError.message] and [AppError.technical], even if a future change to
/// this file, or to how the SDK serialises a thrown object, starts reading
/// more off it than [toString].
final class _SanitizedFailure {
  _SanitizedFailure(AppError error)
      : summary = 'AppError(${error.kind.name}): '
            '${error.technical ?? error.message}';

  final String summary;

  @override
  String toString() => summary;
}

/// The real [TelemetryReporter], backed by Sentry.
final class TelemetryService implements TelemetryReporter {
  /// Builds an INACTIVE reporter. Every method on this class is safe to call
  /// before [initialize] runs, or when it was never called: they do nothing.
  TelemetryService({SentryCaptureFunction? capture})
      : _capture = capture ?? _defaultCapture;

  /// Builds an ALREADY-ACTIVE reporter for tests, bypassing the real Sentry
  /// SDK entirely. [capture] receives exactly what a real capture would send.
  @visibleForTesting
  TelemetryService.forTesting({
    required SentryCaptureFunction capture,
    Map<String, String> staticTags = const <String, String>{},
  })  : _capture = capture,
        _active = true,
        _staticTags = Map<String, String>.of(staticTags);

  final SentryCaptureFunction _capture;
  bool _active = false;
  String? _currentRoute;
  String? _currentWorkspaceId;
  final Map<String, String> _staticTags = <String, String>{};

  @override
  bool get isActive => _active;

  /// Wires Sentry for this build, or does nothing.
  ///
  /// A build with no DSN - [AppConfig.hasTelemetry] false - is a deliberate
  /// choice, not a failure, so this returns immediately without touching the
  /// Sentry SDK at all: a true no-op.
  ///
  /// Never throws. A telemetry outage must not be the reason the app fails
  /// to start, so a failure to reach Sentry here is swallowed into "stay
  /// inactive" - a state every method on this class already tolerates.
  Future<void> initialize({
    required AppConfig config,
    String appVersion = '',
  }) async {
    if (!config.hasTelemetry) {
      return;
    }

    _staticTags
      ..clear()
      ..addAll(
        _resolveStaticTags(
          environment: config.environment,
          appVersion: appVersion,
          platform: _platformName(),
        ),
      );

    try {
      await SentryFlutter.init((SentryFlutterOptions options) {
        options.dsn = config.sentryDsn;
        options.environment = config.environment;
      });
      _active = true;
    } on Object {
      _active = false;
    }
  }

  @override
  Future<void> captureAppError(
    AppError error, {
    TelemetrySyncFailureCategory? category,
  }) async {
    if (!_active) {
      return;
    }
    await _safeCapture(
      _SanitizedFailure(error),
      tags: _tagsFor(kind: error.kind.name, category: category),
    );
  }

  @override
  Future<void> captureSupabaseFailure(
    SupabaseFailure failure, {
    TelemetrySyncFailureCategory? category,
  }) async {
    if (!_active) {
      return;
    }
    final Map<String, String> tags = _tagsFor(
      kind: failure.error.kind.name,
      category: category,
    );
    tags['supabase_failure_cause'] = failure.cause.name;
    final String? code = failure.code;
    if (code != null && code.isNotEmpty) {
      tags['supabase_failure_code'] = code;
    }
    // Deliberately not read: failure.rawMessage. Everything this method needs
    // already lives on failure.error.
    await _safeCapture(_SanitizedFailure(failure.error), tags: tags);
  }

  /// Reports a Flutter framework error to telemetry, then invokes
  /// `FlutterError.presentError` - a SEPARATE handler slot from `onError`,
  /// not a recursive call back into this method - so the existing on-screen
  /// error behaviour (a red screen in debug, the registered
  /// `ErrorWidget.builder` otherwise) is unchanged by assigning this handler.
  ///
  /// Assign this to `FlutterError.onError` AT THE COMPOSITION ROOT:
  /// ```dart
  /// FlutterError.onError = telemetryService.reportFlutterError;
  /// ```
  /// This module never assigns it itself - a global handler belongs where a
  /// reader of `main.dart` can see it wired, not inferred from an opaque
  /// `initialize()` call.
  void reportFlutterError(FlutterErrorDetails details) {
    FlutterError.presentError(details);
    if (!_active) {
      return;
    }
    final SupabaseFailure classified = classifySupabaseError(details.exception);
    unawaited(
      _safeCapture(
        _SanitizedFailure(classified.error),
        tags: _tagsFor(kind: classified.error.kind.name, category: null)
          ..['telemetry_source'] = 'flutter_error',
        // The one place a real stack trace is forwarded: it names a code
        // location, not user data, and it is what makes a framework crash
        // report actionable at all.
        stackTrace: details.stack,
      ),
    );
  }

  /// Reports an error that escaped every Flutter zone.
  ///
  /// Assign this to `PlatformDispatcher.instance.onError` AT THE COMPOSITION
  /// ROOT:
  /// ```dart
  /// PlatformDispatcher.instance.onError = telemetryService.reportPlatformDispatcherError;
  /// ```
  /// This module never assigns it itself, for the same reason as
  /// [reportFlutterError]. Returns true only once telemetry has genuinely
  /// been offered the error, so an inactive build still lets the platform's
  /// own default handling (and, in debug, its own log output) proceed rather
  /// than claiming an error was handled when nothing was done with it.
  bool reportPlatformDispatcherError(Object error, StackTrace stackTrace) {
    if (!_active) {
      return false;
    }
    final SupabaseFailure classified = classifySupabaseError(error);
    unawaited(
      _safeCapture(
        _SanitizedFailure(classified.error),
        tags: _tagsFor(kind: classified.error.kind.name, category: null)
          ..['telemetry_source'] = 'platform_dispatcher',
        stackTrace: stackTrace,
      ),
    );
    return true;
  }

  @override
  void setCurrentRoute(String? routeName) {
    _currentRoute = routeName;
  }

  @override
  void setWorkspaceId(String? workspaceId) {
    _currentWorkspaceId = workspaceId;
  }

  Future<void> _safeCapture(
    Object throwable, {
    required Map<String, String> tags,
    StackTrace? stackTrace,
  }) async {
    try {
      await _capture(throwable, tags: tags, stackTrace: stackTrace);
    } on Object {
      // Telemetry itself failing to send must never surface as an app error.
      // There is nowhere safe to report a failure to report a failure.
    }
  }

  Map<String, String> _tagsFor({
    required String kind,
    required TelemetrySyncFailureCategory? category,
  }) {
    final String? route = _currentRoute;
    final String? workspaceId = _currentWorkspaceId;
    return <String, String>{
      ..._staticTags,
      'error_kind': kind,
      if (route != null && route.isNotEmpty) 'route': route,
      if (workspaceId != null && workspaceId.isNotEmpty)
        'workspace_id': workspaceId,
      if (category != null) 'sync_failure_category': category.name,
    };
  }

  static Map<String, String> _resolveStaticTags({
    required String environment,
    required String appVersion,
    required String platform,
  }) {
    return <String, String>{
      'app_environment': environment,
      if (appVersion.isNotEmpty) 'app_version': appVersion,
      if (platform.isNotEmpty) 'platform': platform,
    };
  }

  /// `dart:io`'s `Platform` throws on the web, and this file must never throw
  /// while trying to describe the platform it is running on.
  static String _platformName() {
    if (kIsWeb) {
      return 'web';
    }
    try {
      return Platform.operatingSystem;
    } on Object {
      return 'unknown';
    }
  }

  static Future<void> _defaultCapture(
    Object exception, {
    required Map<String, String> tags,
    StackTrace? stackTrace,
  }) async {
    await Sentry.captureException(
      exception,
      stackTrace: stackTrace,
      withScope: (Scope scope) async {
        for (final MapEntry<String, String> entry in tags.entries) {
          await scope.setTag(entry.key, entry.value);
        }
      },
    );
  }
}
