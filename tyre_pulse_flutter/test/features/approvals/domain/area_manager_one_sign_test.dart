/// Owner rule 2026-11-08: an area manager signing a two-stage sheet that is
/// still at the supervisor step closes it in one signature. Mirrors
/// `src/test/checklistApproval.test.js` "an area manager signs once" and the
/// SQL `decide_checklist_approval` (20261108100000).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart';

const ApprovalTemplateLike kTwo =
    ApprovalTemplateLike(requireAreaManager: true);
const ApprovalTemplateLike kOne =
    ApprovalTemplateLike(requireAreaManager: false);
const ApprovalSubmissionLike kPending =
    ApprovalSubmissionLike(approvalStatus: 'pending');

void main() {
  test('an area manager closes from the supervisor step', () {
    for (final String role in <String>[
      'PMV Manager',
      'Workshop Maintenance Area Manager',
      'Workshop Area Manager',
      'Director',
      'Admin',
    ]) {
      expect(nextStatusFor(kTwo, kPending, true, role: role), 'approved');
      expect(canDecide(kTwo, kPending, role), isTrue);
      expect(closesInOneSign(kTwo, kPending, role), isTrue);
    }
  });

  test('a supervisor still passes it to the area manager', () {
    expect(
      nextStatusFor(kTwo, kPending, true, role: 'Workshop Supervisor'),
      'pending_area_manager',
    );
  });

  test('no role keeps the two-step answer; single-stage and reject unchanged',
      () {
    expect(nextStatusFor(kTwo, kPending, true), 'pending_area_manager');
    expect(
      nextStatusFor(kOne, kPending, true, role: 'PMV Manager'),
      'approved',
    );
    expect(
      nextStatusFor(kTwo, kPending, false, role: 'PMV Manager'),
      'rejected',
    );
  });
}
