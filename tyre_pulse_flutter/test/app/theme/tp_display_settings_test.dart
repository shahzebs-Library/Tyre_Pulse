/// Tests for the display preference store and its two Riverpod controllers.
///
/// The doc comment on `tp_display_settings.dart` states three properties
/// that are load-bearing and are what this file exists to pin:
///
/// 1. [InMemoryDisplaySettingsStore] holds a choice for the current run only.
/// 2. The theme mode defaults to [ThemeMode.light], deliberately NOT
///    [ThemeMode.system] - spec section 53 again, the app is used outdoors.
/// 3. The interface is synchronous: reading a preference must never be a
///    future the first frame waits on. [TpThemeModeController.build] and
///    [TpLocaleController.build] both return a plain value, not a Future or
///    an AsyncValue, so this is enforced by the type system as much as by
///    the tests below - the tests confirm what that typing promises.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';

void main() {
  group('InMemoryDisplaySettingsStore, as a unit', () {
    test('a fresh store reads null for both preferences', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      expect(store.readThemeMode(), isNull);
      expect(store.readLocale(), isNull);
    });

    test('writeThemeMode is read back exactly', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      store.writeThemeMode(ThemeMode.dark);
      expect(store.readThemeMode(), ThemeMode.dark);
    });

    test('writeLocale is read back exactly', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      store.writeLocale(const Locale('ur'));
      expect(store.readLocale(), const Locale('ur'));
    });

    test('writeLocale(null) goes back to following the device language', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      store.writeLocale(const Locale('ar'));
      expect(store.readLocale(), isNotNull);

      store.writeLocale(null);
      expect(store.readLocale(), isNull);
    });

    test('two separate store instances do not share state', () {
      final InMemoryDisplaySettingsStore a = InMemoryDisplaySettingsStore();
      final InMemoryDisplaySettingsStore b = InMemoryDisplaySettingsStore();
      a.writeThemeMode(ThemeMode.dark);
      expect(a.readThemeMode(), ThemeMode.dark);
      expect(b.readThemeMode(), isNull);
    });
  });

  group('themeModeProvider - the default with nothing ever saved', () {
    test('is ThemeMode.light, not ThemeMode.system', () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      // Spec section 53: a phone left on system dark must not open
      // unreadable in the sun, so light is the explicit fallback rather
      // than the platform default.
      expect(container.read(themeModeProvider), ThemeMode.light);
      expect(container.read(themeModeProvider), isNot(ThemeMode.system));
    });

    test('reading twice does not change the state', () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.light);
      expect(container.read(themeModeProvider), ThemeMode.light);
    });
  });

  group('themeModeProvider - a preference already saved before build()', () {
    test('is honoured instead of the light default', () {
      final InMemoryDisplaySettingsStore preloaded =
          InMemoryDisplaySettingsStore()..writeThemeMode(ThemeMode.dark);

      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => preloaded),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.dark);
    });
  });

  group('themeModeProvider - setMode', () {
    test('updates the provider state', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => store),
        ],
      );
      addTearDown(container.dispose);
      expect(container.read(themeModeProvider), ThemeMode.light);

      container.read(themeModeProvider.notifier).setMode(ThemeMode.dark);

      expect(container.read(themeModeProvider), ThemeMode.dark);
    });

    test('writes through to the underlying store, not only local state', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => store),
        ],
      );
      addTearDown(container.dispose);

      container.read(themeModeProvider.notifier).setMode(ThemeMode.dark);

      expect(store.readThemeMode(), ThemeMode.dark);
    });
  });

  group('localeProvider - the default with nothing ever saved', () {
    test('is null, meaning follow the device language', () {
      final ProviderContainer container = ProviderContainer();
      addTearDown(container.dispose);

      expect(container.read(localeProvider), isNull);
    });
  });

  group('localeProvider - a preference already saved before build()', () {
    test('is honoured instead of the null default', () {
      final InMemoryDisplaySettingsStore preloaded =
          InMemoryDisplaySettingsStore()..writeLocale(const Locale('ar'));

      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => preloaded),
        ],
      );
      addTearDown(container.dispose);

      expect(container.read(localeProvider), const Locale('ar'));
    });
  });

  group('localeProvider - setLocale', () {
    test('updates the provider state and writes through to the store', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => store),
        ],
      );
      addTearDown(container.dispose);
      expect(container.read(localeProvider), isNull);

      container.read(localeProvider.notifier).setLocale(const Locale('ur'));

      expect(container.read(localeProvider), const Locale('ur'));
      expect(store.readLocale(), const Locale('ur'));
    });

    test('passing null returns to following the device language', () {
      final InMemoryDisplaySettingsStore store = InMemoryDisplaySettingsStore();
      final ProviderContainer container = ProviderContainer(
        overrides: [
          displaySettingsStoreProvider.overrideWith((Ref ref) => store),
        ],
      );
      addTearDown(container.dispose);
      container.read(localeProvider.notifier).setLocale(const Locale('ar'));
      expect(container.read(localeProvider), isNotNull);

      container.read(localeProvider.notifier).setLocale(null);

      expect(container.read(localeProvider), isNull);
      expect(store.readLocale(), isNull);
    });
  });

  group('the store provider is a genuine seam between containers', () {
    test('two containers with no override get two independent stores', () {
      // The default provider creates a fresh InMemoryDisplaySettingsStore
      // per container, so a preference set through one provider tree must
      // never leak into a different container's tree.
      final ProviderContainer first = ProviderContainer();
      addTearDown(first.dispose);
      final ProviderContainer second = ProviderContainer();
      addTearDown(second.dispose);

      first.read(themeModeProvider.notifier).setMode(ThemeMode.dark);

      expect(first.read(themeModeProvider), ThemeMode.dark);
      expect(second.read(themeModeProvider), ThemeMode.light);
    });
  });
}
