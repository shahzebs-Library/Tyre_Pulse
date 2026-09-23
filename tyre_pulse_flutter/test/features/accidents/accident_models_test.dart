import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/data/accident_dto.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

void main() {
  group('accidentWorkstreamChipFor', () {
    test('matches all verified status buckets', () {
      expect(
        accidentWorkstreamChipFor('completed'),
        AccidentWorkstreamChip.done,
      );
      expect(
        accidentWorkstreamChipFor('not_required'),
        AccidentWorkstreamChip.notRequired,
      );
      expect(
        accidentWorkstreamChipFor('cancelled'),
        AccidentWorkstreamChip.notRequired,
      );
      expect(
        accidentWorkstreamChipFor('not_started'),
        AccidentWorkstreamChip.pending,
      );
      expect(
        accidentWorkstreamChipFor('rejected'),
        AccidentWorkstreamChip.pending,
      );
      for (final String token in <String>[
        'assigned',
        'in_progress',
        'waiting_info',
        'waiting_approval',
        'waiting_external',
        'on_hold',
        'reopened',
      ]) {
        expect(
          accidentWorkstreamChipFor(token),
          AccidentWorkstreamChip.inProgress,
        );
      }
    });

    test('not applicable wins and unknown remains pending', () {
      expect(
        accidentWorkstreamChipFor('completed', notApplicable: true),
        AccidentWorkstreamChip.notRequired,
      );
      expect(
        accidentWorkstreamChipFor('future_token'),
        AccidentWorkstreamChip.pending,
      );
      expect(accidentWorkstreamChipFor(null), AccidentWorkstreamChip.pending);
    });
  });

  test('DTO keeps independent status concepts and unknown recovery vocabulary',
      () {
    final AccidentRecord record = const AccidentDto(<String, dynamic>{
      'id': '12345678-aaaa',
      'asset_no': 'PMP-01',
      'site': 'Riyadh',
      'incident_date': '2026-08-28',
      'status': 'under_review',
      'workflow_stage': 'workshop_assessment',
      'closure_status': 'pending_closure',
      'case_status': 'assessment_in_progress',
      'recovery_status': 'Yes',
      'damage_condition': 'major_body_damage',
      'estimated_damage_cost': 46900,
      'driver_name': 'Salim R.',
      'injuries': false,
      'injury_count': 0,
      'third_party_involved': 'true',
      'police_report_no': 'DUB-2026-88142',
      'najm_status': 'received',
      'najm_fault': 'other_party',
      'taqdeer_status': 'pending',
      'taqdeer_no': 'TQD-994',
      'workshop_location': 'Dubai Industrial City',
      'deductible': 1500,
      'amount_transfer': 24000,
      'photos': <String>['tp-storage://accident/a.jpg'],
    }).toDomain();

    expect(record.status, 'under_review');
    expect(record.workflowStage, 'workshop_assessment');
    expect(record.closureStatus, 'pending_closure');
    expect(record.caseStatus, 'assessment_in_progress');
    expect(record.recoveryStatus, 'Yes');
    expect(record.damageCondition, 'major_body_damage');
    expect(record.estimatedDamageCost, 46900);
    expect(record.driverName, 'Salim R.');
    expect(record.injuries, isFalse);
    expect(record.injuryCount, 0);
    expect(record.thirdPartyInvolved, isTrue);
    expect(record.policeReportNo, 'DUB-2026-88142');
    expect(record.najmStatus, 'received');
    expect(record.najmFault, 'other_party');
    expect(record.taqdeerStatus, 'pending');
    expect(record.taqdeerNo, 'TQD-994');
    expect(record.workshopLocation, 'Dubai Industrial City');
    expect(record.deductible, 1500);
    expect(record.amountTransfer, 24000);
    expect(record.photos, hasLength(1));
  });

  test('report validity requires asset, site, narrative and evidence', () {
    const AccidentReportInput valid = AccidentReportInput(
      assetNo: 'PMP-01',
      site: 'Riyadh',
      description: 'Rear panel damaged',
      incidentDate: '2026-08-28',
      photoPaths: <String>['/evidence/a.jpg'],
    );
    expect(valid.isValid, isTrue);
    expect(
      const AccidentReportInput(
        assetNo: 'PMP-01',
        site: 'Riyadh',
        description: 'Rear panel damaged',
        incidentDate: '2026-08-28',
        photoPaths: <String>[],
      ).isValid,
      isFalse,
    );
  });
}
