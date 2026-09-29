/// Stores and retires this device's push token on the server.
///
/// Backing surface (artifact 02): `register_user_device(p_push_token,
/// p_platform, p_device_id, p_app_version)` and
/// `revoke_user_device(p_push_token)`, both created by
/// `MIGRATIONS_V321_USER_DEVICES.sql`. `register_user_device` also stamps
/// `profiles.push_token` for older consumers, so this app never writes that
/// column itself. Server consumers fan out over every non-revoked
/// `user_devices` row (`20260924124000_push_fanout_user_devices.sql`).
///
/// An FCM token is told apart from an Expo token by its form alone:
/// `workflow-notify` sends `ExponentPushToken[...]` / `ExpoPushToken[...]` to
/// Expo and every other token to FCM. No column records the provider.
///
/// ONLINE-ONLY by design (artifact 06 section 7): a token registration is
/// meaningless offline and is simply retried on the next sign-in or refresh.
library;

import 'dart:async';

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// How long one registration call may take before it is abandoned.
const Duration pushDeviceCallTimeout = Duration(seconds: 10);

abstract interface class PushDeviceRepository {
  /// Upserts this device. Throws an `AppError` on failure.
  Future<void> register({
    required String token,
    required String platform,
    String? appVersion,
  });

  /// Soft-revokes this device for the signed-in user. Throws on failure.
  Future<void> revoke(String token);
}

final class SupabasePushDeviceRepository implements PushDeviceRepository {
  /// Takes a reader, not a client, so a build or test that never registers a
  /// token never needs Supabase initialised.
  SupabasePushDeviceRepository(this._readClient);

  final SupabaseClient Function() _readClient;

  @override
  Future<void> register({
    required String token,
    required String platform,
    String? appVersion,
  }) async {
    try {
      await _readClient().rpc<Object?>(
        SupabaseRpcs.registerUserDevice,
        params: <String, Object?>{
          'p_push_token': token,
          'p_platform': platform,
          'p_device_id': null,
          'p_app_version': appVersion,
        },
      ).timeout(pushDeviceCallTimeout);
    } on Object catch (error) {
      throw mapSupabaseError(error);
    }
  }

  @override
  Future<void> revoke(String token) async {
    try {
      await _readClient().rpc<Object?>(
        SupabaseRpcs.revokeUserDevice,
        params: <String, Object?>{'p_push_token': token},
      ).timeout(pushDeviceCallTimeout);
    } on Object catch (error) {
      throw mapSupabaseError(error);
    }
  }
}
