import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow_preview.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

void main() {
  group('AccidentCaseWorkflowProjection', () {
    test('uses only the recorded server completion percentage', () {
      final AccidentCaseWorkflowProjection projection =
          AccidentCaseWorkflowProjection(
        AccidentCaseSnapshot(
          accident: _record(completionOverall: 64.25),
          provisioned: true,
          workstreams: const <AccidentWorkstream>[
            AccidentWorkstream(
              id: 'completed-1',
              key: 'incident_evidence',
              status: 'completed',
            ),
            AccidentWorkstream(
              id: 'completed-2',
              key: 'fleet_validation',
              status: 'completed',
            ),
            AccidentWorkstream(
              id: 'pending',
              key: 'repair',
              status: 'not_started',
            ),
          ],
        ),
      );

      // Two completed rows out of three would be 66.67%. The projection must
      // preserve the independently recorded route value instead.
      expect(projection.recordedCompletionPercent, 64.25);
    });

    test('rejects absent, non-finite and out-of-range completion values', () {
      for (final num? value in <num?>[
        null,
        -0.01,
        100.01,
        double.nan,
        double.infinity,
      ]) {
        final AccidentCaseWorkflowProjection projection =
            AccidentCaseWorkflowProjection(
          AccidentCaseSnapshot(
            accident: _record(completionOverall: value),
            provisioned: true,
          ),
        );

        expect(
          projection.recordedCompletionPercent,
          isNull,
          reason: 'Invalid server value $value must remain unavailable.',
        );
      }
    });

    test('selects a real active owner and preserves truthful update dates', () {
      final DateTime older = DateTime.utc(2026, 5, 11, 9);
      final DateTime newer = DateTime.utc(2026, 5, 12, 10);
      final AccidentCaseWorkflowProjection projection =
          AccidentCaseWorkflowProjection(
        AccidentCaseSnapshot(
          accident: _record(),
          provisioned: true,
          workstreams: <AccidentWorkstream>[
            const AccidentWorkstream(
              id: 'pending-first',
              key: 'repair',
              status: 'not_started',
              ownerRole: 'Workshop Planner',
            ),
            AccidentWorkstream(
              id: 'in-progress',
              key: 'insurance',
              status: 'waiting_external',
              ownerRole: 'Insurance Claims Officer',
              updatedAt: newer,
            ),
            AccidentWorkstream(
              id: 'done',
              key: 'fleet_validation',
              status: 'completed',
              updatedAt: older,
            ),
            const AccidentWorkstream(
              id: 'undated',
              key: 'liability',
              status: 'in_progress',
            ),
          ],
        ),
      );

      expect(projection.activeWorkstream?.id, 'in-progress');
      expect(
        projection.datedUpdates.map((AccidentWorkstream item) => item.id),
        <String>['in-progress', 'done'],
      );
      expect(projection.workstream('repair')?.id, 'pending-first');
      expect(
        projection
            .matching(<String>['fleet_validation', 'missing', 'insurance']).map(
          (AccidentWorkstream item) => item.key,
        ),
        <String>['fleet_validation', 'insurance'],
      );
    });
  });

  group('AccidentCaseWorkflowPreview', () {
    test('verified case fields take precedence over deterministic seed data',
        () {
      final AccidentCaseWorkflowPreview preview =
          AccidentCaseWorkflowPreview.fromSnapshot(
        AccidentCaseSnapshot(
          accident: _record(
            faultStatus: 'shared liability',
            payer: 'our insurance',
            repairType: 'external workshop',
            insurer: '  Verified Insurer  ',
            policyNo: '  POL-REAL-42  ',
            insuranceClaimNo: '  CLM-REAL-18  ',
            claimAmount: 41000.75,
            claimApprovedAmount: 38000.25,
            recoveredAmount: 12500.5,
            repairCost: 21999.95,
          ),
          provisioned: true,
        ),
      );

      expect(preview.liability, AccidentLiabilityChoice.shared);
      expect(preview.payer, AccidentPayerChoice.ourInsurance);
      expect(preview.repairRoute, AccidentRepairRoute.externalWorkshop);
      expect(preview.insurer, 'Verified Insurer');
      expect(preview.policyNumber, 'POL-REAL-42');
      expect(preview.claimNumber, 'CLM-REAL-18');
      expect(preview.claimAmount, 41000.75);
      expect(preview.approvedAmount, 38000.25);
      expect(preview.recoveredAmount, 12500.5);
      expect(preview.repairEstimate, 21999.95);
      expect(preview.unrecoveredAmount, 25499.75);
    });

    test('exposes the complete liability, payer and repair route choices', () {
      expect(AccidentLiabilityChoice.values, <AccidentLiabilityChoice>[
        AccidentLiabilityChoice.ourDriverGcc,
        AccidentLiabilityChoice.otherParty,
        AccidentLiabilityChoice.shared,
        AccidentLiabilityChoice.underInvestigation,
        AccidentLiabilityChoice.notApplicable,
      ]);
      expect(AccidentPayerChoice.values, <AccidentPayerChoice>[
        AccidentPayerChoice.otherPartyInsurance,
        AccidentPayerChoice.ourInsurance,
        AccidentPayerChoice.gccCompany,
        AccidentPayerChoice.driverRecovery,
        AccidentPayerChoice.warranty,
        AccidentPayerChoice.pending,
      ]);
      expect(AccidentRepairRoute.values, <AccidentRepairRoute>[
        AccidentRepairRoute.internalWorkshop,
        AccidentRepairRoute.authorisedDealer,
        AccidentRepairRoute.externalWorkshop,
        AccidentRepairRoute.onSiteRepair,
        AccidentRepairRoute.totalLoss,
      ]);
    });

    test('contains every required case document and named accountable actor',
        () {
      final AccidentCaseWorkflowPreview preview =
          AccidentCaseWorkflowPreview.fromSnapshot(
        AccidentCaseSnapshot(accident: _record(), provisioned: true),
      );
      final Map<String, AccidentWorkflowPreviewDocument> documents =
          <String, AccidentWorkflowPreviewDocument>{
        for (final AccidentWorkflowPreviewDocument document
            in preview.documents)
          document.labelKey: document,
      };

      expect(documents.keys, <String>[
        'policeReport',
        'najmReport',
        'taqdeerAssessment',
        'thirdPartyRegistration',
        'thirdPartyPolicy',
        'drivingLicence',
        'companyUndertaking',
        'vehicleRegistration',
        'accidentPhotos',
        'workshopAssessmentDocument',
      ]);
      expect(documents['companyUndertaking']?.required, isFalse);
      expect(
        documents.entries
            .where(
              (MapEntry<String, AccidentWorkflowPreviewDocument> entry) =>
                  entry.key != 'companyUndertaking',
            )
            .every(
              (MapEntry<String, AccidentWorkflowPreviewDocument> entry) =>
                  entry.value.required,
            ),
        isTrue,
      );
      expect(
        documents.values
            .map((AccidentWorkflowPreviewDocument item) => item.uploadedBy)
            .toSet(),
        containsAll(<String>{'Mr. Ajay', 'Ms. Fatima', 'Eng. Vinay'}),
      );
      expect(
        preview.actors.map((AccidentWorkflowPreviewActor actor) => actor.name),
        <String>[
          'Mr. Ajay',
          'Ms. Fatima',
          'Eng. Vinay',
          'Ms. Mai',
          'PMV Manager',
        ],
      );
    });

    test('orders external handoff before quotation, PO and repair start', () {
      final AccidentCaseWorkflowPreview preview =
          AccidentCaseWorkflowPreview.fromSnapshot(
        AccidentCaseSnapshot(
          accident: _record(repairType: 'external workshop'),
          provisioned: true,
        ),
      );
      final List<AccidentWorkflowPreviewRepairMilestone> milestones =
          preview.repairMilestones;
      final List<String> keys = milestones
          .map(
            (AccidentWorkflowPreviewRepairMilestone item) => item.titleKey,
          )
          .toList(growable: false);

      expect(keys, <String>[
        'vehicleDispatchedMilestone',
        'externalWorkshopArrivalMilestone',
        'vendorQuotationReceivedMilestone',
        'quotationComparedMilestone',
        'purchaseOrderRecordedMilestone',
        'repairStartMilestone',
      ]);
      expect(
        keys.indexOf('purchaseOrderRecordedMilestone'),
        lessThan(keys.indexOf('repairStartMilestone')),
      );
      for (int index = 1; index < 4; index++) {
        expect(milestones[index - 1].occurredAt, isNotNull);
        expect(milestones[index].occurredAt, isNotNull);
        expect(
          milestones[index].occurredAt!.isAfter(
                milestones[index - 1].occurredAt!,
              ),
          isTrue,
        );
      }
      expect(milestones[4].occurredAt, isNull);
      expect(milestones[4].status, AccidentWorkflowPreviewStatus.inProgress);
      expect(milestones[5].occurredAt, isNull);
      expect(milestones[5].status, AccidentWorkflowPreviewStatus.pending);
    });
  });
}

AccidentRecord _record({
  num? completionOverall,
  String? faultStatus,
  String? payer,
  String? repairType,
  String? insurer,
  String? policyNo,
  String? insuranceClaimNo,
  num? claimAmount,
  num? claimApprovedAmount,
  num? recoveredAmount,
  num? repairCost,
}) =>
    AccidentRecord(
      id: 'acc-workflow-1',
      referenceNo: 'ACC-2026-0182',
      assetNo: 'Mixer 3208',
      site: 'Diriyah',
      incidentDate: '2026-05-11 08:15',
      faultStatus: faultStatus,
      payer: payer,
      repairType: repairType,
      insurer: insurer,
      policyNo: policyNo,
      insuranceClaimNo: insuranceClaimNo,
      claimAmount: claimAmount,
      claimApprovedAmount: claimApprovedAmount,
      recoveredAmount: recoveredAmount,
      repairCost: repairCost,
      completionOverall: completionOverall,
      photos: const <String>['tp-storage://accident/photo-1.jpg'],
    );
