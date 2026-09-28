import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_case_summary.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';

void main() {
  group('AccidentCaseSummary.fromSnapshot', () {
    test('keeps blanks as blanks and never invents a figure', () {
      final AccidentCaseSummary summary = AccidentCaseSummary.fromSnapshot(
        const AccidentCaseSnapshot(
          accident: AccidentRecord(
            id: 'acc-1',
            assetNo: 'TM-101',
            site: 'Riyadh',
            incidentDate: '2026-09-01',
            referenceNo: 'ACC-2026-0148',
          ),
          provisioned: true,
        ),
      );

      expect(summary.reference, 'ACC-2026-0148');
      expect(summary.completionOverall, isNull);
      expect(summary.workstreams, isEmpty);
      final List<AccidentSummaryLine> lines = <AccidentSummaryLine>[
        for (final AccidentSummarySection section in summary.sections)
          ...section.lines,
      ];
      AccidentSummaryLine line(String key) =>
          lines.firstWhere((AccidentSummaryLine l) => l.labelKey == key);
      expect(line('assetNo').isBlank, isFalse);
      expect(line('insurer').isBlank, isTrue);
      expect(line('claimed').isBlank, isTrue);
      expect(line('injuries').isBlank, isTrue);
      expect(line('claimed').number, isNull);
    });

    test('orders workstreams canonically and keeps server progress', () {
      final AccidentCaseSummary summary = AccidentCaseSummary.fromSnapshot(
        const AccidentCaseSnapshot(
          accident: AccidentRecord(
            id: 'acc-2',
            assetNo: 'MP-7',
            site: 'Jeddah',
            incidentDate: '2026-09-02',
            claimAmount: 0,
            injuries: false,
          ),
          provisioned: true,
          workstreams: <AccidentWorkstream>[
            AccidentWorkstream(id: 'w2', key: 'insurance', status: 'assigned'),
            AccidentWorkstream(
              id: 'w1',
              key: 'fleet_validation',
              status: 'completed',
              progressPct: 100,
            ),
          ],
        ),
      );

      expect(
        summary.workstreams.map((AccidentSummaryWorkstream w) => w.key),
        <String>['fleet_validation', 'insurance'],
      );
      expect(summary.workstreams.first.chip, AccidentWorkstreamChip.done);
      expect(summary.workstreams.last.progressPct, isNull);
      final AccidentSummaryLine claimed = summary.sections
          .expand((AccidentSummarySection s) => s.lines)
          .firstWhere((AccidentSummaryLine l) => l.labelKey == 'claimed');
      expect(claimed.isBlank, isFalse, reason: 'a recorded 0 is a value');
    });

    test('derives a safe file name from the reference', () {
      final AccidentCaseSummary summary = AccidentCaseSummary.fromSnapshot(
        const AccidentCaseSnapshot(
          accident: AccidentRecord(
            id: 'acc-3',
            assetNo: 'A',
            site: 'S',
            incidentDate: '2026-09-03',
            referenceNo: 'ACC/2026:0150',
          ),
          provisioned: false,
        ),
      );
      expect(summary.fileName, 'Accident case summary ACC 2026 0150.pdf');
      expect(summary.workstreamsProvisioned, isFalse);
    });
  });
}
