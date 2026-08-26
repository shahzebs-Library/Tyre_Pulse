/// Reads and writes for the offline command queue.
///
/// Every method here is a row operation. Nothing in this file reads a
/// collection into memory, changes it and writes the whole thing back - that
/// pattern is what let one bad read replace a worker's unsynced inspections
/// with an empty list. A read failure surfaces as a thrown driver error, never
/// as an empty result.
library;

import 'package:drift/drift.dart';
import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/database/tables/queue_tables.dart';
import 'package:tyre_pulse/core/database/tables/sync_tables.dart';
import 'package:uuid/uuid.dart';

part 'queue_dao.g.dart';

/// A photo to attach to a command at enqueue time.
///
/// The file must ALREADY have been copied out of the OS cache directory into
/// the durable queue media folder before this is constructed. Enqueuing a cache
/// path produces a queue that comes back holding dead URIs after the OS purges
/// it, which is why the copy happens before the enqueue rather than before the
/// upload.
class QueuedMediaAttachment {
  const QueuedMediaAttachment({
    required this.localPath,
    required this.fileName,
    required this.orderIndex,
    this.fieldKey,
    this.sizeBytes,
    this.mimeType,
    this.checksum,
    this.bucket,
  });

  final String localPath;
  final String fileName;

  /// Position within its field. Rebuilding the keyed photo map in the right
  /// order depends on this.
  final int orderIndex;

  /// Checklist field id, or tyre position, or null for a flat list.
  final String? fieldKey;

  final int? sizeBytes;
  final String? mimeType;
  final String? checksum;
  final String? bucket;
}

/// The queue, its media, its dead letters and the sync lock.
@DriftAccessor(
  tables: <Type>[
    PendingCommands,
    PendingMediaUploads,
    SyncFailures,
    SyncMetadata,
  ],
)
class QueueDao extends DatabaseAccessor<AppDatabase> with _$QueueDaoMixin {
  QueueDao(super.attachedDatabase);

  static const Uuid _uuid = Uuid();

  /// Enqueues one command and its photos in a SINGLE transaction.
  ///
  /// The idempotency key is minted here, before any network attempt, and
  /// committed in the same transaction as the payload. If the app dies between
  /// the two writes neither exists; a retry with a fresh key would otherwise
  /// insert a second server row.
  ///
  /// The unique index on `idempotencyKey` means a second screen cannot enqueue
  /// the same logical write twice: the insert raises instead of quietly
  /// duplicating.
  Future<PendingCommand> enqueue({
    required String commandType,
    required String entityType,
    required String payloadJson,
    required String createdBy,
    required String workspaceId,
    required DateTime now,
    String? id,
    String? idempotencyKey,
    String? entityId,
    String? country,
    String? dependsOn,
    List<QueuedMediaAttachment> attachments = const <QueuedMediaAttachment>[],
  }) async {
    final String commandId = id ?? _uuid.v4();
    final String key = idempotencyKey ?? _uuid.v4();

    return transaction(() async {
      await into(pendingCommands).insert(
        PendingCommandsCompanion.insert(
          id: commandId,
          commandType: commandType,
          entityType: entityType,
          payloadJson: payloadJson,
          createdAt: now,
          createdBy: createdBy,
          workspaceId: workspaceId,
          nextRetryAt: now,
          status: CommandStatus.pending,
          idempotencyKey: key,
          entityId: Value<String?>(entityId),
          country: Value<String?>(country),
          dependsOn: Value<String?>(dependsOn),
        ),
      );

      for (final QueuedMediaAttachment attachment in attachments) {
        await into(pendingMediaUploads).insert(
          PendingMediaUploadsCompanion.insert(
            id: _uuid.v4(),
            commandId: commandId,
            orderIndex: attachment.orderIndex,
            localPath: attachment.localPath,
            fileName: attachment.fileName,
            state: MediaUploadState.queued,
            capturedAt: now,
            fieldKey: Value<String?>(attachment.fieldKey),
            sizeBytes: Value<int?>(attachment.sizeBytes),
            mimeType: Value<String?>(attachment.mimeType),
            checksum: Value<String?>(attachment.checksum),
            bucket: Value<String?>(attachment.bucket),
          ),
        );
      }

      return _requireById(commandId);
    });
  }

  /// Claims the next batch of due work for [workspaceId] and marks it
  /// `processing`.
  ///
  /// Three refusals are built in and each prevents a specific failure:
  ///
  /// - Only `pending` and `retry` are claimable. A `blocked` row is waiting on
  ///   a decision, not on a turn, and claiming it would push work the user was
  ///   told would not be pushed.
  /// - Only rows captured in [workspaceId] are claimed. Pushing a command
  ///   captured elsewhere under the active context is a cross-tenant write.
  /// - A row whose `dependsOn` predecessor has not reached `synced` is set
  ///   `blocked` rather than claimed, so it is visibly waiting rather than
  ///   silently reordered. A predecessor that no longer exists was pruned,
  ///   which only happens after it synced, so it counts as satisfied.
  Future<List<PendingCommand>> claimNextBatch({
    required String workspaceId,
    required DateTime now,
    int limit = 10,
  }) async {
    return transaction(() async {
      final due =
          await (select(pendingCommands)
                ..where(
                  (t) =>
                      (t.status.equals(CommandStatus.pending) |
                          t.status.equals(CommandStatus.retry)) &
                      t.workspaceId.equals(workspaceId) &
                      t.nextRetryAt.isSmallerOrEqualValue(now),
                )
                ..orderBy([
                  (t) => OrderingTerm.asc(t.createdAt),
                  (t) => OrderingTerm.asc(t.id),
                ])
                ..limit(limit))
              .get();

      final claimed = <PendingCommand>[];
      for (final PendingCommand row in due) {
        final String? predecessor = row.dependsOn;
        if (predecessor != null && !await _predecessorSatisfied(predecessor)) {
          await _setStatus(
            row.id,
            CommandStatus.blocked,
            error: 'Waiting on an earlier record that has not synced yet.',
          );
          continue;
        }
        await _setStatus(row.id, CommandStatus.processing);
        claimed.add(await _requireById(row.id));
      }
      return claimed;
    });
  }

  /// Marks a command as delivered.
  ///
  /// This is committed BEFORE anything is pruned or any file is deleted. A
  /// crash between the two loses nothing; the reverse order loses the `synced`
  /// marking and replays an already-committed insert.
  Future<void> markSynced(String id, DateTime at) async {
    await (update(pendingCommands)..where((t) => t.id.equals(id))).write(
      PendingCommandsCompanion(
        status: const Value<String>(CommandStatus.synced),
        syncedAt: Value<DateTime?>(at),
        lastError: const Value<String?>(null),
      ),
    );
  }

  /// Records a failed attempt and schedules the next one.
  ///
  /// Returns the row as it now stands so the caller can report whether the
  /// command is waiting or has given up. On exhaustion the row goes `failed`
  /// and STAYS in the table: nothing that has not reached the server is ever
  /// removed automatically.
  ///
  /// [message] must already be sanitised. A raw driver message stored here
  /// leaks later through a log export or a support screenshot.
  Future<PendingCommand> markAttemptFailed(
    String id, {
    required DateTime now,
    required String message,
  }) async {
    return transaction(() async {
      final PendingCommand current = await _requireById(id);
      final int attempts = current.retryCount + 1;
      final bool exhausted = attempts >= QueueRetryPolicy.maxRetries;
      final DateTime nextAttempt = now.add(
        QueueRetryPolicy.backoffFor(current.retryCount),
      );

      await (update(pendingCommands)..where((t) => t.id.equals(id))).write(
        PendingCommandsCompanion(
          retryCount: Value<int>(attempts),
          nextRetryAt: Value<DateTime>(exhausted ? now : nextAttempt),
          status: Value<String>(
            exhausted ? CommandStatus.failed : CommandStatus.retry,
          ),
          lastError: Value<String?>(message),
        ),
      );
      return _requireById(id);
    });
  }

  /// Blocks a command without treating it as a failure.
  ///
  /// Used when a row was captured in a workspace that is no longer active.
  /// Nothing is wrong with the row; it simply may not run under this context,
  /// and it is never discarded.
  Future<void> blockCommand(String id, {required String reason}) =>
      _setStatus(id, CommandStatus.blocked, error: reason);

  /// Puts blocked rows back in the queue, for example after switching back to
  /// the workspace they were captured in.
  Future<int> unblockForWorkspace({
    required String workspaceId,
    required DateTime now,
  }) {
    return (update(pendingCommands)..where(
          (t) =>
              t.status.equals(CommandStatus.blocked) &
              t.workspaceId.equals(workspaceId),
        ))
        .write(
          PendingCommandsCompanion(
            status: const Value<String>(CommandStatus.pending),
            nextRetryAt: Value<DateTime>(now),
            lastError: const Value<String?>(null),
          ),
        );
  }

  /// Releases a claim without counting it as a failed attempt.
  ///
  /// Used by the sync engine when a command's evidence (its attached photos)
  /// is not yet ready to push - `MediaDao.commandMediaReady` answered false.
  /// Nothing was refused and no attempt was made against the server, so this
  /// deliberately does not touch `retryCount`, `nextRetryAt` or `lastError`
  /// the way `markAttemptFailed` does: a command waiting on its own photos
  /// must not be indistinguishable from one the server is actively refusing.
  Future<void> returnToPending(String id) =>
      _setStatus(id, CommandStatus.pending);

  /// A manual "retry failed" from the sync screen. Resets the counter so the
  /// backoff starts again from 30 seconds.
  Future<int> retryFailed({required DateTime now, String? workspaceId}) {
    final statement = update(pendingCommands)
      ..where((t) {
        final Expression<bool> failed = t.status.equals(CommandStatus.failed);
        if (workspaceId == null) {
          return failed;
        }
        return failed & t.workspaceId.equals(workspaceId);
      });

    return statement.write(
      PendingCommandsCompanion(
        status: const Value<String>(CommandStatus.pending),
        retryCount: const Value<int>(0),
        nextRetryAt: Value<DateTime>(now),
        lastError: const Value<String?>(null),
      ),
    );
  }

  /// Returns to the queue a claim that a crashed sync run abandoned.
  ///
  /// Without this a crash mid-flight strands the row in `processing` forever
  /// and the technician is told work is in progress while nothing is running.
  Future<int> reclaimStaleClaims({
    required DateTime now,
    Duration timeout = QueueRetryPolicy.claimTimeout,
  }) {
    final DateTime cutoff = now.subtract(timeout);
    return (update(pendingCommands)..where(
          (t) =>
              t.status.equals(CommandStatus.processing) &
              t.nextRetryAt.isSmallerOrEqualValue(cutoff),
        ))
        .write(
          PendingCommandsCompanion(
            status: const Value<String>(CommandStatus.pending),
            nextRetryAt: Value<DateTime>(now),
          ),
        );
  }

  /// The number the badge, the tab bar and the sync banner show.
  ///
  /// Counts everything that is NOT `synced`, `failed` included. RECORDED:
  /// counting only `pending` made every badge read 0 the moment an item failed,
  /// so the banner and its Sync button vanished and the technician was shown
  /// "all synced" while an inspection sat unsent.
  Future<int> pendingCount({String? workspaceId}) async {
    final Expression<int> total = pendingCommands.id.count();
    final query = selectOnly(pendingCommands)..addColumns([total]);

    final Expression<bool> notSynced = pendingCommands.status
        .equals(CommandStatus.synced)
        .not();
    query.where(
      workspaceId == null
          ? notSynced
          : notSynced & pendingCommands.workspaceId.equals(workspaceId),
    );

    final TypedResult row = await query.getSingle();
    return row.read(total) ?? 0;
  }

  /// Every command still carrying work, oldest first.
  Future<List<PendingCommand>> outstandingCommands({String? workspaceId}) {
    return (select(pendingCommands)
          ..where((t) {
            final Expression<bool> notSynced = t.status
                .equals(CommandStatus.synced)
                .not();
            if (workspaceId == null) {
              return notSynced;
            }
            return notSynced & t.workspaceId.equals(workspaceId);
          })
          ..orderBy([
            (t) => OrderingTerm.asc(t.createdAt),
            (t) => OrderingTerm.asc(t.id),
          ]))
        .get();
  }

  Future<PendingCommand?> commandById(String id) {
    return (select(pendingCommands)
          ..where((t) => t.id.equals(id))
          ..limit(1))
        .getSingleOrNull();
  }

  Future<PendingCommand?> commandByIdempotencyKey(String key) {
    return (select(pendingCommands)
          ..where((t) => t.idempotencyKey.equals(key))
          ..limit(1))
        .getSingleOrNull();
  }

  /// Removes synced commands whose photos are all verified, and returns the
  /// local file paths whose rows were deleted.
  ///
  /// The caller deletes those files AFTER this returns. Row first, then file:
  /// deleting the file first would orphan the row on a crash and the sweep
  /// would never find it.
  ///
  /// A command with any unverified photo is SKIPPED rather than forced. The ON
  /// DELETE RESTRICT on `pending_media_uploads.commandId` would refuse the
  /// delete anyway; skipping makes the refusal explicit rather than an
  /// exception the caller has to interpret.
  Future<List<String>> pruneSyncedCommands() async {
    return transaction(() async {
      final synced = await (select(
        pendingCommands,
      )..where((t) => t.status.equals(CommandStatus.synced))).get();

      final filesToDelete = <String>[];
      for (final PendingCommand command in synced) {
        final media = await (select(
          pendingMediaUploads,
        )..where((t) => t.commandId.equals(command.id))).get();

        final bool allVerified = media.every(
          (PendingMediaUpload m) => m.state == MediaUploadState.verified,
        );
        if (!allVerified) {
          continue;
        }

        for (final PendingMediaUpload m in media) {
          filesToDelete.add(m.localPath);
        }
        await (delete(
          pendingMediaUploads,
        )..where((t) => t.commandId.equals(command.id))).go();
        await (delete(
          pendingCommands,
        )..where((t) => t.id.equals(command.id))).go();
      }
      return filesToDelete;
    });
  }

  /// Writes a dead-letter row and trims the log to the newest
  /// [RetentionLimits.syncFailures].
  ///
  /// Trimmed by COUNT, never by age: age would delete the diagnosis of a device
  /// that has been offline for weeks, which is exactly the device whose
  /// failures matter most.
  Future<void> recordFailure({
    required String errorClass,
    required DateTime occurredAt,
    required int attempt,
    String? id,
    String? commandId,
    String? commandType,
    String? entityType,
    String? workspaceId,
    String? errorCode,
    String? messageSafe,
    String? payloadSnapshotJson,
  }) async {
    await transaction(() async {
      await into(syncFailures).insert(
        SyncFailuresCompanion.insert(
          id: id ?? _uuid.v4(),
          occurredAt: occurredAt,
          attempt: attempt,
          errorClass: errorClass,
          commandId: Value<String?>(commandId),
          commandType: Value<String?>(commandType),
          entityType: Value<String?>(entityType),
          workspaceId: Value<String?>(workspaceId),
          errorCode: Value<String?>(errorCode),
          messageSafe: Value<String?>(messageSafe),
          payloadSnapshotJson: Value<String?>(payloadSnapshotJson),
        ),
      );

      final keep =
          await (select(syncFailures)
                ..orderBy([
                  (t) => OrderingTerm.desc(t.occurredAt),
                  (t) => OrderingTerm.desc(t.id),
                ])
                ..limit(RetentionLimits.syncFailures))
              .get();

      if (keep.isEmpty) {
        return;
      }
      final List<String> keepIds = keep
          .map((SyncFailure f) => f.id)
          .toList(growable: false);
      await (delete(syncFailures)..where((t) => t.id.isIn(keepIds).not())).go();
    });
  }

  Future<List<SyncFailure>> recentFailures({int limit = 50}) {
    return (select(syncFailures)
          ..orderBy([
            (t) => OrderingTerm.desc(t.occurredAt),
            (t) => OrderingTerm.desc(t.id),
          ])
          ..limit(limit))
        .get();
  }

  /// Takes the single sync lock. Spec section 15: never two sync engines on one
  /// queue.
  ///
  /// Returns false when another holder's claim is still inside [staleAfter]. A
  /// claim older than that is treated as abandoned by a crashed run, because a
  /// lock that can never be broken is a queue that never drains again.
  Future<bool> acquireSyncLock({
    required String holder,
    required DateTime now,
    Duration staleAfter = QueueRetryPolicy.claimTimeout,
  }) async {
    return transaction(() async {
      final existing =
          await (select(syncMetadata)
                ..where(
                  (t) => t.key.equals(SyncMetadataKeys.syncLockAcquiredAt),
                )
                ..limit(1))
              .getSingleOrNull();

      if (existing != null &&
          now.difference(existing.updatedAt).abs() < staleAfter) {
        final currentHolder =
            await (select(syncMetadata)
                  ..where((t) => t.key.equals(SyncMetadataKeys.syncLockHolder))
                  ..limit(1))
                .getSingleOrNull();
        if (currentHolder != null && currentHolder.valueJson != holder) {
          return false;
        }
      }

      await _writeMetadata(SyncMetadataKeys.syncLockHolder, holder, now);
      await _writeMetadata(
        SyncMetadataKeys.syncLockAcquiredAt,
        now.toIso8601String(),
        now,
      );
      return true;
    });
  }

  Future<void> releaseSyncLock({required DateTime now}) async {
    await transaction(() async {
      await (delete(syncMetadata)..where(
            (t) =>
                t.key.equals(SyncMetadataKeys.syncLockHolder) |
                t.key.equals(SyncMetadataKeys.syncLockAcquiredAt),
          ))
          .go();
      await _writeMetadata(
        SyncMetadataKeys.syncLastRunAt,
        now.toIso8601String(),
        now,
      );
    });
  }

  Future<void> _writeMetadata(String key, String value, DateTime now) async {
    await into(syncMetadata).insertOnConflictUpdate(
      SyncMetadataCompanion.insert(key: key, valueJson: value, updatedAt: now),
    );
  }

  Future<void> _setStatus(String id, String status, {String? error}) async {
    await (update(pendingCommands)..where((t) => t.id.equals(id))).write(
      PendingCommandsCompanion(
        status: Value<String>(status),
        lastError: error == null
            ? const Value<String?>.absent()
            : Value<String?>(error),
      ),
    );
  }

  /// A predecessor that is gone was pruned, which only happens after it synced.
  Future<bool> _predecessorSatisfied(String id) async {
    final PendingCommand? row = await commandById(id);
    if (row == null) {
      return true;
    }
    return row.status == CommandStatus.synced;
  }

  Future<PendingCommand> _requireById(String id) {
    return (select(pendingCommands)
          ..where((t) => t.id.equals(id))
          ..limit(1))
        .getSingle();
  }
}
