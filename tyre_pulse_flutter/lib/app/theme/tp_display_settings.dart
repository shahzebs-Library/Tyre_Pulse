/// The two display preferences a user can change: theme mode and language.
///
/// They live in one file because they are one concern and share one store. The
/// language provider is re-exported from the localisation layer so a feature
/// can import it from where it expects to find it.
///
/// Production preloads [SharedPreferencesDisplaySettingsStore] before the
/// first frame. Tests can use the isolated in-memory implementation.
///
/// The interface is deliberately SYNCHRONOUS. Reading a preference must not be
/// a future the first frame has to wait on, or the app opens on a flash of the
/// wrong language. A durable implementation preloads its values before
/// `runApp` and then answers synchronously.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Reads and writes the user's display preferences.
abstract interface class TpDisplaySettingsStore {
  /// The saved theme mode, or null when the user has never chosen one.
  ThemeMode? readThemeMode();

  /// The saved language, or null to follow the device.
  Locale? readLocale();

  void writeThemeMode(ThemeMode mode);

  /// Pass null to go back to following the device language.
  void writeLocale(Locale? locale);
}

/// Non-sensitive device preferences, available synchronously after preload.
class SharedPreferencesDisplaySettingsStore implements TpDisplaySettingsStore {
  SharedPreferencesDisplaySettingsStore(this._preferences);

  final SharedPreferences _preferences;
  static const String themeKey = 'display.theme';
  static const String localeKey = 'display.locale';

  @override
  ThemeMode? readThemeMode() => switch (_preferences.get(themeKey)) {
        'light' => ThemeMode.light,
        'dark' => ThemeMode.dark,
        'system' => ThemeMode.system,
        _ => null,
      };

  @override
  Locale? readLocale() => switch (_preferences.get(localeKey)) {
        'en' => const Locale('en'),
        'ar' => const Locale('ar'),
        'ur' => const Locale('ur'),
        _ => null,
      };

  @override
  void writeThemeMode(ThemeMode mode) {
    unawaited(_persist(_preferences.setString(themeKey, mode.name)));
  }

  @override
  void writeLocale(Locale? locale) {
    unawaited(
      _persist(
        locale == null
            ? _preferences.remove(localeKey)
            : _preferences.setString(localeKey, locale.languageCode),
      ),
    );
  }

  Future<void> _persist(Future<bool> write) async {
    try {
      if (!await write) {
        throw StateError('Display preferences could not be saved.');
      }
    } on Object catch (error, stack) {
      FlutterError.reportError(
        FlutterErrorDetails(
          exception: error,
          stack: stack,
          library: 'display preferences',
          context: ErrorDescription('while saving display preferences'),
        ),
      );
    }
  }
}

/// The default store. Holds the choice for this run of the app and no longer.
class InMemoryDisplaySettingsStore implements TpDisplaySettingsStore {
  ThemeMode? _themeMode;
  Locale? _locale;

  @override
  ThemeMode? readThemeMode() => _themeMode;

  @override
  Locale? readLocale() => _locale;

  @override
  void writeThemeMode(ThemeMode mode) => _themeMode = mode;

  @override
  void writeLocale(Locale? locale) => _locale = locale;
}

/// Override this in the root `ProviderScope` to make preferences durable.
final Provider<TpDisplaySettingsStore> displaySettingsStoreProvider =
    Provider<TpDisplaySettingsStore>((ref) => InMemoryDisplaySettingsStore());

/// The active theme mode.
///
/// Defaults to [ThemeMode.light], not [ThemeMode.system]. Spec section 53:
/// light is the primary theme because the application is used outdoors, and a
/// phone left on system dark would otherwise open unreadable in the sun.
class TpThemeModeController extends Notifier<ThemeMode> {
  @override
  ThemeMode build() {
    return ref.read(displaySettingsStoreProvider).readThemeMode() ??
        ThemeMode.light;
  }

  void setMode(ThemeMode mode) {
    ref.read(displaySettingsStoreProvider).writeThemeMode(mode);
    state = mode;
  }
}

final NotifierProvider<TpThemeModeController, ThemeMode> themeModeProvider =
    NotifierProvider<TpThemeModeController, ThemeMode>(
  TpThemeModeController.new,
);

/// The active language, or null to follow the device.
///
/// Flutter changes direction the moment this changes, so unlike the React
/// Native app there is no reload prompt to port. Artifact 03 section 6.3 says
/// so explicitly: do not port the prompt.
class TpLocaleController extends Notifier<Locale?> {
  @override
  Locale? build() => ref.read(displaySettingsStoreProvider).readLocale();

  /// Pass null to follow the device language again.
  void setLocale(Locale? locale) {
    ref.read(displaySettingsStoreProvider).writeLocale(locale);
    state = locale;
  }
}

final NotifierProvider<TpLocaleController, Locale?> localeProvider =
    NotifierProvider<TpLocaleController, Locale?>(TpLocaleController.new);
