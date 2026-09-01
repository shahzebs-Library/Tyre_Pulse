import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_report_intake.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';

const VehicleAsset _vehicle = VehicleAsset(
  id: 'vehicle-1',
  assetNo: 'CP3012',
  make: 'SANY',
  model: 'SYG5360THB',
  vehicleType: 'Concrete pump',
  site: 'Diriyah',
  status: 'Active',
  operatorName: 'Driver One',
  currentKm: 128400,
  registrationNo: 'ABC 1234',
);

AccidentReportIntakeDraft _validDraft({
  AccidentDamageMap damageMap = const AccidentDamageMap.empty(),
  Map<String, String> evidencePaths = const <String, String>{
    'photo_scene': 'scene.jpg',
  },
  String driverStatement = '',
  bool? policeNotified,
  String policeReportNo = '',
  bool thirdPartyInvolved = false,
  bool? thirdPartyInvoiceAvailable,
  String thirdPartyInvoiceNumber = '',
}) =>
    AccidentReportIntakeDraft(
      vehicle: _vehicle,
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      incidentSite: 'Diriyah',
      accidentType: 'collision',
      narrative: 'Vehicle contacted a barrier.',
      driverName: 'Driver One',
      passengersInvolved: false,
      injuries: false,
      emergencyServices: false,
      vehicleMovable: true,
      recoveryRequired: false,
      safeToOperate: false,
      authorityInvolved: false,
      thirdPartyInvolved: thirdPartyInvolved,
      thirdPartyName: thirdPartyInvolved ? 'Other Driver' : '',
      thirdPartyPlate: thirdPartyInvolved ? 'XYZ 9087' : '',
      thirdPartyContact: thirdPartyInvolved ? '+966500000000' : '',
      thirdPartyInvoiceAvailable: thirdPartyInvoiceAvailable,
      thirdPartyInvoiceNumber: thirdPartyInvoiceNumber,
      policeNotified: policeNotified,
      policeReportNo: policeReportNo,
      najmNotified: false,
      driverStatement: driverStatement,
      damageMap: damageMap,
      evidencePaths: evidencePaths,
    );

void main() {
  test('reporter intake has five distinct steps', () {
    expect(
      AccidentReportStep.values,
      <AccidentReportStep>[
        AccidentReportStep.incident,
        AccidentReportStep.peopleAuthority,
        AccidentReportStep.damage,
        AccidentReportStep.evidenceDocuments,
        AccidentReportStep.review,
      ],
    );
  });

  test('incident step validates asset and incident facts together', () {
    final AccidentReportIntakeDraft draft = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
    );

    expect(
      draft.validationMessagesFor(AccidentReportStep.incident),
      <String>[
        'Select a fleet asset or enter an asset number.',
        'Incident site is required.',
        'Select an event type.',
        'Describe what happened.',
      ],
    );
  });

  test('evidence is one overview plus one exact selected damage area', () {
    final AccidentDamageMap damage = AccidentDamageMap.fromMarks(
      const <AccidentDamageMark>[
        AccidentDamageMark(
          zoneId: 'left_rear_door',
          view: AccidentDamageView.left,
          normalizedX: .48,
          normalizedY: .54,
          areaLabel: 'Left rear door',
          severity: AccidentDamageSeverity.moderate,
          damageType: AccidentDamageType.dent,
        ),
        AccidentDamageMark(
          zoneId: 'front_bumper',
          view: AccidentDamageView.front,
          normalizedX: .40,
          normalizedY: .78,
          areaLabel: 'Front bumper',
          severity: AccidentDamageSeverity.severe,
          damageType: AccidentDamageType.broken,
        ),
      ],
    );
    final AccidentReportIntakeDraft draft = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      accidentType: 'total_loss',
      injuries: true,
      damageMap: damage,
    );

    final List<AccidentEvidenceRequirement> requirements =
        evidenceRequirementsFor(draft);
    expect(requirements, hasLength(3));
    expect(
      requirements.map((AccidentEvidenceRequirement item) => item.key),
      <String>[
        'photo_scene',
        'photo_damage_left_rear_door',
        'photo_damage_front_bumper',
      ],
    );
    expect(
      requirements.map((AccidentEvidenceRequirement item) => item.label),
      <String>[
        'Scene overview',
        'Left - Left rear door',
        'Front - Front bumper',
      ],
    );
    expect(requirements[1].damageZoneId, 'left_rear_door');
    expect(requirements[2].damageZoneId, 'front_bumper');
  });

  test('other-party photos are conditional and no route photos are added', () {
    final AccidentReportIntakeDraft noThirdParty = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      accidentType: 'tyre_wheel',
      thirdPartyInvolved: false,
    );
    final AccidentReportIntakeDraft thirdParty = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      accidentType: 'third_party_property',
      thirdPartyInvolved: true,
    );

    expect(
      evidenceRequirementsFor(noThirdParty)
          .map((AccidentEvidenceRequirement item) => item.key),
      <String>['photo_scene'],
    );
    expect(
      evidenceRequirementsFor(thirdParty)
          .map((AccidentEvidenceRequirement item) => item.key),
      <String>[
        'photo_scene',
        'photo_other_party_vehicle',
        'photo_other_party_plate',
      ],
    );
  });

  test('a photo attached to its damage mark satisfies that requirement', () {
    final AccidentDamageMap damage = AccidentDamageMap.fromMarks(
      const <AccidentDamageMark>[
        AccidentDamageMark(
          zoneId: 'right_front_door',
          view: AccidentDamageView.right,
          normalizedX: .24,
          normalizedY: .46,
          areaLabel: 'Right front door',
          severity: AccidentDamageSeverity.moderate,
          damageType: AccidentDamageType.scratch,
          photoReferences: <String>['right-door.jpg'],
        ),
      ],
    );
    final AccidentReportIntakeDraft draft = _validDraft(damageMap: damage);
    final List<AccidentEvidenceRequirement> requirements =
        evidenceRequirementsFor(draft);

    expect(draft.completedEvidenceCount(requirements), 2);
    expect(
      draft.validationMessagesFor(AccidentReportStep.evidenceDocuments),
      isEmpty,
    );
  });

  test('missing selected-area photo blocks evidence, optional docs do not', () {
    final AccidentDamageMap damage = AccidentDamageMap.fromMarks(
      const <AccidentDamageMark>[
        AccidentDamageMark(
          zoneId: 'top_boom_section_3',
          view: AccidentDamageView.top,
          normalizedX: .50,
          normalizedY: .45,
          areaLabel: 'Boom section 3',
          severity: AccidentDamageSeverity.severe,
          damageType: AccidentDamageType.cracked,
        ),
      ],
    );
    final AccidentReportIntakeDraft missingDamagePhoto =
        _validDraft(damageMap: damage);

    expect(
      missingDamagePhoto.validationMessagesFor(
        AccidentReportStep.evidenceDocuments,
      ),
      <String>['1 required photograph(s) are still missing.'],
    );
    expect(_validDraft().isReadyToSubmit, isTrue);
  });

  test('optional document list uses only the corrected Saudi documents', () {
    expect(
      accidentOptionalDocuments
          .map((AccidentEvidenceRequirement item) => (item.key, item.label)),
      <(String, String)>[
        ('doc_driving_licence', 'Driving licence'),
        ('doc_iqama', 'Iqama'),
        ('doc_istimara', 'Istimara'),
        ('doc_najm_report', 'Najm report'),
        ('doc_taqdeer_report', 'Taqdeer report'),
      ],
    );
    expect(
      accidentOptionalDocuments
          .every((AccidentEvidenceRequirement item) => !item.mandatory),
      isTrue,
    );
  });

  test('police and driver-statement legacy fields do not gate submission', () {
    final AccidentReportIntakeDraft draft = _validDraft(
      driverStatement: '',
      policeNotified: null,
      policeReportNo: '',
    );

    expect(
      draft.validationMessagesFor(AccidentReportStep.peopleAuthority),
      isEmpty,
    );
    expect(draft.validationMessagesFor(AccidentReportStep.review), isEmpty);
    expect(draft.isReadyToSubmit, isTrue);
  });

  test('third-party invoice is optional but its number is required when yes',
      () {
    final AccidentReportIntakeDraft notAnswered = _validDraft(
      thirdPartyInvolved: true,
    );
    final AccidentReportIntakeDraft yesWithoutNumber = _validDraft(
      thirdPartyInvolved: true,
      thirdPartyInvoiceAvailable: true,
    );
    final AccidentReportIntakeDraft yesWithNumber = _validDraft(
      thirdPartyInvolved: true,
      thirdPartyInvoiceAvailable: true,
      thirdPartyInvoiceNumber: 'INV-4482',
    );

    expect(
      notAnswered.validationMessagesFor(AccidentReportStep.peopleAuthority),
      isEmpty,
    );
    expect(
      yesWithoutNumber.validationMessagesFor(
        AccidentReportStep.peopleAuthority,
      ),
      contains('Record the third-party invoice number.'),
    );
    expect(
      yesWithNumber.validationMessagesFor(AccidentReportStep.peopleAuthority),
      isEmpty,
    );
  });

  test('legacy JSON reads old fields and aliases supported document paths', () {
    final AccidentReportIntakeDraft restored =
        AccidentReportIntakeDraft.fromJson(<String, dynamic>{
      'incidentAt': '2026-08-30T09:15:00.000',
      'policeNotified': true,
      'policeReportNo': 'POL-99',
      'driverStatement': 'Legacy statement',
      'thirdPartyInvoiceAvailable': true,
      'thirdPartyInvoiceNumber': 'INV-99',
      'evidencePaths': <String, dynamic>{
        'doc_driver_license': 'licence.jpg',
        'doc_resident_id': 'iqama.jpg',
        'doc_vehicle_registration': 'istimara.jpg',
        'doc_driver_statement': 'statement.pdf',
        'doc_authority_report': 'police.pdf',
      },
    });

    expect(restored.policeNotified, isTrue);
    expect(restored.policeReportNo, 'POL-99');
    expect(restored.driverStatement, 'Legacy statement');
    expect(restored.thirdPartyInvoiceAvailable, isTrue);
    expect(restored.thirdPartyInvoiceNumber, 'INV-99');
    expect(restored.evidencePaths['doc_driving_licence'], 'licence.jpg');
    expect(restored.evidencePaths['doc_iqama'], 'iqama.jpg');
    expect(restored.evidencePaths['doc_istimara'], 'istimara.jpg');
    expect(restored.evidencePaths['doc_driver_statement'], 'statement.pdf');
    expect(restored.evidencePaths['doc_authority_report'], 'police.pdf');
  });

  test('round trip preserves exact damage evidence and Finder audit metadata',
      () {
    final DateTime reviewedAt = DateTime.utc(2026, 8, 30, 9, 22);
    final AccidentDamageMark mark = AccidentDamageMark(
      zoneId: 'left:0.2500:0.5000',
      severity: AccidentDamageSeverity.moderate,
      damageType: AccidentDamageType.scratch,
      view: AccidentDamageView.left,
      normalizedX: .25,
      normalizedY: .5,
      areaLabel: 'Left door',
      note: 'Paint removed',
      photoReferences: const <String>['draft-photo-1.jpg'],
      suggestion: AccidentDamageSuggestion(
        source: 'finder',
        confidence: .91,
        suggestedType: AccidentDamageType.dent,
        suggestedArea: 'Left door',
        decision: AccidentDamageSuggestionDecision.corrected,
        reviewedBy: 'reporter-1',
        reviewedAt: reviewedAt,
        correctionNote: 'Scratch, not dent',
      ),
    );
    final AccidentReportIntakeDraft original = _validDraft(
      damageMap: AccidentDamageMap.fromMarks(<AccidentDamageMark>[mark]),
      evidencePaths: const <String, String>{
        'photo_scene': 'scene.jpg',
        'doc_iqama': 'iqama.jpg',
      },
    );

    final AccidentReportIntakeDraft restored =
        AccidentReportIntakeDraft.fromJson(original.toJson());

    expect(restored.vehicle, _vehicle);
    expect(restored.damageMap, original.damageMap);
    expect(restored.damageMap.marks.single.photoReferences, <String>[
      'draft-photo-1.jpg',
    ]);
    expect(restored.damageMap.marks.single.suggestion?.reviewedAt, reviewedAt);
    expect(restored.evidencePaths['photo_scene'], 'scene.jpg');
    expect(restored.evidencePaths['doc_iqama'], 'iqama.jpg');
  });

  test('submission notes omit police and driver statement but include invoice',
      () {
    final AccidentReportIntakeDraft draft = _validDraft(
      driverStatement: 'Legacy statement must not be submitted.',
      policeNotified: true,
      policeReportNo: 'POL-99',
      thirdPartyInvolved: true,
      thirdPartyInvoiceAvailable: true,
      thirdPartyInvoiceNumber: 'INV-4482',
    );

    final String notes = draft.composeSubmissionNotes();
    expect(notes, isNot(contains('Police notified:')));
    expect(notes, isNot(contains('Police report:')));
    expect(notes, isNot(contains('Driver statement:')));
    expect(notes, contains('Third-party invoice available: Yes'));
    expect(notes, contains('Third-party invoice number: INV-4482'));
    expect(notes, contains('Najm notified: No'));
  });
}
