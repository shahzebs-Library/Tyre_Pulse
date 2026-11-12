/// Orchestrates one handover submission: durably queue it FIRST, then try to
/// deliver it, and only ever delete a local photo once delivery is CONFIRMED.
///
/// # The commit-then-attempt order
///
/// [submitNow] always writes a [QueuedHandover] to [HandoverSubmissionQueue]
/// BEFORE attempting anything over the network - the atomically-written queue
/// file is the durable commit point. Trying online-first and queueing only on
/// catch leaves a window where a process kill between a slow request and its
/// catch block loses the submission with no trace. Mirrors
/// `inspection_sync_engine.dart`.
///
/// # Photos are re-read from the QUEUED ENTRY every attempt
///
/// A handover's photos (general and per-damage-marker) are carried as local
/// paths inside the queued entry's own JSON. Every attempt uploads the still-
/// local ones, swaps each for a durable `tp-storage://` reference, and only
/// deletes the local files once the server row is confirmed. An upload that
/// fails keeps its local path so the next attempt retries exactly that photo.
library;

import 'dart:io';

import 'package:tyre_pulse/core/database/database_constants.dart'
    show uploadConcurrency;
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/handover/data/handover_photo_uploader.dart';
import 'package:tyre_pulse/features/handover/data/handover_remote_repository.dart';
import 'package:tyre_pulse/features/handover/data/handover_submission_queue.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';
import 'package:tyre_pulse/features/handover/domain/queued_handover.dart';

/// What [HandoverSyncEngine.submitNow] actually did. Not a boolean: "delivered
/// now" and "safely queued for later" are both successful outcomes from the
/// field - the work is saved either way - and only
/// [HandoverSubmitOutcome.queuedWithWarning] is something to tell the user
/// about, because it means the server refused the write for a reason retrying
/// unchanged will not fix.
enum HandoverSubmitOutcome {
  /// Reached the server immediately. Local photos have been discarded.
  deliveredNow,

  /// Could not be delivered immediately (most likely offline) but is safely
  /// durable in the on-device queue and will be retried.
  queued,

  /// Delivery was attempted, the device WAS online, and the server gave a
  /// definitive, non-retryable refusal. Still queued - never discard work -
  /// but the user should see why.
  queuedWithWarning,
}

class HandoverSubmitResult {
  const HandoverSubmitResult({
    required this.outcome,
    required this.clientUuid,
    this.warning,
  });

  final HandoverSubmitOutcome outcome;
  final String clientUuid;
  final AppError? warning;
}

/// Summary of one [HandoverSyncEngine.flushQueue] pass.
class HandoverFlushSummary {
  const HandoverFlushSummary({
    this.attempted = 0,
    this.delivered = 0,
    this.stillPending = 0,
  });

  final int attempted;
  final int delivered;
  final int stillPending;
}

final class HandoverSyncEngine {
  HandoverSyncEngine({
    required HandoverSubmissionQueue queue,
    required HandoverRemoteRepository remote,
    required HandoverPhotoUploader photoUploader,
  })  : _queue = queue,
        _remote = remote,
        _photoUploader = photoUploader;

  final HandoverSubmissionQueue _queue;
  final HandoverRemoteRepository _remote;
  final HandoverPhotoUploader _photoUploader;

  /// Queues [payload] and attempts to deliver it once, immediately. Never
  /// throws - every failure resolves to [HandoverSubmitOutcome.queued] or
  /// [HandoverSubmitOutcome.queuedWithWarning], because a submit must never
  /// leave the user with nothing to show for a completed handover.
  Future<HandoverSubmitResult> submitNow({
    required HandoverPayload payload,
    required String clientUuid,
  }) async {
    // A submitted handover enters the supervisor queue (the server default,
    // stated explicitly so a reader of the queue file knows its intent).
    final HandoverPayload submitted = payload.approvalStatus == null
        ? payload.copyWith(approvalStatus: 'pending_supervisor')
        : payload;
    final QueuedHandover item = QueuedHandover(
      id: clientUuid,
      payload: submitted,
      createdAt: DateTime.now().toUtc(),
    );

    // Durable commit point FIRST.
    await _queue.enqueue(item);
    return _attemptDelivery(item);
  }

  /// Retries every queue entry that has not yet synced. Called right after
  /// [submitNow] queues something (in case connectivity returned), and when the
  /// history screen opens.
  Future<HandoverFlushSummary> flushQueue() async {
    final HandoverQueueReadResult read = await _queue.list();
    if (!read.isReadable) {
      // Refuse rather than guess - an unreadable store is not "nothing queued".
      return const HandoverFlushSummary();
    }
    int attempted = 0;
    int delivered = 0;
    for (final QueuedHandover item in read.items) {
      if (item.status == HandoverQueueStatus.synced) continue;
      attempted++;
      final HandoverSubmitResult result = await _attemptDelivery(item);
      if (result.outcome == HandoverSubmitOutcome.deliveredNow) {
        delivered++;
      }
    }
    return HandoverFlushSummary(
      attempted: attempted,
      delivered: delivered,
      stillPending: attempted - delivered,
    );
  }

  Future<HandoverSubmitResult> _attemptDelivery(QueuedHandover item) async {
    try {
      final _ResolvedPhotos resolved = await _uploadOutstandingPhotos(item);
      final HandoverPayload resolvedPayload = item.payload.copyWith(
        photos: resolved.photos,
        damages: resolved.damages,
      );

      await _remote.upsertHandover(
        payload: resolvedPayload,
        clientUuid: item.id,
      );

      final DateTime now = DateTime.now().toUtc();
      await _queue.markSynced(item.id, now);

      // Delivery confirmed - safe to delete the local photo files now, and
      // only now; they are durably represented by their tp-storage refs on the
      // server row.
      await _deleteFilesBestEffort(resolved.uploadedLocalPaths);
      await _queue.remove(item.id);

      return HandoverSubmitResult(
        outcome: HandoverSubmitOutcome.deliveredNow,
        clientUuid: item.id,
      );
    } on Object catch (error) {
      final SupabaseFailure failure =
          error is SupabaseFailure ? error : classifySupabaseError(error);
      final AppError appError = failure.error;

      await _queue.markFailed(item.id, error: appError.message);

      final bool isNetworkFailure = appError.kind == AppErrorKind.network;
      return HandoverSubmitResult(
        outcome: isNetworkFailure
            ? HandoverSubmitOutcome.queued
            : HandoverSubmitOutcome.queuedWithWarning,
        clientUuid: item.id,
        warning: isNetworkFailure ? null : appError,
      );
    }
  }

  /// Uploads every still-local photo - the general ones and each damage
  /// marker's - [uploadConcurrency] at a time (never an unbounded fan-out: that
  /// is a documented out-of-memory crash on the low-end handsets this fleet
  /// uses). A photo whose upload fails keeps its LOCAL path so the next attempt
  /// retries exactly it.
  Future<_ResolvedPhotos> _uploadOutstandingPhotos(QueuedHandover item) async {
    final List<String> uploadedLocalPaths = <String>[];

    // --- general photos ---
    final List<String> general = List<String>.of(item.payload.photos);
    final List<int> pendingGeneral = <int>[
      for (int i = 0; i < general.length; i++)
        if (_isLocalPhoto(general[i])) i,
    ];
    for (int i = 0; i < pendingGeneral.length; i += uploadConcurrency) {
      final List<int> slice = pendingGeneral.sublist(
        i,
        (i + uploadConcurrency > pendingGeneral.length)
            ? pendingGeneral.length
            : i + uploadConcurrency,
      );
      await Future.wait(<Future<void>>[
        for (final int index in slice)
          () async {
            final String localPath = general[index];
            final String ref = await _photoUploader.upload(
              localPath: localPath,
              handoverId: item.id,
              slot: 'photo',
            );
            general[index] = ref;
            uploadedLocalPaths.add(localPath);
          }(),
      ]);
    }

    // --- per-marker damage photos ---
    final List<HandoverDamageMarker> markers =
        List<HandoverDamageMarker>.of(item.payload.damages);
    final List<int> pendingMarkers = <int>[
      for (int i = 0; i < markers.length; i++)
        if (markers[i].photoLocalPath != null && markers[i].photoUrl == null) i,
    ];
    for (int i = 0; i < pendingMarkers.length; i += uploadConcurrency) {
      final List<int> slice = pendingMarkers.sublist(
        i,
        (i + uploadConcurrency > pendingMarkers.length)
            ? pendingMarkers.length
            : i + uploadConcurrency,
      );
      await Future.wait(<Future<void>>[
        for (final int index in slice)
          () async {
            final HandoverDamageMarker marker = markers[index];
            final String localPath = marker.photoLocalPath!;
            final String ref = await _photoUploader.upload(
              localPath: localPath,
              handoverId: item.id,
              slot: 'damage_${marker.view.key}',
            );
            markers[index] = marker.copyWith(
              photoUrl: ref,
              clearPhotoLocalPath: true,
            );
            uploadedLocalPaths.add(localPath);
          }(),
      ]);
    }

    return _ResolvedPhotos(
      photos: general,
      damages: markers,
      uploadedLocalPaths: uploadedLocalPaths,
    );
  }

  /// Best-effort and silent: the server row has already committed by the time
  /// this runs, so a file that cannot be removed is orphaned either way, and
  /// one missing file must not abort the cleanup of the rest.
  Future<void> _deleteFilesBestEffort(List<String> paths) async {
    for (final String path in paths) {
      try {
        final File file = File(path);
        if (file.existsSync()) {
          await file.delete();
        }
      } on Object {
        continue;
      }
    }
  }
}

/// A photo reference is "local" (needs uploading) when it is a filesystem path
/// - i.e. not already a durable `tp-storage://` reference and not a `data:` or
/// `http(s)` URL.
bool _isLocalPhoto(String reference) {
  final String lower = reference.trim().toLowerCase();
  if (lower.isEmpty) return false;
  return !lower.startsWith('tp-storage://') &&
      !lower.startsWith('data:') &&
      !lower.startsWith('http://') &&
      !lower.startsWith('https://');
}

class _ResolvedPhotos {
  const _ResolvedPhotos({
    required this.photos,
    required this.damages,
    required this.uploadedLocalPaths,
  });

  final List<String> photos;
  final List<HandoverDamageMarker> damages;
  final List<String> uploadedLocalPaths;
}
