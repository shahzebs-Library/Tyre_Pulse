/// Local persistence for the visual country shown on the login screen.
///
/// This repository has no backend, auth, profile, workspace, or permissions
/// dependency by design. The preference is non-sensitive presentation state,
/// so normal platform preferences are appropriate (master spec section 7).
library;

import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';

/// Persistence boundary consumed by the login-country controller.
abstract interface class LoginCountryPreferenceRepository {
  /// Returns the remembered visual country, or null on first launch or when a
  /// stored value belongs to a newer/older app version.
  Future<LoginCountry?> read();

  /// Persists [country] before the controller publishes it as selected.
  Future<void> save(LoginCountry country);

  /// Removes only this feature's value, returning the login to first-launch
  /// country selection.
  Future<void> clear();
}

/// Narrow string store kept separate from domain decoding for focused tests.
abstract interface class LoginCountryPreferenceStore {
  Future<String?> read();

  Future<void> write(String value);

  Future<void> clear();
}

/// `shared_preferences` implementation using its current async API.
///
/// [SharedPreferencesAsync] avoids a process-local cache, so a background
/// isolate or native host change cannot leave this read stale. Every operation
/// targets the one namespaced key; this class never calls an unrestricted
/// preferences clear.
final class SharedPreferencesLoginCountryPreferenceStore
    implements LoginCountryPreferenceStore {
  SharedPreferencesLoginCountryPreferenceStore({
    SharedPreferencesAsync? preferences,
  }) : _preferences = preferences ?? SharedPreferencesAsync();

  /// Versioned so any future representation can migrate without colliding
  /// with auth/session/workspace storage.
  static const String storageKey = 'tyre_pulse.auth.login_visual_country.v1';

  final SharedPreferencesAsync _preferences;

  @override
  Future<void> clear() => _preferences.remove(storageKey);

  @override
  Future<String?> read() => _preferences.getString(storageKey);

  @override
  Future<void> write(String value) => _preferences.setString(storageKey, value);
}

/// Maps stable local strings to the domain enum used by presentation.
final class LocalLoginCountryPreferenceRepository
    implements LoginCountryPreferenceRepository {
  LocalLoginCountryPreferenceRepository(this._store);

  final LoginCountryPreferenceStore _store;

  @override
  Future<void> clear() => _store.clear();

  @override
  Future<LoginCountry?> read() async =>
      LoginCountry.fromStorageValue(await _store.read());

  @override
  Future<void> save(LoginCountry country) => _store.write(country.storageValue);
}
