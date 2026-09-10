/// Persists reviewer evidence before attempting the canonical server decision.
/// Revision and stage are captured at review time, never refreshed on retry.
/// The server checks current authority and exact revision atomically, returning
/// the original receipt for a retried operation after a lost response. Legacy
/// unversioned entries stay visible and require a fresh review.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_decision_queue.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';
import 'package:uuid/uuid.dart';

/// What [ChecklistApprovalSyncEngine.decideNow] or
/// [ChecklistApprovalSyncEngine.retryOne] actually did.
enum ChecklistApprovalDecisionOutcome {
  /// Reached the server immediately, and the write was accepted - the
  /// entry has already been removed from the on-device queue.
  deliveredNow,

  /// Could not be delivered immediately (most likely offline), but is
  /// safely durable in the on-device queue and will be retried
  /// automatically.
  queued,

  /// Delivery was attempted and definitively refused - either the server
  /// rejected the write outright, or this engine detected that the
  /// submission has moved on since the decision was made. Still durable on
  /// this device (see [ChecklistApprovalQueueStatus.blocked]), but will
  /// NOT be retried automatically again. The reviewer should see
  /// [ChecklistApprovalDecisionResult.error] and, ordinarily, reopen the
  /// submission to make a fresh decision against its current state.
  blocked,
}

class ChecklistApprovalDecisionResult {
  const ChecklistApprovalDecisionResult({
    required this.outcome,
    required this.decisionId,
    this.error,
  });

  final ChecklistApprovalDecisionOutcome outcome;

  /// [QueuedChecklistApprovalDecision.id] - the dedupe key.
  final String decisionId;

  /// Set only for [ChecklistApprovalDecisionOutcome.blocked].
  final AppError? error;
}

/// Summary of one [ChecklistApprovalSyncEngine.flushQueue] pass.
class ChecklistApprovalFlushSummary {
  const ChecklistApprovalFlushSummary({
    this.attempted = 0,
    this.delivered = 0,
    this.blocked = 0,
  });

  final int attempted;
  final int delivered;
  final int blocked;
}

final class ChecklistApprovalSyncEngine {
  ChecklistApprovalSyncEngine({
    required ChecklistApprovalDecisionQueue queue,
    required ChecklistApprovalRepository repository,
  })  : _queue = queue,
        _repository = repository;

  final ChecklistApprovalDecisionQueue _queue;
  final ChecklistApprovalRepository _repository;

  /// Queues a decision and attempts to deliver it once, immediately. Never
  /// Repository delivery failures resolve to
  /// [ChecklistApprovalDecisionOutcome.queued] or
  /// [ChecklistApprovalDecisionOutcome.blocked], because pressing Approve
  /// or Send back must never leave the reviewer with nothing to show for a
  /// completed decision.
  ///
  /// [stage] must be the outstanding rung this decision was made against
  /// (`stageFor(template, submission)` at the moment of deciding) -
  /// resolving that is the CALLER's job (the review screen), per this
  /// port's own boundary: this engine orchestrates delivery, it does not
  /// decide what the ladder allows. [priorApprovalStatus] must be
  /// `submission.approvalStatus` at that same moment.
  Future<ChecklistApprovalDecisionResult> decideNow({
    required String submissionId,
    int? expectedRevision,
    String? expectedStageToken,
    required ApprovalStage stage,
    required String priorApprovalStatus,
    required String targetStatus,
    required bool approved,
    String? decision,
    String? approverName,
    String? approverSignature,
    String? approverId,
    String? reviewNote,
  }) async {
    final QueuedChecklistApprovalDecision item =
        QueuedChecklistApprovalDecision(
      id: const Uuid().v4(),
      expectedRevision: expectedRevision,
      expectedStageToken: expectedStageToken,
      submissionId: submissionId,
      stage: stage,
      priorApprovalStatus: priorApprovalStatus,
      targetStatus: targetStatus,
      approved: approved,
      decision: decision ?? (approved ? 'approved' : 'returned'),
      decidedAt: DateTime.now(),
      // Already resolved to `approved ? theSignature : null` - a rejection
      // never carries a signature, matching `mobile/lib/checklists.ts`'s
      // own `const signature = input.approved ? (input.approverSignature
      // ?? null) : null`.
      approverSignature: approved ? approverSignature : null,
      approverName: approverName,
      approverId: approverId,
      reviewNote: reviewNote,
    );

    // Durable commit point FIRST - see the library comment.
    await _queue.enqueue(item);

    return _attemptDelivery(item);
  }

  /// Retries every queued entry NOT already [ChecklistApprovalQueueStatus.
  /// blocked] or [ChecklistApprovalQueueStatus.synced]. Intended to be
  /// called opportunistically - right after [decideNow] queues something
  /// (in case connectivity returns between the enqueue and now), and when
  /// the approvals queue screen opens.
  Future<ChecklistApprovalFlushSummary> flushQueue() async {
    final ChecklistApprovalQueueReadResult read = await _queue.list();
    if (!read.isReadable) {
      // Refuse rather than guess - see `ChecklistApprovalQueueReadResult`'s
      // own doc comment. Reporting "nothing to flush" here would be
      // exactly the "empty read that means two different things" trap.
      return const ChecklistApprovalFlushSummary();
    }

    int attempted = 0;
    int delivered = 0;
    int blocked = 0;
    for (final QueuedChecklistApprovalDecision item in read.items) {
      if (item.status != ChecklistApprovalQueueStatus.pending) continue;
      attempted++;
      final ChecklistApprovalDecisionResult result = await _attemptDelivery(
        item,
      );
      if (result.outcome == ChecklistApprovalDecisionOutcome.deliveredNow) {
        delivered++;
      } else if (result.outcome == ChecklistApprovalDecisionOutcome.blocked) {
        blocked++;
      }
    }
    return ChecklistApprovalFlushSummary(
      attempted: attempted,
      delivered: delivered,
      blocked: blocked,
    );
  }

  /// Explicitly retries ONE entry, whatever its current status - including
  /// one [ChecklistApprovalQueueStatus.blocked] entry [flushQueue] would
  /// otherwise never touch again on its own. For a "Try again" action a
  /// reviewer takes deliberately, from the queue screen, on a decision
  /// that is currently blocked - see [ChecklistApprovalQueueStatus.blocked]'s
  /// own doc comment. Returns `null` when [id] is not in the queue at all.
  Future<ChecklistApprovalDecisionResult?> retryOne(String id) async {
    final QueuedChecklistApprovalDecision? item = await _queue.byId(id);
    if (item == null) return null;
    return _attemptDelivery(item);
  }

  /// Every currently-queued (not yet synced) decision, for the approvals
  /// queue screen's "pending decisions" panel. Empty (never null) when the
  /// store is unreadable - matches [ChecklistApprovalDecisionQueue.
  /// pendingCount]'s own "refuse-by-undercounting" contract, appropriate
  /// for a panel that is allowed to show nothing rather than crash.
  Future<List<QueuedChecklistApprovalDecision>> listQueued() async {
    final ChecklistApprovalQueueReadResult read = await _queue.list();
    if (!read.isReadable) return const <QueuedChecklistApprovalDecision>[];
    return read.items
        .where((d) => d.status != ChecklistApprovalQueueStatus.synced)
        .toList(growable: false);
  }

  Future<int> pendingCount() => _queue.pendingCount();

  Future<ChecklistApprovalDecisionResult> _attemptDelivery(
    QueuedChecklistApprovalDecision item,
  ) async {
    try {
      // The server resolves operation replay before checking the frozen
      // revision/stage. A preflight read would block recovery after a lost
      // acknowledgement of a committed decision.
      if (item.expectedRevision == null || item.expectedStageToken == null) {
        return await _block(
          item,
          const AppError.conflict(
            technical:
                'Legacy approval evidence needs a fresh review before sending',
          ),
        );
      }

      final ChecklistApprovalApplyResult applied =
          await _repository.applyDecision(item);
      if (applied == ChecklistApprovalApplyResult.conflict) {
        // The database's own optimistic-concurrency guard caught what the
        // stage re-check above did not - the narrow window between that
        // read and this write. Same outcome, same reason.
        return await _block(
          item,
          const AppError.conflict(
            technical: 'checklist submission approval_status changed '
                'since decision (server-side guard)',
          ),
        );
      }

      final DateTime now = DateTime.now();
      await _queue.markSynced(item.id, now);
      await _queue.remove(item.id);

      return ChecklistApprovalDecisionResult(
        outcome: ChecklistApprovalDecisionOutcome.deliveredNow,
        decisionId: item.id,
      );
    } on Object catch (error) {
      final SupabaseFailure failure =
          error is SupabaseFailure ? error : classifySupabaseError(error);
      final AppError appError = failure.error;

      if (failure.isConnectivity) {
        // The ordinary, expected offline case - stays
        // [ChecklistApprovalQueueStatus.pending] so the NEXT flush pass
        // retries it automatically, exactly like
        // `InspectionSyncEngine`'s own network-failure branch.
        await _queue.markFailed(
          item.id,
          error: appError.message,
          status: ChecklistApprovalQueueStatus.pending,
        );
        return ChecklistApprovalDecisionResult(
          outcome: ChecklistApprovalDecisionOutcome.queued,
          decisionId: item.id,
        );
      }

      // Anything else reached the server (or a definitively refusing
      // intermediary, or this device's own template lookup genuinely
      // failed) and is a reason retrying UNCHANGED will not fix -
      // `guard_checklist_approval_stages` refusing a rung signed by the
      // wrong role, a schema mismatch, a permission refusal. Blocked, not
      // silently retried.
      return _block(item, appError);
    }
  }

  Future<ChecklistApprovalDecisionResult> _block(
    QueuedChecklistApprovalDecision item,
    AppError error,
  ) async {
    await _queue.markFailed(
      item.id,
      error: error.message,
      status: ChecklistApprovalQueueStatus.blocked,
    );
    return ChecklistApprovalDecisionResult(
      outcome: ChecklistApprovalDecisionOutcome.blocked,
      decisionId: item.id,
      error: error,
    );
  }
}
