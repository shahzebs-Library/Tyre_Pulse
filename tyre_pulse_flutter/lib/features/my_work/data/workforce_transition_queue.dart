/// Durable, per-user on-device queue of assignment status updates.
///
/// Same technique as the checklist approval decision queue
/// (`features/approvals/data/checklist_approval_decision_queue.dart`): one JSON
/// file per entry, written to a sibling `.tmp` then renamed (the rename is the
/// durable commit point), a corrupt single file degrades to "one bad row", and
/// an unreadable store is reported as unreadable, never as "nothing queued".
///
/// The only difference is partitioning: entries live under a folder named after
/// the signed-in user's id, so a shared phone can never send one person's
/// updates under another person's session, and signing out keeps the queue.
///
/// Not a Drift table on purpose: the generic command registry is a closed enum
/// for high-volume field writes, and a handful of status taps per shift does
/// not justify a schema migration. See the checklist queue's library comment
/// for the full reasoning, which applies unchanged.
library;

import 'dart:io';

import 'package:path_provider/path_provider.dart';
import 'package:tyre_pulse/features/my_work/data/queued_workforce_transition.dart';

abstract interface class WorkforceTransitionQueue {
  /// Writes (or replaces) an entry atomically.
  Future<void> put(QueuedWorkforceTransition item);

  /// Every readable entry for [userId], ordered by [QueuedWorkforceTransition.seq].
  Future<WorkforceQueueRead> list(String userId);

  /// Removes an entry. Only correct once delivery is confirmed or the user has
  /// dismissed a refused update.
  Future<void> remove(String userId, String id);
}

final class WorkforceQueueRead {
  const WorkforceQueueRead.ok(this.items) : isReadable = true;

  const WorkforceQueueRead.unreadable()
      : items = const <QueuedWorkforceTransition>[],
        isReadable = false;

  final List<QueuedWorkforceTransition> items;

  /// `false` means "could not look". Callers must not treat that as empty.
  final bool isReadable;
}

final RegExp _safeSegment = RegExp(r'^[A-Za-z0-9_-]{8,100}$');

final class FileWorkforceTransitionQueue implements WorkforceTransitionQueue {
  FileWorkforceTransitionQueue({Directory? overrideDirectory})
      : _overrideDirectory = overrideDirectory;

  /// Test seam: a temp directory instead of a platform-channel lookup.
  final Directory? _overrideDirectory;

  static const String _folderName = 'workforce_transitions';

  Future<Directory> _userDirectory(String userId) async {
    if (!_safeSegment.hasMatch(userId)) {
      throw ArgumentError.value(userId, 'userId', 'Unsafe path segment');
    }
    final Directory base =
        _overrideDirectory ?? await getApplicationDocumentsDirectory();
    final Directory dir = Directory(
      '${base.path}${Platform.pathSeparator}$_folderName'
      '${Platform.pathSeparator}$userId',
    );
    if (!dir.existsSync()) {
      await dir.create(recursive: true);
    }
    return dir;
  }

  File _fileFor(Directory dir, String id) {
    if (!_safeSegment.hasMatch(id)) {
      throw ArgumentError.value(id, 'id', 'Unsafe path segment');
    }
    return File('${dir.path}${Platform.pathSeparator}$id.json');
  }

  @override
  Future<void> put(QueuedWorkforceTransition item) async {
    final Directory dir = await _userDirectory(item.userId);
    final File target = _fileFor(dir, item.id);
    final File temp = File('${target.path}.tmp');
    await temp.writeAsString(item.toJsonString(), flush: true);
    await temp.rename(target.path);
  }

  @override
  Future<WorkforceQueueRead> list(String userId) async {
    final List<FileSystemEntity> entries;
    try {
      final Directory dir = await _userDirectory(userId);
      entries = await dir.list().toList();
    } on Object {
      return const WorkforceQueueRead.unreadable();
    }
    final List<QueuedWorkforceTransition> items = <QueuedWorkforceTransition>[];
    for (final FileSystemEntity entity in entries) {
      if (entity is! File || !entity.path.endsWith('.json')) continue;
      try {
        final QueuedWorkforceTransition item =
            QueuedWorkforceTransition.fromJsonString(
          await entity.readAsString(),
        );
        // A file that does not belong to this user is ignored, never sent.
        if (item.userId == userId) items.add(item);
      } on Object {
        // One corrupt file must not take the whole queue down. It is left on
        // disk untouched for diagnosis; nothing here deletes it.
        continue;
      }
    }
    items.sort(
      (QueuedWorkforceTransition a, QueuedWorkforceTransition b) =>
          a.seq != b.seq ? a.seq.compareTo(b.seq) : a.id.compareTo(b.id),
    );
    return WorkforceQueueRead.ok(items);
  }

  @override
  Future<void> remove(String userId, String id) async {
    final Directory dir = await _userDirectory(userId);
    final File file = _fileFor(dir, id);
    if (file.existsSync()) {
      await file.delete();
    }
  }
}
