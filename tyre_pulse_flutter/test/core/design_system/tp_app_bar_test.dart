/// Tests for [TpAppBar].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

/// [TpAppBar] is a `PreferredSizeWidget` meant for `Scaffold.appBar`, not for
/// a plain body - so, unlike most of this design system, its tests build
/// their own [Scaffold] around it rather than using [pumpTp].
Future<void> _pumpAppBar(
  WidgetTester tester,
  TpAppBar appBar, {
  Locale locale = const Locale('en'),
}) {
  return tester.pumpWidget(
    tpApp(
      home: Scaffold(appBar: appBar, body: const SizedBox()),
      locale: locale,
    ),
  );
}

void main() {
  testWidgets('the title renders', (WidgetTester tester) async {
    await _pumpAppBar(tester, const TpAppBar(title: 'Tyre Records'));

    expect(find.text('Tyre Records'), findsOneWidget);
  });

  group('the subtitle', () {
    testWidgets('renders as a second line when supplied', (
      WidgetTester tester,
    ) async {
      await _pumpAppBar(
        tester,
        const TpAppBar(title: 'Tyre Records', subtitle: 'TM514'),
      );

      expect(find.text('Tyre Records'), findsOneWidget);
      expect(find.text('TM514'), findsOneWidget);
    });

    testWidgets('when omitted, no subtitle text renders at all', (
      WidgetTester tester,
    ) async {
      await _pumpAppBar(
        tester,
        const TpAppBar(title: 'Tyre Records', subtitle: 'TM514'),
      );
      expect(find.text('TM514'), findsOneWidget);

      await _pumpAppBar(tester, const TpAppBar(title: 'Tyre Records'));
      expect(find.text('TM514'), findsNothing);
    });
  });

  group('showBack', () {
    testWidgets('true, the default, renders a leading Back control', (
      WidgetTester tester,
    ) async {
      await _pumpAppBar(tester, const TpAppBar(title: 'Tyre Records'));

      expect(find.byIcon(Icons.arrow_back_ios_new_rounded), findsOneWidget);
    });

    testWidgets('false renders no leading control at all', (
      WidgetTester tester,
    ) async {
      await _pumpAppBar(
        tester,
        const TpAppBar(title: 'Tyre Records', showBack: false),
      );

      expect(find.byIcon(Icons.arrow_back_ios_new_rounded), findsNothing);
      expect(find.byIcon(Icons.arrow_forward_ios_rounded), findsNothing);
      final AppBar bar = tester.widget<AppBar>(find.byType(AppBar));
      expect(bar.leading, isNull);
    });
  });

  group('under right-to-left', () {
    // arrow_back_ios_new_rounded sets matchTextDirection, so Flutter mirrors
    // it by itself under RTL. The widget must NOT also swap the glyph: doing
    // both cancels out and points Back the wrong way in Arabic and Urdu.
    testWidgets(
        'an Arabic locale keeps the plain back glyph, mirrored by '
        'Flutter', (WidgetTester tester) async {
      await _pumpAppBar(
        tester,
        const TpAppBar(title: 'Tyre Records'),
        locale: const Locale('ar'),
      );

      final Finder icon = find.byIcon(Icons.arrow_back_ios_new_rounded);
      expect(icon, findsOneWidget);
      expect(find.byIcon(Icons.arrow_forward_ios_rounded), findsNothing);
      expect(Icons.arrow_back_ios_new_rounded.matchTextDirection, isTrue);
      expect(Directionality.of(tester.element(icon)), TextDirection.rtl);
    });

    testWidgets('an explicit rtl Directionality does not hand-flip the glyph',
        (WidgetTester tester) async {
      await tester.pumpWidget(
        tpApp(
          home: const Directionality(
            textDirection: TextDirection.rtl,
            child: Scaffold(
              appBar: TpAppBar(title: 'Tyre Records'),
              body: SizedBox(),
            ),
          ),
        ),
      );

      final Finder icon = find.byIcon(Icons.arrow_back_ios_new_rounded);
      expect(icon, findsOneWidget);
      expect(find.byIcon(Icons.arrow_forward_ios_rounded), findsNothing);
      expect(Directionality.of(tester.element(icon)), TextDirection.rtl);
    });
  });

  group('the Back control', () {
    testWidgets('onBack, when supplied, is called on tap', (
      WidgetTester tester,
    ) async {
      int taps = 0;
      await _pumpAppBar(
        tester,
        TpAppBar(title: 'Tyre Records', onBack: () => taps++),
      );

      await tester.tap(find.byIcon(Icons.arrow_back_ios_new_rounded));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('with no onBack and no router, tapping it does not throw', (
      WidgetTester tester,
    ) async {
      // "A Back control that throws is worse than one that reports it could
      // not act" - tp_back.dart. This harness has no GoRouter, which is
      // exactly the case that comment names.
      await _pumpAppBar(tester, const TpAppBar(title: 'Tyre Records'));

      await tester.tap(find.byIcon(Icons.arrow_back_ios_new_rounded));
      await tester.pump();
    });
  });

  testWidgets('supplied actions render', (WidgetTester tester) async {
    await _pumpAppBar(
      tester,
      TpAppBar(
        title: 'Tyre Records',
        actions: <Widget>[
          IconButton(icon: const Icon(Icons.filter_list), onPressed: () {}),
        ],
      ),
    );

    expect(find.byIcon(Icons.filter_list), findsOneWidget);
  });

  group('preferredSize', () {
    test('is the toolbar height alone with no subtitle and no bottom', () {
      const TpAppBar bar = TpAppBar(title: 'Tyre Records');

      expect(bar.preferredSize.height, kToolbarHeight);
    });

    test('grows by one spacing step for a subtitle', () {
      const TpAppBar bar = TpAppBar(title: 'Tyre Records', subtitle: 'TM514');

      expect(bar.preferredSize.height, kToolbarHeight + TpSpace.lg);
    });

    test('grows by the bottom widget\'s own height', () {
      const double bottomHeight = 24;
      const TpAppBar bar = TpAppBar(
        title: 'Tyre Records',
        bottom: PreferredSize(
          preferredSize: Size.fromHeight(bottomHeight),
          child: SizedBox.shrink(),
        ),
      );

      expect(bar.preferredSize.height, kToolbarHeight + bottomHeight);
    });

    test('a subtitle and a bottom widget stack together', () {
      const double bottomHeight = 24;
      const TpAppBar bar = TpAppBar(
        title: 'Tyre Records',
        subtitle: 'TM514',
        bottom: PreferredSize(
          preferredSize: Size.fromHeight(bottomHeight),
          child: SizedBox.shrink(),
        ),
      );

      expect(
        bar.preferredSize.height,
        kToolbarHeight + TpSpace.lg + bottomHeight,
      );
    });
  });
}
