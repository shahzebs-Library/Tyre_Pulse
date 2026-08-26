/// This feature's dedicated on-device queue for checklist approval
/// decisions that could not be confirmed delivered yet.
///
/// # Why a file-backed queue, and not a new Drift table
///
/// Two shapes were genuinely weighed before writing this file, per this
/// port's own investigation (not assumed):
///
/// - A NEW Drift table, mirroring `lib/core/database/tables/queue_tables.dart`
///   /`dao/queue_dao.dart`'s shape for the generic command queue. Rejected:
///   `queue_dao.dart` is built around `CommandType` and `CommandSpec` from
///   the CLOSED `command_registry.dart` enum this feature is explicitly
///   forbidden from touching (`CHECKLIST_APPROVAL` is deliberately excluded
///   from it - see `queued_checklist_approval_decision.dart`'s library
///   comment), so reusing it would mean widening shared, high-care
///   infrastructure for a single feature's low-volume writes. A genuinely
///   NEW, separate Drift table was also considered and rejected: this
///   feature's write volume is a handful of decisions per reviewer per
///   shift (never a field-wide fan-out the way inspection submissions or
///   photo uploads are), and a schema migration - a new table, a new DAO,
///   a `schemaVersion` bump in `app_database.dart` - is real, permanent
///   surface area for a queue this small.
/// - `lib/features/inspections/data/inspection_submission_queue.dart`'s
///   `FileInspectionSubmissionQueue` - a plain, `path_provider`-backed,
///   one-JSON-file-per-entry queue, built for the EXACT same reason this
///   feature needs one: a feature-owned write that the closed generic
///   registry cannot carry. Chosen. It needs zero schema migration, zero
///   change to `lib/core/database/`, and reproduces every durability
///   property that actually matters here (atomic write, one file per
///   entry so a write to one decision can never corrupt another, a
///   corrupt individual file degrades to "one bad row" rather than taking
///   the whole queue down, and a read that could not happen at all is
///   distinguished from a read that genuinely found nothing).
///
/// This file is therefore, deliberately, a close structural mirror of
/// `FileInspectionSubmissionQueue` - same atomic-write technique (write a
/// sibling `.tmp` file, rename it over the real one - a rename within the
/// same directory is the durable commit point on both Android and iOS),
/// same refuse-rather-than-guess read contract
/// ([ChecklistApprovalQueueReadResult]), same per-entry-file isolation.
/// Read [ChecklistApprovalDecisionQueue] over
/// [InspectionSubmissionQueue] side by side before changing either.
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';

/// The narrow surface [ChecklistApprovalSyncEngine] and the queue/review
/// screens need. Abstract so tests substitute an in-memory fake - mirrors
/// `InspectionSubmissionQueue`'s own split.
abstract interface class ChecklistApprovalDecisionQueue {
  Future<void> enqueue(QueuedChecklistApprovalDecision item);

  Future<ChecklistApprovalQueueReadResult> list();

  Future<QueuedChecklistApprovalDecision?> byId(String id);

  Future<void> markSynced(String id, DateTime at);

  /// Records [error] and moves this entry to [status] - either
  /// [ChecklistApprovalQueueStatus.pending] (a transient, connectivity-style
  /// failure the engine will retry on its own) or
  /// [ChecklistApprovalQueueStatus.blocked] (a definitive refusal, or a
  /// detected conflict, that must not be retried automatically). See
  /// [ChecklistApprovalSyncEngine] for who decides which.
  Future<void> markFailed(
    String id, {
    required String error,
    required ChecklistApprovalQueueStatus status,
  });

  /// Removes the queue entry. Only correct to call once delivery is
  /// CONFIRMED - see `ChecklistApprovalSyncEngine`, the only caller.
  Future<void> remove(String id);

  /// Count of entries not yet [ChecklistApprovalQueueStatus.synced] -
  /// [pending] and [blocked] both count, because both still represent a
  /// decision this device has not yet confirmed reached the server. Returns
  /// 0 on an unreadable store rather than throwing, matching
  /// `InspectionSubmissionQueue.pendingCount`'s own documented contract: a
  /// badge is allowed to under-report while genuinely unable to look.
  Future<int> pendingCount();
}

/// The real, file-backed implementation.
final class FileChecklistApprovalDecisionQueue
    implements ChecklistApprovalDecisionQueue {
  FileChecklistApprovalDecisionQueue({Directory? overrideDirectory})
      : _overrideDirectory = overrideDirectory;

  /// Test seam: a fixed temp directory instead of
  /// [getApplicationDocumentsDirectory], which needs a platform channel
  /// this environment cannot provide.
  final Directory? _overrideDirectory;

  static const String _folderName = 'checklist_approval_decisions';

  Future<Directory> _directory() async {
    final Directory base =
        _overrideDirectory ?? await getApplicationDocumentsDirectory();
    final Directory dir = Directory(
      '${base.path}${Platform.pathSeparator}$_folderName',
    );
    if (!dir.existsSync()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  File _fileFor(Directory dir, String id) =>
      File('${dir.path}${Platform.pathSeparator}$id.json');

  @override
  Future<void> enqueue(QueuedChecklistApprovalDecision item) async {
    final Directory dir = await _directory();
    await _writeAtomic(_fileFor(dir, item.id), item.toJsonString());
  }

  @override
  Future<ChecklistApprovalQueueReadResult> list() async {
    final Directory dir;
    final List<FileSystemEntity> entries;
    try {
      dir = await _directory();
      entries = await dir.list().toList();
    } on Object {
      return const ChecklistApprovalQueueReadResult.unreadable();
    }

    final List<QueuedChecklistApprovalDecision> items =
        <QueuedChecklistApprovalDecision>[];
    for (final FileSystemEntity entity in entries) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      if (entity.path.endsWith('.tmp')) continue;
      try {
        final String raw = await entity.readAsString();
        items.add(QueuedChecklistApprovalDecision.fromJsonString(raw));
      } on Object {
        // One corrupt file must not fail the whole read - see the library
        // comment. It is simply omitted; nothing here silently deletes it.
        continue;
      }
    }
    return ChecklistApprovalQueueReadResult.ok(items);
  }

  @override
  Future<QueuedChecklistApprovalDecision?> byId(String id) async {
    final Directory dir = await _directory();
    final File file = _fileFor(dir, id);
    if (!file.existsSync()) return null;
    try {
      return QueuedChecklistApprovalDecision.fromJsonString(
        await file.readAsString(),
      );
    } on Object {
      return null;
    }
  }

  @override
  Future<void> markSynced(String id, DateTime at) async {
    final QueuedChecklistApprovalDecision? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: ChecklistApprovalQueueStatus.synced,
        syncedAt: at,
        clearError: true,
      ),
    );
  }

  @override
  Future<void> markFailed(
    String id, {
    required String error,
    required ChecklistApprovalQueueStatus status,
  }) async {
    final QueuedChecklistApprovalDecision? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: status,
        error: error,
        attempts: current.attempts + 1,
      ),
    );
  }

  @override
  Future<void> remove(String id) async {
    final Directory dir = await _directory();
    final File file = _fileFor(dir, id);
    if (file.existsSync()) {
      await file.delete();
    }
  }

  @override
  Future<int> pendingCount() async {
    final ChecklistApprovalQueueReadResult result = await list();
    if (!result.isReadable) return 0;
    return result.items
        .where((d) => d.status != ChecklistApprovalQueueStatus.synced)
        .length;
  }

  Future<void> _writeAtomic(File target, String contents) async {
    final File temp = File('${target.path}.tmp');
    await temp.writeAsString(contents, flush: true);
    await temp.rename(target.path);
  }
}

/// The two ways a read of the on-device queue store can come back "empty",
/// and why they must never be conflated - mirrors
/// `InspectionQueueReadResult`'s own doc comment and
/// `mobile/lib/offlineQueue.ts`'s `QueueUnreadableError` almost verbatim,
/// over a different queue for the same reason: a directory that genuinely
/// enumerates zero files is [ok] with an empty list; a directory that could
/// not be listed at all is [unreadable] and MUST NOT be treated by any
/// caller as "nothing is queued" - in particular, a flush pass over an
/// unreadable store must refuse rather than silently report "everything
/// synced".
enum ChecklistApprovalQueueReadStatus { ok, unreadable }

class ChecklistApprovalQueueReadResult {
  const ChecklistApprovalQueueReadResult._({
    required this.status,
    required this.items,
  });

  const ChecklistApprovalQueueReadResult.ok(
    List<QueuedChecklistApprovalDecision> items,
  ) : this._(status: ChecklistApprovalQueueReadStatus.ok, items: items);

  const ChecklistApprovalQueueReadResult.unreadable()
      : this._(
          status: ChecklistApprovalQueueReadStatus.unreadable,
          items: const <QueuedChecklistApprovalDecision>[],
        );

  final ChecklistApprovalQueueReadStatus status;
  final List<QueuedChecklistApprovalDecision> items;

  bool get isReadable => status == ChecklistApprovalQueueReadStatus.ok;
}
