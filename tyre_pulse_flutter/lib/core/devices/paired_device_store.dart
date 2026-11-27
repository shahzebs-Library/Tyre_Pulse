/// Remembers the devices a person added, on this phone, per user: two people
/// sharing a handset each keep their own gauge and printer.
///
/// Local only, never synced: a Bluetooth address means nothing on another
/// phone, and there is no server table for it (none is invented).
library;

import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/core/devices/device_models.dart';

abstract interface class PairedDeviceStore {
  Future<List<PairedDevice>> load(String userId);
  Future<void> save(String userId, List<PairedDevice> devices);
}

final class PrefsPairedDeviceStore implements PairedDeviceStore {
  PrefsPairedDeviceStore({SharedPreferencesAsync? preferences})
      : _prefs = preferences ?? SharedPreferencesAsync();

  final SharedPreferencesAsync _prefs;

  static String keyFor(String userId) => 'tp.devices.v1.$userId';

  @override
  Future<List<PairedDevice>> load(String userId) async {
    final String? raw = await _prefs.getString(keyFor(userId));
    return decodePairedDevices(raw);
  }

  @override
  Future<void> save(String userId, List<PairedDevice> devices) =>
      _prefs.setString(keyFor(userId), encodePairedDevices(devices));
}

/// One unreadable entry is dropped, not allowed to lose the rest.
List<PairedDevice> decodePairedDevices(String? raw) {
  if (raw == null || raw.isEmpty) return const <PairedDevice>[];
  final Object? decoded;
  try {
    decoded = jsonDecode(raw);
  } on FormatException {
    return const <PairedDevice>[];
  }
  if (decoded is! List) return const <PairedDevice>[];
  final List<PairedDevice> out = <PairedDevice>[];
  for (final Object? entry in decoded) {
    if (entry is! Map<String, dynamic>) continue;
    try {
      out.add(PairedDevice.fromJson(entry));
    } on FormatException {
      continue;
    }
  }
  return out;
}

String encodePairedDevices(List<PairedDevice> devices) => jsonEncode(
      <Map<String, dynamic>>[
        for (final PairedDevice d in devices) d.toJson(),
      ],
    );

/// In-memory store for tests.
final class MemoryPairedDeviceStore implements PairedDeviceStore {
  final Map<String, List<PairedDevice>> byUser = <String, List<PairedDevice>>{};

  @override
  Future<List<PairedDevice>> load(String userId) async =>
      List<PairedDevice>.of(byUser[userId] ?? const <PairedDevice>[]);

  @override
  Future<void> save(String userId, List<PairedDevice> devices) async {
    byUser[userId] = List<PairedDevice>.of(devices);
  }
}
