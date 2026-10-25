/// The one network call for a status update: the idempotent database function
/// `workforce_assignment_transition`. It is an RPC (not a table write) so the
/// server records who did what and when, and so a replayed idempotency key is
/// a success rather than a duplicate. See the migration for the exact rules.
library;

import 'package:supabase_flutter/supabase_flutter.dart';

/// How the server answered a delivered request.
enum WorkforceRemoteOutcome {
  /// Applied now.
  applied,

  /// This exact idempotency key had been applied before (lost response).
  replayed,

  /// The assignment was already in the state this update would produce.
  alreadyApplied,

  /// Refused. See [WorkforceRemoteResult.reason] and [WorkforceRemoteResult.status].
  rejected,
}

final class WorkforceRemoteResult {
  const WorkforceRemoteResult({
    required this.outcome,
    this.status,
    this.reason,
  });

  /// Parses the jsonb the function returns. Anything unexpected throws a
  /// [FormatException] so the caller treats it as an unknown failure rather
  /// than guessing success.
  factory WorkforceRemoteResult.fromJson(Object? json) {
    if (json is! Map<Object?, Object?>) {
      throw const FormatException('Unexpected workforce transition response');
    }
    final Object? ok = json['ok'];
    final Object? result = json['result'];
    final String? status =
        (json['status'] ?? json['current_status']) as String?;
    final String? reason = json['reason'] as String?;
    if (ok == true) {
      return WorkforceRemoteResult(
        outcome: switch (result) {
          'applied' => WorkforceRemoteOutcome.applied,
          'replayed' => WorkforceRemoteOutcome.replayed,
          'already_applied' => WorkforceRemoteOutcome.alreadyApplied,
          _ => throw const FormatException('Unknown workforce result'),
        },
        status: status,
      );
    }
    if (ok == false) {
      return WorkforceRemoteResult(
        outcome: WorkforceRemoteOutcome.rejected,
        status: status,
        reason: reason ?? 'rejected',
      );
    }
    throw const FormatException('Workforce response missing ok flag');
  }

  final WorkforceRemoteOutcome outcome;
  final String? status;
  final String? reason;

  bool get isDelivered => outcome != WorkforceRemoteOutcome.rejected;
}

abstract interface class WorkforceTransitionRemote {
  /// Sends one update. Throws on transport failure or an unexpected response;
  /// returns normally (including `rejected`) when the server answered.
  Future<WorkforceRemoteResult> apply({
    required String assignmentId,
    required String action,
    required String idempotencyKey,
    required DateTime clientAt,
    String? note,
  });
}

final class SupabaseWorkforceTransitionRemote
    implements WorkforceTransitionRemote {
  const SupabaseWorkforceTransitionRemote(this._client);

  final SupabaseClient _client;

  @override
  Future<WorkforceRemoteResult> apply({
    required String assignmentId,
    required String action,
    required String idempotencyKey,
    required DateTime clientAt,
    String? note,
  }) async {
    final Object? response = await _client.rpc<Object?>(
      'workforce_assignment_transition',
      params: <String, Object?>{
        'p_assignment_id': assignmentId,
        'p_action': action,
        'p_idempotency_key': idempotencyKey,
        'p_note': note,
        'p_client_at': clientAt.toUtc().toIso8601String(),
      },
    );
    return WorkforceRemoteResult.fromJson(response);
  }
}
