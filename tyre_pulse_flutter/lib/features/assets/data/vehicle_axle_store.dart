/// Keeps the per-machine axle counts on the device, so a phone that restarts
/// with no signal still draws a 4-axle pump with 12 tyres, not 14.
///
/// The counts come from `vehicle_fleet.axle_count` (non-sensitive fleet
/// configuration), so normal preferences are appropriate. One versioned key;
/// a missing or corrupt value reads as nothing saved. Storage never breaks
/// the app: every failure is swallowed and the type's default build is drawn.
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/vehicle_axle_registry.dart';

/// Narrow string store so tests can run without the platform plugin.
abstract interface class AxleKeyValueStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);
}

final class SharedPreferencesAxleKeyValueStore implements AxleKeyValueStore {
  SharedPreferencesAxleKeyValueStore({SharedPreferencesAsync? preferences})
      : _given = preferences;

  final SharedPreferencesAsync? _given;

  // Created on first use, inside the store's own try/catch, so a test or a
  // platform without the plugin never fails while building the repository.
  SharedPreferencesAsync get _preferences => _given ?? SharedPreferencesAsync();

  @override
  Future<String?> read(String key) => _preferences.getString(key);

  @override
  Future<void> write(String key, String value) =>
      _preferences.setString(key, value);
}

final class VehicleAxleStore {
  VehicleAxleStore(this._kv);

  static const String storageKey = 'tp.vehicle_axle_counts.v1';

  final AxleKeyValueStore _kv;
  bool _restored = false;

  /// Saves what the registry knows now. Never throws.
  Future<void> save() async {
    try {
      final Map<String, int?> counts = exportAxleRegistry();
      if (counts.isEmpty) return;
      await _kv.write(
        storageKey,
        jsonEncode(<String, Object?>{
          'preferred': preferredAxleCountry,
          'counts': counts,
        }),
      );
    } on Object {
      // A failed write only costs the offline 4-axle picture.
    }
  }

  /// Restores the saved counts once per process. Never throws.
  Future<void> restore() async {
    if (_restored) return;
    _restored = true;
    try {
      final String? raw = await _kv.read(storageKey);
      if (raw == null || raw.isEmpty) return;
      final Object? decoded = jsonDecode(raw);
      if (decoded is! Map<String, dynamic>) return;
      final Object? counts = decoded['counts'];
      if (counts is! Map<String, dynamic>) return;
      final Map<String, int?> parsed = <String, int?>{};
      counts.forEach((String key, Object? v) {
        parsed[key] = v is num ? v.toInt() : null;
      });
      importAxleRegistry(
        parsed,
        preferredCountry: decoded['preferred'] as String?,
      );
    } on Object {
      // Corrupt or unreadable: draw the default build.
    }
  }
}
