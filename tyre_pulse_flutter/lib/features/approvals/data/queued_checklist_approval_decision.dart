/// A checklist approval decision, and the JSON shape it is persisted under
/// on this device while it is durable-but-not-yet-confirmed.
///
/// # Why this exists as its OWN queue entry, and not a `pending_commands`
/// # row
///
/// `lib/core/sync/command_registry.dart`'s own doc comment excludes
/// `CHECKLIST_APPROVAL` from the closed 14-`CommandType` registry by name,
/// citing "Artifact 06 section 4". AGENTS.md states the underlying reason
/// directly: "Approvals and other decisions that depend on current server
/// state are NOT blindly queued (spec section 14)." A checklist submission
/// (`CommandType.checklistSubmission`) is a plain observation - its meaning
/// never changes between when it is made and when it finally reaches the
/// server, so the generic queue's "retry the same payload until it lands"
/// model is exactly right for it. An approval DECISION is different: it is
/// only correct for the specific rung ([stage]) it was made against, and a
/// stale decision replayed against a submission that has since moved on
/// (someone else decided it, or it advanced past the rung this decision
/// targets) must never silently land - see [ChecklistApprovalSyncEngine]'s
/// own library comment for exactly how that is prevented.
///
/// # What is stored, and what is deliberately NOT
///
/// A signature captured for THIS decision is carried on [approverSignature]
/// as a `data:` URL, transiently, until this item either syncs or is
/// discarded. It is NEVER written into `MediaDao`/the `CapturedSignatures`
/// Drift table `checklist_signature_pad.dart` uses for a checklist FILL
/// signature - `draft_tables.dart`'s own doc comment on
/// `CapturedSignatures.ownerKind` states this explicitly: "an approver's
/// mark goes straight to the RPC/update while online and is never
/// persisted" the way a checklist-fill signature is. This file's own
/// on-device JSON persistence (via [ChecklistApprovalDecisionQueue]) is the
/// ONE place a not-yet-delivered approval signature lives on this device,
/// and only for as long as delivery genuinely could not be confirmed.
///
/// # Field-for-field mirror of `mobile/lib/checklists.ts`'s `decideApproval`
///
/// [targetStatus], [priorApprovalStatus], [approverName], [approverSignature],
/// [approverId] and [reviewNote] together carry EXACTLY what
/// `decideApproval` computes before calling `saveCommand('CHECKLIST_APPROVAL',
/// ...)` - see [ChecklistApprovalRepository.applyDecision] for the write
/// this produces, field for field against the TS source (re-read directly
/// from `mobile/lib/checklists.ts:440-485` for this port, not from a
/// paraphrase).
library;

import 'dart:convert';

import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalStage;

/// Wire tokens for [ApprovalStage] - mirrors the mobile RN reference
/// source's own `rung.key === 'area_manager'` usage
/// (`mobile/app/(app)/checklists/approvals/[submissionId].tsx`). Kept here,
/// rather than added to `checklist_approval.dart`, because that file is
/// pure Dart with zero imports and this is a JSON-serialisation concern of
/// THIS feature's own on-device persistence, not of the ladder engine.
String approvalStageToWire(ApprovalStage stage) => switch (stage) {
      ApprovalStage.supervisor => 'supervisor',
      ApprovalStage.areaManager => 'area_manager',
    };

/// The inverse of [approvalStageToWire]. Returns `null` for anything else -
/// a queue entry with an unreadable stage cannot be safely re-validated
/// (see [ChecklistApprovalSyncEngine]), so [QueuedChecklistApprovalDecision.
/// fromJson] refuses to decode one rather than guessing.
ApprovalStage? approvalStageFromWire(String? wire) => switch (wire) {
      'supervisor' => ApprovalStage.supervisor,
      'area_manager' => ApprovalStage.areaManager,
      _ => null,
    };

/// The three states a queued decision can be in on this device.
///
/// Deliberately NOT the two-state pending/synced/failed shape
/// `queued_inspection.dart` uses. An inspection submission's payload never
/// stops being correct while it waits, so `flushQueue` retrying a `failed`
/// entry forever is safe there. A checklist decision is only correct for
/// the rung it targets - see [ChecklistApprovalSyncEngine]'s library
/// comment - so this queue distinguishes "will keep retrying on its own"
/// from "will NOT be retried automatically again, and needs a person to
/// look at it".
enum ChecklistApprovalQueueStatus {
  /// Not yet delivered. Either never attempted, or the last attempt failed
  /// for a reason retrying unchanged could plausibly fix (no connection).
  /// [ChecklistApprovalSyncEngine.flushQueue] retries these automatically.
  pending,

  /// Delivered and confirmed. [ChecklistApprovalDecisionQueue.remove]s
  /// this entry once it reaches this state - see that class's own contract.
  synced,

  /// The last attempt failed for a reason automatic retrying will not fix:
  /// the server refused it outright, or - the case this feature is built
  /// specifically to catch - the submission has moved on since this
  /// decision was made and re-sending it unchanged would be wrong, not
  /// merely late. Surfaced to the reviewer; never retried by
  /// [ChecklistApprovalSyncEngine.flushQueue] on its own. A person may
  /// still explicitly ask to try again
  /// ([ChecklistApprovalSyncEngine.retryOne]), or - more usually - reopen
  /// the submission and make a fresh decision against its current state,
  /// which mints a NEW dedupe key rather than resurrecting this one.
  blocked,
}

String _queueStatusToWire(ChecklistApprovalQueueStatus status) =>
    switch (status) {
      ChecklistApprovalQueueStatus.pending => 'pending',
      ChecklistApprovalQueueStatus.synced => 'synced',
      ChecklistApprovalQueueStatus.blocked => 'blocked',
    };

ChecklistApprovalQueueStatus _queueStatusFromWire(String? wire) =>
    switch (wire) {
      'synced' => ChecklistApprovalQueueStatus.synced,
      'blocked' => ChecklistApprovalQueueStatus.blocked,
      _ => ChecklistApprovalQueueStatus.pending,
    };

/// One decision, durable on this device from the moment it is made until
/// delivery is confirmed (or it is explicitly abandoned).
class QueuedChecklistApprovalDecision {
  const QueuedChecklistApprovalDecision({
    required this.id,
    this.expectedRevision,
    this.expectedStageToken,
    required this.submissionId,
    required this.stage,
    required this.priorApprovalStatus,
    required this.targetStatus,
    required this.approved,
    this.decision,
    required this.decidedAt,
    this.approverName,
    this.approverSignature,
    this.approverId,
    this.reviewNote,
    this.status = ChecklistApprovalQueueStatus.pending,
    this.syncedAt,
    this.error,
    this.attempts = 0,
  });

  /// Unique operation UUID, reused unchanged until the server acknowledges it.
  /// It also names the durable evidence file. Legacy IDs remain readable.
  final String id;

  /// Frozen at review time. Legacy entries remain readable but cannot replay.
  final int? expectedRevision;
  final String? expectedStageToken;

  final String submissionId;

  /// The rung this decision was made against. Required, never null: a
  /// decision can only be constructed once `stageFor(...)` returned a real
  /// stage (see `checklist_approval_review_screen.dart`) - a submission
  /// with nothing outstanding has nothing to decide. This is the
  /// authoritative signal [ChecklistApprovalSyncEngine] re-checks before
  /// every delivery attempt: if the submission's CURRENT stage no longer
  /// matches this one, the submission has moved on and this decision must
  /// not be applied.
  final ApprovalStage stage;

  /// `checklist_submissions.approval_status` as it stood WHEN this
  /// decision was made. Carried into the server write as an optimistic-
  /// concurrency guard (`.eq('approval_status', priorApprovalStatus)`) so
  /// the write itself can never silently land on a row that has since
  /// changed, even in the narrow window between this engine's own
  /// pre-flight re-check and the write reaching the server. Mirrors the
  /// `requiresOptimisticStatusMatch` pattern `checklist_submission_
  /// repository.dart`'s own library comment describes for
  /// `checklistAssignmentStatus`/`workOrderStatus`/`correctiveActionStatus`
  /// in the generic queue - applied here by hand, since `CHECKLIST_APPROVAL`
  /// is not a member of that generic registry at all.
  final String priorApprovalStatus;

  /// `nextStatusFor(template, submission, approved)`, resolved ONCE when
  /// this decision was made - `'approved'`, `'rejected'` or
  /// `'pending_area_manager'`.
  final String targetStatus;

  /// `true` to sign off/approve the outstanding [stage], `false` to send
  /// the submission back.
  final bool approved;

  /// Explicit returned/rejected decision; absent on legacy evidence.
  final String? decision;
  String get wireDecision => decision ?? (approved ? 'approved' : 'returned');

  /// Client capture time; accepted actor/time are derived by the server.
  final DateTime decidedAt;

  /// `input.approverName || null` in the TS source - a blank name is
  /// stored as absent, never as `''`.
  final String? approverName;

  /// Already resolved to `approved ? theSignature : null` - a rejection
  /// never carries a signature, whatever was drawn before the reviewer
  /// changed their mind. See the library comment on why this is the ONE
  /// place an approval signature is persisted on this device.
  final String? approverSignature;

  /// The signed-in reviewer's own user id, for `approved_by`/
  /// `supervisor_by`. Never a display name - see
  /// `InspectionApprovalDecision.approverName`'s own doc comment on the
  /// same distinction over the analogous inspection table: the server-side
  /// column that actually identifies WHO decided must never be filled from
  /// something a person could type.
  final String? approverId;

  /// The reason for a rejection. `null`/ignored for an approval - matches
  /// `input.approved ? null : (input.reviewNote ?? null)`.
  final String? reviewNote;

  final ChecklistApprovalQueueStatus status;
  final DateTime? syncedAt;

  /// Sanitised before storage - an [AppError.message], never a raw driver
  /// message. Matches `QueuedInspection.error`'s own discipline.
  final String? error;

  final int attempts;

  QueuedChecklistApprovalDecision copyWith({
    ChecklistApprovalQueueStatus? status,
    DateTime? syncedAt,
    bool clearSyncedAt = false,
    String? error,
    bool clearError = false,
    int? attempts,
  }) {
    return QueuedChecklistApprovalDecision(
      id: id,
      expectedRevision: expectedRevision,
      expectedStageToken: expectedStageToken,
      submissionId: submissionId,
      stage: stage,
      priorApprovalStatus: priorApprovalStatus,
      targetStatus: targetStatus,
      approved: approved,
      decision: decision,
      decidedAt: decidedAt,
      approverName: approverName,
      approverSignature: approverSignature,
      approverId: approverId,
      reviewNote: reviewNote,
      status: status ?? this.status,
      syncedAt: clearSyncedAt ? null : (syncedAt ?? this.syncedAt),
      error: clearError ? null : (error ?? this.error),
      attempts: attempts ?? this.attempts,
    );
  }

  /// The dedupe key `'approve_${submissionId}_$targetStatus'` this class is
  /// always constructed with as [id] - exposed as a static helper so
  /// `ChecklistApprovalSyncEngine.decideNow` and every test build it the
  /// same way, once.
  static String dedupeKeyFor({
    required String submissionId,
    required String targetStatus,
  }) =>
      'approve_${submissionId}_$targetStatus';

  Map<String, Object?> toJson() {
    return <String, Object?>{
      'schemaVersion': 2,
      'id': id,
      'expectedRevision': expectedRevision,
      'expectedStageToken': expectedStageToken,
      'submissionId': submissionId,
      'stage': approvalStageToWire(stage),
      'priorApprovalStatus': priorApprovalStatus,
      'targetStatus': targetStatus,
      'approved': approved,
      'decision': decision,
      'decidedAt': decidedAt.toIso8601String(),
      'approverName': approverName,
      'approverSignature': approverSignature,
      'approverId': approverId,
      'reviewNote': reviewNote,
      'status': _queueStatusToWire(status),
      'syncedAt': syncedAt?.toIso8601String(),
      'error': error,
      'attempts': attempts,
    };
  }

  String toJsonString() => jsonEncode(toJson());

  /// Decodes [json]. Throws a [FormatException] when [id], [submissionId]
  /// or [stage] cannot be read - all three are required to safely
  /// re-validate and apply this decision, and a partially-unreadable
  /// decision must never be guessed at (see [ChecklistApprovalSyncEngine]).
  static QueuedChecklistApprovalDecision fromJson(Map<String, Object?> json) {
    final Object? rawId = json['id'];
    final Object? rawSubmissionId = json['submissionId'];
    final ApprovalStage? stage = approvalStageFromWire(
      json['stage'] as String?,
    );
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException(
        'Queued checklist approval decision has no usable "id".',
      );
    }
    if (rawSubmissionId is! String || rawSubmissionId.isEmpty) {
      throw const FormatException(
        'Queued checklist approval decision has no usable "submissionId".',
      );
    }
    if (stage == null) {
      throw const FormatException(
        'Queued checklist approval decision has no usable "stage".',
      );
    }
    final Object? rawPriorStatus = json['priorApprovalStatus'];
    final Object? rawTargetStatus = json['targetStatus'];
    if (rawPriorStatus is! String || rawTargetStatus is! String) {
      throw const FormatException(
        'Queued checklist approval decision has no usable status fields.',
      );
    }

    return QueuedChecklistApprovalDecision(
      id: rawId,
      expectedRevision: (json['expectedRevision'] as num?)?.toInt(),
      expectedStageToken: json['expectedStageToken'] as String?,
      submissionId: rawSubmissionId,
      stage: stage,
      priorApprovalStatus: rawPriorStatus,
      targetStatus: rawTargetStatus,
      approved: json['approved'] == true,
      decision: json['decision'] as String?,
      decidedAt: _dateTimeOrNow(json['decidedAt']),
      approverName: json['approverName'] as String?,
      approverSignature: json['approverSignature'] as String?,
      approverId: json['approverId'] as String?,
      reviewNote: json['reviewNote'] as String?,
      status: _queueStatusFromWire(json['status'] as String?),
      syncedAt: _dateTimeOrNull(json['syncedAt']),
      error: json['error'] as String?,
      attempts: (json['attempts'] as num?)?.toInt() ?? 0,
    );
  }

  static QueuedChecklistApprovalDecision fromJsonString(String raw) =>
      fromJson((jsonDecode(raw) as Map).cast<String, Object?>());

  static DateTime _dateTimeOrNow(Object? raw) =>
      _dateTimeOrNull(raw) ?? DateTime.now().toUtc();

  static DateTime? _dateTimeOrNull(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }

  @override
  String toString() => 'QueuedChecklistApprovalDecision(id: $id, '
      'targetStatus: $targetStatus, status: $status)';
}
