/// Parity group A - the field type registry. Cases A1-A10.
///
/// `docs/flutter-migration/08-checklist-engine-parity-tests.md` section 10
/// group A. Fixtures mirror `src/test/checklistFieldTypes.test.js` (the
/// web registry test - see `checklist_field_type.dart`'s library comment
/// for why group A draws on the web source specifically).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field_type.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_validation.dart';

const List<String> _kAllTypes = <String>[
  'section',
  'text',
  'textarea',
  'number',
  'select',
  'multiselect',
  'boolean',
  'date',
  'rating',
  'asset',
  'site',
  'user',
  'photo',
  'signature',
];

void main() {
  test('A1: the registry declares 14 types', () {
    final List<String> types = <String>[
      for (final ChecklistFieldTypeDef d in kChecklistFieldTypes) d.type,
    ];
    expect(types, containsAll(_kAllTypes));
    expect(types, hasLength(14));
    expect(kChecklistFieldTypes, hasLength(14));
  });

  test('A2: only select and multiselect carry options', () {
    for (final String t in _kAllTypes) {
      final bool expected = t == 'select' || t == 'multiselect';
      expect(typeHasOptions(t), expected, reason: t);
    }
  });

  test('A3: section is the only layout type', () {
    for (final String t in _kAllTypes) {
      expect(isLayoutField(t), t == 'section', reason: t);
    }
  });

  test('A4: photo and signature are not value fields', () {
    for (final String t in _kAllTypes) {
      final bool expectedValueField =
          t != 'section' && t != 'photo' && t != 'signature';
      expect(isValueField(t), expectedValueField, reason: t);
    }
    expect(isValueField('section'), isFalse);
    expect(isValueField('photo'), isFalse);
    expect(isValueField('signature'), isFalse);
  });

  test('A5: everything except section is recordable', () {
    for (final String t in _kAllTypes) {
      expect(isRecordableField(t), t != 'section', reason: t);
    }
  });

  test('A6: reference types resolve live', () {
    expect(kReferenceTypes, containsAll(<String>['asset', 'site', 'user']));
    expect(kReferenceTypes, hasLength(3));
    expect(referenceSource('asset'), 'asset');
    expect(referenceSource('site'), 'site');
    expect(referenceSource('user'), 'user');
    expect(referenceSource('text'), isNull);
    expect(typeHasOptions('asset'), isFalse);
  });

  test('A7: blank answers match the field kind', () {
    expect(blankAnswer(const ChecklistField(id: 'x', type: 'multiselect')), <Object?>[]);
    expect(blankAnswer(const ChecklistField(id: 'x', type: 'boolean')), isNull);
    expect(blankAnswer(const ChecklistField(id: 'x', type: 'rating')), 0);
    expect(blankAnswer(const ChecklistField(id: 'x', type: 'number')), '');
    expect(
      blankAnswer(
        const ChecklistField(id: 'x', type: 'text', defaultValue: 'x'),
      ),
      'x',
    );
    // A type with no explicit default falls back to '' (field.default ?? '').
    expect(blankAnswer(const ChecklistField(id: 'x', type: 'text')), '');
  });

  test('A8: a reference field validates like text', () {
    expect(
      validateAnswer(
        const ChecklistField(id: 'x', type: 'site', label: 'Site', required: true),
        '',
      ),
      matches(RegExp('required', caseSensitive: false)),
    );
    expect(
      validateAnswer(
        const ChecklistField(id: 'x', type: 'site', required: true),
        'Riyadh Depot',
      ),
      isNull,
    );
  });

  test('A9: a layout field is never validated', () {
    expect(
      validateAnswer(const ChecklistField(id: 'x', type: 'section'), null),
      isNull,
    );
  });

  test("A10: an unknown type does not crash the registry", () {
    expect(fieldTypeDef('nonsense'), isNull);
    expect(newField('nonsense').type, 'text');
    // The registry lookup itself is equally forgiving of an absent token.
    expect(fieldTypeDef(null), isNull);
  });
}
