/// Coverage for [QueuedChecklistApprovalDecision]'s JSON round trip, its
/// dedupe key format, and [approvalStageToWire]/[approvalStageFromWire] -
/// the on-disk shape [FileChecklistApprovalDecisionQueue] persists one
/// decision as. A drift here would silently corrupt every queued decision
/// written by an earlier app version, or worse, let one decode as the WRONG
/// stage - see [ChecklistApprovalSyncEngine]'s own conflict check, which
/// depends entirely on [QueuedChecklistApprovalDecision.stage] surviving
/// the round trip intact. Mirrors
/// `test/features/inspections/domain/queued_inspection_test.dart`'s own
/// field-by-field style rather than a single blanket equality.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/queued_checklist_approval_decision.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalStage;

QueuedChecklistApprovalDecision _sample({
  ApprovalStage stage = ApprovalStage.supervisor,
  String targetStatus = 'pending_area_manager',
  bool approved = true,
  ChecklistApprovalQueueStatus status = ChecklistApprovalQueueStatus.pending,
}) {
  return QueuedChecklistApprovalDecision(
    id: QueuedChecklistApprovalDecision.dedupeKeyFor(
      submissionId: 'sub-1',
      targetStatus: targetStatus,
    ),
    submissionId: 'sub-1',
    stage: stage,
    priorApprovalStatus: 'pending',
    targetStatus: targetStatus,
    approved: approved,
    decidedAt: DateTime.utc(2026, 8, 20, 9, 30),
    approverName: 'Ahmed',
    approverSignature: 'data:image/png;base64,aaa',
    approverId: 'user-1',
    reviewNote: null,
    status: status,
  );
}

void main() {
  group('approvalStageToWire / approvalStageFromWire', () {
    test('supervisor round-trips to "supervisor"', () {
      expect(approvalStageToWire(ApprovalStage.supervisor), 'supervisor');
      expect(approvalStageFromWire('supervisor'), ApprovalStage.supervisor);
    });

    test('areaManager round-trips to "area_manager"', () {
      expect(approvalStageToWire(ApprovalStage.areaManager), 'area_manager');
      expect(approvalStageFromWire('area_manager'), ApprovalStage.areaManager);
    });

    test(
        'an unrecognised, null or blank wire value decodes to null - a '
        'queue entry with an unreadable stage cannot be safely '
        're-validated and must never be guessed at', () {
      expect(approvalStageFromWire('bogus'), isNull);
      expect(approvalStageFromWire(null), isNull);
      expect(approvalStageFromWire(''), isNull);
    });
  });

  group('dedupeKeyFor', () {
    test(
      'matches the mobile source\'s own `approve_${id}_${status}` shape',
      () {
        expect(
          QueuedChecklistApprovalDecision.dedupeKeyFor(
            submissionId: 'sub-1',
            targetStatus: 'approved',
          ),
          'approve_sub-1_approved',
        );
      },
    );

    test(
        'a supervisor sign-off and the later area-manager approval on the '
        'SAME submission never collide - each targets a different status', () {
      final String signOff = QueuedChecklistApprovalDecision.dedupeKeyFor(
        submissionId: 'sub-1',
        targetStatus: 'pending_area_manager',
      );
      final String finalApproval = QueuedChecklistApprovalDecision.dedupeKeyFor(
        submissionId: 'sub-1',
        targetStatus: 'approved',
      );
      expect(signOff, isNot(finalApproval));
    });
  });

  group('toJson / fromJson round trip', () {
    test('every field survives, field by field', () {
      final QueuedChecklistApprovalDecision original = _sample();
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJson(original.toJson());

      expect(restored.id, original.id);
      expect(restored.submissionId, original.submissionId);
      expect(restored.stage, original.stage);
      expect(restored.priorApprovalStatus, original.priorApprovalStatus);
      expect(restored.targetStatus, original.targetStatus);
      expect(restored.approved, original.approved);
      expect(restored.decidedAt, original.decidedAt);
      expect(restored.approverName, original.approverName);
      expect(restored.approverSignature, original.approverSignature);
      expect(restored.approverId, original.approverId);
      expect(restored.reviewNote, original.reviewNote);
      expect(restored.status, original.status);
    });

    test('toJsonString / fromJsonString round-trips the same way', () {
      final QueuedChecklistApprovalDecision original = _sample(
        status: ChecklistApprovalQueueStatus.blocked,
      );
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJsonString(
        original.toJsonString(),
      );
      expect(restored.status, ChecklistApprovalQueueStatus.blocked);
      expect(restored.stage, original.stage);
    });

    test('a rejection with a reviewNote round-trips it', () {
      final QueuedChecklistApprovalDecision original =
          QueuedChecklistApprovalDecision(
        id: QueuedChecklistApprovalDecision.dedupeKeyFor(
          submissionId: 'sub-1',
          targetStatus: 'rejected',
        ),
        submissionId: 'sub-1',
        stage: ApprovalStage.areaManager,
        priorApprovalStatus: 'pending_area_manager',
        targetStatus: 'rejected',
        approved: false,
        decidedAt: DateTime.utc(2026, 8, 20),
        reviewNote: 'Front left tread not recorded',
      );
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJson(original.toJson());
      expect(restored.approved, isFalse);
      expect(restored.reviewNote, 'Front left tread not recorded');
      expect(restored.approverSignature, isNull);
    });

    test(
      'a synced entry carries syncedAt and no error, and it round-trips',
      () {
        final QueuedChecklistApprovalDecision original = _sample().copyWith(
          status: ChecklistApprovalQueueStatus.synced,
          syncedAt: DateTime.utc(2026, 8, 20, 10),
        );
        final QueuedChecklistApprovalDecision restored =
            QueuedChecklistApprovalDecision.fromJson(original.toJson());
        expect(restored.status, ChecklistApprovalQueueStatus.synced);
        expect(restored.syncedAt, DateTime.utc(2026, 8, 20, 10));
        expect(restored.error, isNull);
      },
    );

    test('a blocked entry carries its error and attempts count', () {
      final QueuedChecklistApprovalDecision original = _sample().copyWith(
        status: ChecklistApprovalQueueStatus.blocked,
        error: 'This record changed on the server.',
        attempts: 2,
      );
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJson(original.toJson());
      expect(restored.status, ChecklistApprovalQueueStatus.blocked);
      expect(restored.error, 'This record changed on the server.');
      expect(restored.attempts, 2);
    });
  });

  group('fromJson refuses rather than guesses', () {
    test('a missing id throws a FormatException', () {
      expect(
        () => QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
          'submissionId': 'sub-1',
          'stage': 'supervisor',
          'priorApprovalStatus': 'pending',
          'targetStatus': 'pending_area_manager',
        }),
        throwsFormatException,
      );
    });

    test('a missing submissionId throws a FormatException', () {
      expect(
        () => QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
          'id': 'approve_sub-1_approved',
          'stage': 'supervisor',
          'priorApprovalStatus': 'pending',
          'targetStatus': 'approved',
        }),
        throwsFormatException,
      );
    });

    test(
        'a missing or unreadable stage throws a FormatException - never '
        'defaults to a guessed rung', () {
      expect(
        () => QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
          'id': 'approve_sub-1_approved',
          'submissionId': 'sub-1',
          'priorApprovalStatus': 'pending',
          'targetStatus': 'approved',
        }),
        throwsFormatException,
      );
      expect(
        () => QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
          'id': 'approve_sub-1_approved',
          'submissionId': 'sub-1',
          'stage': 'not_a_real_stage',
          'priorApprovalStatus': 'pending',
          'targetStatus': 'approved',
        }),
        throwsFormatException,
      );
    });

    test('missing status fields throw a FormatException', () {
      expect(
        () => QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
          'id': 'approve_sub-1_approved',
          'submissionId': 'sub-1',
          'stage': 'supervisor',
        }),
        throwsFormatException,
      );
    });

    test(
        'an unreadable decidedAt falls back to now, rather than throwing '
        '- a decision that was genuinely made must not become undecodable '
        'over a corrupt timestamp alone', () {
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
        'id': 'approve_sub-1_approved',
        'submissionId': 'sub-1',
        'stage': 'supervisor',
        'priorApprovalStatus': 'pending',
        'targetStatus': 'approved',
        'decidedAt': 'not a date',
      });
      expect(restored.decidedAt, isNotNull);
    });

    test(
        'an unrecognised status wire value defaults to pending, never to '
        'synced or blocked', () {
      final QueuedChecklistApprovalDecision restored =
          QueuedChecklistApprovalDecision.fromJson(<String, Object?>{
        'id': 'approve_sub-1_approved',
        'submissionId': 'sub-1',
        'stage': 'supervisor',
        'priorApprovalStatus': 'pending',
        'targetStatus': 'approved',
        'status': 'not_a_real_status',
      });
      expect(restored.status, ChecklistApprovalQueueStatus.pending);
    });
  });
}
