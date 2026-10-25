/// Offline-first delivery of assignment status updates.
///
/// # Contract
///
/// - A tap is written to the durable per-user queue FIRST ([submit]); delivery
///   is then attempted. A process kill or lost connection can never lose it.
/// - Every entry carries one idempotency key reused for all retries, so a
///   request whose response was lost is a harmless replay on the server.
/// - Updates for one assignment are delivered strictly in the order the user
///   made them. A transport failure stops the pass (order kept, retried later).
/// - A server REFUSAL (the assignment moved on, permission changed, wrong
///   state) is never retried automatically and never deleted silently: the
///   entry becomes [WorkforceQueueStatus.rejected] with the reason, stays on
///   screen, and every later queued update for that assignment is held as
///   rejected too ("depends on a refused update") instead of being sent blind.
///   The user dismisses it (the screen then shows the server's truth) or
///   retries it.
/// - [flush] is single-flight per user: connectivity, resume, sign-in and the
///   tap itself can all call it at once without double sending.
///
/// Unverified: written without a Flutter SDK, so none of this has been
/// compiled or run on a device. See docs/workforce-intelligence/OFFLINE_ASSIGNMENTS.md.
library;

import 'dart:async';

import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_queue.dart';
import 'package:tyre_pulse/features/my_work/data/workforce_transition_remote.dart';
import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';
import 'package:uuid/uuid.dart';

enum WorkforceSubmitOutcome {
  /// Reached the server and was accepted before this call returned.
  deliveredNow,

  /// Safely stored; will be delivered automatically.
  queued,

  /// Delivery was attempted and the server refused it.
  rejected,

  /// Not accepted locally (not applicable to the current state, note missing,
  /// a refused update must be resolved first, queue unavailable). Nothing stored.
  refused,
}

final class WorkforceSubmitResult {
  const WorkforceSubmitResult(this.outcome, {this.item, this.message});

  final WorkforceSubmitOutcome outcome;
  final QueuedWorkforceTransition? item;
  final String? message;
}

final class WorkforceFlushSummary {
  const WorkforceFlushSummary({
    this.attempted = 0,
    this.delivered = 0,
    this.rejected = 0,
    this.offline = false,
    this.unreadable = false,
  });

  final int attempted;
  final int delivered;
  final int rejected;

  /// The pass stopped because the network (or an expired session) failed.
  final bool offline;

  /// The queue store could not be read; nothing was sent.
  final bool unreadable;

  bool get changedServerState => delivered > 0 || rejected > 0;

  WorkforceFlushSummary plus(WorkforceFlushSummary other) {
    return WorkforceFlushSummary(
      attempted: attempted + other.attempted,
      delivered: delivered + other.delivered,
      rejected: rejected + other.rejected,
      offline: offline || other.offline,
      unreadable: unreadable || other.unreadable,
    );
  }
}

/// Sentence shown to the user for a refusal code from the server.
String workforceRejectionMessage(String? reason, String? currentStatus) {
  final String suffix = currentStatus == null
      ? ''
      : ' Current status: ${currentStatus.replaceAll('_', ' ')}.';
  switch (reason) {
    case 'invalid_transition':
      return 'The assignment had already moved on when this update arrived.$suffix';
    case 'not_found':
      return 'This assignment is no longer available to you.';
    case 'forbidden':
      return 'Only the assigned employee can do this.';
    case 'note_required':
      return 'A note is required for this update.';
    case 'key_reuse':
      return 'This update conflicted with an earlier one. Refresh and try again.';
    default:
      return 'The server did not accept this update.$suffix';
  }
}

final class WorkforceTransitionEngine {
  WorkforceTransitionEngine({
    required WorkforceTransitionQueue queue,
    required WorkforceTransitionRemote remote,
    String Function()? newId,
    DateTime Function()? clock,
    String? Function()? sessionUserId,
  })  : _queue = queue,
        _remote = remote,
        _newId = newId ?? (() => const Uuid().v4()),
        _clock = clock ?? DateTime.now,
        _sessionUserId = sessionUserId;

  final WorkforceTransitionQueue _queue;
  final WorkforceTransitionRemote _remote;
  final String Function() _newId;
  final DateTime Function() _clock;

  /// The account the network session currently belongs to. When given, an
  /// entry is only ever sent while the session is the entry's own user, so a
  /// queued update can never be delivered under someone else's sign-in.
  final String? Function()? _sessionUserId;

  Future<void> _tail = Future<void>.value();
  final Map<String, Future<WorkforceFlushSummary>> _flushes =
      <String, Future<WorkforceFlushSummary>>{};
  final Set<String> _dirty = <String>{};

  /// Serialises read-modify-write sections (submit, retry, dismiss).
  Future<T> _serial<T>(Future<T> Function() body) {
    final Completer<T> completer = Completer<T>();
    _tail = _tail.then((_) async {
      try {
        completer.complete(await body());
      } on Object catch (error, stack) {
        completer.completeError(error, stack);
      }
    });
    return completer.future;
  }

  /// Records the user's update and tries to deliver it.
  ///
  /// [serverStatus] is the status the screen's last server read showed; queued
  /// updates are applied on top of it to decide what is still allowed.
  Future<WorkforceSubmitResult> submit({
    required String userId,
    required String assignmentId,
    required String serverStatus,
    required WorkforceAction action,
    String? note,
  }) async {
    final String? trimmed = note?.trim();
    final String? cleanNote =
        (trimmed == null || trimmed.isEmpty) ? null : trimmed;
    if (action.noteRequired && cleanNote == null) {
      return const WorkforceSubmitResult(
        WorkforceSubmitOutcome.refused,
        message: 'A note is required for this update.',
      );
    }

    final ({
      WorkforceSubmitResult? early,
      QueuedWorkforceTransition? created
    }) stored = await _serial(() async {
      final WorkforceQueueRead read = await _queue.list(userId);
      if (!read.isReadable) {
        return (
          early: const WorkforceSubmitResult(
            WorkforceSubmitOutcome.refused,
            message:
                'Offline updates are unavailable on this device right now.',
          ),
          created: null,
        );
      }
      final List<QueuedWorkforceTransition> mine = read.items
          .where(
            (QueuedWorkforceTransition i) => i.assignmentId == assignmentId,
          )
          .toList(growable: false);
      if (mine.any(
        (QueuedWorkforceTransition i) =>
            i.status == WorkforceQueueStatus.rejected,
      )) {
        return (
          early: const WorkforceSubmitResult(
            WorkforceSubmitOutcome.refused,
            message: 'An earlier update for this assignment was refused. '
                'Review it first.',
          ),
          created: null,
        );
      }
      final List<QueuedWorkforceTransition> pending = mine;
      final String effective = effectiveWorkforceStatus(serverStatus, pending);
      if (!action.canApplyFrom(effective)) {
        return (
          early: WorkforceSubmitResult(
            WorkforceSubmitOutcome.refused,
            message: '${action.label} is not available while the assignment is '
                '${effective.replaceAll('_', ' ')}.',
          ),
          created: null,
        );
      }
      int nextSeq = 1;
      for (final QueuedWorkforceTransition i in read.items) {
        if (i.seq >= nextSeq) nextSeq = i.seq + 1;
      }
      final DateTime now = _clock();
      final QueuedWorkforceTransition item = QueuedWorkforceTransition(
        id: _newId(),
        userId: userId,
        assignmentId: assignmentId,
        action: action,
        seq: nextSeq,
        createdAt: now.toUtc(),
        clientAt: now.toUtc(),
        baseStatus: effective,
        note: cleanNote,
      );
      await _queue.put(item);
      return (early: null, created: item);
    });

    final WorkforceSubmitResult? early = stored.early;
    if (early != null) return early;
    final QueuedWorkforceTransition created = stored.created!;

    await flush(userId);

    final WorkforceQueueRead after = await _queue.list(userId);
    if (!after.isReadable) {
      return WorkforceSubmitResult(
        WorkforceSubmitOutcome.queued,
        item: created,
      );
    }
    for (final QueuedWorkforceTransition i in after.items) {
      if (i.id != created.id) continue;
      return WorkforceSubmitResult(
        i.status == WorkforceQueueStatus.rejected
            ? WorkforceSubmitOutcome.rejected
            : WorkforceSubmitOutcome.queued,
        item: i,
        message: i.error,
      );
    }
    return WorkforceSubmitResult(
      WorkforceSubmitOutcome.deliveredNow,
      item: created,
    );
  }

  /// Delivers everything deliverable for [userId]. Safe to call from any
  /// trigger at any time: concurrent calls share one run.
  Future<WorkforceFlushSummary> flush(String userId) {
    final Future<WorkforceFlushSummary>? running = _flushes[userId];
    if (running != null) {
      _dirty.add(userId);
      return running;
    }
    final Future<WorkforceFlushSummary> run =
        _flushLoop(userId).whenComplete(() {
      _flushes.remove(userId);
    });
    _flushes[userId] = run;
    return run;
  }

  Future<WorkforceFlushSummary> _flushLoop(String userId) async {
    WorkforceFlushSummary total = const WorkforceFlushSummary();
    do {
      _dirty.remove(userId);
      final WorkforceFlushSummary pass = await _pass(userId);
      total = total.plus(pass);
      if (pass.offline || pass.unreadable) break;
    } while (_dirty.contains(userId));
    return total;
  }

  Future<WorkforceFlushSummary> _pass(String userId) async {
    final WorkforceQueueRead read = await _queue.list(userId);
    if (!read.isReadable) {
      return const WorkforceFlushSummary(unreadable: true);
    }
    final Set<String> halted = <String>{
      for (final QueuedWorkforceTransition i in read.items)
        if (i.status == WorkforceQueueStatus.rejected) i.assignmentId,
    };
    int attempted = 0;
    int delivered = 0;
    int rejected = 0;
    bool offline = false;

    for (final QueuedWorkforceTransition item in read.items) {
      if (item.status != WorkforceQueueStatus.pending) continue;
      if (halted.contains(item.assignmentId)) {
        await _queue.put(
          item.copyWith(
            status: WorkforceQueueStatus.rejected,
            error: 'Not sent because an earlier update for this assignment '
                'was refused.',
            rejectionReason: _dependsOnRejected,
          ),
        );
        rejected++;
        continue;
      }
      final String? sessionUser = _sessionUserId?.call();
      if (_sessionUserId != null && sessionUser != userId) {
        // Signed out, or a different person signed in: leave everything
        // untouched (no attempt counted) and stop. The owner's next sign-in
        // flushes it.
        offline = true;
        break;
      }
      attempted++;
      try {
        final WorkforceRemoteResult result = await _remote.apply(
          assignmentId: item.assignmentId,
          action: item.action.wire,
          idempotencyKey: item.id,
          clientAt: item.clientAt,
          note: item.note,
        );
        if (result.isDelivered) {
          await _queue.remove(userId, item.id);
          delivered++;
        } else {
          await _queue.put(
            item.copyWith(
              status: WorkforceQueueStatus.rejected,
              attempts: item.attempts + 1,
              error: workforceRejectionMessage(result.reason, result.status),
              serverStatus: result.status,
              rejectionReason: result.reason,
            ),
          );
          halted.add(item.assignmentId);
          rejected++;
        }
      } on Object catch (error) {
        final SupabaseFailure failure = classifySupabaseError(error);
        if (_isTransient(failure)) {
          await _queue.put(
            item.copyWith(
              attempts: item.attempts + 1,
              error: failure.error.message,
            ),
          );
          offline = true;
          break;
        }
        await _queue.put(
          item.copyWith(
            status: WorkforceQueueStatus.rejected,
            attempts: item.attempts + 1,
            error: failure.error.message,
            rejectionReason: failure.cause.name,
          ),
        );
        halted.add(item.assignmentId);
        rejected++;
      }
    }
    return WorkforceFlushSummary(
      attempted: attempted,
      delivered: delivered,
      rejected: rejected,
      offline: offline,
    );
  }

  static const String _dependsOnRejected = 'depends_on_rejected';

  static bool _isTransient(SupabaseFailure failure) {
    if (failure.isConnectivity) return true;
    switch (failure.cause) {
      case SupabaseFailureCause.serverError:
      case SupabaseFailureCause.rateLimited:
      case SupabaseFailureCause.jwtExpired:
      case SupabaseFailureCause.unauthenticated:
        return true;
      default:
        return false;
    }
  }

  /// Every unresolved entry for [userId] (pending and rejected), in order.
  Future<List<QueuedWorkforceTransition>> list(String userId) async {
    final WorkforceQueueRead read = await _queue.list(userId);
    return read.isReadable ? read.items : const <QueuedWorkforceTransition>[];
  }

  /// Unresolved entries; under-reports (0) when the store is unreadable.
  Future<int> pendingCount(String userId) async => (await list(userId)).length;

  /// The user has seen a refused update. Removes it (only if it is refused),
  /// along with later updates held behind it, so the screen shows server truth.
  Future<void> dismiss(String userId, String id) {
    return _serial(() async {
      final WorkforceQueueRead read = await _queue.list(userId);
      if (!read.isReadable) return;
      QueuedWorkforceTransition? target;
      for (final QueuedWorkforceTransition i in read.items) {
        if (i.id == id) target = i;
      }
      if (target == null || target.status != WorkforceQueueStatus.rejected) {
        return;
      }
      for (final QueuedWorkforceTransition i in read.items) {
        final bool held = i.assignmentId == target.assignmentId &&
            i.status == WorkforceQueueStatus.rejected &&
            i.seq >= target.seq &&
            (i.id == id || i.rejectionReason == _dependsOnRejected);
        if (held) await _queue.remove(userId, i.id);
      }
    });
  }

  /// Puts a refused update (and the ones held behind it) back in the queue
  /// and tries again. Only the earliest refused update of an assignment can be
  /// retried, so order is preserved.
  Future<WorkforceFlushSummary> retry(String userId, String id) async {
    await _serial(() async {
      final WorkforceQueueRead read = await _queue.list(userId);
      if (!read.isReadable) return;
      QueuedWorkforceTransition? target;
      for (final QueuedWorkforceTransition i in read.items) {
        if (i.id == id) target = i;
      }
      if (target == null || target.status != WorkforceQueueStatus.rejected) {
        return;
      }
      final QueuedWorkforceTransition found = target;
      final bool earlierRefused = read.items.any(
        (QueuedWorkforceTransition i) =>
            i.assignmentId == found.assignmentId &&
            i.status == WorkforceQueueStatus.rejected &&
            i.seq < found.seq,
      );
      if (earlierRefused) return;
      for (final QueuedWorkforceTransition i in read.items) {
        final bool reopen = i.assignmentId == found.assignmentId &&
            i.status == WorkforceQueueStatus.rejected &&
            i.seq >= found.seq &&
            (i.id == id || i.rejectionReason == _dependsOnRejected);
        if (reopen) {
          await _queue.put(
            i.copyWith(status: WorkforceQueueStatus.pending, clearError: true),
          );
        }
      }
    });
    return flush(userId);
  }
}

/// [serverStatus] with every PENDING entry for one assignment applied in
/// order. Entries that no longer apply are skipped (the server decides).
String effectiveWorkforceStatus(
  String serverStatus,
  Iterable<QueuedWorkforceTransition> entries,
) {
  final List<QueuedWorkforceTransition> pending = entries
      .where(
        (QueuedWorkforceTransition i) =>
            i.status == WorkforceQueueStatus.pending,
      )
      .toList()
    ..sort(
      (QueuedWorkforceTransition a, QueuedWorkforceTransition b) =>
          a.seq.compareTo(b.seq),
    );
  String status = serverStatus;
  for (final QueuedWorkforceTransition entry in pending) {
    status = applyWorkforceAction(status, entry.action) ?? status;
  }
  return status;
}
