/// Parity group M - status vocabulary and history buckets. Cases M1-M5.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10,
/// group M. M1 and M2 mirror `checklistApproval.ts`
/// (`checklist_approval.dart`); M3-M5 mirror a DIFFERENT source file,
/// `mobile/lib/checklists.ts` (`checklist_approval_history.dart`) - see
/// that file's own library comment for why it is kept separate.
///
/// M1's proof cites a case-insensitive regex match
/// (`src/test/checklistApproval.test.js:111-117` uses `.toMatch(/supervisor/i)`
/// etc.), because that test does not own the exact English string. This
/// file owns it - [statusSummary] is defined here - so exact equality is
/// used instead; it is a strictly STRONGER assertion of the same fact, not
/// a weaker one.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval_history.dart';

const ApprovalTemplateLike kTwoStage = ApprovalTemplateLike(
  requireAreaManager: true,
);
const ApprovalTemplateLike kOneStage = ApprovalTemplateLike(
  requireAreaManager: false,
);

void main() {
  test(
    'case M1: statusSummary says WHO is holding it, not just "pending"',
    () {
      expect(
        statusSummary(
          kTwoStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending'),
        ).text,
        'Waiting for a supervisor',
      );
      expect(
        statusSummary(
          kTwoStage,
          const ApprovalSubmissionLike(
            approvalStatus: 'pending_area_manager',
          ),
        ).text,
        'Waiting for the area manager',
      );
      expect(
        statusSummary(
          kTwoStage,
          const ApprovalSubmissionLike(approvalStatus: 'approved'),
        ).text,
        'Closed',
      );
      expect(
        statusSummary(
          kOneStage,
          const ApprovalSubmissionLike(approvalStatus: 'pending'),
        ).text,
        'Waiting for approval',
      );
    },
  );

  test(
    'case M2: closed means CLOSED, not "a supervisor looked at it"',
    () {
      expect(
        isFullyClosed(
          const ApprovalSubmissionLike(
            approvalStatus: 'pending_area_manager',
          ),
        ),
        isFalse,
      );
      expect(
        isFullyClosed(
          const ApprovalSubmissionLike(approvalStatus: 'approved'),
        ),
        isTrue,
      );
    },
  );

  test('case M3: both waiting rungs fold into ONE history bucket', () {
    expect(
      historyBucket(const ApprovalSubmissionLike(approvalStatus: 'pending')),
      HistoryBucket.waiting,
    );
    expect(
      historyBucket(
        const ApprovalSubmissionLike(
          approvalStatus: 'pending_area_manager',
        ),
      ),
      HistoryBucket.waiting,
    );
  });

  test('case M4: an unknown status is noApproval, not a crash', () {
    expect(
      historyBucket(const ApprovalSubmissionLike(approvalStatus: '')),
      HistoryBucket.noApproval,
    );
    expect(
      historyBucket(
        const ApprovalSubmissionLike(approvalStatus: 'not_required'),
      ),
      HistoryBucket.noApproval,
    );
    // Taken directly from mobile/__tests__/checklistHistory.test.ts:267-268,
    // beyond the two inputs the artifact table itself names - an
    // unrecognised value and a wholly absent submission are the same class
    // of "must not read as closed" gap.
    expect(
      historyBucket(
        const ApprovalSubmissionLike(approvalStatus: 'something_new'),
      ),
      HistoryBucket.noApproval,
    );
    expect(historyBucket(null), HistoryBucket.noApproval);
  });

  test('case M5: a never-minted document number is NULL, not blank', () {
    expect(submissionReference(null), isNull);
    expect(submissionReference('   '), isNull);
    expect(
      submissionReference('WDC-TM514-2026-0001'),
      'WDC-TM514-2026-0001',
    );
  });
}
