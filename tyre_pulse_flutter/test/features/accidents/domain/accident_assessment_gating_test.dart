import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_assessment_gating.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_claim_package.dart';

const List<Map<String, Object?>> _areas = <Map<String, Object?>>[
  <String, Object?>{
    'view': 'top',
    'region_key': 'boom_3',
    'region_label': 'Boom section 3',
    'damage_type': 'crack',
    'severity': 'severe',
    'action': 'structural_review',
    'photo_refs': <String>['tp-storage://accident-photos/accidents/u/a.jpg'],
  },
  <String, Object?>{
    'view': 'left',
    'region_key': 'outrigger_lf',
    'region_label': 'Left front outrigger',
    'damage_type': 'bent',
    'severity': 'moderate',
    'action': 'replace',
  },
];

final String _phone = jsonEncode(<String, Object?>{
  'version': 2,
  'marks': <Map<String, Object?>>[
    <String, Object?>{
      'zone_id': 'rear_hopper',
      'view': 'rear',
      'area': 'Rear hopper guard',
      'damage_type': 'broken',
      'severity': 'minor',
      'photo_references': <String>['tp-storage://accident-photos/x/b.jpg'],
    },
    <String, Object?>{
      'zone_id': 'boom',
      'view': 'top',
      'area': 'boom section 3',
      'damage_type': 'dent',
      'severity': 'major',
    },
  ],
});

AccidentEvidenceItem _att(String key) => AccidentEvidenceItem(
      id: key,
      workstreamKey: 'assessment',
      requirementKey: key,
    );

void main() {
  group('mergeDamageRows', () {
    test('lists both sources, assessment first, phone marks de-duplicated', () {
      final List<AssessmentDamageRow> rows = mergeDamageRows(
        damageAreas: _areas,
        damageDescription: _phone,
      );
      expect(rows.length, 3);
      expect(rows[0].component, 'Boom section 3');
      expect(rows[0].source, DamageRowSource.assessment);
      expect(rows[0].damageType, 'cracked');
      expect(rows[0].severity, 'severe');
      expect(rows[0].actionLabel, 'Replace / structural review');
      expect(rows[0].firstPhoto, endsWith('a.jpg'));
      expect(rows[2].component, 'Rear hopper guard');
      expect(rows[2].source, DamageRowSource.phone);
      expect(rows[2].damageTypeLabel, 'Broken');
      expect(rows[2].severityLabel, 'Minor');
      expect(rows[2].action, isNull);
    });

    test('phone severity Major folds to severe; prose is not a mark', () {
      final List<AssessmentDamageRow> phone = damageRowsFromDescription(_phone);
      expect(phone[1].severity, 'severe');
      expect(damageRowsFromDescription('Front bumper scratched'), isEmpty);
      expect(damageRowsFromDescription('{not json'), isEmpty);
      expect(damageRowsFromAreas('nope'), isEmpty);
    });
  });

  group('route and gating', () {
    test('external when any mark is severe or total loss, else internal', () {
      final List<AssessmentDamageRow> rows =
          damageRowsFromAreas(<Map<String, Object?>>[_areas[1]]);
      expect(
        recommendedRepairRoute(rows: rows, totalLossPossible: false),
        'internal',
      );
      expect(
        recommendedRepairRoute(rows: rows, totalLossPossible: true),
        'external',
      );
      expect(
        recommendedRepairRoute(
          rows: damageRowsFromAreas(_areas),
          totalLossPossible: false,
        ),
        'external',
      );
      expect(
        recommendedRouteReason(
          rows: damageRowsFromAreas(_areas),
          totalLossPossible: false,
        ),
        contains('1 major damage area'),
      );
    });

    test('submission needs the vendor quotation only on the external route',
        () {
      final List<AssessmentAttachmentStatus> none =
          assessmentAttachmentStatuses(const <AccidentEvidenceItem>[]);
      final List<AssessmentAttachmentStatus> quoted =
          assessmentAttachmentStatuses(
        <AccidentEvidenceItem>[_att('vendor_quotation')],
      );
      expect(
        canSubmitAssessment(route: 'external', attachments: none),
        isFalse,
      );
      expect(
        canSubmitAssessment(route: 'external', attachments: quoted),
        isTrue,
      );
      expect(canSubmitAssessment(route: 'internal', attachments: none), isTrue);
      expect(canSubmitAssessment(route: 'on_site', attachments: none), isTrue);
    });

    test('attachment rows print Attached / Missing / count', () {
      final List<AssessmentAttachmentStatus> statuses =
          assessmentAttachmentStatuses(<AccidentEvidenceItem>[
        _att('assessment_report_pdf'),
        for (int i = 0; i < 9; i++) _att('damage_photos'),
      ]);
      expect(statuses.length, 4);
      expect(statuses[0].label, 'Attached');
      expect(statuses[1].label, 'Missing');
      expect(statuses[2].label, '9');
      expect(statuses[3].label, 'Missing');
    });
  });

  group('totals and labels', () {
    test('preliminary total and parts availability never fabricate zero', () {
      expect(preliminaryTotal(labourCost: 1200, partsCost: 3400), 4600);
      expect(preliminaryTotal(labourCost: null, partsCost: 3400), 3400);
      expect(preliminaryTotal(labourCost: null, partsCost: null), isNull);
      expect(
        partsAvailabilityLabel(available: 2, specialOrder: 1),
        '2 available · 1 special order',
      );
      expect(partsAvailabilityLabel(), 'Not set');
    });

    test('route and quotation labels', () {
      expect(repairRouteLabel('on_site'), 'On-site repair');
      expect(repairRouteLabel(null), '');
      expect(quotationStatusLabel('requested'), 'Requested');
      expect(quotationStatusLabel(null), 'Not set');
    });
  });
}
