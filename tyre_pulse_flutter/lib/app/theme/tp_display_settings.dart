/// The two display preferences a user can change: theme mode and language.
///
/// They live in one file because they are one concern and share one store. The
/// language provider is re-exported from the localisation layer so a feature
/// can import it from where it expects to find it.
///
/// PERSISTENCE IS A STUB, DELIBERATELY AND VISIBLY.
///
/// [TpDisplaySettingsStore] is an interface with an in-memory implementation.
/// Changing the language or the theme takes effect immediately, which is the
/// behaviour a user can see; it does not yet survive a restart, which is the
/// behaviour they cannot. The durable implementation belongs to whoever owns
/// device storage, and it plugs in by overriding [displaySettingsStoreProvider]
/// in the root `ProviderScope`.
///
/// The interface is deliberately SYNCHRONOUS. Reading a preference must not be
/// a future the first frame has to wait on, or the app opens on a flash of the
/// wrong language. A durable implementation preloads its values before
/// `runApp` and then answers synchronously.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

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
