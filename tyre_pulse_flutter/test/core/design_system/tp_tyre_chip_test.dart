/// Tests for [TpTyreChip].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('the position identifier renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpTyreChip(data: TpTyreChipData(position: 'LHF1')),
    );

    expect(find.textContaining('LHF1'), findsOneWidget);
  });

  group('the detail line', () {
    testWidgets('renders when supplied', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(
          data: TpTyreChipData(position: 'LHF1', detail: '112 psi'),
        ),
      );

      expect(find.text('112 psi'), findsOneWidget);
    });

    testWidgets('is absent when not supplied', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(data: TpTyreChipData(position: 'LHF1')),
      );

      expect(find.text('112 psi'), findsNothing);
    });
  });

  group('a tyre nobody has assessed does not default to looking healthy',
      () {
    testWidgets('the default status is unknown', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(data: TpTyreChipData(position: 'LHF1')),
      );

      expect(_decorationOf(tester).color, TpPalette.light.unknown.soft);
    });

    testWidgets('a real status carries its own colour',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(
          data: TpTyreChipData(position: 'LHF1', status: TpStatus.critical),
        ),
      );

      expect(_decorationOf(tester).color, TpPalette.light.critical.soft);
    });
  });

  group('isSelected', () {
    testWidgets('draws a stronger, focus-coloured border',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(
          data: TpTyreChipData(position: 'LHF1', status: TpStatus.warning),
          isSelected: true,
        ),
      );

      final Border border = _decorationOf(tester).border! as Border;
      expect(border.top.color, TpPalette.light.focus);
      expect(border.top.width, TpBorderWidth.strong);
    });

    testWidgets(
      'false, the default, draws the status colour at hairline width',
      (WidgetTester tester) async {
        await pumpTp(
          tester,
          const TpTyreChip(
            data: TpTyreChipData(position: 'LHF1', status: TpStatus.warning),
          ),
        );

        final Border border = _decorationOf(tester).border! as Border;
        expect(border.top.color, TpPalette.light.warning.base);
        expect(border.top.width, TpBorderWidth.hairline);
      },
    );
  });

  group('onTap', () {
    testWidgets('fires when the chip is tapped', (WidgetTester tester) async {
      int taps = 0;
      await pumpTp(
        tester,
        TpTyreChip(
          data: const TpTyreChipData(position: 'LHF1'),
          onTap: () => taps++,
        ),
      );

      await tester.tap(find.textContaining('LHF1'));
      await tester.pump();

      expect(taps, 1);
    });

    testWidgets('no InkWell is built when onTap is not supplied',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpTyreChip(data: TpTyreChipData(position: 'LHF1')),
      );

      expect(
        find.descendant(
          of: find.byType(TpTyreChip),
          matching: find.byType(InkWell),
        ),
        findsNothing,
      );
    });
  });

  testWidgets(
    'the position stays left-to-right even under a right-to-left locale',
    (WidgetTester tester) async {
      // Repository rule 10: RR2 rendering as 2RR under Arabic is not
      // cosmetic, it names a different wheel.
      await pumpTpRtl(
        tester,
        const TpTyreChip(data: TpTyreChipData(position: 'RR2')),
      );

      expect(find.textContaining('RR2'), findsOneWidget);

      final Directionality isolate = tester.widget<Directionality>(
        find
            .descendant(
              of: find.byType(TpTyreChip),
              matching: find.byType(Directionality),
            )
            .first,
      );
      expect(isolate.textDirection, TextDirection.ltr);
    },
  );
}

BoxDecoration _decorationOf(WidgetTester tester) {
  final DecoratedBox box = tester.widget<DecoratedBox>(
    find
        .descendant(
          of: find.byType(TpTyreChip),
          matching: find.byType(DecoratedBox),
        )
        .first,
  );
  return box.decoration as BoxDecoration;
}
