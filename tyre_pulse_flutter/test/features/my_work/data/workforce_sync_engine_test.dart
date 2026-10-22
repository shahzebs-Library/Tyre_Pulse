/// Coverage for [WorkforceTransitionEngine]: durable queue first, idempotency
/// keys, strict per-assignment ordering, server refusals surfaced (never
/// dropped), single-flight delivery and identity safety.
///
/// UNVERIFIED: written without a Flutter SDK; never compiled or run.
library;

import 'dart:async';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_sync_engine.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

import 'workforce_test_fakes.dart';

const String userA = '11111111-1111-1111-1111-111111111111';
const String userB = '22222222-2222-2222-2222-222222222222';
const String job1 = 'assignment-1';
const String job2 = 'assignment-2';

WorkforceTransitionEngine engineWith(
  FakeWorkforceQueue queue,
  FakeWorkforceRemote remote, {
  String? Function()? session,
}) {
  int n = 0;
  return WorkforceTransitionEngine(
    queue: queue,
    remote: remote,
    newId: () => 'key-${++n}-0000000000',
    clock: () => DateTime.utc(2026, 10, 23, 8).add(Duration(minutes: n)),
    sessionUserId: session,
  );
}

void main() {
  group('submit', () {
    test('writes to the queue first, then delivers; a delivered entry is removed',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      final WorkforceTransitionEngine engine = engineWith(queue, remote);

      final WorkforceSubmitResult result = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );

      expect(result.outcome, WorkforceSubmitOutcome.deliveredNow);
      expect(remote.calls, hasLength(1));
      expect(remote.calls.single.action, 'start');
      expect(remote.calls.single.key, 'key-1-0000000000');
      expect(queue.of(userA), isEmpty);
    });

    test('offline: the entry stays pending, with an attempt counted', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('no network'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);

      final WorkforceSubmitResult result = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );

      expect(result.outcome, WorkforceSubmitOutcome.queued);
      final List<QueuedWorkforceTransition> stored = queue.of(userA);
      expect(stored, hasLength(1));
      expect(stored.single.status, WorkforceQueueStatus.pending);
      expect(stored.single.attempts, 1);
      expect(stored.single.baseStatus, 'assigned');
    });

    test('requires a note to block and stores nothing without one', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final WorkforceTransitionEngine engine =
          engineWith(queue, FakeWorkforceRemote());

      final WorkforceSubmitResult result = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'in_progress',
        action: WorkforceAction.block,
        note: '   ',
      );

      expect(result.outcome, WorkforceSubmitOutcome.refused);
      expect(queue.of(userA), isEmpty);
    });

    test('the note is trimmed and sent with the update', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      await engineWith(queue, remote).submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'in_progress',
        action: WorkforceAction.block,
        note: '  waiting for valve  ',
      );
      expect(remote.calls.single.note, 'waiting for valve');
    });

    test('an action that does not apply is refused locally', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      final WorkforceSubmitResult result = await engineWith(queue, remote).submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'submitted',
        action: WorkforceAction.start,
      );
      expect(result.outcome, WorkforceSubmitOutcome.refused);
      expect(remote.calls, isEmpty);
      expect(queue.of(userA), isEmpty);
    });

    test('queued updates stack: the next action is judged on the optimistic status',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
        const SocketException('offline'),
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);

      for (final WorkforceAction action in <WorkforceAction>[
        WorkforceAction.accept,
        WorkforceAction.start,
      ]) {
        final WorkforceSubmitResult r = await engine.submit(
          userId: userA,
          assignmentId: job1,
          serverStatus: 'assigned',
          action: action,
        );
        expect(r.outcome, WorkforceSubmitOutcome.queued);
      }
      // 'accept' again is no longer possible: the screen would show in_progress.
      final WorkforceSubmitResult again = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      expect(again.outcome, WorkforceSubmitOutcome.refused);
      expect(queue.of(userA).map((QueuedWorkforceTransition i) => i.seq),
          <int>[1, 2]);
    });
  });

  group('flush', () {
    test('delivers in the order the user acted and reuses the same key on retry',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'), // accept, tapped offline
        const SocketException('offline'), // start, tapped offline
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );
      final List<String> firstKeys =
          queue.of(userA).map((QueuedWorkforceTransition i) => i.id).toList();
      expect(firstKeys, hasLength(2));

      remote.calls.clear(); // connectivity returns
      final WorkforceFlushSummary summary = await engine.flush(userA);

      expect(summary.delivered, 2);
      expect(remote.calls.map((RemoteCall c) => c.action),
          <String>['accept', 'start']);
      expect(remote.calls.map((RemoteCall c) => c.key), firstKeys);
      expect(queue.of(userA), isEmpty);
    });

    test('a transport failure stops the pass and keeps order for later',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      await engine.submit(
        userId: userA,
        assignmentId: job2,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      remote.script
        ..clear()
        ..add(const SocketException('still offline'));
      remote.calls.clear();

      final WorkforceFlushSummary summary = await engine.flush(userA);

      expect(summary.offline, isTrue);
      expect(remote.calls, hasLength(1), reason: 'stopped after the first failure');
      expect(queue.of(userA), hasLength(2));
      expect(queue.of(userA).first.attempts, 3);
    });

    test('a replayed key is treated as delivered', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const WorkforceRemoteResult(outcome: WorkforceRemoteOutcome.replayed),
      ]);
      final WorkforceSubmitResult result = await engineWith(queue, remote).submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );
      expect(result.outcome, WorkforceSubmitOutcome.deliveredNow);
      expect(queue.of(userA), isEmpty);
    });

    test('already-applied by another device is also delivered', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const WorkforceRemoteResult(
          outcome: WorkforceRemoteOutcome.alreadyApplied,
          status: 'in_progress',
        ),
      ]);
      final WorkforceSubmitResult result = await engineWith(queue, remote).submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );
      expect(result.outcome, WorkforceSubmitOutcome.deliveredNow);
    });

    test('a server refusal is kept, explained and not retried automatically',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        rejectedResult('invalid_transition', status: 'cancelled'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);

      final WorkforceSubmitResult result = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'in_progress',
        action: WorkforceAction.complete,
      );

      expect(result.outcome, WorkforceSubmitOutcome.rejected);
      final QueuedWorkforceTransition kept = queue.of(userA).single;
      expect(kept.status, WorkforceQueueStatus.rejected);
      expect(kept.serverStatus, 'cancelled');
      expect(kept.rejectionReason, 'invalid_transition');
      expect(kept.error, contains('cancelled'));

      remote.calls.clear();
      await engine.flush(userA);
      expect(remote.calls, isEmpty, reason: 'refused entries are never resent');
      expect(queue.of(userA), hasLength(1));
    });

    test('later updates for a refused assignment are held, not sent blind',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
        const SocketException('offline'),
        const SocketException('offline'),
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      for (final WorkforceAction action in <WorkforceAction>[
        WorkforceAction.accept,
        WorkforceAction.start,
        WorkforceAction.complete,
      ]) {
        await engine.submit(
          userId: userA,
          assignmentId: job1,
          serverStatus: 'assigned',
          action: action,
        );
      }
      // Another assignment, unaffected by the refusal.
      await engine.submit(
        userId: userA,
        assignmentId: job2,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      remote.script
        ..clear()
        ..add(rejectedResult('invalid_transition', status: 'cancelled'));
      remote.calls.clear();

      final WorkforceFlushSummary summary = await engine.flush(userA);

      expect(summary.rejected, 3, reason: 'the refused update and two held behind it');
      expect(summary.delivered, 1, reason: 'the other assignment still syncs');
      expect(remote.calls.map((RemoteCall c) => '${c.assignmentId}:${c.action}'),
          <String>['assignment-1:accept', 'assignment-2:accept']);
      final List<QueuedWorkforceTransition> left = queue.of(userA);
      expect(left, hasLength(3));
      expect(left.every((QueuedWorkforceTransition i) =>
          i.status == WorkforceQueueStatus.rejected), isTrue);
      expect(left[1].rejectionReason, 'depends_on_rejected');
    });

    test('a new update is refused while a refused one is unresolved', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        rejectedResult('not_found'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      final WorkforceSubmitResult next = await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );
      expect(next.outcome, WorkforceSubmitOutcome.refused);
    });

    test('concurrent triggers share one delivery run', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      remote.calls.clear();
      remote.gate = Completer<void>();

      final Future<WorkforceFlushSummary> a = engine.flush(userA);
      final Future<WorkforceFlushSummary> b = engine.flush(userA);
      final Future<WorkforceFlushSummary> c = engine.flush(userA);
      remote.gate!.complete();
      await Future.wait(<Future<WorkforceFlushSummary>>[a, b, c]);

      expect(remote.calls, hasLength(1), reason: 'sent once, not three times');
      expect(queue.of(userA), isEmpty);
    });

    test('an unreadable queue sends nothing and is not reported as empty',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue()..unreadable = true;
      final FakeWorkforceRemote remote = FakeWorkforceRemote();
      final WorkforceFlushSummary summary =
          await engineWith(queue, remote).flush(userA);
      expect(summary.unreadable, isTrue);
      expect(remote.calls, isEmpty);
    });

    test('never delivers under a different signed-in account', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      String? signedIn = userA;
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine =
          engineWith(queue, remote, session: () => signedIn);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      remote.calls.clear();

      signedIn = userB; // someone else signs in on the same phone
      final WorkforceFlushSummary other = await engine.flush(userA);
      expect(other.offline, isTrue);
      expect(remote.calls, isEmpty);
      expect(queue.of(userA).single.status, WorkforceQueueStatus.pending);
      expect(queue.of(userA).single.attempts, 1, reason: 'no attempt was made');

      signedIn = null; // signed out
      await engine.flush(userA);
      expect(remote.calls, isEmpty);

      signedIn = userA; // the owner returns
      final WorkforceFlushSummary owner = await engine.flush(userA);
      expect(owner.delivered, 1);
      expect(queue.of(userA), isEmpty);
    });

    test('queues are per user', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      expect(await engine.pendingCount(userA), 1);
      expect(await engine.pendingCount(userB), 0);
      final WorkforceFlushSummary summary = await engine.flush(userB);
      expect(summary.attempted, 0);
    });

    test('an unclassifiable failure is surfaced as refused, not retried forever',
        () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const FormatException('garbled response'),
      ]);
      final WorkforceSubmitResult result = await engineWith(queue, remote).submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      expect(result.outcome, WorkforceSubmitOutcome.rejected);
      expect(queue.of(userA).single.status, WorkforceQueueStatus.rejected);
    });
  });

  group('reconciliation', () {
    Future<(FakeWorkforceQueue, FakeWorkforceRemote, WorkforceTransitionEngine)>
        refusedChain() async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.start,
      );
      remote.script
        ..clear()
        ..add(rejectedResult('invalid_transition', status: 'cancelled'));
      await engine.flush(userA);
      return (queue, remote, engine);
    }

    test('dismiss removes the refused update and the ones held behind it',
        () async {
      final (FakeWorkforceQueue queue, _, WorkforceTransitionEngine engine) =
          await refusedChain();
      final String firstId = queue.of(userA).first.id;

      await engine.dismiss(userA, firstId);

      expect(queue.of(userA), isEmpty);
    });

    test('dismiss never removes a pending update', () async {
      final FakeWorkforceQueue queue = FakeWorkforceQueue();
      final FakeWorkforceRemote remote = FakeWorkforceRemote(<Object>[
        const SocketException('offline'),
      ]);
      final WorkforceTransitionEngine engine = engineWith(queue, remote);
      await engine.submit(
        userId: userA,
        assignmentId: job1,
        serverStatus: 'assigned',
        action: WorkforceAction.accept,
      );
      await engine.dismiss(userA, queue.of(userA).single.id);
      expect(queue.of(userA), hasLength(1));
    });

    test('retry reopens the refused update and everything held behind it, in order',
        () async {
      final (FakeWorkforceQueue queue, FakeWorkforceRemote remote, WorkforceTransitionEngine engine) =
          await refusedChain();
      final String firstId = queue.of(userA).first.id;
      remote.calls.clear();
      remote.script.clear(); // server now accepts

      final WorkforceFlushSummary summary = await engine.retry(userA, firstId);

      expect(summary.delivered, 2);
      expect(remote.calls.map((RemoteCall c) => c.action),
          <String>['accept', 'start']);
      expect(queue.of(userA), isEmpty);
    });

    test('only the earliest refused update of an assignment can be retried',
        () async {
      final (FakeWorkforceQueue queue, FakeWorkforceRemote remote, WorkforceTransitionEngine engine) =
          await refusedChain();
      final String secondId = queue.of(userA)[1].id;
      remote.calls.clear();

      await engine.retry(userA, secondId);

      expect(remote.calls, isEmpty);
      expect(queue.of(userA).every((QueuedWorkforceTransition i) =>
          i.status == WorkforceQueueStatus.rejected), isTrue);
    });
  });

  group('effectiveWorkforceStatus', () {
    QueuedWorkforceTransition entry(int seq, WorkforceAction a,
        {WorkforceQueueStatus status = WorkforceQueueStatus.pending}) {
      return QueuedWorkforceTransition(
        id: 'id-$seq-0000000000',
        userId: userA,
        assignmentId: job1,
        action: a,
        seq: seq,
        createdAt: DateTime.utc(2026, 10, 23),
        clientAt: DateTime.utc(2026, 10, 23),
        status: status,
      );
    }

    test('applies pending entries in order and ignores refused ones', () {
      expect(
        effectiveWorkforceStatus('assigned', <QueuedWorkforceTransition>[
          entry(2, WorkforceAction.block),
          entry(1, WorkforceAction.start),
          entry(3, WorkforceAction.complete,
              status: WorkforceQueueStatus.rejected),
        ]),
        'blocked',
      );
    });

    test('skips an entry that no longer applies', () {
      expect(
        effectiveWorkforceStatus('in_progress', <QueuedWorkforceTransition>[
          entry(1, WorkforceAction.accept),
        ]),
        'in_progress',
      );
    });
  });
}
