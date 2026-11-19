/// Sends a session's finished lines: photos first, then the lines, then the
/// server's answer is written back to the encrypted draft.
///
/// Order matters. A line is only sent once every one of its photos has a
/// server reference, so the server never holds a line whose evidence is still
/// on a phone; and the local photo file is never deleted before the server
/// has confirmed it (AGENTS.md, "Offline is not optional").
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/data/count_draft_store.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';

enum SubmitStatus {
  /// Every finished line is now on the server.
  done,

  /// Nothing was finished, so nothing was sent.
  nothingToSend,

  /// No connection: everything stays on this phone, safe.
  offline,

  /// The server does not have the inventory count objects yet.
  notProvisioned,

  /// Some lines were refused or some photos could not be uploaded.
  partial,

  /// The server refused the whole request.
  failed,
}

@immutable
final class SubmitOutcome {
  const SubmitOutcome(
    this.status,
    this.session, {
    this.sent = 0,
    this.accepted = 0,
    this.rejected = 0,
    this.failure,
  });

  final SubmitStatus status;
  final CountSession session;
  final int sent;
  final int accepted;
  final int rejected;
  final SupabaseFailure? failure;
}

final class CountSubmitter {
  const CountSubmitter({
    required InventoryAuditRepository repository,
    required CountDraftStore drafts,
    Future<void> Function(List<String> paths) discardPhotos = _discardNothing,
  })  : _repository = repository,
        _drafts = drafts,
        _discard = discardPhotos;

  final InventoryAuditRepository _repository;
  final CountDraftStore _drafts;
  final Future<void> Function(List<String> paths) _discard;

  static Future<void> _discardNothing(List<String> paths) async {}

  Future<SubmitOutcome> submit(
    CountSession session, {
    required String deviceId,
  }) async {
    CountSession current = session;
    if (current.submittable.isEmpty) {
      return SubmitOutcome(SubmitStatus.nothingToSend, current);
    }

    bool photoProblem = false;
    final List<CountLine> ready = <CountLine>[];
    final Map<String, List<String>> uploaded = <String, List<String>>{};
    for (final CountLine line in current.submittable) {
      CountLine working = line;
      final List<String> remaining = <String>[];
      for (final String path in line.photoPaths) {
        try {
          final String ref = await _repository.uploadPhoto(
            auditId: current.auditId,
            clientUuid: line.clientUuid,
            localPath: path,
          );
          working = working.copyWith(
            photoRefs: <String>[...working.photoRefs, ref],
          );
          (uploaded[line.clientUuid] ??= <String>[]).add(path);
        } on SupabaseFailure catch (failure) {
          remaining.add(path);
          if (failure.isConnectivity) {
            await _drafts.save(current);
            return SubmitOutcome(
              SubmitStatus.offline,
              current,
              failure: failure,
            );
          }
          photoProblem = true;
        }
      }
      working = working.copyWith(photoPaths: remaining);
      current = current.updateLine(working);
      if (remaining.isEmpty) ready.add(working);
    }
    // Persist uploaded photo refs before sending, so a crash between the
    // upload and the submit never uploads the same photo twice.
    await _drafts.save(current);

    if (ready.isEmpty) {
      return SubmitOutcome(SubmitStatus.partial, current);
    }

    final CountSubmitResult result;
    try {
      result = await _repository.submit(
        auditId: current.auditId,
        lines: ready,
        deviceId: deviceId,
      );
    } on SupabaseFailure catch (failure) {
      final SubmitStatus status = failure.isConnectivity
          ? SubmitStatus.offline
          : failure.isSchemaMismatch
              ? SubmitStatus.notProvisioned
              : SubmitStatus.failed;
      return SubmitOutcome(status, current, failure: failure);
    }

    current = current.applySubmitResult(result);
    await _drafts.save(current);
    // Only now, with the line accepted and the draft saved, is the local
    // photo copy redundant.
    await _discard(<String>[
      for (final String id in result.accepted) ...?uploaded[id],
    ]);
    final int accepted = ready
        .where((CountLine l) => result.accepted.contains(l.clientUuid))
        .length;
    final int rejected = ready
        .where((CountLine l) => result.rejected.containsKey(l.clientUuid))
        .length;
    final bool clean =
        !photoProblem && rejected == 0 && accepted == ready.length;
    return SubmitOutcome(
      clean ? SubmitStatus.done : SubmitStatus.partial,
      current,
      sent: ready.length,
      accepted: accepted,
      rejected: rejected,
    );
  }
}

/// A rejected line the counter fixed goes back to draft so it can be resent.
CountLine reopenRejected(CountLine line) =>
    line.state == CountLineState.rejected
        ? line.copyWith(state: CountLineState.draft, clearReject: true)
        : line;
