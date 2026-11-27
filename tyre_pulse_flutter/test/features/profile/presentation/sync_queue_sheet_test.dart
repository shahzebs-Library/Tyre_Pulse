import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_screen.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_sheet.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

final DateTime _now = DateTime.utc(2026, 11, 20, 10);

SyncQueueEntry _entry(
  String id, {
  SyncQueueItemState state = SyncQueueItemState.waiting,
  CommandType type = CommandType.checklistSubmission,
  String? lastError,
  int minute = 0,
}) {
  return SyncQueueEntry(
    id: id,
    wireType: type.wireName,
    commandType: type,
    state: state,
    queuedAt: DateTime.utc(2026, 11, 20, 8, minute),
    attempts: 1,
    lastError: lastError,
  );
}

final class _Harness {
  int syncRequests = 0;
  final List<String> retried = <String>[];
}

Future<_Harness> _pump(
  WidgetTester tester, {
  List<SyncQueueEntry> items = const <SyncQueueEntry>[],
  SyncRunState run = const SyncRunState(),
  bool online = true,
}) async {
  final _Harness harness = _Harness();
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        syncQueueEntriesProvider.overrideWith(
          (Ref ref) => Stream<List<SyncQueueEntry>>.value(items),
        ),
        syncRunStateProvider.overrideWith(
          (Ref ref) => Stream<SyncRunState>.value(run),
        ),
        syncQueueOnlineProvider.overrideWith(
          (Ref ref) => Stream<bool>.value(online),
        ),
        syncNowRequestProvider.overrideWithValue(() async {
          harness.syncRequests += 1;
        }),
        syncQueueInspectionFlushProvider.overrideWithValue(() async {}),
        syncQueueRetryProvider.overrideWithValue((String id) async {
          harness.retried.add(id);
          return true;
        }),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Builder(
          builder: (BuildContext context) => Scaffold(
            body: Center(
              child: TextButton(
                onPressed: () => showSyncQueueSheet(context),
                child: const Text('open'),
              ),
            ),
          ),
        ),
      ),
    ),
  );
  await tester.tap(find.text('open'));
  await tester.pumpAndSettle();
  return harness;
}

void main() {
  group('syncQueueSheetItems', () {
    test('failed first, then retrying, waiting; sent excluded; capped', () {
      final List<SyncQueueEntry> items = <SyncQueueEntry>[
        _entry('w1'),
        _entry('s1', state: SyncQueueItemState.sent),
        _entry('r1', state: SyncQueueItemState.retrying),
        _entry('f1', state: SyncQueueItemState.needsAttention),
        _entry('w2'),
        _entry('f2', state: SyncQueueItemState.needsAttention),
      ];
      expect(
        syncQueueSheetItems(items).map((e) => e.id),
        <String>['f1', 'f2', 'r1'],
      );
      expect(syncQueueSheetItems(items, max: 10).map((e) => e.id), <String>[
        'f1',
        'f2',
        'r1',
        'w1',
        'w2',
      ]);
    });
  });

  testWidgets('all synced is one line with the last attempt, no list', (
    tester,
  ) async {
    await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('s1', state: SyncQueueItemState.sent)],
      run: SyncRunState(
        lastAttemptAt: DateTime.now().subtract(const Duration(minutes: 2)),
      ),
    );
    expect(find.byType(SyncQueueSheet), findsOneWidget);
    expect(find.text('All synced · last attempt 2 min ago'), findsOneWidget);
    expect(find.byKey(SyncQueueSheetKeys.item('s1')), findsNothing);
    // The status line is the whole confirmation: no button, no reason.
    expect(find.byKey(SyncQueueSheetKeys.syncNow), findsNothing);
    expect(find.byKey(SyncQueueSheetKeys.syncNowReason), findsNothing);
    // The one sent item is still listed on the full screen.
    expect(find.text('See all (1)'), findsOneWidget);
  });

  testWidgets('shows counts, caps the list at 3, failed first with Retry', (
    tester,
  ) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[
        _entry('w1', minute: 5),
        _entry('w2', minute: 4),
        _entry('w3', minute: 3),
        _entry(
          'f1',
          state: SyncQueueItemState.needsAttention,
          lastError: 'The server refused this entry.',
        ),
      ],
    );
    expect(find.text('3 waiting · 1 needs attention'), findsOneWidget);
    expect(find.byKey(SyncQueueSheetKeys.item('f1')), findsOneWidget);
    expect(find.byKey(SyncQueueSheetKeys.item('w1')), findsOneWidget);
    expect(find.byKey(SyncQueueSheetKeys.item('w2')), findsOneWidget);
    expect(find.byKey(SyncQueueSheetKeys.item('w3')), findsNothing);
    expect(
      find.textContaining('The server refused this entry.'),
      findsOneWidget,
    );
    expect(find.text('See all (4)'), findsOneWidget);

    await tester.tap(find.byKey(SyncQueueSheetKeys.retry('f1')));
    await tester.pumpAndSettle();
    expect(h.retried, <String>['f1']);
    expect(find.byKey(SyncQueueSheetKeys.feedback), findsOneWidget);
  });

  testWidgets('no See all when the sheet shows everything', (tester) async {
    await _pump(tester, items: <SyncQueueEntry>[_entry('w1'), _entry('w2')]);
    expect(find.byKey(SyncQueueSheetKeys.seeAll), findsNothing);
  });

  testWidgets('Sync now requests a sync and says so inline', (tester) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('w1')],
    );
    await tester.tap(find.byKey(SyncQueueSheetKeys.syncNow));
    await tester.pump();
    await tester.pump();
    expect(h.syncRequests, 1);
    expect(
      find.text('Sync requested. This list updates as items are sent.'),
      findsOneWidget,
    );
    // Stop the follow-up polling timer before the test ends.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('offline disables Sync now with a one-line reason', (
    tester,
  ) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('w1')],
      online: false,
    );
    expect(find.byKey(SyncQueueSheetKeys.syncNowReason), findsOneWidget);
    await tester.tap(find.byKey(SyncQueueSheetKeys.syncNow));
    await tester.pump();
    expect(h.syncRequests, 0);
  });

  testWidgets('See all closes the sheet and opens the full screen', (
    tester,
  ) async {
    await _pump(
      tester,
      items: <SyncQueueEntry>[
        for (int i = 0; i < 4; i++) _entry('w$i', minute: i),
      ],
    );
    await tester.tap(find.byKey(SyncQueueSheetKeys.seeAll));
    await tester.pumpAndSettle();
    expect(find.byType(SyncQueueSheet), findsNothing);
    expect(find.byType(SyncQueueScreen), findsOneWidget);
  });

  testWidgets('a read failure says so with a Retry, never "All synced"', (
    tester,
  ) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: <Override>[
          syncQueueEntriesProvider.overrideWith(
            (Ref ref) => Stream<List<SyncQueueEntry>>.error(StateError('db')),
          ),
          syncRunStateProvider.overrideWith(
            (Ref ref) => Stream<SyncRunState>.value(const SyncRunState()),
          ),
          syncQueueOnlineProvider.overrideWith(
            (Ref ref) => Stream<bool>.value(true),
          ),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Scaffold(body: SyncQueueSheet(onSeeAll: () {})),
        ),
      ),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(SyncQueueSheetKeys.error), findsOneWidget);
    expect(find.textContaining('All synced'), findsNothing);
  });

  group('syncRelativeTime', () {
    testWidgets('just now, minutes, hours, days', (tester) async {
      late AppLocalizations l10n;
      await tester.pumpWidget(
        MaterialApp(
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: Builder(
            builder: (BuildContext context) {
              l10n = AppLocalizations.of(context);
              return const SizedBox();
            },
          ),
        ),
      );
      String ago(Duration d) => syncRelativeTime(l10n, _now.subtract(d), _now);
      expect(ago(const Duration(seconds: 20)), 'just now');
      expect(ago(const Duration(minutes: 5)), '5 min ago');
      expect(ago(const Duration(hours: 3)), '3 h ago');
      expect(ago(const Duration(days: 2)), '2 d ago');
      expect(
        syncRelativeTime(l10n, _now.add(const Duration(hours: 1)), _now),
        'just now',
      );
    });
  });
}
