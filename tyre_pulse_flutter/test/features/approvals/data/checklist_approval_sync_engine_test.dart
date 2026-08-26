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
    if (failure != null) throw failure;
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
    if (failure != null) throw failure;
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

  group('decideNow - the commit-then-attempt order', () {
    test('the decision is durably enqueued BEFORE any delivery attempt - '
        'the queue write happens even though delivery never succeeds',
        () async {
      // A deliberately-failing repository makes this observable: even
      // though delivery never succeeds, the enqueue call is recorded
      // first. Thrown as a real SupabaseFailure so `error is
      // SupabaseFailure` short-circuits inside the engine, exactly as
      // `inspection_sync_engine_test.dart`'s own equivalent test does.
      repository.byIdFailWith = const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );

      await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(queue.enqueueCalls, isNotEmpty);
      expect(
        queue.enqueueCalls.first,
        'approve_sub-1_pending_area_manager',
      );
    });

    test('a successful delivery returns deliveredNow, and the queue entry '
        'is marked synced and removed', () async {
      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(
        result.outcome,
        ChecklistApprovalDecisionOutcome.deliveredNow,
      );
      expect(result.error, isNull);
      expect(repository.appliedDecisionIds, isNotEmpty);
      expect(await queue.byId(result.decisionId), isNull);
    });

    test('a rejection never carries a signature, whatever was drawn - '
        'already resolved to null before this ever reaches the queue',
        () async {
      await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'rejected',
        approved: false,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,should-not-be-kept',
        reviewNote: 'Front left tread not recorded',
      );
      // [enqueuedItems] records what was written the moment the durable
      // commit happened, unaffected by the entry later being removed once
      // delivery succeeds.
      expect(queue.enqueuedItems, hasLength(1));
      expect(queue.enqueuedItems.single.approverSignature, isNull);
      expect(
        queue.enqueuedItems.single.reviewNote,
        'Front left tread not recorded',
      );
    });

    test('a connectivity failure queues the decision - stays pending, no '
        'error surfaced other than result.outcome', () async {
      repository.byIdFailWith = const SupabaseFailure(
        error: AppError.network(),
        cause: SupabaseFailureCause.offline,
      );

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.queued);

      final QueuedChecklistApprovalDecision? stillQueued =
          await queue.byId(result.decisionId);
      expect(stillQueued, isNotNull);
      expect(stillQueued!.status, ChecklistApprovalQueueStatus.pending);
    });

    test('a definitive server refusal (e.g. row-level security) is '
        'blocked, not silently retried', () async {
      repository.applyFailWith = const SupabaseFailure(
        error: AppError.authorization(
          message: 'You are not allowed to sign this off.',
        ),
        cause: SupabaseFailureCause.rowLevelSecurity,
      );

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
      expect(result.error, isNotNull);

      final QueuedChecklistApprovalDecision? stillQueued =
          await queue.byId(result.decisionId);
      expect(stillQueued!.status, ChecklistApprovalQueueStatus.blocked);
    });

    test('decideNow never throws, whatever the repository does', () async {
      repository.byIdFailWith = StateError('completely unexpected');
      await expectLater(
        engine.decideNow(
          submissionId: 'sub-1',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
        ),
        completes,
      );
    });
  });

  group('the stage-mismatch conflict check - the rule InspectionSyncEngine '
      'does not need', () {
    test('a submission that has already moved past the decided stage is '
        'BLOCKED with a conflict error, and NOTHING is written', () async {
      // The decision was made when the submission was still `pending`
      // (stage: supervisor). By the time delivery is attempted, somebody
      // else has already signed it off - the server now reports
      // `pending_area_manager`, so the CURRENT stage is areaManager, not
      // the supervisor stage this decision targets.
      repository.current = _pendingSubmission(
        approvalStatus: 'pending_area_manager',
      );

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
      expect(result.error!.kind, AppErrorKind.conflict);
      expect(repository.appliedDecisionIds, isEmpty);
    });

    test('a submission that has already been fully closed (nothing '
        'outstanding at all) is also blocked, never delivered', () async {
      repository.current = _pendingSubmission(approvalStatus: 'approved');

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.areaManager,
        priorApprovalStatus: 'pending_area_manager',
        targetStatus: 'approved',
        approved: true,
        approverName: 'Sara',
        approverSignature: 'data:image/png;base64,bbb',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
      expect(repository.appliedDecisionIds, isEmpty);
    });

    test('a submission that no longer exists at all (removed) is blocked '
        'with a validation error, not a crash', () async {
      repository.current = null;

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
      expect(result.error!.kind, AppErrorKind.validation);
    });

    test('the stage still matching current state (nobody else acted) '
        'delivers normally', () async {
      // repository.current is set by setUp to approval_status: 'pending',
      // which is exactly the supervisor stage this decision targets.
      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );
      expect(
        result.outcome,
        ChecklistApprovalDecisionOutcome.deliveredNow,
      );
    });
  });

  group('the server-side optimistic-concurrency guard - the SECOND layer',
      () {
    test('ChecklistApprovalApplyResult.conflict from the repository is '
        'ALSO blocked, even when this engine\'s own stage re-check saw no '
        'problem - the narrow window between the two', () async {
      repository.applyResult = ChecklistApprovalApplyResult.conflict;

      final ChecklistApprovalDecisionResult result = await engine.decideNow(
        submissionId: 'sub-1',
        stage: ApprovalStage.supervisor,
        priorApprovalStatus: 'pending',
        targetStatus: 'pending_area_manager',
        approved: true,
        approverName: 'Ahmed',
        approverSignature: 'data:image/png;base64,aaa',
      );

      expect(result.outcome, ChecklistApprovalDecisionOutcome.blocked);
      expect(result.error!.kind, AppErrorKind.conflict);

      final QueuedChecklistApprovalDecision? stillQueued =
          await queue.byId(result.decisionId);
      expect(stillQueued!.status, ChecklistApprovalQueueStatus.blocked);
    });
  });

  group('flushQueue', () {
    test('retries only PENDING entries, skips blocked and synced ones',
        () async {
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'approve_sub-1_pending_area_manager',
          submissionId: 'sub-1',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
          approverName: 'Ahmed',
          approverSignature: 'data:image/png;base64,aaa',
        ),
      );
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'approve_sub-2_approved',
          submissionId: 'sub-2',
          stage: ApprovalStage.areaManager,
          priorApprovalStatus: 'pending_area_manager',
          targetStatus: 'approved',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
          status: ChecklistApprovalQueueStatus.blocked,
          error: 'previously refused',
        ),
      );
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'approve_sub-3_rejected',
          submissionId: 'sub-3',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'rejected',
          approved: false,
          decidedAt: DateTime.utc(2026, 8, 20),
          status: ChecklistApprovalQueueStatus.synced,
          syncedAt: DateTime.utc(2026, 8, 20, 1),
        ),
      );

      // The one PENDING entry (sub-1) targets a submission whose current
      // stage matches - it will deliver.
      final ChecklistApprovalFlushSummary summary = await engine.flushQueue();

      expect(summary.attempted, 1);
      expect(summary.delivered, 1);
      expect(summary.blocked, 0);
      // The blocked and synced entries were never touched.
      expect(repository.appliedDecisionIds, <String>[
        'approve_sub-1_pending_area_manager',
      ]);
    });

    test('an unreadable queue store refuses rather than guessing - '
        'reports nothing attempted', () async {
      final ChecklistApprovalSyncEngine engineOverUnreadable =
          ChecklistApprovalSyncEngine(
        queue: _UnreadableQueue(),
        repository: repository,
      );
      final ChecklistApprovalFlushSummary summary =
          await engineOverUnreadable.flushQueue();
      expect(summary.attempted, 0);
      expect(summary.delivered, 0);
      expect(summary.blocked, 0);
    });
  });

  group('retryOne', () {
    test('explicitly retries a BLOCKED entry that flushQueue would never '
        'touch on its own', () async {
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'approve_sub-1_pending_area_manager',
          submissionId: 'sub-1',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
          status: ChecklistApprovalQueueStatus.blocked,
          error: 'checklist submission stage changed since decision',
        ),
      );

      // The submission now genuinely matches this decision's stage again
      // (e.g. the earlier "somebody else acted" turned out to be a false
      // alarm the reviewer wants to retry).
      repository.current = _pendingSubmission(approvalStatus: 'pending');

      final ChecklistApprovalDecisionResult? result =
          await engine.retryOne('approve_sub-1_pending_area_manager');

      expect(result, isNotNull);
      expect(
        result!.outcome,
        ChecklistApprovalDecisionOutcome.deliveredNow,
      );
    });

    test('returns null for an id that is not in the queue at all', () async {
      expect(await engine.retryOne('ghost'), isNull);
    });
  });

  group('listQueued', () {
    test('returns every entry not yet synced', () async {
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'a',
          submissionId: 'sub-a',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
        ),
      );
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'b',
          submissionId: 'sub-b',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
          status: ChecklistApprovalQueueStatus.synced,
          syncedAt: DateTime.utc(2026, 8, 20, 1),
        ),
      );

      final List<QueuedChecklistApprovalDecision> queued =
          await engine.listQueued();
      expect(queued.map((d) => d.id), <String>['a']);
    });
  });

  group('pendingCount', () {
    test('delegates straight to the queue', () async {
      await queue.enqueue(
        QueuedChecklistApprovalDecision(
          id: 'a',
          submissionId: 'sub-a',
          stage: ApprovalStage.supervisor,
          priorApprovalStatus: 'pending',
          targetStatus: 'pending_area_manager',
          approved: true,
          decidedAt: DateTime.utc(2026, 8, 20),
        ),
      );
      expect(await engine.pendingCount(), 1);
    });
  });
}

class _UnreadableQueue implements ChecklistApprovalDecisionQueue {
  @override
  Future<void> enqueue(QueuedChecklistApprovalDecision item) async {}

  @override
  Future<ChecklistApprovalQueueReadResult> list() async =>
      const ChecklistApprovalQueueReadResult.unreadable();

  @override
  Future<QueuedChecklistApprovalDecision?> byId(String id) async => null;

  @override
  Future<void> markSynced(String id, DateTime at) async {}

  @override
  Future<void> markFailed(
    String id, {
    required String error,
    required ChecklistApprovalQueueStatus status,
  }) async {}

  @override
  Future<void> remove(String id) async {}

  @override
  Future<int> pendingCount() async => 0;
}
