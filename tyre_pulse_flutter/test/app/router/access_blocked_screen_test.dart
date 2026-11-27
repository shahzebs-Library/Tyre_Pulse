// The not-active gate a self-registered person waits on. It re-checks: a
// "Check again" button and every return to the app re-read the profile, so an
// account approved meanwhile goes straight in without restarting the app.

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

Future<void> _pump(WidgetTester tester, TpShellGateActions actions) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [shellGateActionsProvider.overrideWithValue(actions)],
      child: MaterialApp(
        theme: TpTheme.light,
        localizationsDelegates: TpLocalizations.delegates,
        supportedLocales: TpLocalizations.supportedLocales,
        home: const TpAccessBlockedScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('Check again re-reads the account and says it is still waiting',
      (WidgetTester tester) async {
    int checks = 0;
    int signOuts = 0;
    await _pump(
      tester,
      TpShellGateActions(
        onRecheckAccess: () async => checks++,
        onSignOut: () => signOuts++,
      ),
    );

    expect(find.text('Your account is not active'), findsOneWidget);
    await tester.tap(find.text('Check again'));
    await tester.pumpAndSettle();
    expect(checks, 1);
    expect(
      find.text(
        'Your account is still not active. Ask your administrator to '
        'approve it.',
      ),
      findsOneWidget,
    );

    await tester.tap(find.text('Sign out'));
    expect(signOuts, 1);
  });

  testWidgets('returning to the app re-checks without a message',
      (WidgetTester tester) async {
    int checks = 0;
    await _pump(
      tester,
      TpShellGateActions(onRecheckAccess: () async => checks++),
    );

    tester.binding
      ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
      ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
      ..handleAppLifecycleStateChanged(AppLifecycleState.paused);
    await tester.pump();
    tester.binding
      ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
      ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
      ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
    await tester.pumpAndSettle();

    expect(checks, 1);
    expect(find.byType(SnackBar), findsNothing);
  });

  testWidgets('without a re-check action Sign out stays the only button',
      (WidgetTester tester) async {
    await _pump(tester, TpShellGateActions(onSignOut: () {}));
    expect(find.text('Check again'), findsNothing);
    expect(find.text('Sign out'), findsOneWidget);
  });
}
