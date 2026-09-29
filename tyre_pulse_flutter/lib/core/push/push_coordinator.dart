/// The push token lifecycle and message delivery, with no UI in it.
///
/// - After sign-in: initialise the provider, ask for notification permission,
///   read the token and register it (`register_user_device`). Re-registered on
///   every token refresh.
/// - Before sign-out: revoke the token (`revoke_user_device`) while the
///   session still exists, so a signed-out device stops receiving pushes.
/// - A tapped notification is held until a user is signed in, then handed to
///   the attached `onOpen` exactly once.
/// - A message arriving while the app is on screen goes to `onForeground`.
///
/// Every failure here is reported to telemetry and swallowed on purpose:
/// push is an extra channel, and nothing about it may stop someone signing
/// in, signing out or using the app.
library;

import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/push/push_device_repository.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/core/push/push_messaging_client.dart';
import 'package:tyre_pulse/core/telemetry/telemetry_reporter.dart';

/// The upper bound on revoking the token during sign-out, so a dead network
/// can never hold the sign-out button.
const Duration pushRevokeOnSignOutTimeout = Duration(seconds: 4);

final class PushCoordinator {
  PushCoordinator({
    required PushMessagingClient client,
    required PushDeviceRepository devices,
    required TelemetryReporter telemetry,
    required String? appVersion,
    this.platform = 'android',
  })  : _client = client,
        _devices = devices,
        _telemetry = telemetry,
        _appVersion = appVersion;

  final PushMessagingClient _client;
  final PushDeviceRepository _devices;
  final TelemetryReporter _telemetry;
  final String? _appVersion;

  /// Stored in `user_devices.platform`.
  final String platform;

  void Function(PushMessage message)? _onOpen;
  void Function(PushMessage message)? _onForeground;

  /// Connects the UI. [onOpen] receives a tapped notification once a user is
  /// signed in (a tap held from before attach is delivered now);
  /// [onForeground] receives a message that arrived while the app was on
  /// screen. Pass nulls to detach.
  void attach({
    void Function(PushMessage message)? onOpen,
    void Function(PushMessage message)? onForeground,
  }) {
    _onOpen = onOpen;
    _onForeground = onForeground;
    _flushPendingOpen();
  }

  bool? _initialized;
  Future<bool>? _initializing;
  bool _initialMessageRead = false;
  String? _signedInUserId;
  String? _registeredToken;
  String? _registeredForUser;
  PushMessage? _pendingOpen;
  final List<StreamSubscription<Object?>> _subscriptions =
      <StreamSubscription<Object?>>[];

  /// The token this device registered for the current user, if any.
  @visibleForTesting
  String? get registeredToken => _registeredToken;

  Future<bool> _ensureInitialized() {
    final bool? done = _initialized;
    if (done != null) return Future<bool>.value(done);
    return _initializing ??= _initialize();
  }

  Future<bool> _initialize() async {
    final bool ok = await _client.initialize();
    _initialized = ok;
    if (!ok) {
      final Object? error = _client.lastInitializationError;
      if (error != null) {
        _report('Push initialisation failed', error);
      }
      return false;
    }
    _subscriptions
      ..add(_client.onTokenRefresh.listen(_handleTokenRefresh))
      ..add(_client.onForegroundMessage.listen(_handleForeground))
      ..add(_client.onMessageOpenedApp.listen(_handleOpened));
    return true;
  }

  /// Call when a user is signed in and the workspace is ready.
  Future<void> onSignedIn(String userId) async {
    _signedInUserId = userId;
    if (!await _ensureInitialized()) return;
    if (_signedInUserId != userId) return;

    if (!_initialMessageRead) {
      _initialMessageRead = true;
      final PushMessage? initial = await _client.getInitialMessage();
      if (initial != null) _pendingOpen = initial;
    }

    final PushPermissionStatus permission = await _client.requestPermission();
    if (permission == PushPermissionStatus.granted) {
      final String? token = await _client.getToken();
      if (token != null && _signedInUserId == userId) {
        await _register(token, userId);
      }
    }
    _flushPendingOpen();
  }

  /// Call BEFORE the session is ended, so the revoke still carries it.
  Future<void> onSigningOut() async {
    final String? token = _registeredToken;
    _signedInUserId = null;
    _registeredToken = null;
    _registeredForUser = null;
    _pendingOpen = null;
    if (token == null) return;
    try {
      await _devices.revoke(token).timeout(pushRevokeOnSignOutTimeout);
    } on Object catch (error) {
      _report('Push token revoke failed', error);
    }
  }

  /// Call after a sign-out that did not go through [onSigningOut] (a session
  /// that expired on its own). Nothing can be revoked without a session.
  void onSignedOut() {
    _signedInUserId = null;
    _registeredToken = null;
    _registeredForUser = null;
    _pendingOpen = null;
  }

  Future<void> _register(String token, String userId) async {
    if (_registeredToken == token && _registeredForUser == userId) return;
    try {
      await _devices.register(
        token: token,
        platform: platform,
        appVersion: _appVersion,
      );
      _registeredToken = token;
      _registeredForUser = userId;
    } on Object catch (error) {
      _report('Push token registration failed', error);
    }
  }

  void _handleTokenRefresh(String token) {
    final String? userId = _signedInUserId;
    final String trimmed = token.trim();
    if (userId == null || trimmed.isEmpty) return;
    unawaited(_register(trimmed, userId));
  }

  void _handleForeground(PushMessage message) {
    if (_signedInUserId == null) return;
    _onForeground?.call(message);
  }

  void _handleOpened(PushMessage message) {
    _pendingOpen = message;
    _flushPendingOpen();
  }

  void _flushPendingOpen() {
    final PushMessage? message = _pendingOpen;
    if (message == null || _signedInUserId == null) return;
    final void Function(PushMessage)? open = _onOpen;
    if (open == null) return;
    _pendingOpen = null;
    open(message);
  }

  void _report(String message, Object error) {
    final AppError appError = error is AppError
        ? error
        : AppError(
            kind: AppErrorKind.unknown,
            message: message,
            technical: '$message: ${error.runtimeType}',
          );
    unawaited(_telemetry.captureAppError(appError).catchError((Object _) {}));
  }

  Future<void> dispose() async {
    for (final StreamSubscription<Object?> sub in _subscriptions) {
      await sub.cancel();
    }
    _subscriptions.clear();
  }
}
