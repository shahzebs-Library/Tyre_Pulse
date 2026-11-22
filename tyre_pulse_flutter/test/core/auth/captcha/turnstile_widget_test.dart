import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_captcha.dart';
import 'package:tyre_pulse/core/auth/captcha/turnstile_widget.dart';

import 'fake_turnstile.dart';

final class _Harness {
  _Harness(this.factory, this.controller, this.tokens);
  final FakeTurnstileFactory factory;
  final TurnstileController controller;
  final List<String?> tokens;
}

Future<_Harness> _pump(
  WidgetTester tester, {
  Locale locale = const Locale('en'),
  double textScale = 1,
}) async {
  final FakeTurnstileFactory factory = FakeTurnstileFactory();
  final TurnstileController controller = TurnstileController();
  final List<String?> tokens = <String?>[];
  await tester.pumpWidget(
    MaterialApp(
      theme: TpTheme.light,
      locale: locale,
      supportedLocales: TpLocalizations.supportedLocales,
      localizationsDelegates: TpLocalizations.delegates,
      home: Scaffold(
        body: MediaQuery.withClampedTextScaling(
          minScaleFactor: textScale,
          maxScaleFactor: textScale,
          child: Center(
            child: SizedBox(
              width: 300,
              child: TurnstileCaptcha(
                siteKey: 'site-key',
                factory: factory,
                controller: controller,
                onTokenChanged: tokens.add,
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.pump();
  return _Harness(factory, controller, tokens);
}

String _status(WidgetTester tester) =>
    tester.widget<Text>(find.byKey(const Key('captcha.status'))).data!;

void main() {
  testWidgets('loads, prompts, and hands the token to the screen',
      (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    expect(h.factory.handles, hasLength(1));
    expect(h.factory.latest.siteKey, 'site-key');
    expect(_status(tester), 'Loading the security check...');

    h.factory.latest.emit(const TurnstileReady());
    await tester.pump();
    expect(_status(tester), 'Complete the security check to continue.');

    h.factory.latest.emit(const TurnstileToken('tok'));
    await tester.pump();
    expect(h.tokens, <String?>['tok']);
    expect(_status(tester), 'Security check complete.');
    expect(find.byKey(const Key('captcha.retry')), findsNothing);
    expect(find.bySemanticsLabel('Security check'), findsOneWidget);
  });

  testWidgets('reset after an attempt clears the token and re-arms the page',
      (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    h.factory.latest.emit(const TurnstileToken('tok'));
    await tester.pump();

    h.controller.reset();
    await tester.pump();

    expect(h.tokens, <String?>['tok', null]);
    expect(h.factory.latest.resets, 1);
    expect(h.factory.handles, hasLength(1));
    expect(_status(tester), 'Complete the security check to continue.');
  });

  testWidgets('expiry drops the token; Try again starts a fresh page',
      (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    h.factory.latest.emit(const TurnstileToken('tok'));
    await tester.pump();
    h.factory.latest.emit(const TurnstileExpired());
    await tester.pump();

    expect(h.tokens.last, isNull);
    expect(_status(tester), contains('expired'));
    await tester.tap(find.byKey(const Key('captcha.retry')));
    await tester.pump();
    expect(h.factory.handles, hasLength(2));
    expect(find.byKey(const Key('captcha.retry')), findsNothing);
  });

  testWidgets('a load failure offers Try again, which rebuilds the page',
      (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    h.factory.latest.emit(const TurnstileFailed('load'));
    await tester.pump();

    expect(_status(tester), contains('could not load'));
    final Finder retry = find.byKey(const Key('captcha.retry'));
    expect(tester.getSize(retry).height, greaterThanOrEqualTo(48));
    await tester.tap(retry);
    await tester.pump();

    expect(h.factory.handles, hasLength(2));
    expect(h.factory.handles.first.disposed, isTrue);
    expect(_status(tester), 'Loading the security check...');
    // An event from the discarded page is ignored.
    h.factory.handles.first.emit(const TurnstileToken('stale'));
    await tester.pump();
    expect(h.tokens, isEmpty);
  });

  testWidgets('nothing within the time limit reads as timed out',
      (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    await tester.pump(kTurnstileLoadTimeout + const Duration(seconds: 1));

    expect(_status(tester), contains('taking too long'));
    expect(find.byKey(const Key('captcha.retry')), findsOneWidget);
    expect(h.tokens, isEmpty);
  });

  testWidgets('a ready page cancels the timeout', (WidgetTester tester) async {
    final _Harness h = await _pump(tester);
    h.factory.latest.emit(const TurnstileReady());
    await tester.pump(kTurnstileLoadTimeout + const Duration(seconds: 1));
    expect(_status(tester), 'Complete the security check to continue.');
  });

  testWidgets('Arabic, right to left, text scale 2.0: no overflow',
      (WidgetTester tester) async {
    final _Harness h =
        await _pump(tester, locale: const Locale('ar'), textScale: 2);
    h.factory.latest.emit(const TurnstileFailed('load'));
    await tester.pump();
    expect(tester.takeException(), isNull);
    expect(
      Directionality.of(
        tester.element(find.byKey(const Key('captcha.status'))),
      ),
      TextDirection.rtl,
    );
    expect(find.byKey(const Key('captcha.retry')), findsOneWidget);
  });
}
