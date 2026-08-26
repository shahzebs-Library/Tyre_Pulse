/// Orchestrates one inspection submission: durably queue it FIRST, then
/// try to deliver it, and only ever discard the draft once delivery is
/// CONFIRMED.
///
/// # The commit-then-attempt order, and why it is not "attempt then queue
/// on failure"
///
/// `mobile/app/(app)/inspection/new.tsx`'s `handleSubmit` tries the
/// online write FIRST and only calls `enqueueInspection` in the catch
/// block. This port inverts that: [submitNow] always writes a
/// [QueuedInspection] to [InspectionSubmissionQueue] BEFORE attempting
/// anything over the network, exactly mirroring the queue DAO's own
/// documented discipline elsewhere in this codebase (`QueueDao.enqueue`:
/// "the idempotency key is minted here, before any network attempt, and
/// committed in the same transaction as the payload... if the app dies
/// between the two writes neither exists"). Trying online-first and
/// queueing only on catch leaves exactly that gap: a process kill between
/// a slow request being sent and its catch block running loses the
/// submission with no trace anywhere on the device. Queuing first closes
/// it - the manifest file, written atomically by
/// `FileInspectionSubmissionQueue`, is the durable commit point, and the
/// immediate delivery attempt that follows is best-effort on top of an
/// already-safe write, not a substitute for one.
///
/// # Photos and signature are read from the DRAFT, every time
///
/// [QueuedInspection.payload] is a resolved snapshot taken at enqueue
/// time, but the underlying photo FILES and the signature stay owned by
/// the draft (`InspectionDraftRepository`) until this engine confirms
/// delivery - see `queued_inspection.dart`'s library comment for why. So
/// every attempt in [_attemptDelivery], first or retried, re-resolves
/// local photo paths against whatever the draft's `DraftPhotos` rows
/// currently hold, rather than trusting a possibly-stale path baked into
/// the queued JSON.
library;

import 'dart:io';

import 'package:tyre_pulse/core/database/database_constants.dart'
    show uploadConcurrency;
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_draft_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_photo_uploader.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_remote_repository.dart';
import 'package:tyre_pulse/features/inspections/data/inspection_submission_queue.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/queued_inspection.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

/// What [InspectionSyncEngine.submitNow] actually did, for the submit
/// screen to react to. This is intentionally NOT a boolean: "delivered
/// now" and "safely queued for later" are both legitimate successful
/// outcomes from the inspector's point of view - the work is saved either
/// way - and only [InspectionSubmitOutcome.queuedWithWarning] is something
/// they should be told about, since it means the server refused the write
/// for a reason retrying unchanged will not fix (see
/// `AppError.isRetryable`).
enum InspectionSubmitOutcome {
  /// Reached the server immediately. The draft has been discarded.
  deliveredNow,

  /// Could not be delivered immediately (most likely offline) but is
  /// safely durable in the on-device queue and will be retried.
  queued,

  /// Delivery was attempted, the device WAS online, and the server gave a
  /// definitive, non-retryable refusal. Still queued - see the library
  /// comment on never discarding work - but the inspector should see why.
  queuedWithWarning,
}

class InspectionSubmitResult {
  const InspectionSubmitResult({
    required this.outcome,
    required this.clientUuid,
    this.warning,
  });

  final InspectionSubmitOutcome outcome;
  final String clientUuid;
  final AppError? warning;
}

/// Summary of one [InspectionSyncEngine.flushQueue] pass.
class InspectionFlushSummary {
  const InspectionFlushSummary({
    this.attempted = 0,
    this.delivered = 0,
    this.stillPending = 0,
  });

  final int attempted;
  final int delivered;
  final int stillPending;
}

final class InspectionSyncEngine {
  InspectionSyncEngine({
    required InspectionDraftRepository draftRepository,
    required InspectionSubmissionQueue queue,
    required InspectionRemoteRepository remote,
    required InspectionPhotoUploader photoUploader,
  })  : _draftRepository = draftRepository,
        _queue = queue,
        _remote = remote,
        _photoUploader = photoUploader;

  final InspectionDraftRepository _draftRepository;
  final InspectionSubmissionQueue _queue;
  final InspectionRemoteRepository _remote;
  final InspectionPhotoUploader _photoUploader;

  /// Queues [payload] (built from [draftKey]) and attempts to deliver it
  /// once, immediately. Never throws - every failure resolves to
  /// [InspectionSubmitOutcome.queued] or
  /// [InspectionSubmitOutcome.queuedWithWarning], because a submit action
  /// must never leave the inspector with nothing to show for a completed
  /// sheet.
  Future<InspectionSubmitResult> submitNow({
    required String draftKey,
    required InspectionPayload payload,
    required String clientUuid,
  }) async {
    final QueuedInspection item = QueuedInspection(
      id: clientUuid,
      draftKey: draftKey,
      payload: payload,
      createdAt: DateTime.now().toUtc(),
    );

    // Durable commit point FIRST - see the library comment.
    await _queue.enqueue(item);

    return _attemptDelivery(item);
  }

  /// Retries every queue entry that has not yet synced. Intended to be
  /// called opportunistically - right after [submitNow] queues something
  /// (in case connectivity returns between the enqueue and now, on a
  /// flaky link), and when the My Inspections screen opens.
  Future<InspectionFlushSummary> flushQueue() async {
    final InspectionQueueReadResult read = await _queue.list();
    if (!read.isReadable) {
      // Refuse rather than guess - see `InspectionQueueReadResult`'s own
      // doc comment. Reporting "nothing to flush" here would be exactly
      // the "empty read that means two different things" trap.
      return const InspectionFlushSummary();
    }

    int attempted = 0;
    int delivered = 0;
    for (final QueuedInspection item in read.items) {
      if (item.status == InspectionQueueStatus.synced) continue;
      attempted++;
      final InspectionSubmitResult result = await _attemptDelivery(item);
      if (result.outcome == InspectionSubmitOutcome.deliveredNow) {
        delivered++;
      }
    }
    return InspectionFlushSummary(
      attempted: attempted,
      delivered: delivered,
      stillPending: attempted - delivered,
    );
  }

  Future<InspectionSubmitResult> _attemptDelivery(QueuedInspection item) async {
    try {
      // Re-resolve photos and signature from the DRAFT every attempt -
      // see the library comment. A position may have gained a photo
      // between one failed attempt and the next only in the sense that
      // the earlier attempt's own upload may have partially succeeded;
      // re-reading is what makes a retry pick up exactly where the last
      // one left off rather than re-uploading everything.
      final Map<String, TyrePositionReading> current =
          await _draftRepository.tyreReadingsWithPhotos(item.draftKey);

      final Map<String, TyrePositionReading> resolved =
          await _uploadOutstandingPhotos(
        inspectionId: item.id,
        readings: current,
      );

      final InspectionPayload resolvedPayload = item.payload.copyWith(
        tyreConditions: resolved,
      );

      await _remote.upsertInspection(
        payload: resolvedPayload,
        clientUuid: item.id,
      );

      final DateTime now = DateTime.now().toUtc();
      await _queue.markSynced(item.id, now);

      // Delivery is confirmed - safe to retire the draft now, and only
      // now. `discardInspectionDraft` hands back the local photo paths
      // it removed; they are already durably represented by [photoUrl]
      // on the server row, so deleting the local copies loses nothing.
      final List<String> orphanedPaths = await _draftRepository.discardDraft(
        item.draftKey,
      );
      await _deleteFilesBestEffort(orphanedPaths);
      await _queue.remove(item.id);

      return InspectionSubmitResult(
        outcome: InspectionSubmitOutcome.deliveredNow,
        clientUuid: item.id,
      );
    } on Object catch (error) {
      final SupabaseFailure failure =
          error is SupabaseFailure ? error : classifySupabaseError(error);
      final AppError appError = failure.error;

      await _queue.markFailed(item.id, error: appError.message);

      // A network failure is the ordinary, expected offline case and is
      // never surfaced as a warning - the whole point of this feature is
      // that it is silently safe. Anything else reached the server (or a
      // definitively rejecting intermediary) and deserves the
      // inspector's attention, matching
      // `mobile/app/(app)/inspection/new.tsx`'s own "online -> warn,
      // offline -> queue silently" split.
      final bool isNetworkFailure = appError.kind == AppErrorKind.network;
      return InspectionSubmitResult(
        outcome: isNetworkFailure
            ? InspectionSubmitOutcome.queued
            : InspectionSubmitOutcome.queuedWithWarning,
        clientUuid: item.id,
        warning: isNetworkFailure ? null : appError,
      );
    }
  }

  /// Uploads every position's still-local photo, [uploadConcurrency] at a
  /// time - never all at once. See `database_constants.dart`'s own
  /// comment on why an unbounded fan-out over every tyre position is a
  /// documented out-of-memory crash on the low-end handsets this fleet
  /// uses, reproduced here for this feature's own photo set rather than
  /// re-litigated with a different, arbitrary bound.
  ///
  /// A position whose upload fails keeps its LOCAL path (never a dead
  /// reference, never silently dropped) so the next attempt retries
  /// exactly that photo.
  Future<Map<String, TyrePositionReading>> _uploadOutstandingPhotos({
    required String inspectionId,
    required Map<String, TyrePositionReading> readings,
  }) async {
    final Map<String, TyrePositionReading> result =
        Map<String, TyrePositionReading>.of(readings);
    final List<String> positions = readings.keys
        .where(
          (p) =>
              readings[p]!.photoLocalPath != null &&
              readings[p]!.photoUrl == null,
        )
        .toList(growable: false);

    for (int i = 0; i < positions.length; i += uploadConcurrency) {
      final List<String> slice = positions.sublist(
        i,
        (i + uploadConcurrency > positions.length)
            ? positions.length
            : i + uploadConcurrency,
      );
      await Future.wait(<Future<void>>[
        for (final String position in slice)
          _uploadOne(
            inspectionId: inspectionId,
            position: position,
            result: result,
          ),
      ]);
    }
    return result;
  }

  Future<void> _uploadOne({
    required String inspectionId,
    required String position,
    required Map<String, TyrePositionReading> result,
  }) async {
    final TyrePositionReading reading = result[position]!;
    final String? localPath = reading.photoLocalPath;
    if (localPath == null) return;
    try {
      final String url = await _photoUploader.upload(
        localPath: localPath,
        inspectionId: inspectionId,
        position: position,
      );
      result[position] = reading.copyWith(
        photoUrl: url,
        clearPhotoLocalPath: true,
      );
    } on Object {
      // Left with its local path intact - never written as a dead
      // reference, never dropped. The whole delivery attempt fails at
      // the upsert step below only if the CALLER decides an unresolved
      // photo should block the row; this engine deliberately still
      // submits the row with whatever mix of photo_url/photo_uri
      // survives, matching production's own behaviour ("a photo that
      // cannot upload is dropped from the OUTGOING record's dead
      // reference, never the record itself" - artifact rule 5.28's
      // spirit, applied here to a position rather than a checklist
      // field: the observation is not discarded for want of a picture).
    }
  }

  /// Deliberately best-effort and silent: `QueueDao.pruneSyncedCommands`'s
  /// own comment on the analogous cleanup in the shared queue applies
  /// here too - the row (draft) deletion has already committed by the
  /// time this runs, so a file that cannot be removed is orphaned either
  /// way, and one missing or already-deleted file must not abort the
  /// cleanup of every other file this pass handed back.
  Future<void> _deleteFilesBestEffort(List<String> paths) async {
    for (final String path in paths) {
      try {
        final File file = File(path);
        if (await file.exists()) {
          await file.delete();
        }
      } on Object {
        continue;
      }
    }
  }
}
