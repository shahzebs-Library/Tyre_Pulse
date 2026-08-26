/// The application's localisation surface.
///
/// Spec section 51: English, Arabic and Urdu, with every user-facing string
/// coming from an ARB file. Spec section 52: Arabic and Urdu are true
/// right-to-left.
///
/// EVERY feature imports this file, never the generated one. The generated
/// output path has moved between Flutter releases (synthetic `flutter_gen`
/// package, then `lib/l10n/generated`). One re-export here means that move
/// costs one line instead of a change in every screen.
library;

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:tyre_pulse/l10n/generated/app_localizations.dart';

export 'package:tyre_pulse/l10n/generated/app_localizations.dart'
    show AppLocalizations;

/// Locale wiring for `MaterialApp.router`.
abstract final class TpLocalizations {
  /// The three languages the product ships. Adding a fourth means adding an
  /// ARB file and an entry here, and nothing else.
  static const List<Locale> supportedLocales = <Locale>[
    Locale('en'),
    Locale('ar'),
    Locale('ur'),
  ];

  /// The delegates `MaterialApp.router` needs.
  ///
  /// The three `Global*Localizations` delegates are what translate Material's
  /// own strings and, more importantly, what give Arabic and Urdu their
  /// right-to-left text direction. Omitting them leaves an Arabic app laid out
  /// left to right with English date formats, which is the usual way RTL
  /// support is half-shipped.
  static const List<LocalizationsDelegate<Object>> delegates =
      <LocalizationsDelegate<Object>>[
        AppLocalizations.delegate,
        GlobalMaterialLocalizations.delegate,
        GlobalWidgetsLocalizations.delegate,
        GlobalCupertinoLocalizations.delegate,
      ];

  /// The languages written right to left.
  ///
  /// Ported from `isRtlLang` in the production app, which is
  /// `lang === 'ar' || lang === 'ur'`.
  static const Set<String> rtlLanguageCodes = <String>{'ar', 'ur'};

  /// Whether [locale] is written right to left.
  static bool isRtl(Locale locale) =>
      rtlLanguageCodes.contains(locale.languageCode);

  /// The text direction for [locale].
  static TextDirection directionOf(Locale locale) =>
      isRtl(locale) ? TextDirection.rtl : TextDirection.ltr;

  /// Resolves a device locale against [supportedLocales].
  ///
  /// Falls back to English rather than to the first supported locale, so a
  /// device set to a language the app does not carry gets a language most
  /// users of this fleet can read, not whichever locale happened to be listed
  /// first.
  static Locale resolve(Locale? deviceLocale, Iterable<Locale> supported) {
    if (deviceLocale == null) return const Locale('en');
    for (final Locale candidate in supported) {
      if (candidate.languageCode == deviceLocale.languageCode) return candidate;
    }
    return const Locale('en');
  }
}
