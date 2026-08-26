/// Coverage for the signature half of the submit gate, mirroring
/// `signatureFields` / `validateSignatures` / `requiresPrimarySignature` /
/// `primarySignatureSatisfied` at `mobile/lib/checklistFields.ts:271-364`
/// (`mobile/` is read-only reference material).
library;

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_field.dart';
import 'package:tyre_pulse/features/checklists/domain/checklist_signature_gate.dart';

void main() {
  group('signatureFields', () {
    test('only signature-type fields with a real id are included', () {
      const List<ChecklistField> fields = <ChecklistField>[
        ChecklistField(id: 'sign_a', type: 'signature'),
        ChecklistField(id: '', type: 'signature'),
        ChecklistField(id: 'x', type: 'text'),
        ChecklistField(id: 'sign_b', type: 'signature'),
      ];
      expect(
        signatureFields(fields).map((f) => f.id),
        <String>['sign_a', 'sign_b'],
      );
    });
  });

  group('validateSignatureFields', () {
    test('an unrequired signature field never errors', () {
      const List<ChecklistField> fields = <ChecklistField>[
        ChecklistField(id: 'sign_a', type: 'signature'),
      ];
      expect(
        validateSignatureFields(fields, const <String, Object?>{}),
        isEmpty,
      );
    });

    test('a required, unsigned field errors by id', () {
      const List<ChecklistField> fields = <ChecklistField>[
        ChecklistField(id: 'sign_a', type: 'signature', required: true, label: 'Mechanic'),
      ];
      final Map<String, String> errors =
          validateSignatureFields(fields, const <String, Object?>{});
      expect(errors.keys, <String>['sign_a']);
      expect(errors['sign_a'], contains('Mechanic'));
    });

    test('a hidden required signature field does not error', () {
      const List<ChecklistField> fields = <ChecklistField>[
        ChecklistField(id: 'gate', type: 'boolean'),
        ChecklistField(
          id: 'sign_a',
          type: 'signature',
          required: true,
          visibleWhen: <ChecklistVisibleCondition>[
            ChecklistVisibleCondition(field: 'gate', op: '=', value: true),
          ],
        ),
      ];
      expect(
        validateSignatureFields(
          fields,
          const <String, Object?>{},
          <String, Object?>{'gate': false},
        ),
        isEmpty,
      );
    });

    test('a non-empty signature clears the error', () {
      const List<ChecklistField> fields = <ChecklistField>[
        ChecklistField(id: 'sign_a', type: 'signature', required: true),
      ];
      expect(
        validateSignatureFields(
          fields,
          <String, Object?>{'sign_a': '<svg></svg>'},
        ),
        isEmpty,
      );
    });
  });

  group('requiresPrimarySignature', () {
    test('false/null means no template-level requirement', () {
      expect(requiresPrimarySignature(null), isFalse);
      expect(requiresPrimarySignature(false), isFalse);
    });

    test('true means the requirement is in force', () {
      expect(requiresPrimarySignature(true), isTrue);
    });
  });

  group('primarySignatureSatisfied', () {
    test('always satisfied when the template does not require one', () {
      expect(
        primarySignatureSatisfied(templateRequiresSignature: false, fields: null),
        isTrue,
      );
    });

    test('unsatisfied when required and nothing at all has been signed', () {
      expect(
        primarySignatureSatisfied(
          templateRequiresSignature: true,
          fields: const <ChecklistField>[],
        ),
        isFalse,
      );
    });

    test('the template-level pad alone satisfies it', () {
      expect(
        primarySignatureSatisfied(
          templateRequiresSignature: true,
          fields: const <ChecklistField>[],
          primary: '<svg></svg>',
        ),
        isTrue,
      );
    });

    test('a signed FIELD satisfies it even with no pad', () {
      expect(
        primarySignatureSatisfied(
          templateRequiresSignature: true,
          fields: const <ChecklistField>[ChecklistField(id: 's', type: 'signature')],
          signatures: <String, Object?>{'s': '<svg></svg>'},
        ),
        isTrue,
      );
    });

    test('an empty-string pad does not count as signed', () {
      expect(
        primarySignatureSatisfied(
          templateRequiresSignature: true,
          fields: const <ChecklistField>[],
          primary: '',
        ),
        isFalse,
      );
    });
  });
}
