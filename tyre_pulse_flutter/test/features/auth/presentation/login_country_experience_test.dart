/// Non-golden regression coverage for the country-aware login presentation.
///
/// Kept separate from `login_screen_test.dart` and deliberately avoids
/// assertions about any informational PMV module strip that may be added to
/// the login page later. These tests protect only the stable contract:
/// remembered visual country, exact hero asset, shared login form,
/// first-launch/error behavior, responsive placement, and accessibility/RTL.
library;

import 'dart:async';
import 'dart:ui' show Tristate;

import 'package:flutter/material.dart';
import 'package:flutter/semantics.dart' show SemanticsNode;
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/auth/data/login_country_preference_repository.dart';
import 'package:tyre_pulse/features/auth/domain/login_country.dart';
import 'package:tyre_pulse/features/auth/presentation/login_country_preference_provider.dart';
import 'package:tyre_pulse/features/auth/presentation/login_screen.dart';
import 'package:tyre_pulse/features/auth/presentation/widgets/login_country_hero.dart';

final class _CountryCase {
  const _CountryCase({
    required this.country,
    required this.englishName,
    required this.assetPath,
  });

  final LoginCountry country;
  final String englishName;
  final String assetPath;
}

const List<_CountryCase> _countries = <_CountryCase>[
  _CountryCase(
    country: LoginCountry.saudiArabia,
    englishName: 'Saudi Arabia',
    assetPath: 'assets/login/figma_city_background.png',
  ),
  _CountryCase(
    country: LoginCountry.unitedArabEmirates,
    englishName: 'United Arab Emirates',
    assetPath: 'assets/login/united_arab_emirates_hero.png',
  ),
  _CountryCase(
    country: LoginCountry.egypt,
    englishName: 'Egypt',
    assetPath: 'assets/login/egypt_hero.png',
  ),
];

final class _CountryRepository implements LoginCountryPreferenceRepository {
  _CountryRepository({
    this.value,
    this.readGate,
    this.readError,
    this.saveError,
  });

  LoginCountry? value;
  final Completer<void>? readGate;
  final StateError? readError;
  final StateError? saveError;
  int saveCalls = 0;

  @override
  Future<void> clear() async => value = null;

  @override
  Future<LoginCountry?> read() async {
    await readGate?.future;
    if (readError case final StateError error) {
      throw error;
    }
    return value;
  }

  @override
  Future<void> save(LoginCountry country) async {
    saveCalls += 1;
    if (saveError case final StateError error) {
      throw error;
    }
    value = country;
  }
}

final class _PumpedLogin {
  const _PumpedLogin({
    required this.container,
    required this.repository,
  });

  final ProviderContainer container;
  final _CountryRepository repository;
}

Future<_PumpedLogin> _pumpLogin(
  WidgetTester tester, {
  required _CountryRepository repository,
  Locale locale = const Locale('en'),
  Size size = const Size(390, 844),
  bool settle = true,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.resetPhysicalSize);
  addTearDown(tester.view.resetDevicePixelRatio);

  final ProviderContainer container = ProviderContainer(
    overrides: <Override>[
      loginCountryPreferenceRepositoryProvider.overrideWithValue(repository),
    ],
  );
  addTearDown(container.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(
      container: container,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const LoginScreen(route: LoginRoute()),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
  }

  return _PumpedLogin(container: container, repository: repository);
}

Finder _heroAsset(String assetPath) => find.byKey(ValueKey<String>(assetPath));

void main() {
  group('remembered country identity', () {
    for (final _CountryCase countryCase in _countries) {
      testWidgets(
        '${countryCase.englishName} renders its exact compact hero and the '
        'shared login form',
        (WidgetTester tester) async {
          await _pumpLogin(
            tester,
            repository: _CountryRepository(value: countryCase.country),
          );

          final Finder hero = find.byKey(const Key('login.brand.panel'));
          final Finder form = find.byKey(const Key('login.form.card'));
          expect(hero, findsOneWidget);
          expect(form, findsOneWidget);
          expect(_heroAsset(countryCase.assetPath), findsOneWidget);
          expect(find.text(countryCase.englishName), findsOneWidget);
          expect(find.byType(TextField), findsNWidgets(2));
          expect(
            tester.getTopLeft(hero).dy,
            lessThan(tester.getTopLeft(form).dy),
          );

          final SemanticsNode heroSemantics = tester.getSemantics(
            find.byKey(LoginCountryKeys.hero),
          );
          expect(
            heroSemantics.label,
            contains('Selected country: ${countryCase.englishName}'),
          );
          expect(tester.takeException(), isNull);
        },
      );

      testWidgets(
        '${countryCase.englishName} keeps one hero and one form in the wide '
        'split layout',
        (WidgetTester tester) async {
          await _pumpLogin(
            tester,
            repository: _CountryRepository(value: countryCase.country),
            size: const Size(1100, 800),
          );

          final Finder hero = find.byKey(const Key('login.brand.panel'));
          final Finder form = find.byKey(const Key('login.form.card'));
          expect(hero, findsOneWidget);
          expect(form, findsOneWidget);
          expect(_heroAsset(countryCase.assetPath), findsOneWidget);
          expect(
            tester.getTopLeft(hero).dx,
            lessThan(tester.getTopLeft(form).dx),
          );
          expect(tester.takeException(), isNull);
        },
      );
    }
  });

  testWidgets(
    'country picker exposes all options as 48dp selectable semantics and '
    'announces the remembered selection',
    (WidgetTester tester) async {
      await _pumpLogin(
        tester,
        repository: _CountryRepository(value: LoginCountry.saudiArabia),
      );

      expect(
        tester.getSize(find.byKey(LoginCountryKeys.change)).height,
        greaterThanOrEqualTo(48),
      );
      await tester.tap(find.byKey(LoginCountryKeys.change));
      await tester.pumpAndSettle();

      expect(find.byKey(LoginCountryKeys.picker), findsOneWidget);
      expect(
        tester.getSemantics(find.byKey(LoginCountryKeys.picker)).label,
        contains('Country selector'),
      );

      for (final _CountryCase countryCase in _countries) {
        final Finder option = find.byKey(
          LoginCountryKeys.option(countryCase.country),
        );
        expect(option, findsOneWidget);
        expect(
          tester.getSize(option).height,
          greaterThanOrEqualTo(48),
        );

        final SemanticsNode optionSemantics = tester.getSemantics(option);
        expect(optionSemantics.label, contains(countryCase.englishName));
        expect(
          optionSemantics.flagsCollection.isSelected,
          countryCase.country == LoginCountry.saudiArabia
              ? Tristate.isTrue
              : Tristate.isFalse,
        );
        expect(optionSemantics.flagsCollection.isButton, isTrue);
      }
    },
  );

  testWidgets(
    'first launch opens the accessible country chooser and saves exactly one '
    'choice',
    (WidgetTester tester) async {
      final _CountryRepository repository = _CountryRepository();
      await _pumpLogin(tester, repository: repository);

      expect(find.byKey(LoginCountryKeys.picker), findsOneWidget);
      expect(repository.saveCalls, 0);

      await tester.tap(
        find.byKey(LoginCountryKeys.option(LoginCountry.egypt)),
      );
      await tester.pumpAndSettle();

      expect(repository.saveCalls, 1);
      expect(repository.value, LoginCountry.egypt);
      expect(find.byKey(LoginCountryKeys.picker), findsNothing);
      expect(_heroAsset('assets/login/egypt_hero.png'), findsOneWidget);
    },
  );

  testWidgets(
    'loading preference keeps login usable and switches from the neutral '
    'fallback only after the saved country resolves',
    (WidgetTester tester) async {
      final Completer<void> readGate = Completer<void>();
      final _CountryRepository repository = _CountryRepository(
        value: LoginCountry.egypt,
        readGate: readGate,
      );
      await _pumpLogin(
        tester,
        repository: repository,
        settle: false,
      );

      expect(
        _heroAsset('assets/login/figma_city_background.png'),
        findsOneWidget,
      );
      expect(find.byKey(LoginCountryKeys.picker), findsNothing);
      expect(find.byType(TextField), findsNWidgets(2));

      readGate.complete();
      await tester.pumpAndSettle();

      expect(_heroAsset('assets/login/egypt_hero.png'), findsOneWidget);
      expect(
        _heroAsset('assets/login/figma_city_background.png'),
        findsNothing,
      );
      expect(find.byKey(LoginCountryKeys.picker), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'preference read failure is explained once and never opens the '
    'first-launch picker',
    (WidgetTester tester) async {
      await _pumpLogin(
        tester,
        repository: _CountryRepository(
          readError: StateError('preferences unreadable'),
        ),
        settle: false,
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(find.byType(SnackBar), findsOneWidget);
      expect(
        find.text('The last action did not finish. Nothing was changed.'),
        findsOneWidget,
      );
      expect(find.byKey(LoginCountryKeys.picker), findsNothing);
      expect(
        _heroAsset('assets/login/figma_city_background.png'),
        findsOneWidget,
      );
      expect(find.byType(TextField), findsNWidgets(2));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'failed country save keeps the previous hero and explains the failure',
    (WidgetTester tester) async {
      final _CountryRepository repository = _CountryRepository(
        value: LoginCountry.egypt,
        saveError: StateError('preferences unwritable'),
      );
      await _pumpLogin(tester, repository: repository);

      await tester.tap(find.byKey(LoginCountryKeys.change));
      await tester.pumpAndSettle();
      await tester.tap(
        find.byKey(
          LoginCountryKeys.option(LoginCountry.unitedArabEmirates),
        ),
      );
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));

      expect(repository.saveCalls, 1);
      expect(repository.value, LoginCountry.egypt);
      expect(_heroAsset('assets/login/egypt_hero.png'), findsOneWidget);
      expect(
        _heroAsset('assets/login/united_arab_emirates_hero.png'),
        findsNothing,
      );
      expect(find.byType(SnackBar), findsOneWidget);
      expect(
        find.text('The last action did not finish. Nothing was changed.'),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'wide Urdu reverses the split layout and localizes country hero and '
    'picker semantics without changing the selected visual asset',
    (WidgetTester tester) async {
      await _pumpLogin(
        tester,
        repository: _CountryRepository(value: LoginCountry.egypt),
        locale: const Locale('ur'),
        size: const Size(1100, 800),
      );

      final Finder hero = find.byKey(const Key('login.brand.panel'));
      final Finder form = find.byKey(const Key('login.form.card'));
      expect(Directionality.of(tester.element(hero)), TextDirection.rtl);
      expect(Directionality.of(tester.element(form)), TextDirection.rtl);
      expect(
        tester.getTopLeft(hero).dx,
        greaterThan(tester.getTopLeft(form).dx),
      );
      expect(find.text('مصر'), findsWidgets);
      expect(_heroAsset('assets/login/egypt_hero.png'), findsOneWidget);
      expect(
        tester.getSemantics(find.byKey(LoginCountryKeys.hero)).label,
        contains('منتخب ملک: مصر'),
      );

      await tester.tap(find.byKey(LoginCountryKeys.change));
      await tester.pumpAndSettle();

      final Finder picker = find.byKey(LoginCountryKeys.picker);
      expect(Directionality.of(tester.element(picker)), TextDirection.rtl);
      expect(tester.getSemantics(picker).label, contains('ملک کا انتخاب'));
      expect(find.text('سعودی عرب'), findsOneWidget);
      expect(find.text('متحدہ عرب امارات'), findsOneWidget);
      expect(find.text('مصر'), findsWidgets);
      expect(tester.takeException(), isNull);
    },
  );
}
