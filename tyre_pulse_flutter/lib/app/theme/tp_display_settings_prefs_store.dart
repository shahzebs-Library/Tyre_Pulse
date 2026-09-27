/// Durable [TpDisplaySettingsStore]: the user's language and theme survive a
/// restart.
///
/// Persistence follows the login-country preference
/// (`features/auth/data/login_country_preference_repository.dart`): platform
/// preferences through [SharedPreferencesAsync], one versioned, namespaced key
/// per value, never an unrestricted clear. Both values are non-sensitive
/// presentation state, so normal preferences are appropriate.
///
/// The store interface is SYNCHRONOUS (see `tp_display_settings.dart`), so
/// [SharedPreferencesDisplaySettingsStore.load] reads both values once before
/// `runApp` and the store then answers from memory. That is what stops the app
/// opening on a flash of the wrong language.
///
/// Storage is never allowed to break the app:
///
/// * a missing, corrupt or unsupported saved value reads as null, so the
///   controllers fall back to their own defaults (light theme, device
///   language);
/// * a failed or slow read at boot yields an empty store, never an exception;
/// * a write updates memory at once (the choice applies live) and persists in
///   the background; a failed write is reported through [onWriteError] and
///   never thrown into the UI. Writes are chained so the last choice made is
///   the last one written.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';

/// Narrow string store, separate from decoding so each is tested alone.
abstract interface class DisplaySettingsKeyValueStore {
  Future<String?> read(String key);

  Future<void> write(String key, String value);

  Future<void> remove(String key);
}

/// `shared_preferences` implementation using its async, cache-free API.
final class SharedPreferencesDisplaySettingsKeyValueStore
    implements DisplaySettingsKeyValueStore {
  SharedPreferencesDisplaySettingsKeyValueStore({
    SharedPreferencesAsync? preferences,
  }) : _preferences = preferences ?? SharedPreferencesAsync();

  final SharedPreferencesAsync _preferences;

  @override
  Future<String?> read(String key) => _preferences.getString(key);

  @override
  Future<void> write(String key, String value) =>
      _preferences.setString(key, value);

  @override
  Future<void> remove(String key) => _preferences.remove(key);
}

/// Encodes and decodes the two stored values. Pure, so it is unit tested.
abstract final class DisplaySettingsCodec {
  /// Versioned so a future representation can migrate without collisions.
  static const String themeModeKey = 'tyre_pulse.display.theme_mode.v1';
  static const String localeKey = 'tyre_pulse.display.locale.v1';

  static String encodeThemeMode(ThemeMode mode) => mode.name;

  /// Null for a missing or unrecognised value.
  static ThemeMode? decodeThemeMode(String? raw) {
    if (raw == null) return null;
    for (final ThemeMode mode in ThemeMode.values) {
      if (mode.name == raw) return mode;
    }
    return null;
  }

  static String encodeLocale(Locale locale) => locale.toLanguageTag();

  /// Null for a missing, malformed or no-longer-shipped language, so the app
  /// follows the device rather than opening in a language it cannot render.
  static Locale? decodeLocale(String? raw) {
    if (raw == null) return null;
    final String code = raw.trim().split(RegExp('[-_]')).first.toLowerCase();
    if (code.isEmpty) return null;
    for (final Locale supported in TpLocalizations.supportedLocales) {
      if (supported.languageCode == code) return supported;
    }
    return null;
  }
}

/// The durable store. Build it with [load], then override
/// [displaySettingsStoreProvider] with it in the root `ProviderScope`.
class SharedPreferencesDisplaySettingsStore implements TpDisplaySettingsStore {
  SharedPreferencesDisplaySettingsStore._(
    this._storage, {
    required ThemeMode? themeMode,
    required Locale? locale,
    this.onWriteError,
  })  : _themeMode = themeMode,
        _locale = locale;

  /// How long boot waits for storage before opening on defaults.
  static const Duration loadTimeout = Duration(seconds: 2);

  /// Reads both saved values. Never throws: any failure gives defaults.
  static Future<SharedPreferencesDisplaySettingsStore> load({
    DisplaySettingsKeyValueStore? storage,
    void Function(Object error, StackTrace stackTrace)? onWriteError,
    Duration timeout = loadTimeout,
  }) async {
    final DisplaySettingsKeyValueStore resolved =
        storage ?? SharedPreferencesDisplaySettingsKeyValueStore();
    final ThemeMode? themeMode = DisplaySettingsCodec.decodeThemeMode(
      await _safeRead(resolved, DisplaySettingsCodec.themeModeKey, timeout),
    );
    final Locale? locale = DisplaySettingsCodec.decodeLocale(
      await _safeRead(resolved, DisplaySettingsCodec.localeKey, timeout),
    );
    return SharedPreferencesDisplaySettingsStore._(
      resolved,
      themeMode: themeMode,
      locale: locale,
      onWriteError: onWriteError,
    );
  }

  static Future<String?> _safeRead(
    DisplaySettingsKeyValueStore storage,
    String key,
    Duration timeout,
  ) async {
    try {
      return await storage.read(key).timeout(timeout);
    } on Object {
      // Unreadable storage must not stop the app opening; the controllers'
      // own defaults apply instead.
      return null;
    }
  }

  final DisplaySettingsKeyValueStore _storage;

  /// Receives a failed background write. Never rethrown.
  final void Function(Object error, StackTrace stackTrace)? onWriteError;

  ThemeMode? _themeMode;
  Locale? _locale;
  Future<void> _pendingWrite = Future<void>.value();

  /// Completes once every write issued so far has been attempted.
  Future<void> get flushed => _pendingWrite;

  @override
  ThemeMode? readThemeMode() => _themeMode;

  @override
  Locale? readLocale() => _locale;

  @override
  void writeThemeMode(ThemeMode mode) {
    _themeMode = mode;
    _enqueue(
      () => _storage.write(
        DisplaySettingsCodec.themeModeKey,
        DisplaySettingsCodec.encodeThemeMode(mode),
      ),
    );
  }

  @override
  void writeLocale(Locale? locale) {
    _locale = locale;
    _enqueue(
      () => locale == null
          ? _storage.remove(DisplaySettingsCodec.localeKey)
          : _storage.write(
              DisplaySettingsCodec.localeKey,
              DisplaySettingsCodec.encodeLocale(locale),
            ),
    );
  }

  void _enqueue(Future<void> Function() write) {
    _pendingWrite = _pendingWrite.then((_) async {
      try {
        await write();
      } on Object catch (error, stackTrace) {
        onWriteError?.call(error, stackTrace);
      }
    });
  }
}
