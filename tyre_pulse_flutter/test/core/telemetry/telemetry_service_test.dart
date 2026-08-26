import 'package:flutter/foundation.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/config/app_config.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_service.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_sync_failure.dart';

const _configWithNoDsn = AppConfig(
  supabaseUrl: 'https://example.supabase.co',
  supabaseAnonKey: 'anon-key',
  environment: 'development',
  sentryDsn: '',
);

void main() {
  group('no DSN means a true no-op', () {
    test('initialize never activates the service and never throws', () async {
      final service = TelemetryService();

      await service.initialize(config: _configWithNoDsn);

      expect(service.isActive, isFalse);
    });

    test('captureAppError does nothing and does not throw', () async {
      final service = TelemetryService();
      await service.initialize(config: _configWithNoDsn);
      const error = AppError(
        kind: AppErrorKind.unknown,
        message: 'Something went wrong.',
      );

      await expectLater(service.captureAppError(error), completes);
    });

    test('captureSupabaseFailure does nothing and does not throw', () async {
      final service = TelemetryService();
      await service.initialize(config: _configWithNoDsn);
      const failure = SupabaseFailure(
        error: AppError(
          kind: AppErrorKind.server,
          message: 'Something went wrong.',
        ),
        cause: SupabaseFailureCause.serverError,
      );

      await expectLater(service.captureSupabaseFailure(failure), completes);
    });

    test('reportFlutterError does not throw', () async {
      final service = TelemetryService();
      await service.initialize(config: _configWithNoDsn);

      expect(
        () => service.reportFlutterError(
          FlutterErrorDetails(exception: Exception('boom')),
        ),
        returnsNormally,
      );
    });

    test(
        'reportPlatformDispatcherError does not throw, and returns false '
        'because nothing was actually offered to telemetry', () async {
      final service = TelemetryService();
      await service.initialize(config: _configWithNoDsn);

      final handled = service.reportPlatformDispatcherError(
        Exception('boom'),
        StackTrace.empty,
      );

      expect(handled, isFalse);
    });

    test(
        'a freshly constructed service with no initialize call at all is '
        'also inactive and safe', () async {
      final service = TelemetryService();

      expect(service.isActive, isFalse);
      await expectLater(
        service.captureAppError(
          const AppError(kind: AppErrorKind.unknown, message: 'x'),
        ),
        completes,
      );
    });
  });

  group('AppError sanitisation', () {
    test(
        'only message and technical reach the sink - never cause, which '
        'may hold the original unredacted exception', () async {
      Object? captured;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          captured = exception;
        },
      );

      const secretInCause =
          'raw driver text carrying eyJhbGciOiJIUzI1NiJ9.payload.sig';
      final error = AppError(
        kind: AppErrorKind.server,
        message: 'A safe, displayable sentence.',
        technical: 'safe technical detail for logs',
        cause: Exception(secretInCause),
      );

      await service.captureAppError(error);

      expect(captured, isNotNull);
      final text = captured.toString();
      expect(text, isNot(contains(secretInCause)));
      expect(text, isNot(contains('eyJhbGciOiJIUzI1NiJ9')));
      expect(text, contains('safe technical detail for logs'));
    });

    test('falls back to message when technical is null', () async {
      Object? captured;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          captured = exception;
        },
      );

      const error = AppError(
        kind: AppErrorKind.validation,
        message: 'A required field is missing.',
      );

      await service.captureAppError(error);

      expect(captured.toString(), contains('A required field is missing.'));
    });
  });

  group('SupabaseFailure sanitisation', () {
    test(
        'rawMessage is never read - a marker only present there must '
        'never reach the sink', () async {
      Object? captured;
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          captured = exception;
          capturedTags = tags;
        },
      );

      const failure = SupabaseFailure(
        error: AppError(
          kind: AppErrorKind.server,
          message: 'Safe.',
          technical: 'safe-technical',
        ),
        cause: SupabaseFailureCause.serverError,
        code: '500',
        rawMessage: 'UNIQUE_RAW_MESSAGE_MARKER_must_never_appear',
      );

      await service.captureSupabaseFailure(failure);

      const marker = 'UNIQUE_RAW_MESSAGE_MARKER_must_never_appear';
      expect(captured.toString(), isNot(contains(marker)));
      expect(capturedTags!.values, isNot(contains(marker)));
    });

    test(
        'adds the cause name and server code as tags - both are declared '
        'safe to log by the mapper', () async {
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          capturedTags = tags;
        },
      );

      const failure = SupabaseFailure(
        error: AppError(kind: AppErrorKind.conflict, message: 'Conflict.'),
        cause: SupabaseFailureCause.uniqueViolation,
        code: '23505',
      );

      await service.captureSupabaseFailure(failure);

      expect(capturedTags!['supabase_failure_cause'], 'uniqueViolation');
      expect(capturedTags!['supabase_failure_code'], '23505');
    });
  });

  group('tags', () {
    test(
        'are present when an event is captured: static tags, error kind, '
        'route, workspace and sync-failure category', () async {
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          capturedTags = tags;
        },
        staticTags: const <String, String>{
          'app_environment': 'production',
          'app_version': '1.4.0',
          'platform': 'android',
        },
      );
      service.setCurrentRoute('InspectionDetail');
      service.setWorkspaceId('workspace-abc');

      const error = AppError(kind: AppErrorKind.network, message: 'x');
      await service.captureAppError(
        error,
        category: TelemetrySyncFailureCategory.connectivity,
      );

      expect(capturedTags, isNotNull);
      expect(capturedTags!['app_environment'], 'production');
      expect(capturedTags!['app_version'], '1.4.0');
      expect(capturedTags!['platform'], 'android');
      expect(capturedTags!['error_kind'], 'network');
      expect(capturedTags!['route'], 'InspectionDetail');
      expect(capturedTags!['workspace_id'], 'workspace-abc');
      expect(capturedTags!['sync_failure_category'], 'connectivity');
    });

    test(
        'route and workspace are omitted, not sent empty, before either is '
        'set - the absence is the privacy-safe state, not a bug', () async {
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          capturedTags = tags;
        },
      );

      await service.captureAppError(
        const AppError(kind: AppErrorKind.unknown, message: 'x'),
      );

      expect(capturedTags!.containsKey('route'), isFalse);
      expect(capturedTags!.containsKey('workspace_id'), isFalse);
    });

    test(
        'sync_failure_category is omitted when the caller does not supply '
        'one - most captures are not sync failures', () async {
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          capturedTags = tags;
        },
      );

      await service.captureAppError(
        const AppError(kind: AppErrorKind.unknown, message: 'x'),
      );

      expect(capturedTags!.containsKey('sync_failure_category'), isFalse);
    });

    test(
        'setCurrentRoute(null) clears the tag for whatever is captured '
        'next', () async {
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          capturedTags = tags;
        },
      );
      service.setCurrentRoute('SomeScreen');
      service.setCurrentRoute(null);

      await service.captureAppError(
        const AppError(kind: AppErrorKind.unknown, message: 'x'),
      );

      expect(capturedTags!.containsKey('route'), isFalse);
    });
  });

  group('crash hooks route through the same sanitisation', () {
    test(
        'reportFlutterError reaches the sink when active, with the JWT- '
        'shaped substring in the raw exception stripped', () async {
      Object? captured;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          captured = exception;
        },
      );

      service.reportFlutterError(
        FlutterErrorDetails(
          exception: Exception(
            'unexpected failure near eyJhbGciOiJIUzI1NiJ9.body.sig',
          ),
        ),
      );
      // reportFlutterError fires its capture without awaiting it.
      await Future<void>.delayed(Duration.zero);

      expect(captured, isNotNull);
      expect(captured.toString(), isNot(contains('eyJhbGciOiJIUzI1NiJ9')));
    });

    test(
        'reportPlatformDispatcherError reaches the sink when active and '
        'returns true', () async {
      Object? captured;
      Map<String, String>? capturedTags;
      final service = TelemetryService.forTesting(
        capture: (exception, {required tags, stackTrace}) async {
          captured = exception;
          capturedTags = tags;
        },
      );

      final handled = service.reportPlatformDispatcherError(
        Exception('escaped every zone'),
        StackTrace.current,
      );
      await Future<void>.delayed(Duration.zero);

      expect(handled, isTrue);
      expect(captured, isNotNull);
      expect(capturedTags!['telemetry_source'], 'platform_dispatcher');
    });
  });
}
