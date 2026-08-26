/// Coverage for [FileChecklistApprovalDecisionQueue] against a real
/// temporary directory - the durability contract this feature's on-device
/// persistence depends on: atomic writes, one file per decision, a corrupt
/// individual file degrading rather than taking the whole read down, and
/// (unlike [InspectionSubmissionQueue]'s two-state shape) a THIRD status -
/// [ChecklistApprovalQueueStatus.blocked] - that [pendingCount] must count
/// alongside [ChecklistApprovalQueueStatus.pending] as "not yet synced".
/// Mirrors `test/features/inspections/data/inspection_submission_queue_test.dart`'s
/// own structure and assertions, adapted for that one real difference.
library;

import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_decision_queue.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalStage;

QueuedChecklistApprovalDecision _decision({
  required String id,
  required String submissionId,
  ApprovalStage stage = ApprovalStage.supervisor,
  String targetStatus = 'pending_area_manager',
  ChecklistApprovalQueueStatus status = ChecklistApprovalQueueStatus.pending,
  String? error,
  int attempts = 0,
}) {
  return QueuedChecklistApprovalDecision(
    id: id,
    submissionId: submissionId,
    stage: stage,
    priorApprovalStatus: 'pending',
    targetStatus: targetStatus,
    approved: true,
    decidedAt: DateTime.utc(2026, 8, 20, 9),
    approverName: 'Ahmed',
    approverSignature: 'data:image/png;base64,aaa',
    status: status,
    error: error,
    attempts: attempts,
  );
}

void main() {
  late Directory tempDir;
  late FileChecklistApprovalDecisionQueue queue;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp(
      'checklist_approval_queue_test_',
    );
    queue = FileChecklistApprovalDecisionQueue(overrideDirectory: tempDir);
  });

  tearDown(() async {
    if (tempDir.existsSync()) {
      await tempDir.delete(recursive: true);
    }
  });

  group('enqueue / list / byId', () {
    test(
      'a freshly enqueued decision is readable back by id and by list()',
      () async {
        final QueuedChecklistApprovalDecision item = _decision(
          id: 'approve_sub-1_pending_area_manager',
          submissionId: 'sub-1',
        );
        await queue.enqueue(item);

        final QueuedChecklistApprovalDecision? found = await queue.byId(
          'approve_sub-1_pending_area_manager',
        );
        expect(found, isNotNull);
        expect(found!.status, ChecklistApprovalQueueStatus.pending);

        final ChecklistApprovalQueueReadResult listed = await queue.list();
        expect(listed.isReadable, isTrue);
        expect(listed.items.map((d) => d.id), <String>[
          'approve_sub-1_pending_area_manager',
        ]);
      },
    );

    test('byId returns null for an id that was never enqueued', () async {
      expect(await queue.byId('does-not-exist'), isNull);
    });

    test(
        'two independent decisions never collide - a write to one cannot '
        'corrupt another', () async {
      await queue.enqueue(
        _decision(
          id: 'approve_sub-1_pending_area_manager',
          submissionId: 'sub-1',
        ),
      );
      await queue.enqueue(
        _decision(id: 'approve_sub-2_approved', submissionId: 'sub-2'),
      );

      final ChecklistApprovalQueueReadResult listed = await queue.list();
      expect(listed.items.length, 2);
      final Set<String> submissionIds =
          listed.items.map((d) => d.submissionId).toSet();
      expect(submissionIds, <String>{'sub-1', 'sub-2'});
    });

    test(
      'a supervisor sign-off and a later area-manager approval on the '
      'SAME submission are two DIFFERENT queue entries, both present',
      () async {
        await queue.enqueue(
          _decision(
            id: 'approve_sub-1_pending_area_manager',
            submissionId: 'sub-1',
            stage: ApprovalStage.supervisor,
            targetStatus: 'pending_area_manager',
          ),
        );
        await queue.enqueue(
          _decision(
            id: 'approve_sub-1_approved',
            submissionId: 'sub-1',
            stage: ApprovalStage.areaManager,
            targetStatus: 'approved',
          ),
        );

        final ChecklistApprovalQueueReadResult listed = await queue.list();
        expect(listed.items, hasLength(2));
      },
    );
  });

  group('markSynced / markFailed / remove', () {
    test(
        'markSynced updates status and syncedAt, and clears any prior '
        'error', () async {
      await queue.enqueue(
        _decision(
          id: 'approve_sub-1_approved',
          submissionId: 'sub-1',
          status: ChecklistApprovalQueueStatus.blocked,
          error: 'earlier failure',
        ),
      );

      final DateTime syncedAt = DateTime.utc(2026, 8, 20, 10);
      await queue.markSynced('approve_sub-1_approved', syncedAt);

      final QueuedChecklistApprovalDecision? after = await queue.byId(
        'approve_sub-1_approved',
      );
      expect(after!.status, ChecklistApprovalQueueStatus.synced);
      expect(after.syncedAt, syncedAt);
      expect(after.error, isNull);
    });

    test(
        'markFailed with status:pending records the error and increments '
        'attempts, but leaves the entry retryable', () async {
      await queue.enqueue(
        _decision(id: 'approve_sub-1_approved', submissionId: 'sub-1'),
      );
      await queue.markFailed(
        'approve_sub-1_approved',
        error: 'network unreachable',
        status: ChecklistApprovalQueueStatus.pending,
      );
      await queue.markFailed(
        'approve_sub-1_approved',
        error: 'network unreachable',
        status: ChecklistApprovalQueueStatus.pending,
      );

      final QueuedChecklistApprovalDecision? after = await queue.byId(
        'approve_sub-1_approved',
      );
      expect(after!.status, ChecklistApprovalQueueStatus.pending);
      expect(after.error, 'network unreachable');
      expect(after.attempts, 2);
    });

    test(
        'markFailed with status:blocked moves the entry OUT of the '
        'automatically-retried set - the whole point of a three-state '
        'queue over the inspection queue\'s two-state one', () async {
      await queue.enqueue(
        _decision(id: 'approve_sub-1_approved', submissionId: 'sub-1'),
      );
      await queue.markFailed(
        'approve_sub-1_approved',
        error: 'checklist submission stage changed since decision',
        status: ChecklistApprovalQueueStatus.blocked,
      );

      final QueuedChecklistApprovalDecision? after = await queue.byId(
        'approve_sub-1_approved',
      );
      expect(after!.status, ChecklistApprovalQueueStatus.blocked);
      expect(after.error, 'checklist submission stage changed since decision');
    });

    test('markSynced/markFailed on an unknown id is a safe no-op', () async {
      await queue.markSynced('ghost', DateTime.utc(2026, 8, 20));
      await queue.markFailed(
        'ghost',
        error: 'x',
        status: ChecklistApprovalQueueStatus.blocked,
      );
      expect((await queue.list()).items, isEmpty);
    });

    test(
      'remove deletes the entry so it no longer appears in list()',
      () async {
        await queue.enqueue(
          _decision(id: 'approve_sub-1_approved', submissionId: 'sub-1'),
        );
        await queue.remove('approve_sub-1_approved');
        expect((await queue.list()).items, isEmpty);
        expect(await queue.byId('approve_sub-1_approved'), isNull);
      },
    );
  });

  group('pendingCount', () {
    test(
        'counts BOTH pending and blocked entries - both still represent a '
        'decision this device has not confirmed reached the server - and '
        'ignores synced ones', () async {
      await queue.enqueue(_decision(id: 'a', submissionId: 'sub-a'));
      await queue.enqueue(
        _decision(
          id: 'b',
          submissionId: 'sub-b',
          status: ChecklistApprovalQueueStatus.blocked,
          error: 'conflict',
        ),
      );
      await queue.enqueue(
        _decision(
          id: 'c',
          submissionId: 'sub-c',
          status: ChecklistApprovalQueueStatus.synced,
        ),
      );

      expect(await queue.pendingCount(), 2);
    });

    test('an empty queue reports 0, not an error', () async {
      expect(await queue.pendingCount(), 0);
    });
  });

  group('a corrupt individual file is skipped, not fatal to the whole read',
      () {
    test(
      'list() omits an unparsable file but returns every other item',
      () async {
        await queue.enqueue(_decision(id: 'good-1', submissionId: 'sub-good'));

        // Write a corrupt sibling file directly, bypassing the queue's own
        // atomic-write path - simulating a file truncated by a process kill
        // mid-write.
        final File corrupt = File(
          '${tempDir.path}${Platform.pathSeparator}checklist_approval_decisions'
          '${Platform.pathSeparator}corrupt.json',
        );
        await corrupt.writeAsString('{not valid json');

        final ChecklistApprovalQueueReadResult result = await queue.list();
        expect(result.isReadable, isTrue);
        expect(result.items.map((d) => d.id), <String>['good-1']);
      },
    );
  });

  group('atomic write leaves no stray .tmp file behind on success', () {
    test('after enqueue, only the real .json file exists', () async {
      await queue.enqueue(
        _decision(id: 'approve_sub-1_approved', submissionId: 'sub-1'),
      );
      final Directory folder = Directory(
        '${tempDir.path}${Platform.pathSeparator}checklist_approval_decisions',
      );
      final List<String> names = await folder
          .list()
          .map((e) => e.path.split(Platform.pathSeparator).last)
          .toList();
      expect(names, <String>['approve_sub-1_approved.json']);
    });
  });
}
