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
      'photos': <String>['tp-storage://accident/a.jpg'],
    }).toDomain();

    expect(record.status, 'under_review');
    expect(record.workflowStage, 'workshop_assessment');
    expect(record.closureStatus, 'pending_closure');
    expect(record.caseStatus, 'assessment_in_progress');
    expect(record.recoveryStatus, 'Yes');
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
