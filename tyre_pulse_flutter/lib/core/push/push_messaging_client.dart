/// The seam between the app and the push provider (Firebase Cloud Messaging).
///
/// Everything outside `firebase_push_messaging_client.dart` talks to this
/// interface, so widget and unit tests never initialise Firebase. The default
/// wired by `push_providers.dart` is [UnsupportedPushMessagingClient]; the
/// composition root (`main.dart`) overrides it with the real client.
library;

import 'dart:async';

import 'package:tyre_pulse/core/push/push_message.dart';

/// What the operating system said about showing notifications.
enum PushPermissionStatus {
  /// The user allowed notifications (or the OS does not ask, below Android 13).
  granted,

  /// The user refused. The token is not registered, matching the Expo app.
  denied,

  /// The platform or build has no push support (for example iOS without a
  /// Firebase configuration, or a test).
  unsupported,
}

abstract interface class PushMessagingClient {
  /// Prepares the provider. Returns false when push is not available on this
  /// build or platform. MUST NOT throw; the caller reports a failure through
  /// [lastInitializationError].
  Future<bool> initialize();

  /// Why [initialize] returned false, when it failed rather than being
  /// unsupported. Null otherwise.
  Object? get lastInitializationError;

  Future<PushPermissionStatus> requestPermission();

  /// This device's push token, or null when none could be obtained.
  Future<String?> getToken();

  Stream<String> get onTokenRefresh;

  /// Messages that arrive while the app is on screen. The OS does not draw
  /// these, so the app must.
  Stream<PushMessage> get onForegroundMessage;

  /// A notification tapped while the app was in the background.
  Stream<PushMessage> get onMessageOpenedApp;

  /// The notification that launched the app from a terminated state, if any.
  Future<PushMessage?> getInitialMessage();
}

/// The default: no push at all. Used by tests and by any build where the real
/// client is not wired, so nothing ever reaches Firebase by accident.
final class UnsupportedPushMessagingClient implements PushMessagingClient {
  const UnsupportedPushMessagingClient();

  @override
  Future<bool> initialize() async => false;

  @override
  Object? get lastInitializationError => null;

  @override
  Future<PushPermissionStatus> requestPermission() async =>
      PushPermissionStatus.unsupported;

  @override
  Future<String?> getToken() async => null;

  @override
  Stream<String> get onTokenRefresh => const Stream<String>.empty();

  @override
  Stream<PushMessage> get onForegroundMessage =>
      const Stream<PushMessage>.empty();

  @override
  Stream<PushMessage> get onMessageOpenedApp =>
      const Stream<PushMessage>.empty();

  @override
  Future<PushMessage?> getInitialMessage() async => null;
}
