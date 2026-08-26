/// Tests for [TpStatusChip].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

// The default label for every status, taken from lib/l10n/app_en.arb - the
// chip's only source of wording when the caller does not override it.
const Map<TpStatus, String> _defaultLabels = <TpStatus, String>{
  TpStatus.ok: 'OK',
  TpStatus.warning: 'Attention',
  TpStatus.critical: 'Critical',
  TpStatus.info: 'Info',
  TpStatus.neutral: 'Neutral',
  TpStatus.unknown: 'Not measured',
};

void main() {
  for (final MapEntry<TpStatus, String> entry in _defaultLabels.entries) {
    testWidgets(
      '${entry.key.name} defaults to the label "${entry.value}"',
      (WidgetTester tester) async {
        await pumpTp(tester, TpStatusChip(status: entry.key));

        expect(find.text(entry.value), findsOneWidget);
      },
    );
  }

  testWidgets('a custom label overrides the default wording',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpStatusChip(status: TpStatus.ok, label: '312 kPa'),
    );

    expect(find.text('312 kPa'), findsOneWidget);
    expect(find.text('OK'), findsNothing);
  });

  group('the icon', () {
    testWidgets('a supplied icon renders regardless of status',
        (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpStatusChip(status: TpStatus.ok, icon: Icons.check_circle),
      );

      expect(find.byIcon(Icons.check_circle), findsOneWidget);
    });

    testWidgets('unknown shows an implicit glyph even with no icon set',
        (WidgetTester tester) async {
      // Spec section 32: "not measured" must be readable by someone who
      // cannot tell the status colours apart, so it carries a glyph even
      // when nothing was passed in.
      await pumpTp(tester, const TpStatusChip(status: TpStatus.unknown));

      expect(find.byIcon(Icons.remove), findsOneWidget);
    });

    testWidgets('a measured status with no icon set shows no glyph at all',
        (WidgetTester tester) async {
      await pumpTp(tester, const TpStatusChip(status: TpStatus.ok));

      expect(find.byType(Icon), findsNothing);
    });
  });

  testWidgets('isCompact renders a shorter chip for identical content',
      (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpStatusChip(status: TpStatus.ok, label: 'Same'),
    );
    final double regularHeight =
        tester.getSize(find.byType(TpStatusChip)).height;

    await pumpTp(
      tester,
      const TpStatusChip(status: TpStatus.ok, label: 'Same', isCompact: true),
    );
    final double compactHeight =
        tester.getSize(find.byType(TpStatusChip)).height;

    expect(compactHeight, lessThan(regularHeight));
  });

  testWidgets('renders under a right-to-left locale',
      (WidgetTester tester) async {
    await pumpTpRtl(
      tester,
      const TpStatusChip(status: TpStatus.ok, label: 'Fixed label'),
    );

    expect(find.text('Fixed label'), findsOneWidget);
  });
}
