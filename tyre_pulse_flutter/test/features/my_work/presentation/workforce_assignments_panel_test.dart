import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_assignments_panel.dart';

const WorkforceAssignment _assigned = WorkforceAssignment(
  id: 'a1',
  title: 'Replace tyre TM-214',
  status: 'assigned',
  priority: 'high',
  site: 'NHC',
);

final class _FakeSource implements WorkforceAssignmentsSource {
  _FakeSource(this.snapshots);

  /// Each call to [listMine] consumes one entry; the last one repeats.
  final List<Object> snapshots;
  Object? advanceError;
  int listCalls = 0;
  int advanceCalls = 0;
  Completer<void>? gate;

  @override
  Future<WorkforceAssignmentSnapshot> listMine() async {
    final Object next = snapshots[listCalls < snapshots.length
        ? listCalls
        : snapshots.length - 1];
    listCalls++;
    if (next is WorkforceAssignmentSnapshot) return next;
    throw next;
  }

  @override
  Future<void> advance(WorkforceAssignment item) async {
    advanceCalls++;
    if (gate != null) await gate!.future;
    final Object? error = advanceError;
    if (error != null) throw error;
  }
}

Future<void> _pump(
  WidgetTester tester,
  _FakeSource source, {
  Locale locale = const Locale('en'),
}) async {
  tester.view.physicalSize = const Size(390, 1200);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workforceAssignmentsRepositoryProvider.overrideWithValue(source),
      ],
      child: MaterialApp(
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const Scaffold(
          body: SingleChildScrollView(child: WorkforceAssignmentsPanel()),
        ),
      ),
    ),
  );
}

void main() {
  testWidgets('shows a loading indicator, then the assignment', (tester) async {
    final Completer<void> hold = Completer<void>();
    final _FakeSource source = _FakeSource(<Object>[
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
    ]);
    // Delay the first read so the loading state is observable.
    final _FakeSource slow = _SlowSource(source, hold.future);
    await _pump(tester, slow);
    expect(find.byKey(WorkforceAssignmentsPanelKeys.loading), findsOneWidget);

    hold.complete();
    await tester.pumpAndSettle();
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
    expect(find.text('Acknowledge'), findsOneWidget);
    expect(find.byKey(WorkforceAssignmentsPanelKeys.loading), findsNothing);
  });

  testWidgets('empty state', (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[
        const WorkforceAssignmentSnapshot(
          items: <WorkforceAssignment>[],
          offline: false,
        ),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.empty), findsOneWidget);
    expect(find.text('No company assignments recorded.'), findsOneWidget);
  });

  testWidgets('error state offers Retry which reloads', (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      StateError('boom'),
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
    ]);
    await _pump(tester, source);
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.error), findsOneWidget);
    expect(find.text('boom'), findsNothing, reason: 'no raw error text');

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.retry));
    await tester.pumpAndSettle();
    expect(source.listCalls, 2);
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
  });

  testWidgets('offline cache is labelled and cannot change status',
      (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[
        const WorkforceAssignmentSnapshot(
          items: <WorkforceAssignment>[_assigned],
          offline: true,
        ),
      ]),
    );
    await tester.pumpAndSettle();
    expect(find.byKey(WorkforceAssignmentsPanelKeys.offline), findsOneWidget);
    expect(find.text('Replace tyre TM-214'), findsOneWidget);
    expect(
      find.byKey(WorkforceAssignmentsPanelKeys.action('a1')),
      findsNothing,
    );
  });

  testWidgets('a successful change reloads the list', (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[
          WorkforceAssignment(
            id: 'a1',
            title: 'Replace tyre TM-214',
            status: 'acknowledged',
            priority: 'high',
          ),
        ],
        offline: false,
      ),
    ]);
    await _pump(tester, source);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.action('a1')));
    await tester.pumpAndSettle();

    expect(source.advanceCalls, 1);
    expect(source.listCalls, 2);
    expect(find.text('Start'), findsOneWidget);
  });

  testWidgets('a server-rejected change is explained and refreshes',
      (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
    ])
      ..advanceError = const WorkforceTransitionException(
        WorkforceTransitionFailure.rejected,
      );
    await _pump(tester, source);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.action('a1')));
    await tester.pumpAndSettle();

    expect(find.textContaining('The server did not accept this update'),
        findsOneWidget);
    expect(find.text('Refresh'), findsOneWidget);
    // The list was reloaded because what was on screen may be stale.
    expect(source.listCalls, 2);
  });

  testWidgets('a network failure offers Retry which re-sends the same change',
      (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
    ])
      ..advanceError = const WorkforceTransitionException(
        WorkforceTransitionFailure.network,
      );
    await _pump(tester, source);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.action('a1')));
    await tester.pumpAndSettle();
    expect(find.textContaining('No connection'), findsOneWidget);
    // No reload for a request that never reached the server.
    expect(source.listCalls, 1);

    source.advanceError = null;
    await tester.tap(find.text('Retry'));
    await tester.pumpAndSettle();
    expect(source.advanceCalls, 2);
  });

  testWidgets('a double tap sends one request while busy', (tester) async {
    final _FakeSource source = _FakeSource(<Object>[
      const WorkforceAssignmentSnapshot(
        items: <WorkforceAssignment>[_assigned],
        offline: false,
      ),
    ])
      ..gate = Completer<void>();
    await _pump(tester, source);
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WorkforceAssignmentsPanelKeys.action('a1')));
    await tester.pump();
    // The button is replaced by a spinner while the request is in flight.
    expect(
      find.byKey(WorkforceAssignmentsPanelKeys.action('a1')),
      findsNothing,
    );
    expect(source.advanceCalls, 1);

    source.gate!.complete();
    await tester.pumpAndSettle();
  });

  testWidgets('Arabic renders translated copy and RTL direction',
      (tester) async {
    await _pump(
      tester,
      _FakeSource(<Object>[
        const WorkforceAssignmentSnapshot(
          items: <WorkforceAssignment>[_assigned],
          offline: false,
        ),
      ]),
      locale: const Locale('ar'),
    );
    await tester.pumpAndSettle();
    expect(find.text('مهام الشركة'), findsOneWidget);
    expect(find.text('تأكيد الاستلام'), findsOneWidget);
    expect(
      Directionality.of(tester.element(find.text('مهام الشركة'))),
      TextDirection.rtl,
    );
  });
}

/// Wraps a source so its first read waits on [_hold].
final class _SlowSource extends _FakeSource {
  _SlowSource(_FakeSource inner, this._hold) : super(inner.snapshots);

  final Future<void> _hold;

  @override
  Future<WorkforceAssignmentSnapshot> listMine() async {
    await _hold;
    return super.listMine();
  }
}
