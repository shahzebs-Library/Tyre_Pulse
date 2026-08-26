/// Shared harness for the design system widget tests.
///
/// Every test in `test/core/design_system/` renders its widget inside a real
/// [MaterialApp], themed with [TpTheme.light] and localised the same way the
/// production app wires a screen (see `lib/main.dart`). A bare
/// [Directionality] wrap is not enough for anything that reads
/// `AppLocalizations.of(context)` - several widgets in this design system do
/// - so the harness always installs the same locale delegates the app
/// installs, matching the pattern already used by
/// `test/app/router/app_router_test.dart`.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

/// Builds the [MaterialApp] shell every test renders inside.
///
/// [home] becomes the app's `home`. A widget meant to sit inside a
/// `Scaffold` body should be wrapped by the caller - see [pumpTp] for that
/// common case. A widget that is itself a page frame ([TpScaffold]), or a
/// control meant to sit in `Scaffold.appBar`, is passed directly as [home]
/// so the test can build its own surrounding `Scaffold`.
Widget tpApp({
  required Widget home,
  Locale locale = const Locale('en'),
}) {
  return MaterialApp(
    debugShowCheckedModeBanner: false,
    theme: TpTheme.light,
    locale: locale,
    supportedLocales: TpLocalizations.supportedLocales,
    localizationsDelegates: TpLocalizations.delegates,
    home: home,
  );
}

/// Pumps [body] inside a themed, localised [MaterialApp] with a plain
/// [Scaffold] around it.
///
/// This is the common case: every design system widget that is not itself a
/// page frame is exercised this way.
Future<void> pumpTp(
  WidgetTester tester,
  Widget body, {
  Locale locale = const Locale('en'),
}) {
  return tester.pumpWidget(
    tpApp(home: Scaffold(body: body), locale: locale),
  );
}

/// [pumpTp] under Arabic - a real right-to-left locale, not a manufactured
/// one.
///
/// Spec section 52: Arabic and Urdu are true right-to-left, and several
/// behaviours in this design system - the app bar chevron, an identifier's
/// bidirectional isolate - are driven by the ambient [Locale] rather than by
/// a bare [Directionality] wrap, so only installing a real locale exercises
/// them.
Future<void> pumpTpRtl(WidgetTester tester, Widget body) {
  return pumpTp(tester, body, locale: const Locale('ar'));
}
