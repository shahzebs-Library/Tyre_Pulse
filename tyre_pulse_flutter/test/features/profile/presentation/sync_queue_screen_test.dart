import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/features/profile/presentation/sync_queue_screen.dart';
import 'package:tyre_pulse/features/profile/sync_queue_providers.dart';

SyncQueueEntry _inspection(
  String id, {
  String asset = 'TM514',
  SyncQueueItemState state = SyncQueueItemState.waiting,
  String? lastError,
}) {
  return SyncQueueEntry(
    id: id,
    wireType: SyncQueueEntry.inspectionWireType,
    commandType: null,
    state: state,
    queuedAt: DateTime.utc(2026, 11, 20, 8, 30),
    attempts: 2,
    lastError: lastError,
    inspectionAsset: asset,
  );
}

SyncQueueEntry _entry(
  String id, {
  CommandType? type = CommandType.checklistSubmission,
  SyncQueueItemState state = SyncQueueItemState.waiting,
  int attempts = 0,
  String? lastError,
}) {
  return SyncQueueEntry(
    id: id,
    wireType: type?.wireName ?? 'SOMETHING_NEW',
    commandType: type,
    state: state,
    queuedAt: DateTime.utc(2026, 11, 20, 8, 30),
    attempts: attempts,
    nextAttemptAt: DateTime.utc(2026, 11, 20, 9),
    lastError: lastError,
  );
}

final class _Harness {
  int syncRequests = 0;
  int inspectionFlushes = 0;
  final List<String> retried = <String>[];
  bool syncFails = false;
}

Future<_Harness> _pump(
  WidgetTester tester, {
  Stream<List<SyncQueueEntry>>? entries,
  List<SyncQueueEntry> items = const <SyncQueueEntry>[],
  SyncRunState run = const SyncRunState(),
  bool online = true,
  bool settle = true,
}) async {
  final _Harness harness = _Harness();
  tester.view.physicalSize = const Size(900, 2400);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        syncQueueEntriesProvider.overrideWith(
          (Ref ref) => entries ?? Stream<List<SyncQueueEntry>>.value(items),
        ),
        syncRunStateProvider.overrideWith(
          (Ref ref) => Stream<SyncRunState>.value(run),
        ),
        syncQueueOnlineProvider.overrideWith(
          (Ref ref) => Stream<bool>.value(online),
        ),
        syncNowRequestProvider.overrideWithValue(() async {
          harness.syncRequests += 1;
          if (harness.syncFails) throw StateError('no workmanager');
        }),
        syncQueueInspectionFlushProvider.overrideWithValue(() async {
          harness.inspectionFlushes += 1;
        }),
        syncQueueRetryProvider.overrideWithValue((String id) async {
          harness.retried.add(id);
          return true;
        }),
      ],
      child: MaterialApp(
        theme: TpTheme.light,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const SyncQueueScreen(),
      ),
    ),
  );
  if (settle) {
    await tester.pumpAndSettle();
  } else {
    await tester.pump();
    await tester.pump();
  }
  return harness;
}

void main() {
  testWidgets('an empty queue says everything is synced', (tester) async {
    await _pump(tester);
    expect(find.byKey(SyncQueueScreenKeys.empty), findsOneWidget);
    expect(find.text('Everything is synced'), findsOneWidget);
    expect(
      find.text('No sync attempt recorded on this device yet'),
      findsOneWidget,
    );
  });

  testWidgets('a read failure shows an error with retry, never empty', (
    tester,
  ) async {
    await _pump(
      tester,
      entries: Stream<List<SyncQueueEntry>>.error(StateError('db')),
    );
    expect(find.byKey(SyncQueueScreenKeys.error), findsOneWidget);
    expect(find.byKey(SyncQueueScreenKeys.empty), findsNothing);
    expect(find.text('Try again'), findsOneWidget);
  });

  testWidgets('lists items with counts, names and safe error text', (
    tester,
  ) async {
    await _pump(
      tester,
      items: <SyncQueueEntry>[
        _entry('a'),
        _entry('b', type: CommandType.odometerLog),
        _entry(
          'c',
          type: CommandType.reportAccident,
          state: SyncQueueItemState.needsAttention,
          attempts: 8,
          lastError: 'Some values are not valid.',
        ),
        _entry(
          'd',
          type: CommandType.stockAdjust,
          state: SyncQueueItemState.needsAttention,
          lastError: 'duplicate key violates constraint pg_x',
        ),
        _entry('e', state: SyncQueueItemState.sent),
        _entry('f', type: null),
      ],
      run: SyncRunState(lastAttemptAt: DateTime.utc(2026, 11, 20, 7)),
    );

    String statValue(Key key) => tester
        .widgetList<Text>(
          find.descendant(of: find.byKey(key), matching: find.byType(Text)),
        )
        .map((Text t) => t.data ?? '')
        .join('|');
    expect(statValue(SyncQueueScreenKeys.statPending), contains('3'));
    expect(statValue(SyncQueueScreenKeys.statAttention), contains('2'));
    expect(statValue(SyncQueueScreenKeys.statSent), contains('1'));

    expect(find.textContaining('Last sync attempt:'), findsOneWidget);
    expect(find.text('Checklist'), findsNWidgets(2));
    expect(find.text('Odometer reading'), findsOneWidget);
    expect(find.text('Accident report'), findsOneWidget);
    expect(find.text('Unrecognised entry'), findsOneWidget);
    expect(find.text('Some values are not valid.'), findsOneWidget);
    // Technical text never reaches the screen.
    expect(find.textContaining('pg_x'), findsNothing);
    expect(find.text('This item could not be sent.'), findsOneWidget);
    expect(find.byKey(SyncQueueScreenKeys.retry('c')), findsOneWidget);
    expect(find.byKey(SyncQueueScreenKeys.retry('a')), findsNothing);
  });

  testWidgets('Sync now requests one run', (tester) async {
    final _Harness h =
        await _pump(tester, items: <SyncQueueEntry>[_entry('a')]);
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    expect(h.syncRequests, 1);
    expect(
      find.text('Sync requested. This list updates as items are sent.'),
      findsOneWidget,
    );
    // Stop the follow-up polling timer before the test ends.
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Sync now reports a failure to start honestly', (tester) async {
    final _Harness h =
        await _pump(tester, items: <SyncQueueEntry>[_entry('a')]);
    h.syncFails = true;
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    expect(find.text('Could not start a sync. Try again.'), findsOneWidget);
  });

  testWidgets('offline disables Sync now and says why', (tester) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('a')],
      online: false,
    );
    expect(find.byKey(SyncQueueScreenKeys.syncNowReason), findsOneWidget);
    expect(find.textContaining('You are offline.'), findsOneWidget);
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    expect(h.syncRequests, 0);
  });

  testWidgets('a running sync disables Sync now', (tester) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('a')],
      run: SyncRunState(lockAcquiredAt: DateTime.now().toUtc()),
      settle: false,
    );
    expect(find.text('A sync is running now'), findsOneWidget);
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    expect(h.syncRequests, 0);
  });

  testWidgets('Retry resets the failed item and asks for a run', (
    tester,
  ) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[
        _entry('c', state: SyncQueueItemState.needsAttention),
      ],
    );
    await tester.tap(find.byKey(SyncQueueScreenKeys.retry('c')));
    await tester.pump();
    await tester.pump();
    expect(h.retried, <String>['c']);
    expect(h.syncRequests, 1);
    expect(find.text('Put back in the queue.'), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });

  test('an unknown status is waiting, never sent', () {
    expect(
      SyncQueueItemState.fromStatus('something'),
      SyncQueueItemState.waiting,
    );
    expect(SyncQueueItemState.fromStatus('synced'), SyncQueueItemState.sent);
    expect(
      SyncQueueItemState.fromStatus('failed'),
      SyncQueueItemState.needsAttention,
    );
  });

  test('a stale lock does not count as a running sync', () {
    final DateTime now = DateTime.utc(2026, 11, 20, 12);
    expect(
      SyncRunState(
        lockAcquiredAt: now.subtract(const Duration(hours: 1)),
      ).isSyncingAt(now),
      isFalse,
    );
    expect(
      SyncRunState(
        lockAcquiredAt: now.subtract(const Duration(seconds: 30)),
      ).isSyncingAt(now),
      isTrue,
    );
  });

  testWidgets(
      'submitted inspections are listed by asset, with no exclusion '
      'note', (tester) async {
    await _pump(
      tester,
      items: <SyncQueueEntry>[
        _inspection('i-1'),
        _inspection(
          'i-2',
          asset: 'MP081',
          state: SyncQueueItemState.needsAttention,
          lastError: 'No connection to the server.',
        ),
      ],
    );
    expect(find.text('Inspection TM514'), findsOneWidget);
    expect(find.text('Inspection MP081'), findsOneWidget);
    expect(find.text('No connection to the server.'), findsOneWidget);
    expect(find.textContaining('not listed here'), findsNothing);
    expect(find.byKey(SyncQueueScreenKeys.retry('i-2')), findsOneWidget);
  });

  testWidgets('Retry on an inspection flushes the inspection queue', (
    tester,
  ) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[
        _inspection('i-2', state: SyncQueueItemState.needsAttention),
      ],
    );
    await tester.tap(find.byKey(SyncQueueScreenKeys.retry('i-2')));
    await tester.pump();
    await tester.pump();
    expect(h.inspectionFlushes, 1);
    expect(h.retried, isEmpty);
    expect(h.syncRequests, 0);
    expect(
      find.text(
        'Tried to send your inspections again. The status below is up to date.',
      ),
      findsOneWidget,
    );
  });

  testWidgets('Sync now covers both queues', (tester) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_entry('a'), _inspection('i-1')],
    );
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    await tester.pump();
    expect(h.syncRequests, 1);
    expect(h.inspectionFlushes, 1);
    await tester.pumpWidget(const SizedBox());
  });

  testWidgets('Sync now with only inspections just flushes them', (
    tester,
  ) async {
    final _Harness h = await _pump(
      tester,
      items: <SyncQueueEntry>[_inspection('i-1')],
    );
    await tester.tap(find.byKey(SyncQueueScreenKeys.syncNow));
    await tester.pump();
    await tester.pump();
    expect(h.syncRequests, 0);
    expect(h.inspectionFlushes, 1);
  });
}
