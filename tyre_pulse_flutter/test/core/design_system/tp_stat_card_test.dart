/// Tests for [TpStatCard].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  group('a measured count', () {
    testWidgets('a real zero renders as 0, not as unavailable', (
      WidgetTester tester,
    ) async {
      // Repository rule 4 and spec section 32: a measured zero is a real
      // fact and must render as a real fact, never folded into "we do not
      // know". TpStatCard.count and TpStatCard.unavailable are structurally
      // different widgets precisely so a test can prove this.
      await pumpTp(
        tester,
        const TpStatCard.count(label: 'Overdue tyres', count: 0),
      );

      expect(find.text('0'), findsOneWidget);
      expect(find.byKey(TpStatCardKeys.value), findsOneWidget);
      expect(find.byKey(TpStatCardKeys.unavailable), findsNothing);
    });

    testWidgets('a positive count renders as itself', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpStatCard.count(label: 'Overdue tyres', count: 42),
      );

      expect(find.text('42'), findsOneWidget);
    });
  });

  testWidgets('a measured value renders the caller-formatted string', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      const TpStatCard.text(label: 'Pressure compliance', value: '82%'),
    );

    expect(find.text('82%'), findsOneWidget);
    expect(find.byKey(TpStatCardKeys.value), findsOneWidget);
    expect(find.byKey(TpStatCardKeys.unavailable), findsNothing);
  });

  group('an unavailable value', () {
    testWidgets('renders a dash, never a zero', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpStatCard.unavailable(label: 'Odometer coverage'),
      );

      expect(find.text('-'), findsOneWidget);
      expect(find.text('0'), findsNothing);
      expect(find.byKey(TpStatCardKeys.unavailable), findsOneWidget);
      expect(find.byKey(TpStatCardKeys.value), findsNothing);
    });

    testWidgets('defaults its caption to "Unavailable"', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpStatCard.unavailable(label: 'Odometer coverage'),
      );

      expect(find.text('Unavailable'), findsOneWidget);
    });

    testWidgets('a supplied caption explains why, and replaces the default', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpStatCard.unavailable(
          label: 'Odometer coverage',
          caption: 'No meter readings on this device',
        ),
      );

      expect(find.text('No meter readings on this device'), findsOneWidget);
      expect(find.text('Unavailable'), findsNothing);
    });

    testWidgets('is drawn with the dashed, unmeasured border', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpStatCard.unavailable(label: 'Odometer coverage'),
      );

      expect(
        find.descendant(
          of: find.byType(TpStatCard),
          matching: find.byType(CustomPaint),
        ),
        findsOneWidget,
      );
    });
  });

  testWidgets('a measured card is never drawn with the dashed border', (
    WidgetTester tester,
  ) async {
    await pumpTp(
      tester,
      const TpStatCard.count(label: 'Overdue tyres', count: 3),
    );

    expect(
      find.descendant(
        of: find.byType(TpStatCard),
        matching: find.byType(CustomPaint),
      ),
      findsNothing,
    );
  });

  testWidgets('the label always renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpStatCard.count(label: 'Overdue tyres', count: 3),
    );

    expect(find.text('Overdue tyres'), findsOneWidget);
  });

  testWidgets('an icon renders when supplied', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpStatCard.count(
        label: 'Overdue tyres',
        count: 3,
        icon: Icons.warning_amber,
      ),
    );

    expect(find.byIcon(Icons.warning_amber), findsOneWidget);
  });

  testWidgets('onTap fires when the card is tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await pumpTp(
      tester,
      TpStatCard.count(label: 'Overdue tyres', count: 3, onTap: () => taps++),
    );

    await tester.tap(find.text('Overdue tyres'));
    await tester.pump();

    expect(taps, 1);
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await pumpTpRtl(
      tester,
      const TpStatCard.count(label: 'Overdue tyres', count: 3),
    );

    expect(find.text('Overdue tyres'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
  });
}
