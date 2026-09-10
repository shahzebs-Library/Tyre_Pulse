/// The single most important behavioural test in this phase: a blocking
/// mark (an answer that would refuse a CLOSE) must never block SUBMISSION.
/// A mechanic who finds a fault on the last item of the day must still be
/// able to record it and go home - see `checklist_marks.dart`'s own library
/// comment, and `checklist_submit_gate.dart`'s, for why this is enforced by
/// construction (no import of the close-gate machinery at all) rather than
/// by discipline.
///
/// Also covers every OTHER thing that genuinely does gate a submit: a
/// required-and-empty field, a missing required remark, an unsatisfied
/// `group_require_one`, a missing required signature field, and an unmet
/// template-level `require_signature`.
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_option_set.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_submit_gate.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_template.dart';

ChecklistTemplate _templateWithLegend({
  required List<ChecklistField> fields,
  List<String> blocking = const <String>['Not OK'],
}) {
  return ChecklistTemplate(
    id: 't1',
    name: 'Daily Check',
    fields: fields,
    optionSets: <String, ChecklistOptionSet>{
      'legend': ChecklistOptionSet(
        options: const <String>['OK', 'Not OK', 'N/A'],
        blocking: blocking,
      ),
    },
  );
}

void main() {
  group('a blocking mark never blocks submission', () {
    test(
        'a "Not OK" answer on an otherwise-complete, non-required field '
        'still allows submission', () {
      final ChecklistTemplate template = _templateWithLegend(
        fields: const <ChecklistField>[
          ChecklistField(
            id: 'brakes',
            type: 'select',
            label: 'Brakes',
            optionsRef: 'legend',
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: <String, Object?>{'brakes': 'Not OK'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
      expect(gate.fieldErrors, isEmpty);
    });

    test(
        'a "Not OK" answer on a REQUIRED select field still allows '
        'submission - required only means non-empty, not non-blocking', () {
      final ChecklistTemplate template = _templateWithLegend(
        fields: const <ChecklistField>[
          ChecklistField(
            id: 'brakes',
            type: 'select',
            label: 'Brakes',
            required: true,
            optionsRef: 'legend',
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: <String, Object?>{'brakes': 'Not OK'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
    });

    test(
        'a plain text field carrying the literal string "Not OK" is not '
        'treated as blocking either - the close-gate\'s server-mirroring '
        'behaviour belongs to `checklist_marks.canClose`, never to this '
        'submit gate', () {
      final ChecklistTemplate template = _templateWithLegend(
        fields: const <ChecklistField>[
          ChecklistField(id: 'notes_field', type: 'text', label: 'Notes'),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: <String, Object?>{'notes_field': 'Not OK'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
    });
  });

  group('what genuinely DOES block submission', () {
    test('a required, empty field blocks', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'km',
            type: 'number',
            label: 'Odometer',
            required: true,
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'km': ''},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isFalse);
      expect(gate.fieldErrors, contains('km'));
    });

    test('a required photo field blocks until evidence is attached', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'evidence',
            type: 'photo',
            label: 'Evidence',
            required: true,
          ),
        ],
      );

      final ChecklistSubmitGate missing = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );
      final ChecklistSubmitGate attached = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
        photoCounts: const <String, int>{'evidence': 1},
      );

      expect(missing.canSubmit, isFalse);
      expect(missing.fieldErrors, contains('evidence'));
      expect(attached.canSubmit, isTrue);
    });

    test('configured per-field minimum photo count is enforced', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'damage',
            type: 'select',
            label: 'Damage',
            options: <String>['OK', 'Defect'],
            allowPhoto: true,
            extra: <String, dynamic>{'min_photos': 2},
          ),
        ],
      );
      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'damage': 'Defect'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
        photoCounts: const <String, int>{'damage': 1},
      );
      expect(gate.canSubmit, isFalse);
      expect(gate.fieldErrors['damage'], contains('2'));
    });

    test('the SAME required field, hidden by visibleWhen, does not block', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(id: 'towed', type: 'boolean', label: 'Towed?'),
          ChecklistField(
            id: 'tow_reason',
            type: 'text',
            label: 'Reason',
            required: true,
            visibleWhen: <ChecklistVisibleCondition>[
              ChecklistVisibleCondition(field: 'towed', op: '=', value: true),
            ],
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'towed': false},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
    });

    test('a mark that demands a remark, with none given, blocks', () {
      final ChecklistTemplate template = _templateWithLegend(
        fields: const <ChecklistField>[
          ChecklistField(
            id: 'brakes',
            type: 'select',
            label: 'Brakes',
            optionsRef: 'legend',
            requireNoteWhen: <String>['Not OK'],
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: <String, Object?>{'brakes': 'Not OK'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isFalse);
      expect(gate.missingNotes, hasLength(1));
      expect(gate.missingNotes.single.id, 'brakes');
    });

    test('supplying the remark clears the block', () {
      final ChecklistTemplate template = _templateWithLegend(
        fields: const <ChecklistField>[
          ChecklistField(
            id: 'brakes',
            type: 'select',
            label: 'Brakes',
            optionsRef: 'legend',
            requireNoteWhen: <String>['Not OK'],
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: <String, Object?>{'brakes': 'Not OK'},
        notes: <String, Object?>{'brakes': 'Pad worn to the wear line'},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
      expect(gate.missingNotes, isEmpty);
    });

    test('a group_require_one group with no member answered blocks', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'odo_km',
            type: 'number',
            label: 'Odometer',
            groupRequireOne: 'meter',
          ),
          ChecklistField(
            id: 'odo_hrs',
            type: 'number',
            label: 'Hours',
            groupRequireOne: 'meter',
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'odo_km': '', 'odo_hrs': ''},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isFalse);
      expect(gate.unsatisfiedGroups, hasLength(1));
    });

    test(
        'a value of 0 on either member of the group satisfies it - zero '
        'is a reading', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'odo_km',
            type: 'number',
            label: 'Odometer',
            groupRequireOne: 'meter',
          ),
          ChecklistField(
            id: 'odo_hrs',
            type: 'number',
            label: 'Hours',
            groupRequireOne: 'meter',
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'odo_km': 0, 'odo_hrs': ''},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isTrue);
    });

    test('a required signature field with no mark blocks', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'sign_mechanic',
            type: 'signature',
            label: 'Mechanic',
            required: true,
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
      );

      expect(gate.canSubmit, isFalse);
      expect(gate.signatureFieldErrors, contains('sign_mechanic'));
    });

    test('signing the field clears its own block', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(
            id: 'sign_mechanic',
            type: 'signature',
            label: 'Mechanic',
            required: true,
          ),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{},
        notes: const <String, Object?>{},
        signatures: <String, Object?>{'sign_mechanic': '<svg></svg>'},
      );

      expect(gate.canSubmit, isTrue);
    });

    test(
        'a template flagged require_signature with no field pad and no '
        'signed field blocks', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(id: 'x', type: 'text', label: 'X'),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'x': 'ok'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
        templateRequiresSignature: true,
      );

      expect(gate.canSubmit, isFalse);
      expect(gate.primarySignatureOk, isFalse);
    });

    test(
        'the template-level pad satisfies require_signature with no '
        'signature field on the template at all', () {
      const ChecklistTemplate template = ChecklistTemplate(
        fields: <ChecklistField>[
          ChecklistField(id: 'x', type: 'text', label: 'X'),
        ],
      );

      final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
        template: template,
        answers: const <String, Object?>{'x': 'ok'},
        notes: const <String, Object?>{},
        signatures: const <String, Object?>{},
        templateRequiresSignature: true,
        primarySignature: '<svg></svg>',
      );

      expect(gate.canSubmit, isTrue);
    });
  });

  test('canSubmit is true for a template with no fields at all', () {
    const ChecklistTemplate template = ChecklistTemplate();
    final ChecklistSubmitGate gate = evaluateChecklistSubmitGate(
      template: template,
      answers: const <String, Object?>{},
      notes: const <String, Object?>{},
      signatures: const <String, Object?>{},
    );
    expect(gate.canSubmit, isTrue);
  });
}
