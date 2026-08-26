/// Parity group E - auto values. Cases E1-E8.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group E. E1-E6 mirror `checklistFields.ts`'s `resolveAutoValue`/
/// `isAutoField` tests (`src/test/checklistFieldTypes.test.js:148-159`);
/// E7-E8 mirror `checklistMarks.ts`'s `resolveAutoFill`
/// (`src/test/checklistMarks.test.js:139-154`) - the artifact groups both
/// mechanisms under "auto values" even though they live in different
/// source files (autoFrom is section 4b, keyed on the ASSET rather than
/// the user/date).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_asset_context.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_fill.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_auto_value.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';

void main() {
  test("E1: current_user resolves the operator's name", () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'user',
      autoValue: 'current_user',
    );
    expect(
      resolveAutoValue(f, const ChecklistAutoValueContext(userName: 'Sam Ali')),
      'Sam Ali',
    );
  });

  test('E2: today resolves the supplied ISO date', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'date',
      autoValue: 'today',
    );
    expect(
      resolveAutoValue(f, const ChecklistAutoValueContext(today: '2026-07-12')),
      '2026-07-12',
    );
  });

  test('E3: today defaults to now when ctx is empty', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'date',
      autoValue: 'today',
    );
    final String today = resolveAutoValue(f);
    expect(today, matches(RegExp(r'^\d{4}-\d{2}-\d{2}$')));
    final DateTime nowUtc = DateTime.now().toUtc();
    final String expected =
        '${nowUtc.year.toString().padLeft(4, '0')}-'
        '${nowUtc.month.toString().padLeft(2, '0')}-'
        '${nowUtc.day.toString().padLeft(2, '0')}';
    expect(today, expected);
  });

  test('E4: a non-auto field resolves to empty', () {
    const ChecklistField f = ChecklistField(id: 'x', type: 'text');
    expect(resolveAutoValue(f), '');
  });

  test('E5: isAutoField tests the PROPERTY, not the type', () {
    expect(isAutoField(const ChecklistField(id: 'x', type: 'user')), isFalse);
    expect(
      isAutoField(
        const ChecklistField(id: 'x', type: 'user', autoValue: 'current_user'),
      ),
      isTrue,
    );
  });

  test('E6: a resumed draft keeps the STORED date - resolveAutoValue never '
      're-resolves what a caller already stored', () {
    const ChecklistField dateField = ChecklistField(
      id: 'd1',
      type: 'date',
      autoValue: 'today',
    );
    // Day 1: the sheet is opened; the auto value is resolved ONCE and
    // stored like any other answer.
    final String onOpen = resolveAutoValue(
      dateField,
      const ChecklistAutoValueContext(today: '2026-07-12'),
    );
    final Map<String, Object?> answers = <String, Object?>{'d1': onOpen};
    expect(answers['d1'], '2026-07-12');

    // Day 2: a caller that resolves again (simulating "the wrong thing
    // to do") gets tomorrow's date - but resolveAutoValue has no way to
    // reach into `answers` and rewrite it; it takes no storage argument
    // at all. The stored value from day 1 survives untouched, which is
    // exactly the contract a resumed draft depends on.
    final String ifResolvedAgain = resolveAutoValue(
      dateField,
      const ChecklistAutoValueContext(today: '2026-07-13'),
    );
    expect(ifResolvedAgain, '2026-07-13');
    expect(answers['d1'], '2026-07-12');
  });

  test('E7: autoFrom prefers fleet number over registration', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'text',
      autoFrom: 'asset.fleet_no',
    );
    expect(
      resolveAutoFill(
        f,
        const ChecklistAssetContext(fleetNumber: 'F1', registrationNo: 'R1'),
      ),
      'F1',
    );
    // ...and falls back to the plate when the register carries only that.
    expect(
      resolveAutoFill(
        f,
        const ChecklistAssetContext(registrationNo: '8448 GXA'),
      ),
      '8448 GXA',
    );
  });

  test('E8: an unknown autoFrom token resolves to nothing', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'text',
      autoFrom: 'asset.invented',
    );
    expect(resolveAutoFill(f, const ChecklistAssetContext(site: 'NHC')), '');
    expect(kChecklistAutoFillSources.containsKey('asset.site'), isTrue);
  });
}
