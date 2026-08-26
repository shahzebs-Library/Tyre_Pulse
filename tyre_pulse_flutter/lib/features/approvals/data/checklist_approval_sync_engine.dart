/// Orchestrates one checklist approval decision: durably queue it FIRST,
/// then try to deliver it, and never deliver a decision that no longer
/// matches the submission it was made against.
///
/// # The commit-then-attempt order
///
/// [decideNow] always writes a [QueuedChecklistApprovalDecision] to
/// [ChecklistApprovalDecisionQueue] BEFORE attempting anything over the
/// network - the same ordering `features/inspections/data/inspection_sync_
/// engine.dart`'s `InspectionSyncEngine.submitNow` uses, and for the same
/// reason: a process kill between a slow request being sent and its catch
/// block running must not lose a supervisor's signature with no trace
/// anywhere on the device (AGENTS.md rule 9, "Never remove offline
/// persistence for convenience"). The queue write, made atomically by
/// [FileChecklistApprovalDecisionQueue], is the durable commit point; the
/// immediate delivery attempt that follows is best-effort on top of an
/// already-safe write, never a substitute for one.
///
/// # The one rule this engine exists to enforce, that `InspectionSyncEngine`
/// # does NOT need to
///
/// AGENTS.md: "Approvals and other decisions that depend on current server
/// state are NOT blindly queued (spec section 14)." An inspection
/// submission is a plain observation - its payload is equally correct
/// whenever it finally lands, which is why `InspectionSyncEngine.
/// flushQueue` retries every non-synced entry, including one that
/// previously failed, forever. A checklist approval decision is different:
/// it is a statement about ONE specific rung
/// ([QueuedChecklistApprovalDecision.stage]) of ONE specific submission,
/// and it is only correct while that submission is still waiting at that
/// rung. If somebody else decides the submission first - or it moves on
/// for any other reason - between when this decision was made and when it
/// finally reaches the server, applying it unchanged would silently
/// contradict a decision somebody else already made.
///
/// [_attemptDelivery] therefore does something `InspectionSyncEngine`'s
/// equivalent step does not: on EVERY attempt, first or retried, it
/// re-reads the submission from the server and recomputes
/// `stageFor(template, freshSubmission)` before writing anything. If the
/// submission's CURRENT stage no longer matches the stage this decision
/// was made against, the write is skipped entirely - nothing is sent - and
/// the entry moves to [ChecklistApprovalQueueStatus.blocked] with an
/// [AppError.conflict], which [ChecklistApprovalSyncEngine.flushQueue]
/// will never retry automatically again (see
/// [ChecklistApprovalQueueStatus.blocked]'s own doc comment for what
/// happens to it next). This is the SAME defence `ChecklistApprovalRepository.
/// applyDecision`'s optimistic-concurrency write adds at the database call
/// itself - deliberately two independent layers, because the gap between
/// this engine's own re-check and the write actually reaching Postgres is
/// exactly the window a single check cannot close on its own.
///
/// # Outcomes are named, not booleans
///
/// [ChecklistApprovalDecisionOutcome] mirrors `InspectionSubmitOutcome`'s
/// own reasoning: "delivered now" and "safely queued for later" are both
/// legitimate successful outcomes from the reviewer's point of view (the
/// decision is durably recorded on this device either way), and only
/// [ChecklistApprovalDecisionOutcome.blocked] is something they need to be
/// told about immediately, because it means either the server refused the
/// decision outright or this engine detected the submission had already
/// moved on.
library;

import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_decision_queue.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

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
  }) : _queue = queue,
       _repository = repository;

  final ChecklistApprovalDecisionQueue _queue;
  final ChecklistApprovalRepository _repository;

  /// Queues a decision and attempts to deliver it once, immediately. Never
  /// throws - every failure resolves to
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
    required ApprovalStage stage,
    required String priorApprovalStatus,
    required String targetStatus,
    required bool approved,
    String? approverName,
    String? approverSignature,
    String? approverId,
    String? reviewNote,
  }) async {
    final QueuedChecklistApprovalDecision item =
        QueuedChecklistApprovalDecision(
          id: QueuedChecklistApprovalDecision.dedupeKeyFor(
            submissionId: submissionId,
            targetStatus: targetStatus,
          ),
          submissionId: submissionId,
          stage: stage,
          priorApprovalStatus: priorApprovalStatus,
          targetStatus: targetStatus,
          approved: approved,
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
      // Re-validate against CURRENT server state before writing anything -
      // see the library comment. This runs on EVERY attempt, first or
      // retried, exactly as `InspectionSyncEngine._attemptDelivery`
      // re-resolves photo paths from the draft on every attempt rather
      // than trusting a possibly-stale snapshot.
      final ChecklistApprovalItem? current = await _repository.byId(
        item.submissionId,
      );
      if (current == null) {
        return _block(
          item,
          const AppError(
            kind: AppErrorKind.validation,
            message:
                'This checklist could not be found. It may have '
                'been removed.',
          ),
        );
      }

      ChecklistApprovalTemplateInfo? templateInfo;
      final String? templateId = current.templateId;
      if (templateId != null && templateId.isNotEmpty) {
        templateInfo = await _repository.templateInfo(templateId);
      }
      final ApprovalTemplateLike templateLike =
          templateInfo?.asTemplateLike ?? const ApprovalTemplateLike();

      final ApprovalStage? currentStage = stageFor(
        templateLike,
        current.asSubmissionLike,
      );
      if (currentStage != item.stage) {
        // Somebody else already acted on this submission, or it is no
        // longer at the rung this decision was made against - the exact
        // situation AGENTS.md rule 14 exists to prevent silently landing.
        return _block(
          item,
          const AppError.conflict(
            technical: 'checklist submission stage changed since decision',
          ),
        );
      }

      final ChecklistApprovalApplyResult applied = await _repository
          .applyDecision(item);
      if (applied == ChecklistApprovalApplyResult.conflict) {
        // The database's own optimistic-concurrency guard caught what the
        // stage re-check above did not - the narrow window between that
        // read and this write. Same outcome, same reason.
        return _block(
          item,
          const AppError.conflict(
            technical:
                'checklist submission approval_status changed '
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
      final SupabaseFailure failure = error is SupabaseFailure
          ? error
          : classifySupabaseError(error);
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
