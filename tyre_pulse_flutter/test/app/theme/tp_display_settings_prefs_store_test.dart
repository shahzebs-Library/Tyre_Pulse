/// Tests for the durable display-settings store: the language and theme a
/// user picks must survive a restart, and bad or unreadable storage must
/// fall back to the defaults without ever crashing the app.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings_prefs_store.dart';

/// In-memory stand-in for device preferences; survives "restarts" because
/// the same instance is handed to a second [load].
class _FakeKeyValueStore implements DisplaySettingsKeyValueStore {
  final Map<String, String> values = <String, String>{};
  bool failReads = false;
  bool failWrites = false;
  bool hangReads = false;

  @override
  Future<String?> read(String key) async {
    if (hangReads) return Completer<String?>().future;
    if (failReads) throw StateError('storage unavailable');
    return values[key];
  }

  @override
  Future<void> write(String key, String value) async {
    if (failWrites) throw StateError('disk full');
    values[key] = value;
  }

  @override
  Future<void> remove(String key) async {
    if (failWrites) throw StateError('disk full');
    values.remove(key);
  }
}

void main() {
  group('DisplaySettingsCodec', () {
    test('theme mode round trips every value', () {
      for (final ThemeMode mode in ThemeMode.values) {
        expect(
          DisplaySettingsCodec.decodeThemeMode(
            DisplaySettingsCodec.encodeThemeMode(mode),
          ),
          mode,
        );
      }
    });

    test('corrupt or missing theme mode decodes to null', () {
      expect(DisplaySettingsCodec.decodeThemeMode(null), isNull);
      expect(DisplaySettingsCodec.decodeThemeMode(''), isNull);
      expect(DisplaySettingsCodec.decodeThemeMode('purple'), isNull);
      expect(DisplaySettingsCodec.decodeThemeMode('DARK'), isNull);
    });

    test('supported locales round trip', () {
      for (final String code in <String>['en', 'ar', 'ur']) {
        final Locale locale = Locale(code);
        expect(
          DisplaySettingsCodec.decodeLocale(
            DisplaySettingsCodec.encodeLocale(locale),
          ),
          locale,
        );
      }
    });

    test('corrupt, missing or unsupported locale decodes to null', () {
      expect(DisplaySettingsCodec.decodeLocale(null), isNull);
      expect(DisplaySettingsCodec.decodeLocale(''), isNull);
      expect(DisplaySettingsCodec.decodeLocale('   '), isNull);
      expect(DisplaySettingsCodec.decodeLocale('fr'), isNull);
      expect(DisplaySettingsCodec.decodeLocale('{garbage'), isNull);
    });

    test('a region-tagged saved locale resolves to the shipped language', () {
      expect(DisplaySettingsCodec.decodeLocale('ar-SA'), const Locale('ar'));
      expect(DisplaySettingsCodec.decodeLocale('en_US'), const Locale('en'));
    });
  });

  group('SharedPreferencesDisplaySettingsStore', () {
    test('round trip: a saved choice is read back after a restart', () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore();
      final SharedPreferencesDisplaySettingsStore first =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      expect(first.readThemeMode(), isNull);
      expect(first.readLocale(), isNull);

      first
        ..writeThemeMode(ThemeMode.dark)
        ..writeLocale(const Locale('ar'));
      // Applies live, before the disk write finishes.
      expect(first.readThemeMode(), ThemeMode.dark);
      expect(first.readLocale(), const Locale('ar'));
      await first.flushed;

      final SharedPreferencesDisplaySettingsStore restarted =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      expect(restarted.readThemeMode(), ThemeMode.dark);
      expect(restarted.readLocale(), const Locale('ar'));
    });

    test('writeLocale(null) removes the saved language', () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore();
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      store.writeLocale(const Locale('ur'));
      await store.flushed;
      expect(storage.values[DisplaySettingsCodec.localeKey], 'ur');

      store.writeLocale(null);
      await store.flushed;
      expect(storage.values.containsKey(DisplaySettingsCodec.localeKey), false);
      final SharedPreferencesDisplaySettingsStore restarted =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      expect(restarted.readLocale(), isNull);
    });

    test('the last of several quick writes is the one persisted', () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore();
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      store
        ..writeThemeMode(ThemeMode.dark)
        ..writeThemeMode(ThemeMode.system)
        ..writeThemeMode(ThemeMode.light);
      await store.flushed;
      expect(storage.values[DisplaySettingsCodec.themeModeKey], 'light');
    });

    test('missing values load as null (defaults apply)', () async {
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(
        storage: _FakeKeyValueStore(),
      );
      expect(store.readThemeMode(), isNull);
      expect(store.readLocale(), isNull);
    });

    test('corrupt values load as null (defaults apply)', () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore()
        ..values[DisplaySettingsCodec.themeModeKey] = 'neon'
        ..values[DisplaySettingsCodec.localeKey] = 'xx-!!';
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      expect(store.readThemeMode(), isNull);
      expect(store.readLocale(), isNull);
    });

    test('unreadable storage loads defaults instead of throwing', () async {
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(
        storage: _FakeKeyValueStore()..failReads = true,
      );
      expect(store.readThemeMode(), isNull);
      expect(store.readLocale(), isNull);
    });

    test('a hung read times out to defaults, it never blocks boot', () async {
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(
        storage: _FakeKeyValueStore()..hangReads = true,
        timeout: const Duration(milliseconds: 10),
      );
      expect(store.readThemeMode(), isNull);
      expect(store.readLocale(), isNull);
    });

    test('a failed write is reported, not thrown, and still applies live',
        () async {
      final List<Object> errors = <Object>[];
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(
        storage: _FakeKeyValueStore()..failWrites = true,
        onWriteError: (Object error, StackTrace _) => errors.add(error),
      );
      store
        ..writeThemeMode(ThemeMode.dark)
        ..writeLocale(null);
      await store.flushed;
      expect(store.readThemeMode(), ThemeMode.dark);
      expect(errors, hasLength(2));
    });
  });

  group('providers restore a saved choice', () {
    test('themeModeProvider and localeProvider read the saved values',
        () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore()
        ..values[DisplaySettingsCodec.themeModeKey] = 'dark'
        ..values[DisplaySettingsCodec.localeKey] = 'ur';
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);

      final ProviderContainer container = ProviderContainer(
        overrides: [displaySettingsStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);

      expect(container.read(themeModeProvider), ThemeMode.dark);
      expect(container.read(localeProvider), const Locale('ur'));
    });

    test('a choice made through the controllers survives a restart', () async {
      final _FakeKeyValueStore storage = _FakeKeyValueStore();
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      final ProviderContainer first = ProviderContainer(
        overrides: [displaySettingsStoreProvider.overrideWithValue(store)],
      );
      first.read(themeModeProvider.notifier).setMode(ThemeMode.system);
      first.read(localeProvider.notifier).setLocale(const Locale('ar'));
      await store.flushed;
      first.dispose();

      final SharedPreferencesDisplaySettingsStore restarted =
          await SharedPreferencesDisplaySettingsStore.load(storage: storage);
      final ProviderContainer second = ProviderContainer(
        overrides: [displaySettingsStoreProvider.overrideWithValue(restarted)],
      );
      addTearDown(second.dispose);
      expect(second.read(themeModeProvider), ThemeMode.system);
      expect(second.read(localeProvider), const Locale('ar'));
    });

    test('corrupt saved values fall back to light and device language',
        () async {
      final SharedPreferencesDisplaySettingsStore store =
          await SharedPreferencesDisplaySettingsStore.load(
        storage: _FakeKeyValueStore()
          ..values[DisplaySettingsCodec.themeModeKey] = '???'
          ..values[DisplaySettingsCodec.localeKey] = 'klingon',
      );
      final ProviderContainer container = ProviderContainer(
        overrides: [displaySettingsStoreProvider.overrideWithValue(store)],
      );
      addTearDown(container.dispose);
      expect(container.read(themeModeProvider), ThemeMode.light);
      expect(container.read(localeProvider), isNull);
    });
  });
}
