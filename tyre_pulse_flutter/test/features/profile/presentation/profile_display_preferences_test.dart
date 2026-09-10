import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_display_settings.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/profile/presentation/profile_display_preferences.dart';

Widget _app(ProviderContainer container) => UncontrolledProviderScope(
      container: container,
      child: Consumer(
        builder: (context, ref, child) => MaterialApp(
          locale: ref.watch(localeProvider),
          themeMode: ref.watch(themeModeProvider),
          theme: TpTheme.light,
          darkTheme: TpTheme.dark,
          localizationsDelegates: TpLocalizations.delegates,
          supportedLocales: TpLocalizations.supportedLocales,
          home: const Scaffold(
            body: SingleChildScrollView(
              child: ProfileDisplayPreferences(),
            ),
          ),
        ),
      ),
    );

ProviderContainer _container(SharedPreferences preferences) =>
    ProviderContainer(
      overrides: [
        displaySettingsStoreProvider.overrideWithValue(
          SharedPreferencesDisplaySettingsStore(preferences),
        ),
      ],
    );

void main() {
  setUp(() => SharedPreferences.setMockInitialValues({}));

  testWidgets('theme and language controls update live and survive restart',
      (tester) async {
    final preferences = await SharedPreferences.getInstance();
    final first = _container(preferences);
    await tester.pumpWidget(_app(first));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('profile.theme')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Dark').last);
    await tester.pumpAndSettle();
    expect(first.read(themeModeProvider), ThemeMode.dark);
    expect(
      Theme.of(tester.element(find.byType(ProfileDisplayPreferences)))
          .brightness,
      Brightness.dark,
    );

    await tester.tap(find.byKey(const Key('profile.language')));
    await tester.pumpAndSettle();
    await tester.tap(find.text('العربية').last);
    await tester.pumpAndSettle();
    expect(first.read(localeProvider), const Locale('ar'));
    expect(
      Directionality.of(
        tester.element(find.byType(ProfileDisplayPreferences)),
      ),
      TextDirection.rtl,
    );

    await tester.pumpWidget(const SizedBox.shrink());
    first.dispose();
    await preferences.reload();
    final restarted = _container(preferences);
    addTearDown(restarted.dispose);
    await tester.pumpWidget(_app(restarted));
    await tester.pumpAndSettle();
    expect(restarted.read(themeModeProvider), ThemeMode.dark);
    expect(restarted.read(localeProvider), const Locale('ar'));
    expect(
      Directionality.of(
        tester.element(find.byType(ProfileDisplayPreferences)),
      ),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'Urdu narrow layout supports returning both choices to the device',
      (tester) async {
    tester.view.physicalSize = const Size(320, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    SharedPreferences.setMockInitialValues({
      SharedPreferencesDisplaySettingsStore.localeKey: 'ur',
      SharedPreferencesDisplaySettingsStore.themeKey: 'dark',
    });
    final preferences = await SharedPreferences.getInstance();
    final container = _container(preferences);
    addTearDown(container.dispose);
    await tester.pumpWidget(_app(container));
    await tester.pumpAndSettle();
    final ur = AppLocalizations.of(
      tester.element(find.byType(ProfileDisplayPreferences)),
    );
    await tester.tap(find.byKey(const Key('profile.language')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(ur.profileDeviceSetting).last);
    await tester.pumpAndSettle();
    final device = AppLocalizations.of(
      tester.element(find.byType(ProfileDisplayPreferences)),
    );
    await tester.tap(find.byKey(const Key('profile.theme')));
    await tester.pumpAndSettle();
    await tester.tap(find.text(device.profileDeviceSetting).last);
    await tester.pumpAndSettle();
    await preferences.reload();
    expect(container.read(localeProvider), isNull);
    expect(container.read(themeModeProvider), ThemeMode.system);
    expect(
      preferences.containsKey(SharedPreferencesDisplaySettingsStore.localeKey),
      isFalse,
    );
    expect(tester.takeException(), isNull);
  });
}
