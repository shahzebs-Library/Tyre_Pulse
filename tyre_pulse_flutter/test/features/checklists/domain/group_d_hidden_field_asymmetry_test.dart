/// Parity group D - the hidden-field asymmetry. Cases D1-D5. **The
/// highest-value group in this port** (the artifact's own words):
/// requirements (`missingNotes`/`unsatisfiedGroups`) respect visibility,
/// the blocking gate (`canClose`/`blockingAnswers`) deliberately does not,
/// and an answer is never cleared just because its field became hidden.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group D. The `COND`/`LEGEND` fixtures are transcribed verbatim from
/// `src/test/checklistMarks.test.js:12-26,205-241` ("a hidden line must not
/// demand the impossible, but must still block") - the artifact records
/// that the real Predictive Maintenance template already uses `visibleWhen`
/// on 197 fields, so this is not a hypothetical scenario.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_marks.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_visibility.dart';

const ChecklistOptionSet _kLegend = ChecklistOptionSet(
  options: <String>[
    'OK',
    'Not OK',
    'Not applicable',
    'Changed',
    'Repaired',
    'Added / Top-Up',
    'Adjusted',
    'Lubricated',
  ],
  blocking: <String>['Not OK'],
  requireNote: <String>['Not OK'],
);

final ChecklistTemplate _cond = const ChecklistTemplate(
  optionSets: <String, ChecklistOptionSet>{'legend': _kLegend},
  fields: <ChecklistField>[
    ChecklistField(
      id: 'interval',
      type: 'select',
      label: 'Interval',
      options: <String>['250h', '500h'],
    ),
    ChecklistField(
      id: 'c500',
      type: 'select',
      label: '500h only check',
      optionsRef: 'legend',
      requireNoteWhen: <String>['Not OK'],
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(field: 'interval', op: '=', value: '500h'),
      ],
    ),
    ChecklistField(
      id: 'km500',
      type: 'number',
      label: 'Km',
      groupRequireOne: 'meter',
      visibleWhen: <ChecklistVisibleCondition>[
        ChecklistVisibleCondition(field: 'interval', op: '=', value: '500h'),
      ],
    ),
  ],
);

void main() {
  test('D1: a hidden line does NOT demand a remark', () {
    // The stale 'Not OK' is left over from when 500h was selected.
    final List<ChecklistFieldRef> missing = missingNotes(
      _cond,
      <String, Object?>{'interval': '250h', 'c500': 'Not OK'},
      const <String, Object?>{},
    );
    expect(missing, isEmpty);
  });

  test('D2: the same line DOES demand one once visible', () {
    final List<ChecklistFieldRef> missing = missingNotes(
      _cond,
      <String, Object?>{'interval': '500h', 'c500': 'Not OK'},
      const <String, Object?>{},
    );
    expect(missing.map((ChecklistFieldRef r) => r.id), <String>['c500']);
  });

  test('D3: a hidden meter group is not demanded', () {
    expect(
      unsatisfiedGroups(_cond, <String, Object?>{'interval': '250h'}),
      isEmpty,
    );
    // ...and it IS demanded once the group's fields are visible again.
    expect(
      unsatisfiedGroups(_cond, <String, Object?>{'interval': '500h'}),
      hasLength(1),
    );
  });

  test('D4: a hidden answer STILL blocks the close', () {
    final Map<String, Object?> answers = <String, Object?>{
      'interval': '250h',
      'c500': 'Not OK',
    };
    // c500 is hidden under this answer set (interval != '500h').
    expect(isFieldVisible(_cond.fields[1], answers), isFalse);

    final ChecklistCloseCheck check = canClose(_cond, answers);
    expect(check.ok, isFalse);
    expect(
      blockingAnswers(_cond, answers).map((BlockingAnswer b) => b.id),
      <String>['c500'],
    );
  });

  test('D5: an answer is never cleared when its field hides', () {
    final ChecklistTemplate template = const ChecklistTemplate(
      fields: <ChecklistField>[
        ChecklistField(
          id: 'q1',
          type: 'select',
          options: <String>['Pass', 'Fail'],
        ),
        ChecklistField(
          id: 'why',
          type: 'text',
          visibleWhen: <ChecklistVisibleCondition>[
            ChecklistVisibleCondition(field: 'q1', op: '=', value: 'Fail'),
          ],
        ),
      ],
    );

    // The operator answers q1=Fail and records a reason.
    final Map<String, Object?> answers = <String, Object?>{
      'q1': 'Fail',
      'why': 'Left rear brake pad worn',
    };
    expect(
      visibleChecklistFields(template.fields, answers)
          .map((ChecklistField f) => f.id),
      contains('why'),
    );

    // The operator changes their mind and answers q1=Pass. Nothing in this
    // domain library clears 'why' - there is no such function to call, and
    // this test proves the map is untouched by anything RENDERING has to
    // do to compute what is now visible.
    answers['q1'] = 'Pass';
    expect(
      visibleChecklistFields(template.fields, answers)
          .map((ChecklistField f) => f.id),
      isNot(contains('why')),
    );
    // The raw answer is still there, byte for byte - this is what a submit
    // payload built from `answers` whole would still carry.
    expect(answers['why'], 'Left rear brake pad worn');
  });
}
