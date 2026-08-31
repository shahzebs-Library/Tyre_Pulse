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

void main() {
  test('required evidence follows captured route facts', () {
    final AccidentReportIntakeDraft draft = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      thirdPartyInvolved: true,
      injuries: true,
      accidentType: 'third_party_property',
    );

    final List<AccidentEvidenceRequirement> requirements =
        evidenceRequirementsFor(draft);
    expect(requirements, hasLength(17));
    expect(
      requirements.map((AccidentEvidenceRequirement item) => item.key),
      containsAll(<String>[
        'photo_full_front',
        'photo_other_party_vehicle',
        'photo_other_party_plate',
        'photo_road_condition',
        'photo_property_damage',
      ]),
    );
  });

  test('seed-scoped event types add their configured evidence slot', () {
    const Map<String, String> expectedByType = <String, String>{
      'tyre_wheel': 'photo_tyres_wheels',
      'total_loss': 'photo_chassis_vin',
      'equipment_to_vehicle': 'photo_equipment_attachment',
      'theft': 'photo_chassis_vin_theft',
    };

    for (final MapEntry<String, String> entry in expectedByType.entries) {
      final AccidentReportIntakeDraft draft = AccidentReportIntakeDraft(
        incidentAt: DateTime(2026, 8, 30, 9, 15),
        accidentType: entry.key,
      );
      expect(
        evidenceRequirementsFor(draft)
            .map((AccidentEvidenceRequirement item) => item.key),
        contains(entry.value),
        reason: entry.key,
      );
    }
  });

  test('draft round trip preserves asset, evidence and Finder audit metadata',
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
    final AccidentReportIntakeDraft original = AccidentReportIntakeDraft(
      vehicle: _vehicle,
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      incidentSite: 'Gate 3',
      incidentLocation: 'North access road',
      accidentType: 'collision',
      severity: 'moderate',
      narrative: 'Vehicle contacted a barrier.',
      driverName: 'Driver One',
      passengersInvolved: false,
      injuries: false,
      emergencyServices: false,
      vehicleMovable: true,
      recoveryRequired: false,
      safeToOperate: false,
      authorityInvolved: false,
      thirdPartyInvolved: false,
      policeNotified: false,
      najmNotified: false,
      driverStatement: 'Barrier was not visible in the mirror.',
      damageMap: AccidentDamageMap.fromMarks(<AccidentDamageMark>[mark]),
      evidencePaths: const <String, String>{
        'photo_full_front': 'front.jpg',
      },
      savedAt: DateTime.utc(2026, 8, 30, 9, 30),
    );

    final AccidentReportIntakeDraft restored =
        AccidentReportIntakeDraft.fromJson(original.toJson());

    expect(restored.vehicle, _vehicle);
    expect(restored.damageMap, original.damageMap);
    expect(restored.damageMap.marks.single.photoReferences, <String>[
      'draft-photo-1.jpg',
    ]);
    expect(restored.damageMap.marks.single.suggestion?.reviewedAt, reviewedAt);
    expect(restored.evidencePaths, <String, String>{
      'photo_full_front': 'front.jpg',
    });
    expect(restored.savedAt, original.savedAt);
  });

  test('conditional answers and every required photo gate submission', () {
    final Map<String, String> photos = <String, String>{
      for (final AccidentEvidenceRequirement item
          in accidentBaselinePhotoRequirements)
        item.key: '${item.key}.jpg',
    };
    final AccidentReportIntakeDraft valid = AccidentReportIntakeDraft(
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
      thirdPartyInvolved: false,
      policeNotified: false,
      najmNotified: false,
      driverStatement: 'Barrier was not visible in the mirror.',
      evidencePaths: photos,
    );

    expect(valid.allValidationMessages, isEmpty);
    expect(valid.isReadyToSubmit, isTrue);

    final AccidentReportIntakeDraft incomplete = AccidentReportIntakeDraft(
      incidentAt: DateTime(2026, 8, 30, 9, 15),
      thirdPartyInvolved: true,
      injuries: true,
      authorityInvolved: true,
      authorityReportStatus: 'none',
      policeNotified: true,
      najmNotified: true,
    );
    expect(
      incomplete.allValidationMessages,
      containsAll(<String>[
        'Select a fleet asset or enter an asset number.',
        'Record the injury count and details.',
        'Explain why no authority report exists.',
        'Record the police report number.',
        'Record the Najm reference.',
      ]),
    );
  });
}
