/// Tests for [TpOfflineBanner] and [TpSyncIndicator] in tp_sync_status.dart.
library;

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';

import 'design_system_test_support.dart';

void main() {
  group('TpOfflineBanner renders nothing when there is nothing to say', () {
    testWidgets('a fully quiet summary collapses to nothing', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(connectivity: TpConnectivity.online),
        ),
      );

      expect(tester.getSize(find.byType(TpOfflineBanner)), Size.zero);
    });

    testWidgets('one pending change is enough to show the banner', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            pendingCount: 1,
          ),
        ),
      );

      expect(tester.getSize(find.byType(TpOfflineBanner)), isNot(Size.zero));
    });
  });

  group('TpOfflineBanner is ordered by urgency', () {
    testWidgets('attention wins even while offline with changes pending', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.offline,
            pendingCount: 5,
            attentionCount: 2,
          ),
        ),
      );

      expect(find.text('2 items need attention'), findsOneWidget);
      expect(find.text('5 changes waiting to sync'), findsOneWidget);
      expect(find.text('Offline'), findsNothing);
    });

    testWidgets('attention with nothing else pending shows no detail line', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            attentionCount: 1,
          ),
        ),
      );

      expect(find.text('1 item needs attention'), findsOneWidget);
      expect(find.textContaining('waiting to sync'), findsNothing);
    });

    testWidgets('a sync in progress shows completed of total', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            syncingCompleted: 8,
            syncingTotal: 12,
          ),
        ),
      );

      expect(find.text('Syncing 8 of 12'), findsOneWidget);
    });

    testWidgets('offline with nothing queued shows the reassurance message', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(connectivity: TpConnectivity.offline),
        ),
      );

      expect(find.text('Offline'), findsOneWidget);
      expect(
        find.text('You can keep working. Everything is saved on this device.'),
        findsOneWidget,
      );
    });

    testWidgets('offline with changes queued shows the count instead', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.offline,
            pendingCount: 3,
          ),
        ),
      );

      expect(find.text('Offline'), findsOneWidget);
      expect(find.text('3 changes waiting to sync'), findsOneWidget);
    });

    testWidgets('connectivity that could not be read is its own message', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(connectivity: TpConnectivity.unknown),
        ),
      );

      expect(find.text('Connection status unknown'), findsOneWidget);
      expect(find.text('Offline'), findsNothing);
    });

    testWidgets('online with changes queued and nothing else wrong', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpOfflineBanner(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            pendingCount: 4,
          ),
        ),
      );

      expect(find.text('4 changes waiting to sync'), findsOneWidget);
    });
  });

  testWidgets('TpOfflineBanner: onTap fires when the banner is tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await pumpTp(
      tester,
      TpOfflineBanner(
        summary: const TpSyncSummary(connectivity: TpConnectivity.offline),
        onTap: () => taps++,
      ),
    );

    await tester.tap(find.text('Offline'));
    await tester.pump();

    expect(taps, 1);
  });

  testWidgets('TpSyncIndicator does not hide itself when everything is fine', (
    WidgetTester tester,
  ) async {
    // Unlike TpOfflineBanner, the compact indicator is meant to sit
    // permanently in an app bar, so it must always say something.
    await pumpTp(
      tester,
      const TpSyncIndicator(
        summary: TpSyncSummary(connectivity: TpConnectivity.online),
      ),
    );

    expect(find.text('All changes synced'), findsOneWidget);
  });

  group('TpSyncIndicator: the compact label per situation', () {
    testWidgets('attention shows a bare digit, not the sentence', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            attentionCount: 3,
          ),
        ),
      );

      expect(find.text('3'), findsOneWidget);
      expect(find.textContaining('needs attention'), findsNothing);
    });

    testWidgets('syncing shows a completed/total fraction', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            syncingCompleted: 8,
            syncingTotal: 12,
          ),
        ),
      );

      expect(find.text('8/12'), findsOneWidget);
    });

    testWidgets('offline with nothing queued shows the word Offline', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(connectivity: TpConnectivity.offline),
        ),
      );

      expect(find.text('Offline'), findsOneWidget);
    });

    testWidgets('offline with changes queued shows the count instead', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.offline,
            pendingCount: 6,
          ),
        ),
      );

      expect(find.text('6'), findsOneWidget);
      expect(find.text('Offline'), findsNothing);
    });

    testWidgets('online with changes queued shows the bare count', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(
            connectivity: TpConnectivity.online,
            pendingCount: 2,
          ),
        ),
      );

      expect(find.text('2'), findsOneWidget);
    });

    testWidgets('connectivity that could not be read shows a dash', (
      WidgetTester tester,
    ) async {
      await pumpTp(
        tester,
        const TpSyncIndicator(
          summary: TpSyncSummary(connectivity: TpConnectivity.unknown),
        ),
      );

      expect(find.text('-'), findsOneWidget);
    });
  });

  testWidgets('TpSyncIndicator: onTap fires when tapped', (
    WidgetTester tester,
  ) async {
    int taps = 0;
    await pumpTp(
      tester,
      TpSyncIndicator(
        summary: const TpSyncSummary(connectivity: TpConnectivity.offline),
        onTap: () => taps++,
      ),
    );

    await tester.tap(find.text('Offline'));
    await tester.pump();

    expect(taps, 1);
  });

  testWidgets('renders under a right-to-left locale', (
    WidgetTester tester,
  ) async {
    await pumpTpRtl(
      tester,
      const TpSyncIndicator(
        summary: TpSyncSummary(
          connectivity: TpConnectivity.online,
          pendingCount: 1,
        ),
      ),
    );

    expect(find.text('1'), findsOneWidget);
  });
}
