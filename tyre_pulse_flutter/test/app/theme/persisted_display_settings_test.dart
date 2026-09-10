import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  setUp(() => SharedPreferences.setMockInitialValues(<String, Object>{}));

  test('theme and RTL language survive recreating the provider container',
      () async {
    final preferences = await SharedPreferences.getInstance();
    final first = ProviderContainer(
      overrides: [
        displaySettingsStoreProvider.overrideWithValue(
          SharedPreferencesDisplaySettingsStore(preferences),
        ),
      ],
    );
    first.read(themeModeProvider.notifier).setMode(ThemeMode.dark);
    first.read(localeProvider.notifier).setLocale(const Locale('ar'));
    first.dispose();
    await preferences.reload();

    final restarted = ProviderContainer(
      overrides: [
        displaySettingsStoreProvider.overrideWithValue(
          SharedPreferencesDisplaySettingsStore(preferences),
        ),
      ],
    );
    addTearDown(restarted.dispose);
    expect(restarted.read(themeModeProvider), ThemeMode.dark);
    expect(restarted.read(localeProvider), const Locale('ar'));
  });

  test('following the device clears the saved language', () async {
    final preferences = await SharedPreferences.getInstance();
    final store = SharedPreferencesDisplaySettingsStore(preferences);
    store.writeLocale(const Locale('ur'));
    store.writeLocale(null);
    store.writeThemeMode(ThemeMode.system);
    await preferences.reload();
    expect(store.readLocale(), isNull);
    expect(store.readThemeMode(), ThemeMode.system);
    expect(
      preferences.containsKey(SharedPreferencesDisplaySettingsStore.localeKey),
      isFalse,
    );
  });

  test('invalid saved values fall back to the app defaults', () async {
    SharedPreferences.setMockInitialValues(<String, Object>{
      SharedPreferencesDisplaySettingsStore.themeKey: 12,
      SharedPreferencesDisplaySettingsStore.localeKey: 'unsupported',
    });
    final container = ProviderContainer(
      overrides: [
        displaySettingsStoreProvider.overrideWithValue(
          SharedPreferencesDisplaySettingsStore(
            await SharedPreferences.getInstance(),
          ),
        ),
      ],
    );
    addTearDown(container.dispose);
    expect(container.read(themeModeProvider), ThemeMode.light);
    expect(container.read(localeProvider), isNull);
  });
}
