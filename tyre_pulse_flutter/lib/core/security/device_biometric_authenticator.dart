/// A narrow bridge to the Android and iOS biometric prompts.
///
/// The login screen asks this interface to verify the person holding the
/// device, then continues through the existing [AuthController] credential
/// path. It never stores a password, invents a second auth backend, or treats
/// a device check as a Supabase session.
library;

import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

enum DeviceBiometricResult {
  authenticated,
  cancelled,
  unavailable,
  lockedOut,
  failed,
}

abstract interface class DeviceBiometricAuthenticator {
  Future<DeviceBiometricResult> authenticate({required String reason});
}

final class PlatformDeviceBiometricAuthenticator
    implements DeviceBiometricAuthenticator {
  const PlatformDeviceBiometricAuthenticator();

  static const MethodChannel _channel = MethodChannel(
    'com.shahzebrahman.tyrepulse/device_security',
  );

  @override
  Future<DeviceBiometricResult> authenticate({required String reason}) async {
    try {
      final String? result = await _channel.invokeMethod<String>(
        'authenticate',
        <String, Object?>{'reason': reason},
      );
      return switch (result) {
        'authenticated' => DeviceBiometricResult.authenticated,
        'cancelled' => DeviceBiometricResult.cancelled,
        'unavailable' => DeviceBiometricResult.unavailable,
        'lockedOut' => DeviceBiometricResult.lockedOut,
        _ => DeviceBiometricResult.failed,
      };
    } on MissingPluginException {
      return DeviceBiometricResult.unavailable;
    } on PlatformException catch (error) {
      return switch (error.code) {
        'unavailable' => DeviceBiometricResult.unavailable,
        'lockedOut' => DeviceBiometricResult.lockedOut,
        'cancelled' => DeviceBiometricResult.cancelled,
        _ => DeviceBiometricResult.failed,
      };
    }
  }
}

final Provider<DeviceBiometricAuthenticator>
    deviceBiometricAuthenticatorProvider =
    Provider<DeviceBiometricAuthenticator>(
  (ref) => const PlatformDeviceBiometricAuthenticator(),
);
