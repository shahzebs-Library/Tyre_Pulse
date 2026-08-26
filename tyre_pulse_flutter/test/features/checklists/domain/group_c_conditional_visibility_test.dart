/// Parity group C - conditional visibility. Cases C1-C14.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group C. Fixtures mirror `src/test/checklistFieldTypes.test.js`'s
/// `isFieldVisible`/`evalCondition`/`validateSubmission` tests.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_validation.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

void main() {
  test('C1: no rule means visible', () {
    const ChecklistField f = ChecklistField(id: 'x', type: 'text');
    expect(isFieldVisible(f, const <String, Object?>{}), isTrue);
  });

  test('C2: a single condition is honoured both ways', () {
    const ChecklistField f = ChecklistField(
      id: 'note',
      type: 'text',
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(field: 'q1', op: '=', value: 'Fail'),
      ],
    );
    expect(isFieldVisible(f, <String, Object?>{'q1': 'Fail'}), isTrue);
    expect(isFieldVisible(f, <String, Object?>{'q1': 'Pass'}), isFalse);
  });

  test('C3: an array is AND, not OR', () {
    const ChecklistField f = ChecklistField(
      id: 'note',
      type: 'text',
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(field: 'q1', op: '=', value: 'Fail'),
        ChecklistVisibleCondition(field: 'q2', op: '=', value: 'Fail'),
      ],
    );
    // Only the first condition is satisfied.
    expect(
      isFieldVisible(f, <String, Object?>{'q1': 'Fail', 'q2': 'Pass'}),
      isFalse,
    );
  });

  test('C4: an unknown operator fails OPEN', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'text',
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(field: 'q1', op: 'BOGUS', value: 1),
      ],
    );
    expect(isFieldVisible(f, const <String, Object?>{}), isTrue);
  });

  test('C5: a malformed rule fails OPEN', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'text',
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(op: '='),
      ],
    );
    expect(isFieldVisible(f, const <String, Object?>{}), isTrue);
  });

  test("C6: '=' compares as STRING", () {
    expect(evalChecklistCondition('=', 5, '5'), isTrue);
  });

  test('C7: numeric ops treat blank as NaN', () {
    expect(evalChecklistCondition('>', '', 3), isFalse);
    expect(evalChecklistCondition('>=', '', 0), isFalse);
    expect(evalChecklistCondition('<', '', 3), isFalse);
  });

  test('C8: includes is array-membership OR substring', () {
    expect(evalChecklistCondition('includes', <String>['a', 'b'], 'b'), isTrue);
    expect(evalChecklistCondition('includes', 'abc', 'b'), isTrue);
  });

  test('C9: in asks whether the ANSWER is one of a set', () {
    expect(
      evalChecklistCondition('in', 'TR-MIXER', <String>['TR-MIXER', 'PUMPS']),
      isTrue,
    );
    expect(
      evalChecklistCondition('in', 'BUS', <String>['TR-MIXER', 'PUMPS']),
      isFalse,
    );
  });

  test("C10: empty/not_empty treat [] as empty", () {
    expect(evalChecklistCondition('empty', <Object?>[], null), isTrue);
    expect(evalChecklistCondition('not_empty', <Object?>[], null), isFalse);
  });

  test('C11: a hidden required field does NOT block submit', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(
        id: 'q1',
        type: 'select',
        label: 'Result',
        options: <String>['Pass', 'Fail'],
        required: true,
      ),
      const ChecklistField(
        id: 'why',
        type: 'text',
        label: 'Why',
        required: true,
        visibleWhen: <ChecklistVisibleCondition>[
          ChecklistVisibleCondition(field: 'q1', op: '=', value: 'Fail'),
        ],
      ),
    ];
    final ChecklistValidationResult res = validateSubmission(
      fields,
      <String, Object?>{'q1': 'Pass'},
    );
    expect(res.valid, isTrue);
  });

  test('C12: the same field blocks once visible', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(
        id: 'q1',
        type: 'select',
        label: 'Result',
        options: <String>['Pass', 'Fail'],
        required: true,
      ),
      const ChecklistField(
        id: 'why',
        type: 'text',
        label: 'Why',
        required: true,
        visibleWhen: <ChecklistVisibleCondition>[
          ChecklistVisibleCondition(field: 'q1', op: '=', value: 'Fail'),
        ],
      ),
    ];
    final ChecklistValidationResult res = validateSubmission(
      fields,
      <String, Object?>{'q1': 'Fail'},
    );
    expect(res.valid, isFalse);
    expect(res.errors['why'], isNotNull);
  });

  test('C13: an empty section header is pruned', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 's1', type: 'section', label: 'A'),
      const ChecklistField(id: 's2', type: 'section', label: 'B'),
      const ChecklistField(id: 't1', type: 'text'),
    ];
    final List<String> ids = visibleChecklistFields(fields)
        .map((ChecklistField f) => f.id)
        .toList();
    expect(ids, <String>['s2', 't1']);
  });

  test('C14: a trailing section is pruned', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 't1', type: 'text'),
      const ChecklistField(id: 's1', type: 'section', label: 'Nothing after'),
    ];
    final List<String> ids = visibleChecklistFields(fields)
        .map((ChecklistField f) => f.id)
        .toList();
    expect(ids, <String>['t1']);
  });
}
