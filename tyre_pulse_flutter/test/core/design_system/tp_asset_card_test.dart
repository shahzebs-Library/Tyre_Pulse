/// Tests for [TpAssetCard].
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('the asset number renders', (WidgetTester tester) async {
    await pumpTp(
      tester,
      const TpAssetCard(asset: TpAssetSummary(assetNo: 'TM514')),
    );

    expect(find.textContaining('TM514'), findsOneWidget);
  });

  group('the description', () {
    testWidgets('renders when supplied', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpAssetCard(
          asset: TpAssetSummary(
            assetNo: 'TM514',
            description: 'Transit mixer, 8m3',
          ),
        ),
      );

      expect(find.text('Transit mixer, 8m3'), findsOneWidget);
    });

    testWidgets('is absent when not supplied', (WidgetTester tester) async {
      await pumpTp(
        tester,
        const TpAssetCard(asset: TpAssetSummary(assetNo: 'TM514')),
      );

      expect(find.text('Transit mixer, 8m3'), findsNothing);
    });
  });

  group('the site and detail line', () {
    testWidgets('joins both when both are supplied', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(
          asset: TpAssetSummary(
            assetNo: 'TM514',
            siteName: 'NHC',
            detail: '84,200 km',
          ),
        ),
      );

      expect(find.text('NHC  |  84,200 km'), findsOneWidget);
    });

    testWidgets('shows only the site when there is no detail', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(
          asset: TpAssetSummary(assetNo: 'TM514', siteName: 'NHC'),
        ),
      );

      expect(find.text('NHC'), findsOneWidget);
    });

    testWidgets('shows only the detail when there is no site', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(
          asset: TpAssetSummary(assetNo: 'TM514', detail: '84,200 km'),
        ),
      );

      expect(find.text('84,200 km'), findsOneWidget);
    });

    testWidgets('renders no line at all when neither is supplied', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(asset: TpAssetSummary(assetNo: 'TM514')),
      );

      expect(find.textContaining('|'), findsNothing);
    });
  });

  group('an asset nobody has assessed does not default to looking healthy', () {
    testWidgets('the default status label reads "Not measured"', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(asset: TpAssetSummary(assetNo: 'TM514')),
      );

      expect(find.text('Not measured'), findsOneWidget);
    });

    testWidgets('a supplied status label overrides the default', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpAssetCard(
          asset: TpAssetSummary(
            assetNo: 'TM514',
            status: TpStatus.ok,
            statusLabel: 'Roadworthy',
          ),
        ),
      );

      expect(find.text('Roadworthy'), findsOneWidget);
      expect(find.text('OK'), findsNothing);
    });
  });

  testWidgets('onTap fires when the card is tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await pumpTp(
      tester,
      TpAssetCard(
        asset: const TpAssetSummary(assetNo: 'TM514'),
        onTap: () => taps++,
      ),
    );

    await tester.tap(find.textContaining('TM514'));
    await tester.pump();

    expect(taps, 1);
  });

  testWidgets(
    'the asset number stays left-to-right under a right-to-left locale',
    (WidgetTester tester) async {
      // Repository rule 10: TM514 reads back wrong under a bidirectional
      // reorder, and a reversed asset number sends work to the wrong
      // machine.
      await pumpTpRtl(
        tester,
        const TpAssetCard(asset: TpAssetSummary(assetNo: 'TM514')),
      );

      expect(find.textContaining('TM514'), findsOneWidget);

      final Directionality isolate = tester.widget<Directionality>(
        find
            .descendant(
              of: find.byType(TpAssetCard),
              matching: find.byType(Directionality),
            )
            .first,
      );
      expect(isolate.textDirection, TextDirection.ltr);
    },
  );
}
