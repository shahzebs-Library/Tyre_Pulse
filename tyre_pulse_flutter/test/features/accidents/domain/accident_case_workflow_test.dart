import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_workflow.dart';
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
}

AccidentRecord _record({num? completionOverall}) => AccidentRecord(
      id: 'acc-workflow-1',
      referenceNo: 'ACC-2026-0182',
      assetNo: 'Mixer 3208',
      site: 'Diriyah',
      incidentDate: '2026-05-11 08:15',
      completionOverall: completionOverall,
      photos: const <String>['tp-storage://accident/photo-1.jpg'],
    );
