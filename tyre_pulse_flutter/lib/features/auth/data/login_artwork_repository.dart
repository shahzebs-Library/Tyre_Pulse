/// Reads the administrator-chosen login artwork and keeps the last good value
/// on the device, so a phone that opens offline still shows the chosen
/// picture instead of snapping back to the default.
library;

import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/auth/domain/login_artwork.dart';

/// Boundary consumed by the login artwork controller.
abstract interface class LoginArtworkRepository {
  /// The last choice saved on this device, or null when none was ever saved.
  Future<LoginArtworkChoice?> readCached();

  /// The live choice from the server, or null when it could not be read.
  /// Never throws: the login screen must not fail because of a picture.
  Future<LoginArtworkChoice?> fetchRemote();

  /// Remembers [choice] for offline starts.
  Future<void> saveCached(LoginArtworkChoice choice);
}

/// Production implementation: `get_public_config` + `SharedPreferencesAsync`.
final class SupabaseLoginArtworkRepository implements LoginArtworkRepository {
  SupabaseLoginArtworkRepository({
    required SupabaseClient Function() client,
    SharedPreferencesAsync? preferences,
  })  : _client = client,
        _injectedPreferences = preferences;

  /// Versioned, namespaced; never collides with auth/session storage.
  static const String storageKey = 'tyre_pulse.auth.login_artwork.v1';

  /// A slow network must not hold the login screen's picture.
  static const Duration timeout = Duration(seconds: 6);

  final SupabaseClient Function() _client;
  final SharedPreferencesAsync? _injectedPreferences;

  /// Created on first use, inside each method's guard: constructing it throws
  /// when no platform store is registered (tests, unsupported hosts), and a
  /// picture must never be able to break the login screen.
  SharedPreferencesAsync get _preferences =>
      _injectedPreferences ?? SharedPreferencesAsync();

  @override
  Future<LoginArtworkChoice?> readCached() async {
    try {
      final String? raw = await _preferences.getString(storageKey);
      return raw == null ? null : LoginArtworkChoice.parse(raw);
    } on Object {
      return null;
    }
  }

  @override
  Future<LoginArtworkChoice?> fetchRemote() async {
    try {
      final Object? body = await _client()
          .rpc<Object?>(SupabaseRpcs.getPublicConfig)
          .timeout(timeout);
      if (body is! Map) return null;
      // Absent key = the administrator never chose = every country default.
      return LoginArtworkChoice.parse(body[loginArtworkConfigKey]);
    } on Object {
      return null;
    }
  }

  @override
  Future<void> saveCached(LoginArtworkChoice choice) async {
    try {
      await _preferences.setString(storageKey, choice.toJson());
    } on Object {
      // A cache write failure only costs the offline start its picture.
    }
  }
}
