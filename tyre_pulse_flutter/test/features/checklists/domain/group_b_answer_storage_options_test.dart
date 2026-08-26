/// Parity group B - answer storage and options. Cases B1-B8.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group B. Fixtures mirror `src/test/checklistI18n.test.js`'s
/// `options_ref`/English-answer-invariant tests, adapted to the MOBILE
/// resolver shape this port follows (see `checklist_i18n.dart`'s library
/// comment).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_i18n.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_validation.dart';

void main() {
  test('B1: the stored value is English, the label is translated', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['OK', 'Not OK'],
      optionsI18n: <String, List<String>>{
        'ar': <String>['حسنا', 'غير جيد'],
      },
    );
    final List<ChecklistFieldOption> opts = fieldOptions(field, null, 'ar');
    expect(opts, <ChecklistFieldOption>[
      const ChecklistFieldOption(value: 'OK', label: 'حسنا'),
      const ChecklistFieldOption(value: 'Not OK', label: 'غير جيد'),
    ]);
  });

  test('B2: a shared set WINS over the field own copy', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['old'],
      optionsRef: 'legend',
    );
    final ChecklistTemplate template = const ChecklistTemplate(
      optionSets: <String, ChecklistOptionSet>{
        'legend': ChecklistOptionSet(options: <String>['new']),
      },
    );
    expect(fieldOptionValues(field, template), <String>['new']);
  });

  test('B3: an empty shared set falls back to the field', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['own'],
      optionsRef: 'legend',
    );
    final ChecklistTemplate template = const ChecklistTemplate(
      optionSets: <String, ChecklistOptionSet>{
        'legend': ChecklistOptionSet(options: <String>[]),
      },
    );
    expect(fieldOptionValues(field, template), <String>['own']);
  });

  test('B4: a short translation array falls back PER INDEX', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['A', 'B', 'C'],
      optionsI18n: <String, List<String>>{
        'ar': <String>['ألف', 'باء'],
      },
    );
    final List<ChecklistFieldOption> opts = fieldOptions(field, null, 'ar');
    expect(opts[0].label, 'ألف');
    expect(opts[1].label, 'باء');
    // The untranslated tail stays English, never blank.
    expect(opts[2].label, 'C');
  });

  test('B5: an unknown language degrades to English', () {
    expect(normalizeLang('fr'), kChecklistDefaultLang);
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['A', 'B'],
      optionsI18n: <String, List<String>>{
        'ar': <String>['أ', 'ب'],
      },
    );
    final List<ChecklistFieldOption> opts = fieldOptions(field, null, 'fr');
    expect(opts.map((ChecklistFieldOption o) => o.label), <String>['A', 'B']);
  });

  test('B6: a blank translation degrades to English', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'text',
      label: 'Eng',
      labels: <String, String>{'ar': '   '},
    );
    expect(fieldLabel(field, 'ar'), 'Eng');
  });

  test('B7: an unknown stored value renders as itself', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['OK', 'Not OK'],
    );
    expect(optionLabel(field, null, 'Legacy Value'), 'Legacy Value');
    expect(optionLabel(field, null, ''), '');
    expect(optionLabel(field, null, null), '');
  });

  test('B8: validation uses the resolved set, not the stale copy', () {
    final ChecklistField field = const ChecklistField(
      id: 'c1',
      type: 'select',
      options: <String>['old'],
      optionsRef: 'legend',
    );
    final ChecklistTemplate template = const ChecklistTemplate(
      optionSets: <String, ChecklistOptionSet>{
        'legend': ChecklistOptionSet(options: <String>['new']),
      },
    );
    final String? err = validateAnswer(
      field,
      'new',
      options: fieldOptionValues(field, template),
    );
    expect(err, isNull);
    // Sanity: without the resolved set, 'new' would be rejected against the
    // field's own stale ['old'] list.
    expect(validateAnswer(field, 'new'), isNotNull);
  });
}
