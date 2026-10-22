/// The assignment lane: offline banner, optimistic "Pending sync" status, the
/// mandatory note on a block, and a refused update being shown (not dropped).
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_assignments_repository.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/presentation/workforce_assignments_panel.dart';
import 'package:tyre_pulse/features/my_work/workforce_sync_providers.dart';

import '../data/workforce_test_fakes.dart';

const String userA = '11111111-1111-1111-1111-111111111111';

Future<(FakeWorkforceQueue, FakeWorkforceRemote)> pump(
  WidgetTester tester, {
  required String status,
  bool offline = false,
  List<Object>? remoteScript,
}) async {
  final FakeWorkforceQueue queue = FakeWorkforceQueue();
  final FakeWorkforceRemote remote = FakeWorkforceRemote(remoteScript);
  int n = 0;
  final WorkforceTransitionEngine engine = WorkforceTransitionEngine(
    queue: queue,
    remote: remote,
    newId: () => 'key-${++n}-0000000000',
  );
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workforceUserIdProvider.overrideWithValue(userA),
        workforceTransitionEngineProvider.overrideWithValue(engine),
        workforceAssignmentsProvider.overrideWith(
          (Ref ref) async => WorkforceAssignmentSnapshot(
            items: <WorkforceAssignment>[
              WorkforceAssignment(
                id: 'a1',
                title: 'Replace valve',
                status: status,
                priority: 'normal',
              ),
            ],
            offline: offline,
          ),
        ),
      ],
      child: const MaterialApp(
        home: Scaffold(body: SingleChildScrollView(child: WorkforceAssignmentsPanel())),
      ),
    ),
  );
  await tester.pumpAndSettle();
  return (queue, remote);
}

void main() {
  testWidgets('shows the offline banner when assignments are cached',
      (WidgetTester tester) async {
    await pump(tester, status: 'assigned', offline: true);
    expect(find.byKey(WorkforcePanelKeys.offlineBanner), findsOneWidget);
    expect(find.text('Replace valve'), findsOneWidget);
  });

  testWidgets('an offline tap is kept and shown as pending sync',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote _) = await pump(
      tester,
      status: 'assigned',
      remoteScript: <Object>[const SocketException('offline')],
    );
    expect(find.byKey(WorkforcePanelKeys.pending('a1')), findsNothing);

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.start)),
    );
    await tester.pumpAndSettle();

    expect(queue.of(userA), hasLength(1));
    expect(find.byKey(WorkforcePanelKeys.pending('a1')), findsOneWidget);
    expect(find.textContaining('In progress'), findsOneWidget);
  });

  testWidgets('blocking asks for a reason and cannot be confirmed empty',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote remote) =
        await pump(tester, status: 'in_progress');

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.block)),
    );
    await tester.pumpAndSettle();

    FilledButton confirm() => tester.widget<FilledButton>(
          find.byKey(WorkforcePanelKeys.noteConfirm),
        );
    expect(confirm().onPressed, isNull);
    expect(remote.calls, isEmpty);

    await tester.enterText(
      find.byKey(WorkforcePanelKeys.noteField),
      'waiting for a valve',
    );
    await tester.pump();
    expect(confirm().onPressed, isNotNull);

    await tester.tap(find.byKey(WorkforcePanelKeys.noteConfirm));
    await tester.pumpAndSettle();
    expect(remote.calls.single.action, 'block');
    expect(remote.calls.single.note, 'waiting for a valve');
    expect(queue.of(userA), isEmpty);
  });

  testWidgets('a refused update is shown with its reason until dismissed',
      (WidgetTester tester) async {
    final (FakeWorkforceQueue queue, FakeWorkforceRemote _) = await pump(
      tester,
      status: 'assigned',
      remoteScript: <Object>[rejectedResult('invalid_transition')],
    );

    await tester.tap(
      find.byKey(WorkforcePanelKeys.action('a1', WorkforceAction.start)),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(WorkforcePanelKeys.rejected('a1')), findsOneWidget);
    expect(queue.of(userA).single.status, WorkforceQueueStatus.rejected);
    // The server status stays authoritative.
    expect(find.textContaining('Assigned'), findsOneWidget);

    await tester.tap(
      find.byKey(
        WorkforcePanelKeys.dismiss(queue.of(userA).single.id),
      ),
    );
    await tester.pumpAndSettle();
    expect(queue.of(userA), isEmpty);
    expect(find.byKey(WorkforcePanelKeys.rejected('a1')), findsNothing);
  });
}
