/// Ends counting on an audit (`inv_audit_complete_counting`).
///
/// Online only, by decision: whether counting may end depends on the audit's
/// CURRENT server status, so it is never queued (AGENTS.md: decisions that
/// depend on server state are not queued). The caller mints ONE idempotency
/// key per press and passes it here; this class never mints one itself, so a
/// retry inside the same press cannot become a second request.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_audit_repository.dart';
import 'package:tyre_pulse/features/inventory/domain/count_models.dart';
import 'package:tyre_pulse/features/inventory/domain/count_session.dart';
import 'package:tyre_pulse/features/inventory/domain/finish_counting.dart';

enum FinishStatus {
  /// Counting ended; the audit is now `counting_completed`.
  done,

  /// No connection: nothing was sent.
  offline,

  /// Lines on this phone have not reached the server: nothing was sent.
  unsentLines,

  /// The audit is not in a counting status: nothing was sent.
  notOpen,

  /// The server does not have the inventory objects yet.
  notProvisioned,

  /// The server refused (not authorised, counting already closed...).
  refused,
}

@immutable
final class FinishOutcome {
  const FinishOutcome(this.status, {this.unsent = 0, this.failure});

  final FinishStatus status;

  /// How many lines are still on the phone ([FinishStatus.unsentLines]).
  final int unsent;
  final SupabaseFailure? failure;
}

final class CountFinisher {
  const CountFinisher({
    required InventoryAuditRepository repository,
    required Future<bool> Function() isOnline,
  })  : _repository = repository,
        _isOnline = isOnline;

  final InventoryAuditRepository _repository;
  final Future<bool> Function() _isOnline;

  Future<FinishOutcome> finish({
    required InventoryAuditSummary audit,
    required CountSession? session,
    required String idempotencyKey,
  }) async {
    switch (finishCountingGate(audit: audit, session: session)) {
      case FinishGate.notOpen:
        return const FinishOutcome(FinishStatus.notOpen);
      case FinishGate.unsentLines:
        return FinishOutcome(
          FinishStatus.unsentLines,
          unsent: session?.pending.length ?? 0,
        );
      case FinishGate.allowed:
        break;
    }
    bool online;
    try {
      online = await _isOnline();
    } on Object {
      // An unreadable connectivity state is not proof of a connection; the
      // server call below still answers honestly if it is.
      online = true;
    }
    if (!online) return const FinishOutcome(FinishStatus.offline);
    try {
      await _repository.completeCounting(
        auditId: audit.id,
        idempotencyKey: idempotencyKey,
      );
      return const FinishOutcome(FinishStatus.done);
    } on SupabaseFailure catch (failure) {
      return FinishOutcome(
        failure.isConnectivity
            ? FinishStatus.offline
            : failure.isSchemaMismatch
                ? FinishStatus.notProvisioned
                : FinishStatus.refused,
        failure: failure,
      );
    }
  }
}
