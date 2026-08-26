/// "My checklist history": this operator's own already-synced submissions,
/// merged with whatever of their own submissions is still sitting in the
/// SHARED offline command queue (queued, retrying, or permanently failed).
///
/// # Why the local half reads `QueueDao` directly rather than a
/// # feature-owned queue
///
/// Checklist submission goes through the generic `pending_commands` table
/// (see `checklist_submission_repository.dart`'s own library comment for
/// why), so there is no feature-owned queue file to read back from the way
/// `features/inspections/data/inspection_submission_queue.dart` has one.
/// This file filters `QueueDao.outstandingCommands` down to
/// `CommandType.checklistSubmission.wireName` and decodes each row's own
/// `payloadJson` - the same payload `checklist_submission_repository.dart`
/// built - back into a small, presentation-ready shape.
library;

import 'dart:convert';

import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/features/checklists/data/checklist_history_row.dart';

/// One of this operator's OWN submissions still in the local queue -
/// queued, being retried, or permanently failed. Never `synced`:
/// [QueueDao.outstandingCommands] already excludes those.
final class QueuedChecklistSubmission {
  const QueuedChecklistSubmission({
    required this.commandId,
    required this.submissionId,
    required this.status,
    required this.createdAt,
    this.templateName,
    this.site,
    this.assetNo,
    this.title,
    this.lastError,
  });

  /// `pending_commands.id`.
  final String commandId;

  /// The `checklist_submissions.id` this command will insert once it
  /// succeeds - read back from the payload's own `id` key.
  final String submissionId;

  /// One of [CommandStatus]: pending, processing, retry, blocked, failed.
  final String status;

  final DateTime createdAt;
  final String? templateName;
  final String? site;
  final String? assetNo;
  final String? title;

  /// Sanitised at write time by `QueueDao.markAttemptFailed` - safe to show.
  final String? lastError;

  bool get needsAttention => status == CommandStatus.failed;
}

/// A single, already-merged "my checklist history" view: completed
/// submissions plus whatever of the operator's own work is still queued.
final class ChecklistHistory {
  const ChecklistHistory({required this.completed, required this.queued});

  final List<ChecklistHistoryRow> completed;
  final List<QueuedChecklistSubmission> queued;

  int get attentionCount =>
      queued.where((QueuedChecklistSubmission q) => q.needsAttention).length;

  int get pendingCount =>
      queued.where((QueuedChecklistSubmission q) => !q.needsAttention).length;
}

abstract interface class ChecklistHistoryRepository {
  /// Loads [ChecklistHistory] for [userId] under [workspaceId].
  ///
  /// Never throws: a failure reading either half degrades that half to an
  /// empty list rather than taking the other half down with it - the same
  /// discipline `inspection_history_screen.dart`'s own load method applies
  /// to its queue/synced split.
  Future<ChecklistHistory> load({
    required String userId,
    required String workspaceId,
  });
}

final class DefaultChecklistHistoryRepository
    implements ChecklistHistoryRepository {
  DefaultChecklistHistoryRepository({
    required QueueDao queueDao,
    required Future<List<ChecklistHistoryRow>> Function(String submittedBy)
        loadCompleted,
  })  : _queueDao = queueDao,
        _loadCompleted = loadCompleted;

  final QueueDao _queueDao;
  final Future<List<ChecklistHistoryRow>> Function(String submittedBy)
      _loadCompleted;

  @override
  Future<ChecklistHistory> load({
    required String userId,
    required String workspaceId,
  }) async {
    List<ChecklistHistoryRow> completed = const <ChecklistHistoryRow>[];
    if (userId.isNotEmpty) {
      try {
        completed = await _loadCompleted(userId);
      } on Object {
        completed = const <ChecklistHistoryRow>[];
      }
    }

    List<QueuedChecklistSubmission> queued =
        const <QueuedChecklistSubmission>[];
    try {
      final List<PendingCommand> rows = await _queueDao.outstandingCommands(
        workspaceId: workspaceId,
      );
      final List<QueuedChecklistSubmission> built =
          <QueuedChecklistSubmission>[];
      for (final PendingCommand row in rows) {
        if (row.commandType != CommandType.checklistSubmission.wireName) {
          continue;
        }
        // Only THIS user's own captured work - a shared handset must never
        // show one worker's queued sheet as another's history.
        if (row.createdBy != userId) continue;
        final QueuedChecklistSubmission? decoded = _decode(row);
        if (decoded != null) built.add(decoded);
      }
      queued = built;
    } on Object {
      queued = const <QueuedChecklistSubmission>[];
    }

    return ChecklistHistory(completed: completed, queued: queued);
  }

  QueuedChecklistSubmission? _decode(PendingCommand row) {
    try {
      final Object? decoded = jsonDecode(row.payloadJson);
      if (decoded is! Map) return null;
      final String submissionId =
          (decoded['id'] as Object?)?.toString() ?? row.entityId ?? row.id;
      return QueuedChecklistSubmission(
        commandId: row.id,
        submissionId: submissionId,
        status: row.status,
        createdAt: row.createdAt,
        templateName: (decoded['template_name'] as Object?)?.toString(),
        site: (decoded['site'] as Object?)?.toString(),
        assetNo: (decoded['asset_no'] as Object?)?.toString(),
        title: (decoded['title'] as Object?)?.toString(),
        lastError: row.lastError,
      );
    } on Object {
      // A corrupt payload must not take the rest of the queue's history
      // down with it.
      return null;
    }
  }
}
