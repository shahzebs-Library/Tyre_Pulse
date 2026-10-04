import 'dart:async';

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/push/push_device_repository.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/core/push/push_messaging_client.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_reporter.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_sync_failure.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_user.dart';

final class FakePushMessagingClient implements PushMessagingClient {
  FakePushMessagingClient({
    this.initializes = true,
    this.initError,
    this.permission = PushPermissionStatus.granted,
    this.token = 'fcm-token-1',
    this.initial,
  });

  bool initializes;
  Object? initError;
  PushPermissionStatus permission;
  String? token;
  PushMessage? initial;
  int initializeCalls = 0;
  int permissionRequests = 0;

  final StreamController<String> refresh = StreamController<String>.broadcast();
  final StreamController<PushMessage> foreground =
      StreamController<PushMessage>.broadcast();
  final StreamController<PushMessage> opened =
      StreamController<PushMessage>.broadcast();

  @override
  Future<bool> initialize() async {
    initializeCalls++;
    return initializes;
  }

  @override
  Object? get lastInitializationError => initializes ? null : initError;

  @override
  Future<PushPermissionStatus> requestPermission() async {
    permissionRequests++;
    return permission;
  }

  @override
  Future<String?> getToken() async => token;

  @override
  Stream<String> get onTokenRefresh => refresh.stream;

  @override
  Stream<PushMessage> get onForegroundMessage => foreground.stream;

  @override
  Stream<PushMessage> get onMessageOpenedApp => opened.stream;

  Future<void> close() async {
    await refresh.close();
    await foreground.close();
    await opened.close();
  }

  @override
  Future<PushMessage?> getInitialMessage() async {
    final PushMessage? message = initial;
    initial = null;
    return message;
  }
}

final class FakePushDeviceRepository implements PushDeviceRepository {
  final List<String> registered = <String>[];
  final List<String> revoked = <String>[];
  final List<String?> versions = <String?>[];
  Exception? registerError;
  Exception? revokeError;
  Completer<void>? revokeGate;

  @override
  Future<void> register({
    required String token,
    required String platform,
    String? appVersion,
  }) async {
    if (registerError != null) throw registerError!;
    registered.add(token);
    versions.add(appVersion);
  }

  @override
  Future<void> revoke(String token) async {
    if (revokeGate != null) await revokeGate!.future;
    if (revokeError != null) throw revokeError!;
    revoked.add(token);
  }
}

final class RecordingTelemetry implements TelemetryReporter {
  final List<AppError> errors = <AppError>[];

  @override
  bool get isActive => true;

  @override
  Future<void> captureAppError(
    AppError error, {
    TelemetrySyncFailureCategory? category,
  }) async {
    errors.add(error);
  }

  @override
  Future<void> captureSupabaseFailure(
    SupabaseFailure failure, {
    TelemetrySyncFailureCategory? category,
  }) async {
    errors.add(failure.error);
  }

  @override
  void setCurrentRoute(String? routeName) {}

  @override
  void setWorkspaceId(String? workspaceId) {}

  @override
  Future<void> setUser(TelemetryUser? user) async {}
}
