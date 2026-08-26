/// Tests for [TpLocalizations], the locale wiring for `MaterialApp.router`.
///
/// Spec section 51: English, Arabic and Urdu, every string from an ARB file.
/// Spec section 52: Arabic and Urdu are true right-to-left. The three
/// `Global*Localizations` delegates are what make the RTL claim true, not
/// merely documented, so the widget test group below builds a real
/// `MaterialApp` with [TpLocalizations.delegates] wired in and checks the
/// ambient [Directionality] the framework actually produces from it, and
/// cross-checks a translated string against the committed ARB file for that
/// locale.
library;

import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';

/// Locates an ARB file the same defensive way
/// `module_registry_drift_test.dart` locates its cross-package reference
/// file: `flutter test` runs with the package root as the working
/// directory (see `.github/workflows/flutter-ci.yml`), so the file is
/// normally under `lib/l10n/` directly. The second candidate covers a
/// repository-root working directory instead.
File _locateArbFile(String fileName) {
  for (final String relative in <String>[
    'lib${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
    'tyre_pulse_flutter${Platform.pathSeparator}lib'
        '${Platform.pathSeparator}l10n${Platform.pathSeparator}$fileName',
  ]) {
    final File file = File(relative);
    if (file.existsSync()) {
      return file;
    }
  }
  fail(
    'Could not find lib/l10n/$fileName from the working directory '
    '${Directory.current.path}.',
  );
}

/// Reads one translatable value straight out of the committed ARB source.
String _arbValue(String fileName, String key) {
  final Map<String, dynamic> arb = jsonDecode(
    _locateArbFile(fileName).readAsStringSync(),
  ) as Map<String, dynamic>;
  return arb[key] as String;
}

void main() {
  group('supportedLocales', () {
    test('is exactly English, Arabic and Urdu, in that order', () {
      expect(TpLocalizations.supportedLocales, const <Locale>[
        Locale('en'),
        Locale('ar'),
        Locale('ur'),
      ]);
    });

    test('carries no more and no fewer than three locales', () {
      expect(TpLocalizations.supportedLocales.length, 3);
    });
  });

  group('delegates', () {
    test('carries AppLocalizations.delegate plus the three global ones', () {
      expect(TpLocalizations.delegates.length, 4);
      expect(
        TpLocalizations.delegates,
        containsAll(const <LocalizationsDelegate<Object>>[
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ]),
      );
    });

    test('AppLocalizations.delegate is the first entry', () {
      // Not load-bearing for correctness, but a deliberate, readable order:
      // the app's own strings before Material/Widgets/Cupertino's.
      expect(TpLocalizations.delegates.first, AppLocalizations.delegate);
    });
  });

  group('isRtl and directionOf', () {
    test('Arabic and Urdu are right to left', () {
      expect(TpLocalizations.isRtl(const Locale('ar')), isTrue);
      expect(TpLocalizations.isRtl(const Locale('ur')), isTrue);
      expect(
        TpLocalizations.directionOf(const Locale('ar')),
        TextDirection.rtl,
      );
      expect(
        TpLocalizations.directionOf(const Locale('ur')),
        TextDirection.rtl,
      );
    });

    test('English is left to right', () {
      expect(TpLocalizations.isRtl(const Locale('en')), isFalse);
      expect(
        TpLocalizations.directionOf(const Locale('en')),
        TextDirection.ltr,
      );
    });

    test('a locale the app does not ship is left to right, not a crash', () {
      expect(TpLocalizations.isRtl(const Locale('fr')), isFalse);
      expect(
        TpLocalizations.directionOf(const Locale('fr')),
        TextDirection.ltr,
      );
    });

    test('a country subtag does not change the direction', () {
      // rtlLanguageCodes is compared on languageCode alone.
      expect(TpLocalizations.isRtl(const Locale('ar', 'SA')), isTrue);
      expect(TpLocalizations.isRtl(const Locale('en', 'US')), isFalse);
    });
  });

  group('resolve', () {
    test('a null device locale resolves to English', () {
      expect(
        TpLocalizations.resolve(null, TpLocalizations.supportedLocales),
        const Locale('en'),
      );
    });

    test('an exact match resolves to that supported locale', () {
      expect(
        TpLocalizations.resolve(
          const Locale('ar'),
          TpLocalizations.supportedLocales,
        ),
        const Locale('ar'),
      );
    });

    test('a device locale with a country subtag matches on language alone', () {
      // The device might report ar_SA; the app only ships bare ar, and
      // resolve must hand back the SUPPORTED candidate, not the device
      // locale verbatim.
      final Locale resolved = TpLocalizations.resolve(
        const Locale('ar', 'SA'),
        TpLocalizations.supportedLocales,
      );
      expect(resolved, const Locale('ar'));
      expect(resolved.countryCode, isNull);
    });

    test('an unsupported device locale falls back to English', () {
      expect(
        TpLocalizations.resolve(
          const Locale('fr'),
          TpLocalizations.supportedLocales,
        ),
        const Locale('en'),
      );
    });

    test('the fallback is hard-coded English, not "supported.first"', () {
      // If this instead fell back to the first supported locale, a caller
      // whose supported list happens to start with something other than
      // English would silently get the wrong fallback language. Neither
      // locale in this custom list is English.
      final Locale resolved = TpLocalizations.resolve(
        const Locale('zz'),
        const <Locale>[Locale('fr'), Locale('de')],
      );
      expect(resolved, const Locale('en'));
      expect(resolved, isNot(const Locale('fr')));
    });

    test('an empty supported list still falls back to English', () {
      expect(
        TpLocalizations.resolve(const Locale('ar'), const <Locale>[]),
        const Locale('en'),
      );
    });
  });

  group('building a real app with these delegates', () {
    const Map<Locale, String> arbFileByLocale = <Locale, String>{
      Locale('en'): 'app_en.arb',
      Locale('ar'): 'app_ar.arb',
      Locale('ur'): 'app_ur.arb',
    };

    for (final Locale locale in TpLocalizations.supportedLocales) {
      testWidgets('resolves locale ${locale.languageCode} correctly', (
        WidgetTester tester,
      ) async {
        late TextDirection ambientDirection;
        late Locale resolvedLocale;
        late String tabHome;

        await tester.pumpWidget(
          MaterialApp(
            locale: locale,
            supportedLocales: TpLocalizations.supportedLocales,
            localizationsDelegates: TpLocalizations.delegates,
            home: Builder(
              builder: (BuildContext context) {
                ambientDirection = Directionality.of(context);
                resolvedLocale = Localizations.localeOf(context);
                tabHome = AppLocalizations.of(context).tabHome;
                return const SizedBox.shrink();
              },
            ),
          ),
        );
        await tester.pumpAndSettle();

        expect(tester.takeException(), isNull);
        expect(resolvedLocale.languageCode, locale.languageCode);
        // This is the behaviour the doc comment on tp_localizations.dart
        // names directly: omitting the Global*Localizations delegates
        // leaves an Arabic app laid out left to right.
        expect(ambientDirection, TpLocalizations.directionOf(locale));
        // Cross-checked against the committed ARB file for this locale,
        // not a value transcribed by hand, so a translation that silently
        // stopped being wired would be caught here.
        expect(
          tabHome,
          _arbValue(arbFileByLocale[locale]!, 'tabHome'),
          reason:
              'wrong locale content resolved for '
              '${locale.languageCode}',
        );
      });
    }
  });
}
