import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/core/design_system/design_system.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/accidents/data/accident_assessment_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_workshop_assessment.dart';

import 'accident_ws_test_support.dart';

final String _phoneMarks = jsonEncode(<String, Object?>{
  'version': 2,
  'marks': <Map<String, Object?>>[
    <String, Object?>{
      'zone_id': 'rear_hopper',
      'view': 'rear',
      'area': 'Rear hopper guard',
      'damage_type': 'broken',
      'severity': 'minor',
    },
    <String, Object?>{
      'zone_id': 'boom',
      'view': 'top',
      'area': 'Boom section 3',
      'damage_type': 'dent',
      'severity': 'moderate',
    },
  ],
});

AccidentRecord _record() => AccidentRecord(
      id: 'case-1',
      assetNo: 'CP045',
      site: 'Verified yard',
      incidentDate: '2026-09-01',
      location: 'Gate 2',
      vehicleType: 'Concrete Pump',
      plateNumber: '1234 ABC',
      damageDescription: _phoneMarks,
    );

AccidentCaseSnapshot _snapshot() => AccidentCaseSnapshot(
      accident: _record(),
      provisioned: true,
      workstreams: const <AccidentWorkstream>[
        AccidentWorkstream(
          id: 'ws',
          key: 'assessment',
          status: 'in_progress',
          ownerRole: 'Workshop Supervisor',
        ),
        AccidentWorkstream(
          id: 'ins',
          key: 'insurance',
          status: 'assigned',
          ownerRole: 'Insurance Officer',
        ),
      ],
    );

const List<Map<String, Object?>> _areas = <Map<String, Object?>>[
  <String, Object?>{
    'view': 'top',
    'region_key': 'boom_3',
    'region_label': 'Boom section 3',
    'damage_type': 'crack',
    'severity': 'severe',
    'action': 'structural_review',
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

void _seedAssessment(FakeAccidentCaseRows rows) {
  rows.seed(SupabaseTables.accidentDamageAssessments, <String, dynamic>{
    'accident_id': 'case-1',
    'damage_areas': _areas,
    'estimated_labour_hours': 16,
    'estimated_labour_cost': 1200,
    'estimated_parts_cost': 3400,
    'assessment_status': 'draft',
    'safe_to_move': false,
    'recovery_required': true,
    'recommended_offroad': true,
    'parts_available_count': 2,
    'parts_special_order_count': 1,
    'route_reason': null,
  });
}

void _seedAttachment(FakeAccidentCaseRows rows, String key) {
  rows.seed(SupabaseTables.accidentEvidence, <String, dynamic>{
    'accident_id': 'case-1',
    'workstream_key': 'assessment',
    'requirement_key': key,
    'kind': 'document',
    'uploaded_at': '2026-09-15T10:00:00Z',
  });
}

List<Override> _overrides(FakeAccidentCaseRows rows) => <Override>[
      accidentAssessmentRepositoryProvider
          .overrideWithValue(AccidentAssessmentRepository(rows)),
    ];

void main() {
  testWidgets(
      'merges assessment and phone marks, recommends external and gates submit',
      (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows();
    _seedAssessment(rows);
    _seedAttachment(rows, 'assessment_report_pdf');
    final List<String> navigated = <String>[];
    await pumpAccidentWorkspace(
      tester,
      AccidentWorkshopAssessmentMockWorkspace(
        snapshot: _snapshot(),
        onNavigate: navigated.add,
      ),
      overrides: _overrides(rows),
    );
    expect(find.text('View damage map · 3 areas'), findsOneWidget);
    expect(find.text('Boom section 3'), findsOneWidget);
    expect(find.text('Left front outrigger'), findsOneWidget);
    expect(find.text('Rear hopper guard'), findsOneWidget);
    expect(find.text('Replace / structural review'), findsOneWidget);
    expect(find.text('Cracked · Major'), findsOneWidget);
    expect(find.text('Verified yard · Gate 2'), findsOneWidget);
    expect(find.text('1234 ABC'), findsOneWidget);
    expect(find.text('Recommended'), findsOneWidget);
    expect(find.text('$testCurrency 4,600.00'), findsOneWidget);
    expect(find.text('2 available · 1 special order'), findsOneWidget);
    expect(
      find.text(
        'Attach vendor quotation to enable submission to External Workshop.',
      ),
      findsOneWidget,
    );
    expect(find.text('Insurance Officer · Insurance'), findsOneWidget);
    final TpButton submit = tester.widget<TpButton>(
      find.byKey(const Key('accident.ws.assessment.submit')),
    );
    expect(submit.onPressed, isNull);
    expect(find.textContaining('Eng. Vinay'), findsNothing);
    expect(find.textContaining('SAR'), findsNothing);
    final Finder map =
        find.byKey(const Key('accident.ws.assessment.viewDamageMap'));
    await reveal(tester, map);
    await tester.tap(map);
    expect(navigated, <String>['damage_map']);
  });

  testWidgets('a vendor quotation unlocks submit, which routes the repair',
      (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows();
    _seedAssessment(rows);
    _seedAttachment(rows, 'vendor_quotation');
    await pumpAccidentWorkspace(
      tester,
      AccidentWorkshopAssessmentMockWorkspace(
        snapshot: _snapshot(),
        onNavigate: (_) {},
      ),
      overrides: _overrides(rows),
    );
    final Finder submit =
        find.byKey(const Key('accident.ws.assessment.submit'));
    await reveal(tester, submit);
    expect(tester.widget<TpButton>(submit).onPressed, isNotNull);
    await tester.tap(submit);
    await tester.pumpAndSettle();
    final Map<String, dynamic> assessment =
        rows.table(SupabaseTables.accidentDamageAssessments).single;
    expect(assessment['assessment_status'], 'submitted');
    expect(assessment['recommended_route'], 'external');
    expect(assessment['estimated_total_cost'], 4600);
    expect(assessment['safe_to_move'], isFalse);
    expect(assessment['assessor_name'], 'Signed-in assessor');
    final Map<String, dynamic> order =
        rows.table(SupabaseTables.accidentRepairOrders).single;
    expect(order['repair_route'], 'external');
    expect(order['country'], 'UAE');
    expect(find.text('Assessment submitted'), findsOneWidget);
  });

  testWidgets('saving without the parity columns drops them and says so',
      (WidgetTester tester) async {
    final FakeAccidentCaseRows rows = FakeAccidentCaseRows(
      missingColumns: assessmentParityColumns,
    );
    rows.seed(SupabaseTables.accidentDamageAssessments, <String, dynamic>{
      'accident_id': 'case-1',
      'damage_areas': _areas,
      'assessment_status': 'draft',
    });
    await pumpAccidentWorkspace(
      tester,
      AccidentWorkshopAssessmentMockWorkspace(
        snapshot: _snapshot(),
        onNavigate: (_) {},
      ),
      overrides: _overrides(rows),
    );
    expect(
      find.textContaining('not provisioned yet on this database.'),
      findsOneWidget,
    );
    final Finder safe =
        find.byKey(const Key('accident.ws.assessment.safeToMove'));
    await reveal(tester, safe);
    await tester.tap(
      find.descendant(of: safe, matching: find.text('No')),
    );
    await tester.pumpAndSettle();
    final Finder save = find.byKey(const Key('accident.ws.assessment.save'));
    await reveal(tester, save);
    await tester.tap(save);
    await tester.pumpAndSettle();
    final Map<String, dynamic> row =
        rows.table(SupabaseTables.accidentDamageAssessments).single;
    expect(row.containsKey('safe_to_move'), isFalse);
    expect(row['assessment_status'], 'draft');
    expect(find.textContaining('pending migration'), findsOneWidget);
    expect(find.textContaining('safe_to_move'), findsOneWidget);
  });
}
