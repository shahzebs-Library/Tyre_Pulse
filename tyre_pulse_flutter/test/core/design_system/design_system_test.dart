/// A smoke test for the design system barrel export.
///
/// Spec section 54:
///
/// > Import this one file rather than reaching for individual widgets, so a
/// > screen's imports show at a glance whether it is using the system or
/// > working around it.
///
/// Every other file in this directory tests one widget against its own
/// `tp_*.dart` file. This one is different: it proves the promise the
/// barrel makes by building a small, real composite screen using ONLY
/// symbols reached through `design_system.dart`, and checks that what it
/// exports is genuinely enough to do that - including [TpBottomSheet],
/// which lives in the same source file as [TpCard]'s neighbour
/// `tp_bottom_sheet.dart` and is easy to forget when re-exporting by hand.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  testWidgets('a composite screen builds entirely from the barrel export', (
    WidgetTester tester,
  ) async {
    const TpSyncSummary sync = TpSyncSummary(
      connectivity: TpConnectivity.offline,
      pendingCount: 2,
    );

    await tester.pumpWidget(
      tpApp(
        home: TpScaffold(
          appBar: const TpAppBar(
            title: 'Fleet overview',
            subtitle: 'NHC',
            actions: <Widget>[TpSyncIndicator(summary: sync)],
          ),
          banner: const TpOfflineBanner(summary: sync),
          body: SingleChildScrollView(
            padding: const EdgeInsets.all(16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: <Widget>[
                const TpAssetCard(
                  asset: TpAssetSummary(
                    assetNo: 'TM514',
                    description: 'Transit mixer',
                    status: TpStatus.ok,
                    statusLabel: 'Roadworthy',
                  ),
                ),
                const SizedBox(height: 12),
                const TpCard(
                  child: TpTyreChip(
                    data: TpTyreChipData(
                      position: 'LHF1',
                      detail: '112 psi',
                      status: TpStatus.ok,
                    ),
                  ),
                ),
                const SizedBox(height: 12),
                const TpStatCard.count(label: 'Overdue tyres', count: 3),
                const SizedBox(height: 12),
                const TpStatCard.unavailable(label: 'Odometer coverage'),
                const SizedBox(height: 12),
                const TpStatusChip(status: TpStatus.warning),
                const SizedBox(height: 12),
                TpInput(label: 'Serial number', onChanged: (String v) {}),
                const SizedBox(height: 12),
                const TpSearchField(),
                const SizedBox(height: 12),
                Builder(
                  builder: (BuildContext context) {
                    return TpButton.primary(
                      label: 'Open sheet',
                      onPressed: () async {
                        await TpBottomSheet.show<String>(
                          context: context,
                          title: 'From the barrel',
                          builder: (BuildContext sheetContext) {
                            return const Text('It works');
                          },
                        );
                      },
                    );
                  },
                ),
              ],
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Fleet overview'), findsOneWidget);
    expect(find.text('NHC'), findsOneWidget);
    expect(find.text('Offline'), findsOneWidget);
    expect(find.text('2 changes waiting to sync'), findsOneWidget);
    expect(find.text('2'), findsOneWidget); // the compact sync indicator
    expect(find.text('Roadworthy'), findsOneWidget);
    expect(find.textContaining('LHF1'), findsOneWidget);
    expect(find.text('112 psi'), findsOneWidget);
    expect(find.text('Overdue tyres'), findsOneWidget);
    expect(find.text('3'), findsOneWidget);
    expect(find.text('Odometer coverage'), findsOneWidget);
    expect(find.text('-'), findsOneWidget);
    expect(find.text('Attention'), findsOneWidget); // TpStatus.warning
    expect(find.text('Serial number'), findsOneWidget);
    expect(find.text('Search'), findsOneWidget);

    // The column above stacks enough cards that "Open sheet" sits below the
    // 600-logical-pixel test viewport: a bare tap() computes an Offset past
    // the root render view's bounds and never registers a hit. Scrolling it
    // into view first is what a real user's finger does implicitly.
    await tester.ensureVisible(find.text('Open sheet'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Open sheet'));
    await tester.pumpAndSettle();

    expect(find.text('From the barrel'), findsOneWidget);
    expect(find.text('It works'), findsOneWidget);
  });
}
