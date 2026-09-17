import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_vocab.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

void main() {
  group('accident_case_vocab mirrors the owner mock screens', () {
    test('report wizard has 7 numbered steps starting at Identify asset', () {
      expect(reportWizardSteps, hasLength(7));
      expect(reportWizardSteps.first.n, 1);
      expect(reportWizardSteps.first.label, 'Identify asset');
      expect(
        reportWizardSteps.map((NumberedStep s) => s.n).toList(),
        <int>[1, 2, 3, 4, 5, 6, 7],
      );
    });

    test('case flow numbers 7 workstreams; server keys exist', () {
      expect(caseFlow, hasLength(7));
      for (final NumberedStep step in caseFlow) {
        if (step.key == 'damage_map' || step.key == 'timeline') continue;
        expect(
          accidentWorkstreamOrder,
          contains(step.key),
          reason: '${step.key} must be a live workstream_key',
        );
      }
      expect(caseFlowLabel('insurance'), 'Workstream 3 of 7');
      expect(caseFlowLabel('fleet_validation'), 'Workstream 1 of 7');
      expect(caseFlowLabel('nope'), '');
      expect(caseFlowStep('handover')?.n, 6);
    });

    test('fault tiles derive the mock fault status; unset pct is undecided',
        () {
      expect(
        faultTiles.map((FaultTile t) => t.label).toList(),
        <String>[
          'Our driver / GCC',
          'Other party',
          'Shared fault',
          'Under investigation',
          'Not applicable',
        ],
      );
      expect(faultStatusFor('third_party_full', 0), 'Non-faulty');
      expect(faultStatusFor('our_driver_full', 100), 'Faulty');
      expect(faultStatusFor('under_investigation', null), 'Under review');
      expect(faultStatusFor('shared', null), '');
    });

    test('payer tiles are the 6 mock options', () {
      expect(payerTiles.map((VocabItem p) => p.label).toList(), <String>[
        'Other party insurance',
        'Our insurance',
        'GCC / company',
        'Driver recovery',
        'Warranty',
        'Pending decision',
      ]);
      expect(recoveryRequiredFor('other_party_insurance'), isTrue);
      expect(recoveryRequiredFor('company'), isFalse);
      expect(payerLabel('warranty'), 'Warranty');
      expect(payerLabel('unknown'), '');
    });

    test('document sets match the mock counts', () {
      expect(responsibilityDocs, hasLength(7));
      expect(
        responsibilityDocs.where((VocabItem d) => d.required),
        hasLength(6),
      );
      expect(claimPackageDocs, hasLength(8));
      expect(fleetValidationItems, hasLength(6));
      expect(assessmentAttachments, hasLength(4));
    });

    test('damage vocabulary: 7 types, Major label on severe, 200-char note',
        () {
      expect(damageTypes.map((VocabItem d) => d.label).toList(), <String>[
        'Dent',
        'Scratch',
        'Cracked',
        'Broken',
        'Missing',
        'Bent',
        'Other',
      ]);
      expect(canonDamageType('Crack'), 'cracked');
      expect(canonDamageType('BENT'), 'bent');
      expect(canonDamageType('panel/body'), 'other');
      expect(canonDamageType(''), '');
      expect(
        damageLevels.firstWhere((VocabItem l) => l.key == 'severe').label,
        'Major',
      );
      expect(damageNoteMax, 200);
      expect(familyViewOrder['bus'], <String>[
        'left',
        'front_left',
        'front',
        'right',
        'rear',
        'top',
      ]);
      expect(familyViewOrder['concrete_pump']?.first, 'top');
      for (final List<String> views in familyViewOrder.values) {
        for (final String v in views) {
          expect(viewLabels.containsKey(v), isTrue, reason: v);
        }
      }
    });

    test('no em or en dashes in any label', () {
      final Iterable<String> labels = <String>[
        ...reportWizardSteps.map((NumberedStep s) => s.label),
        ...caseFlow.map((NumberedStep s) => s.label),
        ...faultTiles.map((FaultTile t) => t.label),
        ...payerTiles.map((VocabItem p) => p.label),
        ...responsibilityDocs.map((VocabItem d) => d.label),
        ...claimPackageDocs.map((VocabItem d) => d.label),
        ...fleetValidationItems.map((VocabItem d) => d.label),
        ...dispatchStepper.map((NumberedStep s) => s.label),
        ...damageTypes.map((VocabItem d) => d.label),
        ...viewLabels.values,
      ];
      for (final String label in labels) {
        expect(label.contains('–') || label.contains('—'), isFalse);
      }
    });
  });
}
