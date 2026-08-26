/// Coverage for the pure, I/O-free parts of the checklist-approvals data
/// layer: [checklistApprovalCountryFilter], [checklistApprovalTemplateLookupCap]
/// and [ChecklistApprovalItem.fromRow] (including its [isWaiting]/
/// [asSubmissionLike] derived views).
///
/// [SupabaseChecklistApprovalRepository] itself is NOT instantiated here -
/// mirrors `inspection_approval_repository_test.dart`'s own stated
/// convention exactly: "No test file anywhere in this project constructs a
/// real `SupabaseClient` against a concrete `Supabase*RemoteRepository`
/// implementation - every `Supabase*RemoteRepository` in this codebase is
/// exercised only through a hand-written fake of its own interface at the
/// point of USE" (see `checklist_approval_sync_engine_test.dart`'s own
/// `_FakeRepository`). This file covers exactly what IS independently
/// testable without one: the query-scoping decision and the row decoder.
///
/// [SupabaseChecklistApprovalRepository._patchFor]'s own field-for-field
/// write logic is private and cannot be unit tested directly - it is
/// verified instead by direct reading against
/// `mobile/lib/checklists.ts:459-483`'s `decideApproval`, quoted in this
/// port's final report.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_item.dart';
import 'package:tyre_pulse/features/approvals/data/checklist_approval_repository.dart';
import 'package:tyre_pulse/features/approvals/domain/checklist_approval.dart'
    show ApprovalSubmissionLike;

void main() {
  group('checklistApprovalCountryFilter', () {
    test('null country means no filter at all', () {
      expect(checklistApprovalCountryFilter(null), isNull);
    });

    test('an empty or whitespace-only country means no filter', () {
      expect(checklistApprovalCountryFilter(''), isNull);
      expect(checklistApprovalCountryFilter('   '), isNull);
    });

    test("the 'All' sentinel means no filter", () {
      expect(checklistApprovalCountryFilter('All'), isNull);
    });

    test('a real country scopes to it OR a null row country', () {
      expect(
        checklistApprovalCountryFilter('KSA'),
        'country.eq.KSA,country.is.null',
      );
    });
  });

  group('checklistApprovalTemplateLookupCap', () {
    test('is 20, matching the mobile source\'s own .slice(0, 20)', () {
      expect(checklistApprovalTemplateLookupCap, 20);
    });
  });

  group('ChecklistApprovalItem.fromRow', () {
    test('decodes every column, via the full SUBMISSION_COLS shape', () {
      final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
        <String, Object?>{
          'id': 'sub-1',
          'template_id': 'tpl-1',
          'template_name': 'Workshop Daily Checklist',
          'template_version': 2,
          'title': 'WDC-TM514-2026-0001',
          'site': 'NHC',
          'asset_no': 'TM514',
          'status': 'submitted',
          'answers': <String, Object?>{'q1': 'Good'},
          'photos': <String, Object?>{
            'q1': <String>['tp-storage://a.jpg'],
          },
          'notes': <String, Object?>{'q1': 'All clear'},
          'signatures': <String, Object?>{'sig1': 'data:image/png;base64,aaa'},
          'signature_data': 'data:image/png;base64,primary',
          'printed_name': 'Ahmed',
          'submitted_by': 'user-1',
          'submitted_at': '2026-08-20T09:00:00.000Z',
          'score_pct': 92,
          'score_passed': true,
          'approval_status': 'pending',
          'document_no': 'WDC-TM514-2026-0001',
          'approver_name': null,
          'approver_signature': null,
          'approved_at': null,
          'supervisor_name': null,
          'supervisor_signature': null,
          'supervisor_at': null,
          'review_note': null,
          'locked': false,
        },
      );

      expect(item.id, 'sub-1');
      expect(item.templateId, 'tpl-1');
      expect(item.templateName, 'Workshop Daily Checklist');
      expect(item.templateVersion, 2);
      expect(item.title, 'WDC-TM514-2026-0001');
      expect(item.site, 'NHC');
      expect(item.assetNo, 'TM514');
      expect(item.status, 'submitted');
      expect(item.answers, <String, Object?>{'q1': 'Good'});
      expect(item.photos, <String, List<String>>{
        'q1': <String>['tp-storage://a.jpg'],
      });
      expect(item.notes, <String, Object?>{'q1': 'All clear'});
      expect(item.signatures, <String, String>{
        'sig1': 'data:image/png;base64,aaa',
      });
      expect(item.signatureData, 'data:image/png;base64,primary');
      expect(item.printedName, 'Ahmed');
      expect(item.submittedBy, 'user-1');
      expect(item.submittedAt, '2026-08-20T09:00:00.000Z');
      expect(item.scorePct, 92);
      expect(item.scorePassed, isTrue);
      expect(item.approvalStatus, 'pending');
      expect(item.documentNo, 'WDC-TM514-2026-0001');
      expect(item.approverName, isNull);
      expect(item.locked, isFalse);
    });

    test("every optional column may be absent (the queue's lean select)", () {
      final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
        <String, Object?>{'id': 'sub-2'},
      );

      expect(item.id, 'sub-2');
      expect(item.templateId, isNull);
      expect(item.title, isNull);
      expect(item.answers, isEmpty);
      expect(item.photos, isEmpty);
      expect(item.notes, isEmpty);
      expect(item.signatures, isEmpty);
      expect(item.signatureData, isNull);
      expect(item.scorePct, isNull);
      expect(item.scorePassed, isNull);
      expect(item.approvalStatus, isNull);
      expect(item.locked, isFalse);
      expect(item.isWaiting, isFalse);
    });

    test('a missing id throws a FormatException', () {
      expect(
        () => ChecklistApprovalItem.fromRow(<String, Object?>{'x': 1}),
        throwsFormatException,
      );
    });

    test('an empty-string id throws a FormatException', () {
      expect(
        () => ChecklistApprovalItem.fromRow(<String, Object?>{'id': ''}),
        throwsFormatException,
      );
    });

    test('a non-string id throws a FormatException', () {
      expect(
        () => ChecklistApprovalItem.fromRow(<String, Object?>{'id': 42}),
        throwsFormatException,
      );
    });

    test('a blank/whitespace-only string column reads back as null', () {
      final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
        <String, Object?>{'id': 'a', 'title': '   ', 'site': ''},
      );
      expect(item.title, isNull);
      expect(item.site, isNull);
    });

    group('isWaiting', () {
      test('pending is waiting', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'pending'},
        );
        expect(item.isWaiting, isTrue);
      });

      test(
          'pending_area_manager is ALSO waiting - the second rung must '
          'never vanish from a queue that only checked the first', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{
            'id': 'a',
            'approval_status': 'pending_area_manager',
          },
        );
        expect(item.isWaiting, isTrue);
      });

      test('approved is not waiting', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'approved'},
        );
        expect(item.isWaiting, isFalse);
      });

      test('rejected is not waiting', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'rejected'},
        );
        expect(item.isWaiting, isFalse);
      });

      test('not_required is not waiting', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{'id': 'a', 'approval_status': 'not_required'},
        );
        expect(item.isWaiting, isFalse);
      });
    });

    group('asSubmissionLike', () {
      test(
          'carries exactly the fields checklist_approval.dart needs, '
          'nothing else', () {
        final ChecklistApprovalItem item = ChecklistApprovalItem.fromRow(
          <String, Object?>{
            'id': 'a',
            'approval_status': 'pending_area_manager',
            'approver_name': 'Sara',
            'approver_signature': 'data:image/png;base64,x',
            'approved_at': '2026-08-20T10:00:00.000Z',
            'supervisor_name': 'Ahmed',
            'supervisor_signature': 'data:image/png;base64,y',
            'supervisor_at': '2026-08-20T09:30:00.000Z',
          },
        );
        final ApprovalSubmissionLike like = item.asSubmissionLike;
        expect(like.approvalStatus, 'pending_area_manager');
        expect(like.approverName, 'Sara');
        expect(like.approverSignature, 'data:image/png;base64,x');
        expect(like.approvedAt, '2026-08-20T10:00:00.000Z');
        expect(like.supervisorName, 'Ahmed');
        expect(like.supervisorSignature, 'data:image/png;base64,y');
        expect(like.supervisorAt, '2026-08-20T09:30:00.000Z');
      });
    });
  });
}
