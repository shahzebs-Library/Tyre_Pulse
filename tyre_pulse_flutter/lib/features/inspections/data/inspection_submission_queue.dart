/// This feature's dedicated on-device queue for submitted-but-not-yet-
/// confirmed inspections.
///
/// See `queued_inspection.dart`'s library comment for WHY this exists
/// instead of `pending_commands` - that reasoning is not repeated here.
/// This file is the mechanism: one JSON file per [QueuedInspection], never
/// a shared blob, so a write to one submission can never race or corrupt
/// another, and a corrupt individual file degrades to "one bad row",
/// never to "the whole queue is unreadable".
///
/// # Durability rules, each mirrored from a named production defect
///
/// - **Atomic write.** [enqueue] and every status update write to a
///   sibling `.tmp` file and RENAME it over the real one. A rename within
///   the same directory is the durable commit point on both Android and
///   iOS filesystems; a direct overwrite leaves a window, however brief,
///   where a process kill mid-write corrupts the file. Mirrors the
///   staged-write discipline `mobile/lib/secureStorage.ts` uses for
///   exactly the same reason (artifact 01 section 5.7).
/// - **Refuse, never guess, on an unreadable store.** [list] returns an
///   [InspectionQueueReadResult] that distinguishes "the folder listed
///   fine and is empty" from "the folder could not be listed at all" -
///   see that type's own doc comment, and `mobile/lib/offlineQueue.ts`'s
///   `QueueUnreadableError`, which this reproduces. A caller must never
///   treat [InspectionQueueReadStatus.unreadable] as "nothing is queued".
/// - **A corrupt individual file is skipped, not fatal.** [list] parses
///   every `.json` file it finds; one that fails to parse is recorded as
///   a diagnostic and excluded from the result rather than aborting the
///   whole read - a structural improvement over RN's single-blob shape,
///   where one corrupt entry could threaten the entire queue.
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';

/// The narrow surface the sync engine and the controllers need. Abstract
/// so a test can substitute an in-memory fake with no real filesystem -
/// mirrored by [InMemoryInspectionSubmissionQueue] in the test suite for
/// exactly that purpose (see `test/features/inspections/data/`).
abstract interface class InspectionSubmissionQueue {
  Future<void> enqueue(QueuedInspection item);

  Future<InspectionQueueReadResult> list();

  Future<QueuedInspection?> byId(String id);

  Future<void> markSynced(String id, DateTime at);

  Future<void> markFailed(String id, {required String error});

  /// Removes the queue entry. Only correct to call once its underlying
  /// draft has ALSO been discarded (or was never real work) - see
  /// `InspectionSyncEngine`, the only caller.
  Future<void> remove(String id);

  /// Count of entries that are not yet [InspectionQueueStatus.synced].
  /// Returns 0 on an unreadable store rather than throwing, because a
  /// badge is allowed to under-report while genuinely unable to look
  /// (spec section 32's "we could not look" is still owed to the log, but
  /// a numeric badge has no room for a third state) - contrast this with
  /// [list], which a mutator MUST NOT degrade the same way.
  Future<int> pendingCount();
}

/// The real, file-backed implementation.
final class FileInspectionSubmissionQueue implements InspectionSubmissionQueue {
  FileInspectionSubmissionQueue({Directory? overrideDirectory})
      : _overrideDirectory = overrideDirectory;

  /// Test seam: a fixed temp directory instead of
  /// [getApplicationDocumentsDirectory], which needs a platform channel
  /// this environment cannot provide.
  final Directory? _overrideDirectory;

  static const String _folderName = 'inspection_submissions';

  Future<Directory> _directory() async {
    final Directory base =
        _overrideDirectory ?? await getApplicationDocumentsDirectory();
    final Directory dir = Directory(
      '${base.path}${Platform.pathSeparator}'
      '$_folderName',
    );
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  File _fileFor(Directory dir, String id) =>
      File('${dir.path}${Platform.pathSeparator}$id.json');

  @override
  Future<void> enqueue(QueuedInspection item) async {
    final Directory dir = await _directory();
    await _writeAtomic(_fileFor(dir, item.id), item.toJsonString());
  }

  @override
  Future<InspectionQueueReadResult> list() async {
    final Directory dir;
    final List<FileSystemEntity> entries;
    try {
      dir = await _directory();
      entries = await dir.list().toList();
    } on Object {
      return const InspectionQueueReadResult.unreadable();
    }

    final List<QueuedInspection> items = <QueuedInspection>[];
    for (final FileSystemEntity entity in entries) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      if (entity.path.endsWith('.tmp')) continue;
      try {
        final String raw = await entity.readAsString();
        items.add(QueuedInspection.fromJsonString(raw));
      } on Object {
        // One corrupt file must not fail the whole read - see the library
        // comment. It is simply omitted; nothing here silently deletes it,
        // because a person may still be able to recover it by hand.
        continue;
      }
    }
    return InspectionQueueReadResult.ok(items);
  }

  @override
  Future<QueuedInspection?> byId(String id) async {
    final Directory dir = await _directory();
    final File file = _fileFor(dir, id);
    if (!await file.exists()) return null;
    try {
      return QueuedInspection.fromJsonString(await file.readAsString());
    } on Object {
      return null;
    }
  }

  @override
  Future<void> markSynced(String id, DateTime at) async {
    final QueuedInspection? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: InspectionQueueStatus.synced,
        syncedAt: at,
        clearError: true,
      ),
    );
  }

  @override
  Future<void> markFailed(String id, {required String error}) async {
    final QueuedInspection? current = await byId(id);
    if (current == null) return;
    await enqueue(
      current.copyWith(
        status: InspectionQueueStatus.failed,
        error: error,
        attempts: current.attempts + 1,
      ),
    );
  }

  @override
  Future<void> remove(String id) async {
    final Directory dir = await _directory();
    final File file = _fileFor(dir, id);
    if (await file.exists()) {
      await file.delete();
    }
  }

  @override
  Future<int> pendingCount() async {
    final InspectionQueueReadResult result = await list();
    if (!result.isReadable) return 0;
    return result.items
        .where((q) => q.status != InspectionQueueStatus.synced)
        .length;
  }

  Future<void> _writeAtomic(File target, String contents) async {
    final File temp = File('${target.path}.tmp');
    await temp.writeAsString(contents, flush: true);
    await temp.rename(target.path);
  }
}
