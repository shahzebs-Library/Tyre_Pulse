/// Shared hand-written fakes for the workforce offline-update tests. Plain
/// Dart interfaces only (no Supabase types, no mocktail), the same approach as
/// `checklist_approval_sync_engine_test.dart`.
library;

import 'dart:async';

import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_queue.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';

class FakeWorkforceQueue implements WorkforceTransitionQueue {
  final Map<String, Map<String, QueuedWorkforceTransition>> store =
      <String, Map<String, QueuedWorkforceTransition>>{};

  /// When true, [list] reports an unreadable store.
  bool unreadable = false;

  @override
  Future<void> put(QueuedWorkforceTransition item) async {
    store
        .putIfAbsent(item.userId, () => <String, QueuedWorkforceTransition>{})[
      item.id] = item;
  }

  @override
  Future<WorkforceQueueRead> list(String userId) async {
    if (unreadable) return const WorkforceQueueRead.unreadable();
    final List<QueuedWorkforceTransition> items =
        (store[userId]?.values ?? const <QueuedWorkforceTransition>[]).toList()
          ..sort(
            (QueuedWorkforceTransition a, QueuedWorkforceTransition b) =>
                a.seq.compareTo(b.seq),
          );
    return WorkforceQueueRead.ok(items);
  }

  @override
  Future<void> remove(String userId, String id) async {
    store[userId]?.remove(id);
  }

  List<QueuedWorkforceTransition> of(String userId) =>
      (store[userId]?.values ?? const <QueuedWorkforceTransition>[]).toList()
        ..sort(
          (QueuedWorkforceTransition a, QueuedWorkforceTransition b) =>
              a.seq.compareTo(b.seq),
        );
}

class RemoteCall {
  const RemoteCall({
    required this.assignmentId,
    required this.action,
    required this.key,
    required this.note,
    required this.clientAt,
  });

  final String assignmentId;
  final String action;
  final String key;
  final String? note;
  final DateTime clientAt;
}

/// Answers from a script, one entry per call: a [WorkforceRemoteResult] to
/// return, or an [Exception] to throw. When the script is exhausted it
/// answers `applied`.
class FakeWorkforceRemote implements WorkforceTransitionRemote {
  FakeWorkforceRemote([List<Object>? script]) : script = script ?? <Object>[];

  final List<Object> script;
  final List<RemoteCall> calls = <RemoteCall>[];

  /// If set, every call waits for this completer before answering (used to
  /// prove that concurrent flushes share one run).
  Completer<void>? gate;

  @override
  Future<WorkforceRemoteResult> apply({
    required String assignmentId,
    required String action,
    required String idempotencyKey,
    required DateTime clientAt,
    String? note,
  }) async {
    calls.add(
      RemoteCall(
        assignmentId: assignmentId,
        action: action,
        key: idempotencyKey,
        note: note,
        clientAt: clientAt,
      ),
    );
    final Completer<void>? wait = gate;
    if (wait != null) await wait.future;
    if (script.isEmpty) {
      return const WorkforceRemoteResult(
        outcome: WorkforceRemoteOutcome.applied,
      );
    }
    final Object next = script.removeAt(0);
    if (next is WorkforceRemoteResult) return next;
    if (next is Exception) throw next;
    throw StateError('Unusable fake remote script entry: $next');
  }
}

const WorkforceRemoteResult appliedResult = WorkforceRemoteResult(
  outcome: WorkforceRemoteOutcome.applied,
);

WorkforceRemoteResult rejectedResult(String reason, {String? status}) {
  return WorkforceRemoteResult(
    outcome: WorkforceRemoteOutcome.rejected,
    reason: reason,
    status: status,
  );
}
