/// What a [SupabaseFailureCause] means for the offline queue, and a plain
/// summary of one reconciliation pass.
///
/// [syncErrorClassFor] is deliberately the ONLY place that turns a
/// [SupabaseFailureCause] into a [SyncErrorClass]. `SyncFailures.errorClass`
/// (`lib/core/database/tables/queue_tables.dart`) is explicit that this
/// classification, and never the message text, decides whether a retry
/// happens - so there must be exactly one function that makes that decision,
/// consumed by `sync_engine.dart` and by anything later that reads the
/// `sync_failures` dead-letter log back out.
library;

import 'package:tyre_pulse/core/database/database_constants.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';

/// Maps a mechanical [SupabaseFailureCause] onto the coarser [SyncErrorClass]
/// vocabulary the local queue is built around.
///
/// This is a classification of the CAUSE alone. It does NOT decide whether a
/// unique-violation is a genuine conflict or a successful idempotent replay -
/// that judgement needs the claimed command's own retry count, which only the
/// caller (the sync engine, at the point it catches a [SupabaseFailure]) has.
/// See [SupabaseFailure.isIdempotentReplay]'s own doc comment: "A first
/// attempt that hits 23505 is a genuine conflict, not a replay." This
/// function always reports [SyncErrorClass.conflict] for
/// [SupabaseFailureCause.uniqueViolation]; the caller is what decides whether
/// to call this function at all for a given failure, or to treat it as a
/// success instead.
///
/// An exhaustive `switch` on purpose - adding a new [SupabaseFailureCause]
/// without extending this mapping is a compile error, not a silent
/// [SyncErrorClass.unknown].
SyncErrorClass syncErrorClassFor(SupabaseFailureCause cause) {
  switch (cause) {
    case SupabaseFailureCause.offline:
    case SupabaseFailureCause.timeout:
      // The request never reached the server, or never got an answer in
      // time. Both are transient by nature: nothing about the write itself
      // was refused, so an unchanged retry is the correct next attempt.
      return SyncErrorClass.network;

    case SupabaseFailureCause.jwtExpired:
    case SupabaseFailureCause.unauthenticated:
      // The session, not the write, is the problem. Retrying the same
      // request with the same expired credentials will fail identically
      // until the session is refreshed by the auth lane.
      return SyncErrorClass.auth;

    case SupabaseFailureCause.forbidden:
    case SupabaseFailureCause.rowLevelSecurity:
      // Real credentials, refused by policy or grant. A retry cannot change
      // the outcome; only a permission change on the server can.
      return SyncErrorClass.permission;

    case SupabaseFailureCause.notNullViolation:
    case SupabaseFailureCause.checkViolation:
    case SupabaseFailureCause.invalidInput:
    case SupabaseFailureCause.onConflictInferenceFailed:
    case SupabaseFailureCause.foreignKeyViolation:
      // The payload itself is what the server refused - a missing field, a
      // value a CHECK constraint rejects, malformed input, an upsert whose
      // conflict target could not be inferred, or a reference to a row that
      // is missing or still in use. An unchanged retry refuses identically.
      return SyncErrorClass.validation;

    case SupabaseFailureCause.uniqueViolation:
      // 23505. See the doc comment above: this function only classifies the
      // MECHANICAL cause. Whether a particular occurrence is a genuine
      // conflict or an idempotent replay's expected outcome is decided by
      // the caller, using the command's own retry count, before it ever
      // reaches for this classification.
      return SyncErrorClass.conflict;

    case SupabaseFailureCause.noRowsFound:
    case SupabaseFailureCause.rangeNotSatisfiable:
    case SupabaseFailureCause.schemaMismatch:
    case SupabaseFailureCause.serverRaise:
    case SupabaseFailureCause.serverError:
    case SupabaseFailureCause.rateLimited:
    case SupabaseFailureCause.storageNotFound:
    case SupabaseFailureCause.unknown:
      // Nothing here is a definite, permanent refusal of the WRITE the way
      // the validation and permission classes are, and nothing here is
      // definitely transient either - a PL/pgSQL guard's deliberate refusal
      // (serverRaise) may refuse identically forever, while a busy server
      // (rateLimited, serverError) usually will not. `SyncErrorClass.all`
      // has no finer bucket for this mixed group, so it is reported honestly
      // as unknown rather than guessed into network or validation. The
      // backoff schedule still retries it - `SyncErrorClass.retryable` names
      // only network and unknown, precisely so a genuinely stuck command in
      // this bucket is not retried forever silently: it still exhausts to
      // `failed` after `QueueRetryPolicy.maxRetries` and waits for a person.
      return SyncErrorClass.unknown;
  }
}

/// What one call to `SyncEngine.runOnce` did.
///
/// A plain, immutable summary - never accumulated across runs and never
/// itself persisted. A sync-status screen (not built by this file) reads
/// `QueueDao.pendingCount`, `QueueDao.outstandingCommands` and
/// `QueueDao.recentFailures` for anything that must survive past a single
/// call; this type exists only to report what the run just did.
final class SyncRunSummary {
  const SyncRunSummary({
    this.lockAcquired = true,
    this.claimed = 0,
    this.synced = 0,
    this.failed = 0,
    this.conflicted = 0,
    this.mediaPending = 0,
    this.photosUploaded = 0,
    this.photosFailed = 0,
  });

  /// False when another holder's claim on the sync lock was still live, so
  /// this run did nothing at all. This is the expected, non-error outcome of
  /// two sync attempts overlapping - never a failure to report as one.
  final bool lockAcquired;

  /// How many commands were claimed from the queue this pass.
  ///
  /// Always equal to `synced + failed + conflicted + mediaPending`: every
  /// claimed command resolves to exactly one of those four outcomes before
  /// this run ends.
  final int claimed;

  /// Reached the server, including a command whose 23505 was correctly read
  /// as a successful replay of an earlier attempt.
  final int synced;

  /// Refused for a reason a retry will not fix on its own, or exhausted its
  /// retries. Recorded in `sync_failures` and left in `pending_commands` -
  /// nothing that has not reached the server is ever discarded.
  final int failed;

  /// Refused because the record changed on the server since it was captured
  /// - either a genuine (non-replay) unique-violation, or an
  /// optimistic-status-match update that matched zero rows. Also recorded in
  /// `sync_failures`; a person needs to look at these, not just wait out a
  /// backoff.
  final int conflicted;

  /// Released back to `pending` because a photo it depends on has not yet
  /// reached `uploaded` or `verified`. Not a failure: nothing was refused,
  /// there was simply nothing to push yet.
  final int mediaPending;

  /// Photos that reached storage this pass.
  final int photosUploaded;

  /// Photo uploads that failed this pass, whether retried later or exhausted
  /// into `MediaUploadState.failed`.
  final int photosFailed;

  @override
  String toString() => 'SyncRunSummary('
      'lockAcquired: $lockAcquired, claimed: $claimed, synced: $synced, '
      'failed: $failed, conflicted: $conflicted, mediaPending: $mediaPending, '
      'photosUploaded: $photosUploaded, photosFailed: $photosFailed)';
}
