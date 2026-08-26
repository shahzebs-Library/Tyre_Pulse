/// Parity group L - the approval ladder state machine. Cases L1-L16.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10,
/// group L. Every expectation is taken from
/// `src/test/checklistApproval.test.js` (the "proof" the artifact cites for
/// each case) or from `mobile/lib/checklistApproval.ts` directly where the
/// artifact points there instead.
///
/// A trailing, clearly separate group of tests beyond the 27 assigned cases
/// covers the "single biggest correctness risk" the task brief calls out:
/// every function here must be TOTAL, never throwing on a `null`, blank or
/// unrecognised input. Those are not part of the parity contract and are
/// labelled as such.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

const ApprovalTemplateLike kTwoStage = ApprovalTemplateLike(
  requireAreaManager: true,
);
const ApprovalTemplateLike kOneStage = ApprovalTemplateLike(
  requireAreaManager: false,
);

void main() {
  group('the ladder (L1-L5)', () {
    test('case L1: two-stage pending resolves to the supervisor rung', () {
      const ApprovalSubmissionLike s0 = ApprovalSubmissionLike(
        approvalStatus: 'pending',
      );
      expect(stageFor(kTwoStage, s0), ApprovalStage.supervisor);
      expect(nextStatusFor(kTwoStage, s0, true), 'pending_area_manager');
    });

    test('case L2: the second rung closes a two-stage sheet', () {
      const ApprovalSubmissionLike s1 = ApprovalSubmissionLike(
        approvalStatus: 'pending_area_manager',
        supervisorSignature: '<svg/>',
      );
      expect(stageFor(kTwoStage, s1), ApprovalStage.areaManager);
      expect(nextStatusFor(kTwoStage, s1, true), 'approved');
    });

    test('case L3: a single-stage sheet still closes on one approval', () {
      expect(
        nextStatusFor(
          kOneStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending'),
          true,
        ),
        'approved',
      );
      // stageFor reads the SUBMISSION's own status, not the template's
      // two-stage flag - a 'pending_area_manager' status still resolves to
      // the area-manager rung even under a "single-stage" template.
      expect(
        stageFor(
          kOneStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending_area_manager'),
        ),
        ApprovalStage.areaManager,
      );
    });

    test('case L4: a rejection is available at either rung', () {
      expect(
        nextStatusFor(
          kTwoStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending'),
          false,
        ),
        'rejected',
      );
      expect(
        nextStatusFor(
          kTwoStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending_area_manager'),
          false,
        ),
        'rejected',
      );
    });

    test('case L5: a finished sheet offers no stage at all', () {
      for (final String status in <String>[
        'approved',
        'rejected',
        'not_required',
        '',
      ]) {
        final ApprovalSubmissionLike submission = ApprovalSubmissionLike(
          approvalStatus: status,
        );
        expect(stageFor(kTwoStage, submission), isNull, reason: status);
        expect(
          canDecide(kTwoStage, submission, 'Admin'),
          isFalse,
          reason: status,
        );
      }
    });
  });

  group('who may act (L6-L14)', () {
    test(
      'case L6: a Manager signs NOTHING - V600 took them off both rungs',
      () {
        expect(canActOnStage(ApprovalStage.supervisor, 'Manager'), isFalse);
        expect(canActOnStage(ApprovalStage.areaManager, 'Manager'), isFalse);
      },
    );

    test('case L7: the trades supervisors sign the first rung only', () {
      for (final String role in <String>[
        'Maintenance Supervisor',
        'Workshop Supervisor',
      ]) {
        expect(
          canActOnStage(ApprovalStage.supervisor, role),
          isTrue,
          reason: role,
        );
        // ...and cannot close their own sheet. Two rungs, or it is one
        // signature wearing two names.
        expect(
          canActOnStage(ApprovalStage.areaManager, role),
          isFalse,
          reason: role,
        );
      }
    });

    test('case L8: the PMV manager signs both rungs', () {
      expect(canActOnStage(ApprovalStage.supervisor, 'PMV Manager'), isTrue);
      expect(canActOnStage(ApprovalStage.areaManager, 'PMV Manager'), isTrue);
    });

    test('case L9: Admin and Director can close too, deliberately', () {
      // Exactly ONE person holds an area-manager role today. A queue only
      // they can clear jams the moment they take leave.
      expect(canActOnStage(ApprovalStage.areaManager, 'Admin'), isTrue);
      expect(canActOnStage(ApprovalStage.areaManager, 'Director'), isTrue);
    });

    test('case L10: a tyre data collector signs the supervisor rung but not '
        'the area manager rung', () {
      expect(
        canActOnStage(ApprovalStage.supervisor, 'Tyre Data Collector'),
        isTrue,
      );
      expect(
        canActOnStage(ApprovalStage.areaManager, 'Tyre Data Collector'),
        isFalse,
      );
    });

    test('case L11: a trade or a driver cannot sign off their own sheet', () {
      for (final String role in <String>[
        'Mechanic',
        'Electrician',
        'Driver',
        'Tyre Man',
        'Reporter',
      ]) {
        expect(
          canActOnStage(ApprovalStage.supervisor, role),
          isFalse,
          reason: role,
        );
        expect(
          canActOnStage(ApprovalStage.areaManager, role),
          isFalse,
          reason: role,
        );
      }
    });

    test('case L12: Title Case DB role matches the lowercase app UserRole', () {
      // profiles.role is 'Maintenance Supervisor'; the app carries
      // 'maintenance_supervisor'. A raw compare matches nobody, which is
      // how a gate silently locks out the exact person it was written
      // for.
      expect(normaliseRole('Maintenance Supervisor'), 'maintenance_supervisor');
      expect(
        canActOnStage(ApprovalStage.supervisor, 'maintenance_supervisor'),
        isTrue,
      );
      expect(
        canActOnStage(
          ApprovalStage.areaManager,
          'workshop-maintenance-area-manager',
        ),
        isTrue,
      );
    });

    test('case L13: a super admin is never locked out', () {
      expect(
        canActOnStage(
          ApprovalStage.areaManager,
          'Reporter',
          isSuperAdmin: true,
        ),
        isTrue,
      );
    });

    test('case L14: a loading profile grants nothing', () {
      expect(canActOnStage(ApprovalStage.supervisor, null), isFalse);
      expect(canActOnStage(null, 'Admin'), isFalse);
    });
  });

  group('what the reader is shown (L15-L16)', () {
    test("case L15: the ladder carries each rung's own signature so it can "
        'be opened and looked at', () {
      final List<ApprovalRung> rows = approvalProgress(
        kTwoStage,
        const ApprovalSubmissionLike(
          approvalStatus: 'pending_area_manager',
          supervisorName: 'A. Khan',
          supervisorSignature: '<svg/>',
          supervisorAt: '2026-08-18T09:00:00Z',
        ),
      );
      expect(rows, hasLength(2));
      expect(rows[0].done, isTrue);
      expect(rows[0].name, 'A. Khan');
      expect(rows[0].signature, '<svg/>');
      expect(rows[1].done, isFalse);
      expect(rows[1].current, isTrue);
      expect(rows[1].name, isNull);
    });

    test('case L16: a single-stage sheet shows ONE rung, filled from the '
        'approver columns', () {
      final List<ApprovalRung> rows = approvalProgress(
        kOneStage,
        const ApprovalSubmissionLike(
          approvalStatus: 'approved',
          approverName: 'M. Ali',
          approverSignature: '<svg/>',
          approvedAt: 'x',
        ),
      );
      expect(rows, hasLength(1));
      expect(rows[0].done, isTrue);
      expect(rows[0].name, 'M. Ali');
    });
  });

  // ------------------------------------------------------------------
  // Beyond the 27 assigned cases: every function here must be TOTAL. A
  // null role, an unknown stage, a garbage template/submission must never
  // throw - the task brief names this the single biggest correctness risk,
  // because a later approvals screen deciding whether to show an Approve
  // button must never crash on it.
  // ------------------------------------------------------------------
  group('extra: total-function robustness (not part of the 27)', () {
    test('every entry point tolerates null template and submission', () {
      expect(stageFor(null, null), isNull);
      expect(isTwoStage(null), isFalse);
      expect(nextStatusFor(null, null, true), 'approved');
      expect(nextStatusFor(null, null, false), 'rejected');
      expect(canDecide(null, null, null), isFalse);
      expect(canDecide(null, null, 'Admin'), isFalse);
      expect(approvalProgress(null, null), hasLength(1));
      expect(isFullyClosed(null), isFalse);
      expect(isRejected(null), isFalse);
      expect(statusSummary(null, null).holder, ApprovalHolder.none);
      expect(statusSummary(null, null).text, 'No approval needed');
      expect(stageLabel(null), '');
    });

    test('normaliseRole never throws on non-string input', () {
      expect(normaliseRole(null), '');
      expect(normaliseRole(''), '');
      expect(normaliseRole('   '), '');
      expect(normaliseRole(42), '42');
      expect(normaliseRole(true), 'true');
    });

    test('a super admin passing canActOnStage a null stage still passes - '
        'the literal source behaviour, preserved on purpose', () {
      // canActOnStage checks isSuperAdmin BEFORE it checks whether a
      // stage was even given, exactly matching the order in
      // mobile/lib/checklistApproval.ts. It is canDecide - not this
      // function - that stops a super admin "acting" on a submission
      // with nothing outstanding, by never calling canActOnStage at all
      // once stageFor returns null. See case L14 for the non-super-admin
      // half of this same call.
      expect(canActOnStage(null, 'Reporter', isSuperAdmin: true), isTrue);
      // canDecide still refuses, because it short-circuits on the null
      // stage before isSuperAdmin is even read.
      expect(
        canDecide(
          kTwoStage,
          const ApprovalSubmissionLike(approvalStatus: 'approved'),
          'Reporter',
          isSuperAdmin: true,
        ),
        isFalse,
      );
    });

    test('an unrecognised approval_status is treated exactly like blank', () {
      const ApprovalSubmissionLike weird = ApprovalSubmissionLike(
        approvalStatus: 'something_new_the_db_might_one_day_send',
      );
      expect(stageFor(kTwoStage, weird), isNull);
      expect(canDecide(kTwoStage, weird, 'Admin'), isFalse);
      expect(isFullyClosed(weird), isFalse);
      expect(isRejected(weird), isFalse);
      expect(statusSummary(kTwoStage, weird).text, 'No approval needed');
    });
  });
}
