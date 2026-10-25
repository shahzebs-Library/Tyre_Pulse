/// One assignment status update made on this device that the server has not
/// confirmed yet (or has refused).
///
/// [id] is the idempotency key sent to `workforce_assignment_transition`. It is
/// generated ONCE when the user taps and is reused for every retry, so a
/// request whose response was lost can be replayed without applying twice.
library;

import 'dart:convert';

import 'package:tyre_pulse/features/my_work/domain/workforce_transition.dart';

enum WorkforceQueueStatus {
  /// Waiting to be delivered. Retried automatically.
  pending,

  /// The server refused it (the assignment moved on, a permission changed...)
  /// or it depends on an earlier refused update. NEVER retried automatically
  /// and never deleted until the user has seen it and dismissed it.
  rejected;

  static WorkforceQueueStatus? fromName(String? value) {
    for (final WorkforceQueueStatus status in WorkforceQueueStatus.values) {
      if (status.name == value) return status;
    }
    return null;
  }
}

final class QueuedWorkforceTransition {
  const QueuedWorkforceTransition({
    required this.id,
    required this.userId,
    required this.assignmentId,
    required this.action,
    required this.seq,
    required this.createdAt,
    required this.clientAt,
    this.baseStatus,
    this.note,
    this.status = WorkforceQueueStatus.pending,
    this.attempts = 0,
    this.error,
    this.serverStatus,
    this.rejectionReason,
  });

  factory QueuedWorkforceTransition.fromJson(Map<String, Object?> json) {
    final WorkforceAction? action =
        WorkforceAction.fromWire(json['action'] as String?);
    final WorkforceQueueStatus? status =
        WorkforceQueueStatus.fromName(json['status'] as String?);
    if (action == null || status == null) {
      throw const FormatException('Unknown workforce queue entry');
    }
    return QueuedWorkforceTransition(
      id: json['id']! as String,
      userId: json['userId']! as String,
      assignmentId: json['assignmentId']! as String,
      action: action,
      seq: (json['seq']! as num).toInt(),
      createdAt: DateTime.parse(json['createdAt']! as String),
      clientAt: DateTime.parse(json['clientAt']! as String),
      baseStatus: json['baseStatus'] as String?,
      note: json['note'] as String?,
      status: status,
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
      error: json['error'] as String?,
      serverStatus: json['serverStatus'] as String?,
      rejectionReason: json['rejectionReason'] as String?,
    );
  }

  factory QueuedWorkforceTransition.fromJsonString(String raw) {
    final Object? decoded = jsonDecode(raw);
    if (decoded is! Map<String, Object?>) {
      throw const FormatException('Workforce queue entry is not an object');
    }
    return QueuedWorkforceTransition.fromJson(decoded);
  }

  /// Idempotency key, also the file name. Generated once per user tap.
  final String id;

  /// The account that made the change. The queue is partitioned by this, so
  /// one person's updates are never sent under another person's session.
  final String userId;
  final String assignmentId;
  final WorkforceAction action;

  /// Per-user delivery order. Updates for one assignment are always sent in
  /// this order.
  final int seq;
  final DateTime createdAt;

  /// When the user actually acted (UTC). The server bounds it, so a wrong
  /// device clock cannot rewrite history.
  final DateTime clientAt;

  /// The assignment status this device showed when the user tapped.
  final String? baseStatus;
  final String? note;
  final WorkforceQueueStatus status;
  final int attempts;

  /// Safe, user-facing sentence for the last failure.
  final String? error;

  /// The status the server reported when it refused the update, if it said.
  final String? serverStatus;

  /// Machine reason from the server (`invalid_transition`, `not_found`...).
  final String? rejectionReason;

  QueuedWorkforceTransition copyWith({
    WorkforceQueueStatus? status,
    int? attempts,
    String? error,
    String? serverStatus,
    String? rejectionReason,
    bool clearError = false,
  }) {
    return QueuedWorkforceTransition(
      id: id,
      userId: userId,
      assignmentId: assignmentId,
      action: action,
      seq: seq,
      createdAt: createdAt,
      clientAt: clientAt,
      baseStatus: baseStatus,
      note: note,
      status: status ?? this.status,
      attempts: attempts ?? this.attempts,
      error: clearError ? null : (error ?? this.error),
      serverStatus: clearError ? null : (serverStatus ?? this.serverStatus),
      rejectionReason:
          clearError ? null : (rejectionReason ?? this.rejectionReason),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'id': id,
        'userId': userId,
        'assignmentId': assignmentId,
        'action': action.wire,
        'seq': seq,
        'createdAt': createdAt.toUtc().toIso8601String(),
        'clientAt': clientAt.toUtc().toIso8601String(),
        'baseStatus': baseStatus,
        'note': note,
        'status': status.name,
        'attempts': attempts,
        'error': error,
        'serverStatus': serverStatus,
        'rejectionReason': rejectionReason,
      };

  String toJsonString() => jsonEncode(toJson());
}
