/// Tests for [TpCard].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('renders its child', (WidgetTester tester) async {
    await pumpTp(tester, const TpCard(child: Text('card content')));

    expect(find.text('card content'), findsOneWidget);
  });

  group('onTap', () {
    testWidgets('fires when the card is tapped', (WidgetTester tester) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpCard(onTap: () => taps++, child: const Text('card content')),
      );

      expect(
        find.descendant(
          of: find.byType(TpCard),
          matching: find.byType(InkWell),
        ),
        findsOneWidget,
      );

      await tester.tap(find.text('card content'));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('no InkWell is built when onTap is not supplied', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpCard(child: Text('card content')));

      expect(
        find.descendant(
          of: find.byType(TpCard),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );

      // A card with no onTap must not throw when something touches it.
      await tester.tap(find.text('card content'), warnIfMissed: false);
      await tester.pump();
    });
  });

  group('isDashed marks content that was never measured', () {
    // Spec section 32: unmeasured content gets a dashed border on top of its
    // colour, because colour alone is not a signal everyone can see.
    testWidgets('true draws a CustomPaint dashed border', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpCard(isDashed: true, child: Text('card content')),
      );

      expect(
        find.descendant(
          of: find.byType(TpCard),
          matching: find.byType(CustomPaint),
        ),
        findsOneWidget,
      );
    });

    testWidgets('false draws the ordinary bordered surface instead', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpCard(child: Text('card content')));

      expect(
        find.descendant(
          of: find.byType(TpCard),
          matching: find.byType(CustomPaint),
        ),
        findsNothing,
      );
    });
  });

  group('colour overrides', () {
    testWidgets('borderColor replaces the default hairline colour', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpCard(borderColor: Colors.red, child: Text('card content')),
      );

      final Border border = _borderOf(tester);
      expect(border.top.color, Colors.red);
    });

    testWidgets('the default border colour comes from the palette', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpCard(child: Text('card content')));

      final Border border = _borderOf(tester);
      expect(border.top.color, TpPalette.light.border);
    });

    testWidgets('background replaces the default surface colour', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpCard(background: Colors.blue, child: Text('card content')),
      );

      expect(_decorationOf(tester).color, Colors.blue);
    });

    testWidgets('the default background comes from the palette', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpCard(child: Text('card content')));

      expect(_decorationOf(tester).color, TpPalette.light.surface);
    });
  });

  group('spacing', () {
    testWidgets('the default padding matches the design token', (
      WidgetTester tester,
    ) async {
      await pumpTp(tester, const TpCard(child: Text('card content')));

      final Iterable<Padding> paddings = _paddingsOf(tester);
      expect(
        paddings.any(
          (Padding p) => p.padding == const EdgeInsets.all(TpSpace.lg),
        ),
        isTrue,
      );
    });

    testWidgets('a custom padding is applied around the child', (
      WidgetTester tester,
    ) async {
      const EdgeInsets customPadding = EdgeInsets.all(40);
      await pumpTp(
        tester,
        const TpCard(padding: customPadding, child: Text('card content')),
      );

      final Iterable<Padding> paddings = _paddingsOf(tester);
      expect(paddings.any((Padding p) => p.padding == customPadding), isTrue);
    });

    testWidgets('a custom margin wraps the whole card', (
      WidgetTester tester,
    ) async {
      const EdgeInsets customMargin = EdgeInsets.all(10);
      await pumpTp(
        tester,
        const TpCard(margin: customMargin, child: Text('card content')),
      );

      final Iterable<Padding> paddings = _paddingsOf(tester);
      expect(paddings.any((Padding p) => p.padding == customMargin), isTrue);
    });
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await pumpTpRtl(tester, const TpCard(child: Text('card content')));

    expect(find.text('card content'), findsOneWidget);
  });
}

Iterable<Padding> _paddingsOf(WidgetTester tester) {
  return tester.widgetList<Padding>(
    find.descendant(of: find.byType(TpCard), matching: find.byType(Padding)),
  );
}

BoxDecoration _decorationOf(WidgetTester tester) {
  final DecoratedBox box = tester.widget<DecoratedBox>(
    find
        .descendant(
          of: find.byType(TpCard),
          matching: find.byType(DecoratedBox),
        )
        .first,
  );
  return box.decoration as BoxDecoration;
}

Border _borderOf(WidgetTester tester) {
  return _decorationOf(tester).border! as Border;
}
