/// The reconciliation loop: claims due work from the local queue, pushes it
/// to Supabase, classifies what happened, and updates the queue accordingly.
///
/// # What this file deliberately does not depend on
///
/// [SyncEngine] never imports `package:supabase_flutter/supabase_flutter.dart`
/// and never constructs a `SupabaseClient`. It pushes through two narrow
/// abstract seams, [CommandPusher] and [MediaUploader], so the reconciliation
/// LOGIC below - claim ordering, idempotency judgement, the optimistic-status
/// guard, the media-readiness gate, the prune-then-delete ordering - can be
/// exercised in a unit test against a fake, with no real network and no mock
/// of a fluent PostgREST query builder. The real, Supabase-backed
/// implementations of both interfaces live in `supabase_command_pusher.dart`,
/// a sibling file `background_sync.dart` wires them from.
///
/// # The two design decisions worth reading before changing anything here
///
/// **Insert idempotency is a plain insert, classified after the fact - never
/// `.upsert()`.** `docs/flutter-migration/06-offline-command-registry.md`
/// section 1 and `SupabaseFailure.isIdempotentReplay`'s own doc comment both
/// explain why: several idempotent tables use a PARTIAL unique index on
/// `client_uuid`, and PostgREST's `on_conflict` parameter cannot supply the
/// predicate a partial index needs for conflict inference, so an upsert can
/// throw 42P10 even when the row genuinely already exists. A plain insert
/// enforces the same uniqueness correctly regardless, and throws 23505 on a
/// genuine duplicate. [_pushOne] resolves what a 23505 means using the
/// CLAIMED command's own `retryCount`: zero means this is the first attempt
/// and the conflict is real; more than zero means an earlier attempt already
/// landed and this is a successful replay, not a failure.
///
/// **A command's SET-clause payload is filtered against
/// `CommandSpec.fieldAllowList` again here, at push time**, even though
/// `QueuedCommandRepository.enqueue` already filtered it once when the
/// command was captured. Artifact 06 section 1(B) frames the allow-list as
/// the thing that stops "a stray key killing a field worker's whole sync",
/// and that guarantee is only as good as its weakest enforcement point - a
/// payload that somehow reached `pending_commands` unfiltered (a future
/// caller bypassing the repository, a stored row from an older app version
/// with a wider allow-list) must not be trusted just because it is already on
/// disk. The filter here is the LAST line of defence, immediately before the
/// network call it protects.
library;

import 'dart:convert';
import 'dart:io';

import 'package:tyre_pulse/core/database/app_database.dart';
import 'package:tyre_pulse/core/database/dao/media_dao.dart';
import 'package:tyre_pulse/core/database/dao/queue_dao.dart';
import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/sync_outcome.dart';

/// Reverses [CommandTypeWireName.wireName]: recovers the [CommandType] a
/// claimed `pending_commands.commandType` string names.
///
/// Returns null for a wire string that matches no known [CommandType] -
/// deliberately not a throw. A row written by a NEWER build of the app,
/// carrying a command type this build has never heard of, is a real
/// possibility on a fleet where devices update on their own schedule, and it
/// must fail the one command gracefully rather than crash the whole sync
/// pass for every other queued row.
CommandType? commandTypeFromWire(String wire) {
  for (final CommandType type in CommandType.values) {
    if (type.wireName == wire) {
      return type;
    }
  }
  return null;
}

/// The payload key a `requiresOptimisticStatusMatch` command carries its
/// expected PRIOR status under.
///
/// Read by [SyncEngine] to build the `.eq('status', ...)` guard on the push;
/// never sent in the SET clause itself - it is excluded from
/// [CommandSpec.fieldAllowList] filtering by name, the same as
/// [CommandSpec.matchColumn]. Whichever screen enqueues a
/// `WORK_ORDER_STATUS`, `CORRECTIVE_ACTION_STATUS` or
/// `CHECKLIST_ASSIGNMENT_STATUS` command must record the status it read
/// before editing under this exact key inside the payload it hands to
/// `QueuedCommandRepository.enqueue`.
const String expectedPriorStatusPayloadKey = '_expectedPriorStatus';

/// What [SyncEngine] needs to push one command's business row to the server.
///
/// A production implementation ([SupabaseCommandPusher] in
/// `supabase_command_pusher.dart`) talks to PostgREST; a test supplies a fake
/// that returns canned rows or throws a canned [SupabaseFailure].
abstract interface class CommandPusher {
  /// Pushes one command.
  ///
  /// [payload] is already allow-list filtered and, for an insert, already
  /// carries `client_uuid`. [matchValue] is the entity id an update command
  /// targets, and is null for an insert. [expectedPriorStatus] is set only
  /// when [CommandSpec.requiresOptimisticStatusMatch] is true, and the
  /// implementation must add it as an additional equality filter on the
  /// row's `status` column, never as part of the SET clause.
  ///
  /// Returns the affected row or rows. An empty list from an UPDATE whose
  /// spec requires an optimistic status match is not a failure to this
  /// method - it is the honest result of a zero-row update, and the caller
  /// (`SyncEngine`) is what turns that into a reported conflict.
  ///
  /// Throws [SupabaseFailure] on any failure - never a raw exception from
  /// the underlying transport.
  Future<List<Map<String, Object?>>> push({
    required CommandSpec spec,
    required Map<String, Object?> payload,
    String? matchValue,
    String? expectedPriorStatus,
  });
}

/// What [SyncEngine] needs to upload one queued photo.
abstract interface class MediaUploader {
  /// Uploads the file at [localPath] to [bucket] under [fileName].
  ///
  /// Throws [SupabaseFailure] on any failure - never a raw exception from
  /// the underlying transport.
  Future<MediaUploadResult> upload({
    required String bucket,
    required String localPath,
    required String fileName,
  });
}

/// What a successful [MediaUploader.upload] produced.
final class MediaUploadResult {
  const MediaUploadResult({
    required this.remotePath,
    required this.remoteRef,
  });

  /// The object's path inside its bucket.
  final String remotePath;

  /// `tp-storage://<bucket>/<path>` - matches
  /// `PendingMediaUploads.remoteRef`'s documented format exactly, so
  /// [MediaDao.markUploaded] can be called with this value unchanged.
  final String remoteRef;
}

/// The outcome of pushing one claimed command, used only to tally
/// [SyncRunSummary] without four separate mutable counters threaded through
/// every branch of [SyncEngine._pushOne].
enum _CommandOutcome { synced, failed, conflicted, mediaPending }

/// Claims due work from the local queue and reconciles it with the server.
///
/// One [SyncEngine] instance is good for exactly one [runOnce] call at a
/// time by construction of the sync lock it takes - see
/// `QueueDao.acquireSyncLock` - but the class itself holds no mutable state
/// between calls, so reusing one instance across repeated calls (the
/// periodic background task's normal use) is safe.
final class SyncEngine {
  const SyncEngine({
    required QueueDao queueDao,
    required MediaDao mediaDao,
    required CommandPusher pusher,
    required MediaUploader uploader,
    required String holderId,
  })  : _queueDao = queueDao,
        _mediaDao = mediaDao,
        _pusher = pusher,
        _uploader = uploader,
        _holderId = holderId;

  final QueueDao _queueDao;
  final MediaDao _mediaDao;
  final CommandPusher _pusher;
  final MediaUploader _uploader;

  /// Identifies THIS run for [QueueDao.acquireSyncLock]. Every call site that
  /// constructs a [SyncEngine] should mint a fresh value per attempt (a UUID
  /// is the natural choice), not a fixed constant - a shared holder id would
  /// let two genuinely concurrent runs each believe they hold the lock,
  /// because `acquireSyncLock` only refuses a DIFFERENT holder's live claim.
  final String _holderId;

  /// A defensive backstop on the photo-upload drain loop, not a normal-case
  /// limit. `MediaDao.claimNextUploads` only ever returns rows still in
  /// `queued` with `attempts < maxUploadAttempts`, and every iteration of the
  /// loop moves at least one row out of that set (to `uploaded` or, once
  /// exhausted, to `failed`), so the loop is already bounded by
  /// `(queued rows) * maxUploadAttempts` and would terminate without this.
  /// It exists only so a future bug in that bound cannot turn into a
  /// background isolate that spins forever.
  static const int _maxMediaClaimRounds = 500;

  /// Performs one full reconciliation pass for [workspaceId].
  ///
  /// Order, and why each step is where it is:
  ///
  /// 1. Take the sync lock. If another holder's claim is still live, this
  ///    call did nothing and [SyncRunSummary.lockAcquired] says so - not an
  ///    error, the expected shape of two sync attempts overlapping.
  /// 2. [QueueDao.reclaimStaleClaims] - a crashed previous run must not
  ///    strand its claimed rows in `processing` forever.
  /// 3. [QueueDao.unblockForWorkspace] for [workspaceId] - see the note on
  ///    [QueueDao.blockCommand] below. This engine never calls
  ///    `blockCommand` itself; it only ever reverses one.
  /// 4. Drain the photo-upload queue, bounded parallelism already enforced
  ///    inside [MediaDao.claimNextUploads] (`uploadConcurrency`). Photos are
  ///    uploaded BEFORE any command is pushed so that a `requiresMediaReady`
  ///    command claimed in step 5 has the best chance of finding its
  ///    evidence already confirmed.
  /// 5. Claim and push commands, one [_pushOne] call per row.
  /// 6. [QueueDao.pruneSyncedCommands] - remove rows that reached `synced`
  ///    with every attached photo `verified`, and delete the files it hands
  ///    back. Row deletion is committed inside that call BEFORE any file is
  ///    touched, so a crash between the two loses nothing; the caller only
  ///    ever deletes files for rows that are already gone.
  /// 7. Release the lock, in a `finally` so a thrown error mid-pass never
  ///    leaves the queue permanently locked.
  ///
  /// # Why this never calls `QueueDao.blockCommand`
  ///
  /// `claimNextBatch`'s own WHERE clause already restricts every claim to
  /// [workspaceId], so a row captured under a different organisation is never
  /// pushed by accident even without `blockCommand` ever being called - the
  /// claim itself is the enforcement. `blockCommand`/`unblockForWorkspace`
  /// exist for a narrower, presentational purpose: so a future outstanding-
  /// work screen can show "N items waiting because you are not currently in
  /// that organisation" as an explained state, rather than those rows simply
  /// sitting `pending` with no visible reason attached. Deciding to move a
  /// row INTO `blocked` is therefore a decision that belongs to whatever
  /// detects a cross-ORGANISATION switch happened (a rarer, different event
  /// from the country/site switching `workspace_switch.dart` already handles
  /// - that file's own library comment is explicit that a workspace switch
  /// never touches the outbound queue at all). This engine's job is only to
  /// make sure that if something else DID block rows for the organisation
  /// that is active right now, they become claimable again the moment this
  /// run starts.
  Future<SyncRunSummary> runOnce({
    required String workspaceId,
    required DateTime now,
  }) async {
    final bool acquired = await _queueDao.acquireSyncLock(
      holder: _holderId,
      now: now,
    );
    if (!acquired) {
      return const SyncRunSummary(lockAcquired: false);
    }

    try {
      await _queueDao.reclaimStaleClaims(now: now);
      await _queueDao.unblockForWorkspace(workspaceId: workspaceId, now: now);

      final (int photosUploaded, int photosFailed) =
          await _drainMediaUploads(now: now);

      final List<PendingCommand> commands = await _queueDao.claimNextBatch(
        workspaceId: workspaceId,
        now: now,
      );

      int synced = 0;
      int failed = 0;
      int conflicted = 0;
      int mediaPending = 0;

      for (final PendingCommand command in commands) {
        switch (await _pushOne(command, now: now)) {
          case _CommandOutcome.synced:
            synced++;
          case _CommandOutcome.failed:
            failed++;
          case _CommandOutcome.conflicted:
            conflicted++;
          case _CommandOutcome.mediaPending:
            mediaPending++;
        }
      }

      final List<String> filesToDelete =
          await _queueDao.pruneSyncedCommands();
      await _deleteFiles(filesToDelete);

      return SyncRunSummary(
        claimed: commands.length,
        synced: synced,
        failed: failed,
        conflicted: conflicted,
        mediaPending: mediaPending,
        photosUploaded: photosUploaded,
        photosFailed: photosFailed,
      );
    } finally {
      await _queueDao.releaseSyncLock(now: now);
    }
  }

  // -- Photo uploads ----------------------------------------------------

  /// Returns `(uploaded, failed)` - a plain positional record. Record TYPES
  /// cannot name a positional field (only a named-field block in braces can),
  /// so the names live only at the call site, which destructures this with a
  /// record PATTERN instead: `final (int photosUploaded, int photosFailed) =
  /// await _drainMediaUploads(...)`.
  Future<(int, int)> _drainMediaUploads({
    required DateTime now,
  }) async {
    int uploaded = 0;
    int failed = 0;

    for (int round = 0; round < _maxMediaClaimRounds; round++) {
      final List<PendingMediaUpload> claimed =
          await _mediaDao.claimNextUploads();
      if (claimed.isEmpty) {
        break;
      }

      for (final PendingMediaUpload media in claimed) {
        final String? bucket = media.bucket;
        if (bucket == null || bucket.isEmpty) {
          // A media row with nowhere to go is a data problem, not a
          // transient one - guessing a bucket for evidence would risk
          // filing a photo somewhere nobody looks for it.
          await _mediaDao.markUploadAttemptFailed(
            media.id,
            messageSafe: 'This photo has no upload destination recorded and '
                'could not be sent.',
          );
          failed++;
          continue;
        }

        try {
          final MediaUploadResult result = await _uploader.upload(
            bucket: bucket,
            localPath: media.localPath,
            fileName: media.fileName,
          );
          await _mediaDao.markUploaded(
            media.id,
            bucket: bucket,
            remotePath: result.remotePath,
            remoteRef: result.remoteRef,
            at: now,
          );
          uploaded++;
        } on SupabaseFailure catch (failure) {
          await _mediaDao.markUploadAttemptFailed(
            media.id,
            messageSafe: failure.error.message,
          );
          failed++;
        }
      }
    }

    return (uploaded, failed);
  }

  // -- Commands -----------------------------------------------------------

  Future<_CommandOutcome> _pushOne(
    PendingCommand command, {
    required DateTime now,
  }) async {
    final CommandType? type = commandTypeFromWire(command.commandType);
    if (type == null) {
      await _fail(
        command,
        now: now,
        message: 'This entry could not be recognised by this version of the '
            'app.',
        errorClass: SyncErrorClass.validation,
      );
      return _CommandOutcome.failed;
    }
    final CommandSpec spec = CommandRegistry.specFor(type);

    if (spec.requiresMediaReady) {
      final bool ready = await _mediaDao.commandMediaReady(command.id);
      if (!ready) {
        // Not a failure: there is simply nothing to push yet. Releasing the
        // claim (rather than leaving it `processing`, and without touching
        // `retryCount` or `lastError`) is exactly what
        // `QueueDao.returnToPending` exists for.
        await _queueDao.returnToPending(command.id);
        return _CommandOutcome.mediaPending;
      }
    }

    final Map<String, Object?> decoded;
    try {
      decoded = jsonDecode(command.payloadJson) as Map<String, Object?>;
    } on Object {
      await _fail(
        command,
        now: now,
        message: 'This entry could not be read and could not be sent.',
        errorClass: SyncErrorClass.validation,
      );
      return _CommandOutcome.failed;
    }

    String? matchValue;
    if (spec.operation == CommandOperation.update) {
      final String? entityId = command.entityId;
      if (entityId == null || entityId.isEmpty) {
        await _fail(
          command,
          now: now,
          message: 'This update is missing the record it was meant to '
              'change and could not be sent.',
          errorClass: SyncErrorClass.validation,
        );
        return _CommandOutcome.failed;
      }
      matchValue = entityId;
    }

    String? expectedPriorStatus;
    if (spec.requiresOptimisticStatusMatch) {
      final Object? raw = decoded[expectedPriorStatusPayloadKey];
      if (raw is! String || raw.isEmpty) {
        await _fail(
          command,
          now: now,
          message: 'This update is missing the information needed to avoid '
              'overwriting a change made elsewhere, and could not be sent.',
          errorClass: SyncErrorClass.validation,
        );
        return _CommandOutcome.failed;
      }
      expectedPriorStatus = raw;
    }

    // The last line of defence for the allow-list (see the library comment),
    // and the ONE place the match column is stripped from the SET clause -
    // `CommandSpec.fieldAllowList` deliberately still contains it, mirroring
    // the source's own `fields` array, precisely so this is the only place
    // that decision is made.
    final Map<String, Object?> setPayload = <String, Object?>{
      for (final MapEntry<String, Object?> entry in decoded.entries)
        if (entry.key != expectedPriorStatusPayloadKey &&
            entry.key != spec.matchColumn &&
            spec.fieldAllowList.contains(entry.key))
          entry.key: entry.value,
    };
    if (spec.operation == CommandOperation.insert) {
      setPayload['client_uuid'] = command.idempotencyKey;
    }

    try {
      final List<Map<String, Object?>> rows = await _pusher.push(
        spec: spec,
        payload: setPayload,
        matchValue: matchValue,
        expectedPriorStatus: expectedPriorStatus,
      );

      if (spec.requiresOptimisticStatusMatch && rows.isEmpty) {
        await _fail(
          command,
          now: now,
          message: 'This record was changed by someone else before this '
              'update could be sent. Review it before trying again.',
          errorClass: SyncErrorClass.conflict,
        );
        return _CommandOutcome.conflicted;
      }

      await _markCommandSynced(command, spec: spec, now: now);
      return _CommandOutcome.synced;
    } on SupabaseFailure catch (failure) {
      // The idempotency judgement: a duplicate key on a RETRY of an
      // idempotent write means the earlier attempt already landed. A
      // duplicate key on the FIRST attempt (retryCount == 0) is a genuine
      // conflict unrelated to retrying, and falls through to the failure
      // path below like any other refusal.
      if (failure.isIdempotentReplay && command.retryCount > 0) {
        await _markCommandSynced(command, spec: spec, now: now);
        return _CommandOutcome.synced;
      }

      final String errorClass = syncErrorClassFor(failure.cause);
      await _fail(
        command,
        now: now,
        message: failure.error.message,
        errorClass: errorClass,
        errorCode: failure.code,
      );
      return errorClass == SyncErrorClass.conflict
          ? _CommandOutcome.conflicted
          : _CommandOutcome.failed;
    }
  }

  Future<void> _markCommandSynced(
    PendingCommand command, {
    required CommandSpec spec,
    required DateTime now,
  }) async {
    await _queueDao.markSynced(command.id, now);
    if (spec.requiresMediaReady) {
      await _mediaDao.markCommandMediaVerified(command.id);
    }
  }

  Future<void> _fail(
    PendingCommand command, {
    required DateTime now,
    required String message,
    required String errorClass,
    String? errorCode,
  }) async {
    await _queueDao.recordFailure(
      errorClass: errorClass,
      occurredAt: now,
      attempt: command.retryCount + 1,
      commandId: command.id,
      commandType: command.commandType,
      entityType: command.entityType,
      workspaceId: command.workspaceId,
      errorCode: errorCode,
      messageSafe: message,
    );
    await _queueDao.markAttemptFailed(command.id, now: now, message: message);
  }

  // -- File cleanup ---------------------------------------------------------

  Future<void> _deleteFiles(List<String> paths) async {
    for (final String path in paths) {
      try {
        await File(path).delete();
      } on Object {
        // `pruneSyncedCommands` has already committed the row deletion for
        // this file's command, so the file is orphaned either way, whether
        // this delete succeeds, finds nothing there, or fails for some other
        // reason. A single missing or already-deleted file must not abort
        // the sweep for every other file this pass handed back - there is
        // no existence pre-check here on purpose, so this never makes the
        // extra `FileSystemEntity` round trip that check would cost.
      }
    }
  }
}
