/// Tests for [TpScaffold].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

/// [TpScaffold] is itself a page frame, so its tests pass it straight to
/// [tpApp] as `home` rather than nesting it inside another [Scaffold] the
/// way [pumpTp] would.
Future<void> _pumpScaffold(
  WidgetTester tester,
  TpScaffold scaffold, {
  Locale locale = const Locale('en'),
}) {
  return tester.pumpWidget(tpApp(home: scaffold, locale: locale));
}

void main() {
  testWidgets('renders its body', (WidgetTester tester) async {
    await _pumpScaffold(
      tester,
      const TpScaffold(body: Center(child: Text('body content'))),
    );

    expect(find.text('body content'), findsOneWidget);
  });

  testWidgets('renders an app bar when supplied', (WidgetTester tester) async {
    await _pumpScaffold(
      tester,
      TpScaffold(
        appBar: AppBar(title: const Text('Tyre Records')),
        body: const Center(child: Text('body content')),
      ),
    );

    expect(find.text('Tyre Records'), findsOneWidget);
    expect(find.byType(AppBar), findsOneWidget);
  });

  group('the banner', () {
    testWidgets('sits above the body, not inside it', (
      WidgetTester tester,
    ) async {
      await _pumpScaffold(
        tester,
        const TpScaffold(banner: Text('banner'), body: Text('body content')),
      );

      final double bannerTop = tester.getTopLeft(find.text('banner')).dy;
      final double bodyTop = tester.getTopLeft(find.text('body content')).dy;
      expect(bannerTop, lessThan(bodyTop));
    });

    testWidgets('is absent when not supplied', (WidgetTester tester) async {
      await _pumpScaffold(tester, const TpScaffold(body: Text('body content')));

      expect(find.text('banner'), findsNothing);
    });
  });

  group('backFallback controls whether a system Back is intercepted', () {
    testWidgets('null, the default, installs no PopScope', (
      WidgetTester tester,
    ) async {
      await _pumpScaffold(tester, const TpScaffold(body: Text('body content')));

      expect(find.byType(PopScope<Object?>), findsNothing);
    });

    testWidgets('a real fallback installs a PopScope', (
      WidgetTester tester,
    ) async {
      await _pumpScaffold(
        tester,
        const TpScaffold(body: Text('body content'), backFallback: '/home'),
      );

      expect(find.byType(PopScope<Object?>), findsOneWidget);
    });
  });

  testWidgets('resizeToAvoidBottomInset passes through', (
    WidgetTester tester,
  ) async {
    await _pumpScaffold(
      tester,
      const TpScaffold(
        body: Text('body content'),
        resizeToAvoidBottomInset: false,
      ),
    );

    final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
    expect(scaffold.resizeToAvoidBottomInset, isFalse);
  });

  group('backgroundColor', () {
    testWidgets('a supplied colour replaces the palette background', (
      WidgetTester tester,
    ) async {
      await _pumpScaffold(
        tester,
        const TpScaffold(
          body: Text('body content'),
          backgroundColor: Colors.red,
        ),
      );

      final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, Colors.red);
    });

    testWidgets('the default comes from the palette', (
      WidgetTester tester,
    ) async {
      await _pumpScaffold(tester, const TpScaffold(body: Text('body content')));

      final Scaffold scaffold = tester.widget<Scaffold>(find.byType(Scaffold));
      expect(scaffold.backgroundColor, TpPalette.light.background);
    });
  });

  testWidgets('a floating action button renders', (WidgetTester tester) async {
    await _pumpScaffold(
      tester,
      TpScaffold(
        body: const Text('body content'),
        floatingActionButton: FloatingActionButton(
          onPressed: () {},
          child: const Icon(Icons.add),
        ),
      ),
    );

    expect(find.byType(FloatingActionButton), findsOneWidget);
  });

  testWidgets('a bottom navigation bar renders', (WidgetTester tester) async {
    await _pumpScaffold(
      tester,
      const TpScaffold(
        body: Text('body content'),
        bottomNavigationBar: BottomAppBar(child: SizedBox(height: 40)),
      ),
    );

    expect(find.byType(BottomAppBar), findsOneWidget);
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await _pumpScaffold(
      tester,
      const TpScaffold(body: Text('body content')),
      locale: const Locale('ar'),
    );

    expect(find.text('body content'), findsOneWidget);
  });
}
