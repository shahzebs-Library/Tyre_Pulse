import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/report_issue/data/report_issue_draft_store.dart';

void main() {
  test('incident time survives draft serialization as the same UTC instant',
      () {
    final incident = DateTime(2026, 9, 6, 14, 35);
    final draft = ReportIssueDraft(
      title: 'Leak',
      site: 'Yard',
      assetNo: 'ASSET-1',
      description: 'Oil below engine',
      restriction: '',
      priority: 'Medium',
      category: 'mechanical',
      operation: 'no',
      requestWorkOrder: true,
      photoLocalPaths: const [],
      savedAt: DateTime.now(),
      incidentAt: incident,
    );
    final restored = ReportIssueDraft.fromJson(draft.toJson());
    expect(restored.incidentAt, incident.toUtc());
    expect(restored.description, draft.description);
    expect(restored.assetNo, draft.assetNo);
  });

  test('older drafts retain an unknown incident time rather than inventing one',
      () {
    final draft = ReportIssueDraft.fromJson({
      'title': 'Existing report',
      'savedAt': '2026-08-30T10:00:00Z',
    });
    expect(draft.incidentAt, isNull);
    expect(draft.title, 'Existing report');
  });
}
