/// Firebase Cloud Messaging behind [PushMessagingClient].
///
/// The ONLY file that imports Firebase. Android only: the Android app reads
/// `android/app/google-services.json` through the Google services Gradle
/// plugin, so `Firebase.initializeApp()` needs no options. iOS has no
/// `GoogleService-Info.plist` and no APNs setup yet, so it reports
/// unsupported instead of failing on every launch.
///
/// Initialisation failure is NEVER fatal: [initialize] returns false and the
/// app runs exactly as it did before push existed.
library;

import 'dart:async';

import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/push/push_message.dart';
import 'package:tyre_pulse/core/push/push_messaging_client.dart';

final class FirebasePushMessagingClient implements PushMessagingClient {
  FirebasePushMessagingClient();

  bool? _ready;
  Object? _lastError;

  bool get _supportedPlatform =>
      !kIsWeb && defaultTargetPlatform == TargetPlatform.android;

  FirebaseMessaging get _messaging => FirebaseMessaging.instance;

  @override
  Object? get lastInitializationError => _lastError;

  @override
  Future<bool> initialize() async {
    final bool? ready = _ready;
    if (ready != null) return ready;
    if (!_supportedPlatform) return _ready = false;
    try {
      if (Firebase.apps.isEmpty) {
        await Firebase.initializeApp();
      }
      return _ready = true;
    } on Object catch (error) {
      _lastError = error;
      return _ready = false;
    }
  }

  @override
  Future<PushPermissionStatus> requestPermission() async {
    if (_ready != true) return PushPermissionStatus.unsupported;
    try {
      // On Android 13+ this shows the POST_NOTIFICATIONS prompt (declared by
      // the firebase_messaging manifest). Below 13 it resolves authorized.
      final NotificationSettings settings =
          await _messaging.requestPermission();
      switch (settings.authorizationStatus) {
        case AuthorizationStatus.authorized:
        case AuthorizationStatus.provisional:
          return PushPermissionStatus.granted;
        case AuthorizationStatus.denied:
        case AuthorizationStatus.deniedPermanently:
        case AuthorizationStatus.notDetermined:
          return PushPermissionStatus.denied;
      }
    } on Object catch (error) {
      _lastError = error;
      return PushPermissionStatus.unsupported;
    }
  }

  @override
  Future<String?> getToken() async {
    if (_ready != true) return null;
    try {
      final String? token = await _messaging.getToken();
      if (token == null || token.trim().isEmpty) return null;
      return token.trim();
    } on Object catch (error) {
      _lastError = error;
      return null;
    }
  }

  @override
  Stream<String> get onTokenRefresh =>
      _ready == true ? _messaging.onTokenRefresh : const Stream<String>.empty();

  @override
  Stream<PushMessage> get onForegroundMessage => _ready == true
      ? FirebaseMessaging.onMessage.map(_toPushMessage)
      : const Stream<PushMessage>.empty();

  @override
  Stream<PushMessage> get onMessageOpenedApp => _ready == true
      ? FirebaseMessaging.onMessageOpenedApp.map(_toPushMessage)
      : const Stream<PushMessage>.empty();

  @override
  Future<PushMessage?> getInitialMessage() async {
    if (_ready != true) return null;
    try {
      final RemoteMessage? message = await _messaging.getInitialMessage();
      return message == null ? null : _toPushMessage(message);
    } on Object catch (error) {
      _lastError = error;
      return null;
    }
  }

  static PushMessage _toPushMessage(RemoteMessage message) => PushMessage(
        messageId: message.messageId,
        title: message.notification?.title,
        body: message.notification?.body,
        data: <String, String>{
          for (final MapEntry<String, dynamic> entry in message.data.entries)
            if (entry.value != null) entry.key: entry.value.toString(),
        },
      );
}
