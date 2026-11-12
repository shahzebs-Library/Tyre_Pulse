/// The multi-factor gate screen: six digits, a real Verify, a clear message
/// on a wrong code, and a way out.
library;

import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/mfa_gate.dart';
import 'package:tyre_pulse/app/router/shell_gates.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

Future<void> pumpGate(
  WidgetTester tester, {
  required TpShellGateActions actions,
  Locale locale = const Locale('en'),
  Size size = const Size(390, 844),
  double textScale = 1,
}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        shellGateActionsProvider.overrideWith((Ref ref) => actions),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        theme: TpTheme.light,
        builder: (BuildContext context, Widget? child) => MediaQuery(
          data: MediaQuery.of(context)
              .copyWith(textScaler: TextScaler.linear(textScale)),
          child: child!,
        ),
        home: const TpMfaRequiredScreen(),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  testWidgets('shows the challenge with a code field, Verify and Sign out', (
    WidgetTester tester,
  ) async {
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onSignOut: () {},
        onVerifyMfa: (String code) async => TpMfaVerifyResult.verified,
      ),
    );

    expect(find.text('Two-step verification'), findsOneWidget);
    expect(find.byKey(TpMfaGateKeys.code), findsOneWidget);
    expect(find.byKey(TpMfaGateKeys.verify), findsOneWidget);
    expect(find.byKey(TpMfaGateKeys.signOut), findsOneWidget);
  });

  testWidgets('a control with nothing behind it is not rendered', (
    WidgetTester tester,
  ) async {
    await pumpGate(tester, actions: const TpShellGateActions());

    expect(find.byKey(TpMfaGateKeys.verify), findsNothing);
    expect(find.byKey(TpMfaGateKeys.signOut), findsNothing);
  });

  testWidgets('an incomplete code is refused locally', (
    WidgetTester tester,
  ) async {
    final List<String> sent = <String>[];
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onVerifyMfa: (String code) async {
          sent.add(code);
          return TpMfaVerifyResult.verified;
        },
      ),
    );

    await tester.enterText(find.byType(TextField), '123');
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pumpAndSettle();

    expect(sent, isEmpty);
    expect(find.text('Enter all 6 digits of the code.'), findsOneWidget);
  });

  testWidgets('only digits are kept, capped at six', (
    WidgetTester tester,
  ) async {
    final List<String> sent = <String>[];
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onVerifyMfa: (String code) async {
          sent.add(code);
          return TpMfaVerifyResult.verified;
        },
      ),
    );

    await tester.enterText(find.byType(TextField), '12a3 4569');
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pump();

    expect(sent, <String>['123456']);
  });

  testWidgets('a wrong code says so, clears the field and can be retried', (
    WidgetTester tester,
  ) async {
    final List<String> sent = <String>[];
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onVerifyMfa: (String code) async {
          sent.add(code);
          return TpMfaVerifyResult.rejected;
        },
      ),
    );

    await tester.enterText(find.byType(TextField), '111111');
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pumpAndSettle();

    expect(
      find.text(
        'That code was not accepted. Check your authenticator app and try '
        'again.',
      ),
      findsOneWidget,
    );
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      isEmpty,
    );

    // Typing again clears the message; the next attempt is sent.
    await tester.enterText(find.byType(TextField), '222222');
    await tester.pump();
    expect(find.textContaining('was not accepted'), findsNothing);
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pumpAndSettle();
    expect(sent, <String>['111111', '222222']);
  });

  testWidgets('a failed check keeps the code and says it could not be checked',
      (WidgetTester tester) async {
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onVerifyMfa: (String code) async => throw StateError('offline'),
      ),
    );

    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pumpAndSettle();

    expect(find.textContaining('could not be checked'), findsOneWidget);
    expect(
      tester.widget<TextField>(find.byType(TextField)).controller!.text,
      '123456',
    );
  });

  testWidgets('a second tap while verifying does not send the code twice', (
    WidgetTester tester,
  ) async {
    final Completer<TpMfaVerifyResult> pending = Completer<TpMfaVerifyResult>();
    int calls = 0;
    await pumpGate(
      tester,
      actions: TpShellGateActions(
        onSignOut: () {},
        onVerifyMfa: (String code) {
          calls++;
          return pending.future;
        },
      ),
    );

    await tester.enterText(find.byType(TextField), '123456');
    await tester.tap(find.byKey(TpMfaGateKeys.verify));
    await tester.pump();
    await tester.tap(find.byKey(TpMfaGateKeys.verify), warnIfMissed: false);
    await tester.pump();

    expect(calls, 1);
    pending.complete(TpMfaVerifyResult.rejected);
    await tester.pumpAndSettle();
  });

  testWidgets('Sign out calls the real action', (WidgetTester tester) async {
    int signOuts = 0;
    await pumpGate(
      tester,
      actions: TpShellGateActions(onSignOut: () => signOuts++),
    );

    await tester.tap(find.byKey(TpMfaGateKeys.signOut));
    expect(signOuts, 1);
  });

  for (final Locale locale in const <Locale>[
    Locale('en'),
    Locale('ar'),
    Locale('ur'),
  ]) {
    testWidgets(
        'fits a small phone at 2x text without overflow '
        '(${locale.languageCode})', (WidgetTester tester) async {
      await pumpGate(
        tester,
        locale: locale,
        size: const Size(320, 568),
        textScale: 2,
        actions: TpShellGateActions(
          onSignOut: () {},
          onVerifyMfa: (String code) async => TpMfaVerifyResult.rejected,
        ),
      );
      expect(tester.takeException(), isNull);

      await tester.enterText(find.byType(TextField), '123456');
      await tester.tap(find.byKey(TpMfaGateKeys.verify));
      await tester.pumpAndSettle();
      expect(tester.takeException(), isNull);
    });
  }
}
