/// Coverage for the checklist history bucket/search helpers, mirroring
/// `historyStateOf`/`matchesHistorySearch` at
/// `mobile/lib/checklists.ts:656-719` (`mobile/` is read-only reference
/// material).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_history_view.dart';

void main() {
  group('checklistHistoryStateOf', () {
    test('approved is closed', () {
      expect(checklistHistoryStateOf('approved'), ChecklistHistoryState.closed);
    });

    test('rejected is sentBack', () {
      expect(
        checklistHistoryStateOf('rejected'),
        ChecklistHistoryState.sentBack,
      );
    });

    test('pending is waiting', () {
      expect(checklistHistoryStateOf('pending'), ChecklistHistoryState.waiting);
    });

    test('pending_area_manager is ALSO waiting - the coarser bucket', () {
      expect(
        checklistHistoryStateOf('pending_area_manager'),
        ChecklistHistoryState.waiting,
      );
    });

    test('not_required, null and an unrecognised value are all noApproval', () {
      expect(
        checklistHistoryStateOf('not_required'),
        ChecklistHistoryState.noApproval,
      );
      expect(checklistHistoryStateOf(null), ChecklistHistoryState.noApproval);
      expect(
        checklistHistoryStateOf('garbage'),
        ChecklistHistoryState.noApproval,
      );
    });
  });

  group('matchesChecklistHistorySearch', () {
    const ChecklistHistorySearchRow row = ChecklistHistorySearchRow(
      documentNo: 'WDC-TM514-2026-0001',
      templateName: 'Workshop Daily Checklist',
      title: 'Daily check',
      assetNo: 'TM514',
      site: 'NHC',
    );

    test('an empty term matches everything', () {
      expect(matchesChecklistHistorySearch(row, ''), isTrue);
      expect(matchesChecklistHistorySearch(row, '   '), isTrue);
    });

    test('matches case-insensitively across every shown field', () {
      expect(matchesChecklistHistorySearch(row, 'tm514'), isTrue);
      expect(matchesChecklistHistorySearch(row, 'NHC'), isTrue);
      expect(matchesChecklistHistorySearch(row, 'workshop daily'), isTrue);
      expect(matchesChecklistHistorySearch(row, 'wdc-tm514'), isTrue);
    });

    test('a term matching nothing shown returns false', () {
      expect(matchesChecklistHistorySearch(row, 'nonexistent'), isFalse);
    });

    test('a null field is treated as absent, not a crash', () {
      const ChecklistHistorySearchRow bare = ChecklistHistorySearchRow();
      expect(matchesChecklistHistorySearch(bare, 'anything'), isFalse);
      expect(matchesChecklistHistorySearch(bare, ''), isTrue);
    });
  });
}
