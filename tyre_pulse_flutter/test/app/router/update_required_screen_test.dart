// The update-required gate on each platform. Every button is real: with no
// store action there is no store button, and on an iPhone the message then
// says where the update comes from instead of leaving the user stuck.

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

const String _genericMessage =
    'This version of Tyre Pulse is too old to keep using. '
    'Install the update to carry on.';
const String _appStoreMessage =
    'This version of Tyre Pulse is too old to keep using. '
    'Update Tyre Pulse from the App Store to carry on.';

Future<void> _pump(
  WidgetTester tester,
  TpShellGateActions actions, {
  Locale? locale,
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [shellGateActionsProvider.overrideWithValue(actions)],
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: const TpUpdateRequiredScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('iPhone with no store link: no store button, App Store wording',
      (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      await _pump(tester, TpShellGateActions(onSignOut: () {}));

      expect(find.text('Open the store'), findsNothing);
      expect(find.text(_appStoreMessage), findsOneWidget);
      expect(find.text('Sign out'), findsOneWidget);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('iPhone with a store link: the button is offered and works',
      (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
    try {
      int opened = 0;
      await _pump(tester, TpShellGateActions(onOpenStore: () => opened++));

      expect(find.text(_genericMessage), findsOneWidget);
      await tester.tap(find.text('Open the store'));
      await tester.pump();
      expect(opened, 1);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  testWidgets('Android keeps the generic wording, with or without a button',
      (WidgetTester tester) async {
    debugDefaultTargetPlatformOverride = TargetPlatform.android;
    try {
      await _pump(tester, const TpShellGateActions());

      expect(find.text(_genericMessage), findsOneWidget);
      expect(find.text(_appStoreMessage), findsNothing);
      expect(find.text('Open the store'), findsNothing);
    } finally {
      debugDefaultTargetPlatformOverride = null;
    }
  });

  for (final String code in const <String>['en', 'ar', 'ur']) {
    for (final double scale in const <double>[1, 2]) {
      testWidgets(
          'iPhone with no store link fits 360x640 in $code at text scale '
          '$scale', (WidgetTester tester) async {
        tester.view.physicalSize = const Size(360, 640);
        tester.view.devicePixelRatio = 1;
        tester.platformDispatcher.textScaleFactorTestValue = scale;
        addTearDown(tester.view.resetPhysicalSize);
        addTearDown(tester.view.resetDevicePixelRatio);
        addTearDown(tester.platformDispatcher.clearTextScaleFactorTestValue);
        debugDefaultTargetPlatformOverride = TargetPlatform.iOS;
        try {
          await _pump(
            tester,
            TpShellGateActions(onSignOut: () {}),
            locale: Locale(code),
          );

          expect(tester.takeException(), isNull);
          expect(
            Directionality.of(
              tester.element(find.byType(TpUpdateRequiredScreen)),
            ),
            code == 'en' ? TextDirection.ltr : TextDirection.rtl,
          );
        } finally {
          debugDefaultTargetPlatformOverride = null;
        }
      });
    }
  }
}
