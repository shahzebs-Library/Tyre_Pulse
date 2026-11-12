/// This feature's dedicated on-device queue for submitted-but-not-yet-confirmed
/// vehicle handovers.
///
/// A literal reproduction of `inspection_submission_queue.dart`'s mechanism and
/// durability rules for this feature's own entry type - see that file and
/// `queued_handover.dart`'s library comment for WHY a dedicated queue exists
/// instead of `pending_commands`. One JSON file per [QueuedHandover], never a
/// shared blob:
///
/// - **Atomic write.** Every write goes to a sibling `.tmp` file and is RENAMEd
///   over the real one - a rename within the directory is the durable commit
///   point on Android and iOS.
/// - **Refuse, never guess, on an unreadable store.** [list] distinguishes "the
///   folder listed fine and is empty" from "the folder could not be listed at
///   all", and a caller must never treat the latter as "nothing is queued".
/// - **A corrupt individual file is skipped, not fatal.**
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:tyre_pulse/features/handover/domain/queued_handover.dart';

/// The narrow surface the sync engine and controllers need. Abstract so a test
/// can substitute an in-memory fake.
abstract interface class HandoverSubmissionQueue {
  Future<void> enqueue(QueuedHandover item);

  Future<HandoverQueueReadResult> list();

  Future<QueuedHandover?> byId(String id);

  Future<void> markSynced(String id, DateTime at);

  Future<void> markFailed(String id, {required String error});

  Future<void> remove(String id);

  /// Count of entries that are not yet [HandoverQueueStatus.synced]. Returns 0
  /// on an unreadable store rather than throwing - a numeric badge may
  /// under-report while genuinely unable to look; contrast [list], which a
  /// mutator MUST NOT degrade the same way.
  Future<int> pendingCount();
}

/// The real, file-backed implementation.
final class FileHandoverSubmissionQueue implements HandoverSubmissionQueue {
  FileHandoverSubmissionQueue({Directory? overrideDirectory})
      : _overrideDirectory = overrideDirectory;

  /// Test seam: a fixed temp directory instead of
  /// [getApplicationDocumentsDirectory], which needs a platform channel this
  /// environment cannot provide.
  final Directory? _overrideDirectory;

  static const String _folderName = 'handover_submissions';

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
  Future<void> enqueue(QueuedHandover item) async {
    final Directory dir = await _directory();
    await _writeAtomic(_fileFor(dir, item.id), item.toJsonString());
  }

  @override
  Future<HandoverQueueReadResult> list() async {
    final Directory dir;
    final List<FileSystemEntity> entries;
    try {
      dir = await _directory();
      entries = await dir.list().toList();
    } on Object {
      return const HandoverQueueReadResult.unreadable();
    }

    final List<QueuedHandover> items = <QueuedHandover>[];
    for (final FileSystemEntity entity in entries) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      if (entity.path.endsWith('.tmp')) continue;
      try {
        items.add(QueuedHandover.fromJsonString(await entity.readAsString()));
      } on Object {
        // One corrupt file must not fail the whole read. It is simply omitted;
        // nothing here deletes it, because it may still be recoverable by hand.
        continue;
      }
    }
    return HandoverQueueReadResult.ok(items);
  }

  @override
  Future<QueuedHandover?> byId(String id) async {
    final Directory dir = await _directory();
    final File file = _fileFor(dir, id);
    if (!file.existsSync()) return null;
    try {
      return QueuedHandover.fromJsonString(await file.readAsString());
    } on Object {
      return null;
    }
  }

  @override
  Future<void> markSynced(String id, DateTime at) async {
    final QueuedHandover? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: HandoverQueueStatus.synced,
        syncedAt: at,
        clearError: true,
      ),
    );
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    final QueuedHandover? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: HandoverQueueStatus.failed,
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
    final HandoverQueueReadResult result = await list();
    if (!result.isReadable) return 0;
    return result.items
        .where((QueuedHandover q) => q.status != HandoverQueueStatus.synced)
        .length;
  }

  Future<void> _writeAtomic(File target, String contents) async {
    final File temp = File('${target.path}.tmp');
    await temp.writeAsString(contents, flush: true);
    await temp.rename(target.path);
  }
}
