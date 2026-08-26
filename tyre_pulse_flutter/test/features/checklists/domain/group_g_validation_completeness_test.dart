/// Parity group G - validation and completeness. Cases G1-G12.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group G. G1-G9 mirror `src/test/checklistFieldTypes.test.js`'s
/// `validateAnswer`/`validateSubmission` tests; G10-G12 mirror
/// `src/test/checklistMarks.test.js:116-136`'s `unsatisfiedGroups` tests
/// (the km/hour-meter fixture, reused from group F's asset context but
/// re-declared minimally here for this group's own focus).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_marks.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_validation.dart';

const ChecklistTemplate _meterTemplate = ChecklistTemplate(
  fields: <ChecklistField>[
    ChecklistField(
      id: 'f_ws_km',
      type: 'number',
      label: 'Km reading',
      groupRequireOne: 'meter',
    ),
    ChecklistField(
      id: 'f_ws_hr',
      type: 'number',
      label: 'Hour meter reading',
      groupRequireOne: 'meter',
    ),
  ],
);

void main() {
  test('G1: required + empty names the field', () {
    expect(
      validateAnswer(
        const ChecklistField(
          id: 'x',
          type: 'text',
          label: 'Name',
          required: true,
        ),
        '',
      ),
      'Name is required',
    );
  });

  test('G2: optional + empty short-circuits every later check', () {
    expect(
      validateAnswer(const ChecklistField(id: 'x', type: 'number', min: 1), ''),
      isNull,
    );
  });

  test('G3: number bounds', () {
    const ChecklistField f = ChecklistField(
      id: 'x',
      type: 'number',
      min: 1,
      max: 10,
    );
    expect(validateAnswer(f, 0), isNotNull);
    expect(validateAnswer(f, 5), isNull);
    expect(validateAnswer(f, 11), isNotNull);
  });

  test('G4: a non-numeric number', () {
    expect(
      validateAnswer(const ChecklistField(id: 'x', type: 'number'), 'abc'),
      matches(RegExp('must be a number')),
    );
  });

  test('G5: select membership', () {
    expect(
      validateAnswer(
        const ChecklistField(
          id: 'x',
          type: 'select',
          label: 'C',
          options: <String>['a', 'b'],
        ),
        'z',
      ),
      matches(RegExp('valid', caseSensitive: false)),
    );
  });

  test('G6: multiselect membership names it plural', () {
    expect(
      validateAnswer(
        const ChecklistField(
          id: 'x',
          type: 'multiselect',
          options: <String>['a', 'b'],
        ),
        <String>['a', 'z'],
      ),
      matches(RegExp('Invalid')),
    );
  });

  test('G7: membership is SKIPPED when no set is known', () {
    expect(
      validateAnswer(const ChecklistField(id: 'x', type: 'select'), 'x'),
      isNull,
    );
  });

  test('G8: rating bounds', () {
    expect(
      validateAnswer(const ChecklistField(id: 'x', type: 'rating'), 9),
      matches(RegExp('0-5|0')),
    );
  });

  test('G9: validateSubmission skips layout and media', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 'a', type: 'text', label: 'A', required: true),
      const ChecklistField(id: 'b', type: 'number', label: 'B', min: 0),
      const ChecklistField(id: 'c', type: 'section', label: 'Heading'),
      const ChecklistField(id: 'd', type: 'photo', label: 'Pics'),
    ];
    final ChecklistValidationResult res = validateSubmission(
      fields,
      <String, Object?>{'a': '', 'b': 5},
    );
    expect(res.valid, isFalse);
    expect(res.errors['a'], isNotNull);
    expect(res.errors.containsKey('c'), isFalse);
    expect(res.errors.containsKey('d'), isFalse);

    final ChecklistValidationResult ok = validateSubmission(
      fields,
      <String, Object?>{'a': 'hi', 'b': 5},
    );
    expect(ok.valid, isTrue);
  });

  test('G10: group_require_one accepts EITHER reading', () {
    expect(
      unsatisfiedGroups(_meterTemplate, <String, Object?>{'f_ws_km': 120345}),
      isEmpty,
    );
    expect(
      unsatisfiedGroups(_meterTemplate, <String, Object?>{'f_ws_hr': 8100}),
      isEmpty,
    );
    final List<UnsatisfiedGroup> missing = unsatisfiedGroups(
      _meterTemplate,
      const <String, Object?>{},
    );
    expect(missing, hasLength(1));
    expect(missing.first.fields.map((ChecklistFieldRef f) => f.id), <String>[
      'f_ws_km',
      'f_ws_hr',
    ]);
  });

  test('G11: zero IS a reading', () {
    expect(
      unsatisfiedGroups(_meterTemplate, <String, Object?>{'f_ws_hr': 0}),
      isEmpty,
    );
  });

  test('G12: a blank string is NOT a reading', () {
    expect(
      unsatisfiedGroups(_meterTemplate, <String, Object?>{'f_ws_km': '  '}),
      hasLength(1),
    );
  });
}
