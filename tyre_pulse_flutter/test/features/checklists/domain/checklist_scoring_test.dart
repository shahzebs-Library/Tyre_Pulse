/// `checklist_scoring.dart` - the one piece of section 5's own documented
/// scope ("Scoring", `docs/flutter-migration/08-checklist-engine-parity-
/// tests.md` lines 529-541) that section 10 assigns no lettered group or
/// numbered case to. `checklist_scoring.dart`'s own library comment records
/// that gap as a deliberate, disclosed judgement call rather than an
/// oversight - this file closes it anyway, checked directly against that
/// prose spec (mirroring `checklistFields.ts:368-388`), because the
/// behaviour is real, precisely documented, and otherwise ships with no
/// coverage at all.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_scoring.dart';

void main() {
  test('only finite, positive-weight fields count; a section never does', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 's', type: 'section', label: 'Heading', weight: 99),
      const ChecklistField(id: 'zero', type: 'select', weight: 0, passValues: <Object?>['OK']),
      const ChecklistField(id: 'neg', type: 'select', weight: -1, passValues: <Object?>['OK']),
      ChecklistField(
        id: 'nan',
        type: 'select',
        weight: double.nan,
        passValues: const <Object?>['OK'],
      ),
      const ChecklistField(id: 'counts', type: 'select', weight: 2, passValues: <Object?>['OK']),
    ];
    final ChecklistScore score = computeScore(fields, <String, Object?>{
      'zero': 'OK',
      'neg': 'OK',
      'nan': 'OK',
      'counts': 'OK',
    });
    expect(score.scored, 1);
    expect(score.possible, 2);
    expect(score.earned, 2);
  });

  test('a hidden field is excluded even when answered and weighted', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(
        id: 'gate',
        type: 'select',
        options: <String>['yes', 'no'],
      ),
      const ChecklistField(
        id: 'dependent',
        type: 'select',
        weight: 5,
        passValues: <Object?>['OK'],
        visibleWhen: <ChecklistVisibleCondition>[
          ChecklistVisibleCondition(field: 'gate', op: '=', value: 'yes'),
        ],
      ),
    ];
    final ChecklistScore score = computeScore(fields, <String, Object?>{
      'gate': 'no',
      'dependent': 'OK',
    });
    expect(score.scored, 0);
    expect(score.possible, 0);
    expect(score.earned, 0);
  });

  test('an array answer passes when ANY element is in passValues', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(
        id: 'x',
        type: 'multiselect',
        weight: 1,
        passValues: <Object?>['OK'],
      ),
    ];
    expect(
      computeScore(fields, <String, Object?>{
        'x': <String>['Bad', 'OK'],
      }).earned,
      1,
    );
    expect(
      computeScore(fields, <String, Object?>{
        'x': <String>['Bad', 'Worse'],
      }).earned,
      0,
    );
  });

  test('with no passValues, merely non-empty passes', () {
    const ChecklistField f = ChecklistField(id: 'x', type: 'text', weight: 1);
    expect(computeScore(<ChecklistField>[f], <String, Object?>{'x': 'anything'}).earned, 1);
    expect(computeScore(<ChecklistField>[f], <String, Object?>{'x': ''}).earned, 0);
    expect(
      computeScore(<ChecklistField>[f], <String, Object?>{
        'x': const <String>[],
      }).earned,
      0,
    );
    expect(computeScore(<ChecklistField>[f], const <String, Object?>{}).earned, 0);
  });

  test('pct is null when nothing was scored, never a fabricated 0 or 100', () {
    final ChecklistScore score = computeScore(
      <ChecklistField>[const ChecklistField(id: 's', type: 'section', weight: 5)],
      const <String, Object?>{},
      80,
    );
    expect(score.possible, 0);
    expect(score.pct, isNull);
    expect(score.passed, isNull);
  });

  test('passed is null whenever no threshold was supplied, even with a real pct', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 'x', type: 'select', weight: 1, passValues: <Object?>['OK']),
    ];
    final ChecklistScore score = computeScore(fields, <String, Object?>{'x': 'OK'});
    expect(score.pct, 100);
    expect(score.passed, isNull);
  });

  test('rounds, and passed compares pct against the threshold both ways', () {
    final List<ChecklistField> fields = <ChecklistField>[
      const ChecklistField(id: 'a', type: 'select', weight: 1, passValues: <Object?>['OK']),
      const ChecklistField(id: 'b', type: 'select', weight: 1, passValues: <Object?>['OK']),
      const ChecklistField(id: 'c', type: 'select', weight: 1, passValues: <Object?>['OK']),
    ];
    final Map<String, Object?> twoOfThree = <String, Object?>{
      'a': 'OK',
      'b': 'OK',
      'c': 'Not OK',
    };
    final ChecklistScore pass = computeScore(fields, twoOfThree, 60);
    expect(pass.scored, 3);
    expect(pass.earned, 2);
    expect(pass.possible, 3);
    expect(pass.pct, 67);
    expect(pass.passed, isTrue);

    final ChecklistScore fail = computeScore(fields, twoOfThree, 70);
    expect(fail.passed, isFalse);
  });
}
