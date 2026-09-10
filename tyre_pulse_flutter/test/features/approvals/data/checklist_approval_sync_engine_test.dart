/// Coverage for [ChecklistApprovalSyncEngine] - the commit-then-attempt
/// ordering (AGENTS.md rule 9), AND the one rule this engine exists to
/// enforce that `InspectionSyncEngine` does not need to (AGENTS.md rule 14,
/// "Approvals and other decisions that depend on current server state are
/// NOT blindly queued"): a decision must never be delivered once the
/// submission it targets has moved on, whether that is caught by this
/// engine's own pre-flight re-check of [stageFor] or by
/// [ChecklistApprovalRepository.applyDecision]'s own server-side
/// optimistic-concurrency guard.
///
/// Every collaborator is a hand-written fake implementing this feature's
/// own plain-Dart interfaces - no Supabase type, no mocktail - mirroring
/// `test/features/inspections/data/inspection_sync_engine_test.dart`'s own
/// `_FakeRemoteRepository`/`_FakeSubmissionQueue` precedent.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/errors/app_error.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_decision_queue.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_sync_engine.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_template_info.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalStage;

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

class _FakeQueue implements ChecklistApprovalDecisionQueue {
  final Map<String, QueuedChecklistApprovalDecision> store =
      <String, QueuedChecklistApprovalDecision>{};
  final List<String> enqueueCalls = <String>[];

  /// Every item ever passed to [enqueue], in order - unlike [store], never
  /// shrinks when an entry is later [remove]d, so a test can inspect
  /// exactly what was queued even after a successful delivery has already
  /// removed it from the live store.
  final List<QueuedChecklistApprovalDecision> enqueuedItems =
      <QueuedChecklistApprovalDecision>[];

  @override
  Future<void> enqueue(QueuedChecklistApprovalDecision item) async {
    enqueueCalls.add(item.id);
    enqueuedItems.add(item);
    store[item.id] = item;
  }

  @override
  Future<ChecklistApprovalQueueReadResult> list() async =>
      ChecklistApprovalQueueReadResult.ok(store.values.toList(growable: false));

  @override
  Future<QueuedChecklistApprovalDecision?> byId(String id) async => store[id];

  @override
  Future<void> markSynced(String id, DateTime at) async {
    final QueuedChecklistApprovalDecision? current = store[id];
    if (current == null) return;
    store[id] = current.copyWith(
      status: ChecklistApprovalQueueStatus.synced,
      syncedAt: at,
      clearError: true,
    );
  }

  @override
  Future<void> markFailed(
    String id, {
    required String error,
    required ChecklistApprovalQueueStatus status,
  }) async {
    final QueuedChecklistApprovalDecision? current = store[id];
    if (current == null) return;
    store[id] = current.copyWith(
      status: status,
      error: error,
      attempts: current.attempts + 1,
    );
  }

  @override
  Future<void> remove(String id) async => store.remove(id);

  @override
  Future<int> pendingCount() async => store.values
      .where((d) => d.status != ChecklistApprovalQueueStatus.synced)
      .length;
}

class _FakeRepository implements ChecklistApprovalRepository {
  /// The submission [byId] returns for the engine's own pre-flight
  /// re-check - the CURRENT server state, independent of what the queued
  /// decision itself was made against. Mutating this between attempts is
  /// how a test simulates "somebody else already decided this".
  ChecklistApprovalItem? current;

  ChecklistApprovalTemplateInfo? template;

  /// Set to throw a specific object on the next [applyDecision] call.
  Object? applyFailWith;

  /// Set to throw a specific object on the next [byId] call - the engine's
  /// pre-flight read, distinct from a write failure.
  Object? byIdFailWith;

  ChecklistApprovalApplyResult applyResult =
      ChecklistApprovalApplyResult.applied;

  final List<String> appliedDecisionIds = <String>[];

  @override
  Future<List<ChecklistApprovalItem>> listPending({String? country}) async =>
      <ChecklistApprovalItem>[];

  @override
  Future<ChecklistApprovalItem?> byId(String id) async {
    final Object? failure = byIdFailWith;
    if (failure != null) {
      // Deliberate arbitrary-error injection, see the class's own
      // fake-repository convention.
      // ignore: only_throw_errors
      throw failure;
    }
    return current;
  }

  @override
  Future<ChecklistApprovalTemplateInfo?> templateInfo(
    String templateId,
  ) async =>
      template;

  @override
  Future<Map<String, ChecklistApprovalTemplateInfo>> templateInfoBatch(
    Iterable<String> templateIds,
  ) async =>
      const <String, ChecklistApprovalTemplateInfo>{};

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<ChecklistApprovalApplyResult> applyDecision(
    QueuedChecklistApprovalDecision item,
  ) async {
    final Object? failure = applyFailWith;
    if (failure != null) throw failure; // ignore: only_throw_errors
    appliedDecisionIds.add(item.id);
    return applyResult;
  }
}

// ---------------------------------------------------------------------------

ChecklistApprovalItem _pendingSubmission({
  String id = 'sub-1',
  String? templateId,
  String approvalStatus = 'pending',
}) {
  return ChecklistApprovalItem.fromRow(<String, Object?>{
    'id': id,
    'template_id': templateId,
    'approval_status': approvalStatus,
  });
}

void main() {
  late _FakeQueue queue;
  late _FakeRepository repository;
  late ChecklistApprovalSyncEngine engine;

  setUp(() {
    queue = _FakeQueue();
    repository = _FakeRepository()..current = _pendingSubmission();
    engine = ChecklistApprovalSyncEngine(queue: queue, repository: repository);
  });

  Future<ChecklistApprovalDecisionResult> decide(
          {bool approved = true,
          int? revision = 7,
          String? token = 'stage-1'}) =>
      engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: approved ? 'approved' : 'rejected',
        approved: approved,
        expectedRevision: revision,
        expectedStageToken: token,
        approverName: 'Reviewer',
        approverId: 'reviewer-id',
        approverSignature: 'data:image/png;base64,evidence',
        reviewNote: approved ? null : 'Repair required',
      );

  const offline = SupabaseFailure(
      error: AppError.network(), cause: SupabaseFailureCause.offline);

  test('durable evidence and immutable context survive connectivity failure',
      () async {
    repository.applyFailWith = offline;
    final result = await decide();
    expect(result.outcome, ChecklistApprovalDecisionOutcome.queued);
    final item = queue.store[result.decisionId]!;
    expect(item.expectedRevision, 7);
    expect(item.expectedStageToken, 'stage-1');
    expect(item.approverSignature, 'data:image/png;base64,evidence');
    expect(item.status, ChecklistApprovalQueueStatus.pending);
    expect(queue.enqueuedItems, hasLength(1));
  });

  test('accepted operation removes durable entry only after confirmation',
      () async {
    final result = await decide();
    expect(result.outcome, ChecklistApprovalDecisionOutcome.deliveredNow);
    expect(repository.appliedDecisionIds, [result.decisionId]);
    expect(queue.store, isEmpty);
    expect(queue.enqueuedItems, hasLength(1));
  });

  test('new review intents never reuse a submission/status operation ID',
      () async {
    repository.applyFailWith = offline;
    final first = await decide();
    final second = await decide();
    expect(first.decisionId, isNot(second.decisionId));
    expect(
        RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
            .hasMatch(first.decisionId),
        isTrue);
    expect(queue.store, hasLength(2));
  });

  test(
      'lost acknowledgement retries exact intent even when record already advanced',
      () async {
    repository.applyFailWith = offline;
    final first = await decide();
    final capturedAt = queue.store[first.decisionId]!.decidedAt;
    repository.current = _pendingSubmission(approvalStatus: 'approved');
    repository.byIdFailWith = StateError('No preflight allowed');
    repository.applyFailWith = null;
    final retried = await engine.retryOne(first.decisionId);
    expect(retried!.outcome, ChecklistApprovalDecisionOutcome.deliveredNow);
    expect(repository.appliedDecisionIds, [first.decisionId]);
    expect(queue.enqueuedItems.single.decidedAt, capturedAt);
  });

  test('server conflict blocks stale signature and preserves it for review',
      () async {
    repository.applyResult = ChecklistApprovalApplyResult.conflict;
    final result = await decide();
    expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
    expect(queue.store[result.decisionId]!.status,
        ChecklistApprovalQueueStatus.blocked);
    expect(queue.store[result.decisionId]!.approverSignature, isNotNull);
    await engine.flushQueue();
    expect(repository.appliedDecisionIds, hasLength(1));
  });

  test('unversioned legacy evidence remains durable but never reaches RPC',
      () async {
    final result = await decide(revision: null, token: null);
    expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
    expect(repository.appliedDecisionIds, isEmpty);
    expect(queue.store[result.decisionId]!.approverSignature, isNotNull);
  });

  test('missing stage token is not silently refreshed', () async {
    final result = await decide(token: null);
    expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
    expect(repository.appliedDecisionIds, isEmpty);
  });

  test('rejection persists reason without signature', () async {
    await decide(approved: false);
    expect(queue.enqueuedItems.single.approverSignature, isNull);
    expect(queue.enqueuedItems.single.reviewNote, 'Repair required');
  });

  test('server refusal blocks without claiming delivery', () async {
    repository.applyFailWith = StateError('refused');
    final result = await decide();
    expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
    expect(queue.store[result.decisionId], isNotNull);
  });

  test('flush retries pending and keeps operation identity', () async {
    repository.applyFailWith = offline;
    final result = await decide();
    repository.applyFailWith = null;
    await engine.flushQueue();
    expect(repository.appliedDecisionIds, [result.decisionId]);
    expect(queue.store, isEmpty);
  });

  test('retry missing ID returns null', () async {
    expect(await engine.retryOne('missing'), isNull);
  });

  test('pending list and count include blocked evidence', () async {
    await decide(revision: null);
    expect(await engine.pendingCount(), 1);
    expect(await engine.listQueued(), hasLength(1));
  });
}
