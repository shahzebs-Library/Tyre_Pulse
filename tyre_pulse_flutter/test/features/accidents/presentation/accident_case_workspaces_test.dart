import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workspaces.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_dispatch_handover.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_fleet_validation.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_insurance_claim.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_responsibility.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_timeline.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_workshop_assessment.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/vehicle_damage_diagram.dart';

import 'accident_case_workspace_fakes.dart';

const String _damageMarks =
    '{"version":2,"marks":[{"zone_id":"left_boom","view":"left","x":0.5,'
    '"y":0.5,"area":"Boom section 3","damage_type":"cracked",'
    '"severity":"severe","photo_references":[]}]}';

const AccidentRecord _record = AccidentRecord(
  id: 'case-1',
  referenceNo: 'ACC-2026-0148',
  assetNo: 'CP-045',
  site: 'Verified yard',
  incidentDate: '2026-09-01',
  description: 'Vehicle collided with barrier while reversing.',
  driverName: 'Recorded driver',
  workshopName: 'Recorded workshop',
  workshopLocation: 'Recorded location',
  releaseDate: '2026-09-06',
  policeReportNo: 'POL-42',
  najmStatus: 'received',
  najmFault: 'Shared finding',
  taqdeerNo: 'TAQ-21',
  taqdeerStatus: 'under review',
  damageDescription: _damageMarks,
);

/// The mock case-flow order the owner's screens number 1..7.
const List<AccidentCaseWorkspace> _mockOrder = <AccidentCaseWorkspace>[
  AccidentCaseWorkspace.fleet,
  AccidentCaseWorkspace.assessment,
  AccidentCaseWorkspace.insurance,
  AccidentCaseWorkspace.responsibility,
  AccidentCaseWorkspace.damageMapping,
  AccidentCaseWorkspace.externalWorkshop,
  AccidentCaseWorkspace.timeline,
];

/// The widget each mock workspace renders. Damage mapping stays the inline
/// read-only workspace, so it is asserted through its diagram instead.
Finder _mockFinder(AccidentCaseWorkspace workspace) => switch (workspace) {
      AccidentCaseWorkspace.fleet =>
        find.byType(AccidentFleetValidationMockWorkspace),
      AccidentCaseWorkspace.assessment =>
        find.byType(AccidentWorkshopAssessmentMockWorkspace),
      AccidentCaseWorkspace.insurance =>
        find.byType(AccidentInsuranceClaimMockWorkspace),
      AccidentCaseWorkspace.responsibility =>
        find.byType(AccidentResponsibilityMockWorkspace),
      AccidentCaseWorkspace.damageMapping => find.byType(VehicleDamageDiagram),
      AccidentCaseWorkspace.externalWorkshop =>
        find.byType(AccidentDispatchHandoverMockWorkspace),
      AccidentCaseWorkspace.timeline =>
        find.byType(AccidentTimelineMockWorkspace),
    };

Future<void> _pump(
  WidgetTester tester,
  AccidentCaseWorkspace workspace, {
  Locale locale = const Locale('en'),
  List<AccidentWorkstream> workstreams = const <AccidentWorkstream>[],
  void Function(AccidentCaseWorkspace target)? onNavigateWorkspace,
}) async {
  tester.view.physicalSize = const Size(400, 900);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final ScrollController controller = ScrollController();
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: accidentCaseWorkspaceOverrides(),
      child: MaterialApp(
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: Scaffold(
          body: AccidentCaseWorkspaceView(
            workspace: workspace,
            snapshot: AccidentCaseSnapshot(
              accident: _record,
              provisioned: true,
              workstreams: workstreams,
            ),
            onRefresh: () async {},
            controller: controller,
            bodyKey: const Key('body'),
            onNavigateWorkspace: onNavigateWorkspace,
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  test('the enum is declared in the mock case-flow order', () {
    expect(AccidentCaseWorkspace.values, _mockOrder);
    for (int index = 0; index < _mockOrder.length; index++) {
      expect(_mockOrder[index].step, index + 1);
    }
  });

  test('every case-flow key maps to exactly one workspace', () {
    const Map<String, AccidentCaseWorkspace> expected =
        <String, AccidentCaseWorkspace>{
      'fleet_validation': AccidentCaseWorkspace.fleet,
      'assessment': AccidentCaseWorkspace.assessment,
      'insurance': AccidentCaseWorkspace.insurance,
      'liability': AccidentCaseWorkspace.responsibility,
      'damage_map': AccidentCaseWorkspace.damageMapping,
      'handover': AccidentCaseWorkspace.externalWorkshop,
      'timeline': AccidentCaseWorkspace.timeline,
    };
    for (final MapEntry<String, AccidentCaseWorkspace> entry
        in expected.entries) {
      expect(AccidentCaseWorkspace.fromFlowKey(entry.key), entry.value);
    }
    expect(AccidentCaseWorkspace.fromFlowKey('finance'), isNull);
    expect(AccidentCaseWorkspace.fromFlowKey(''), isNull);
  });

  for (int index = 0; index < _mockOrder.length; index++) {
    final AccidentCaseWorkspace workspace = _mockOrder[index];
    final int step = index + 1;

    testWidgets('${workspace.name} renders the mock widget as workstream $step',
        (WidgetTester tester) async {
      await _pump(tester, workspace);
      expect(tester.takeException(), isNull);
      expect(find.text('Workstream $step of 7'), findsOneWidget);
      expect(_mockFinder(workspace), findsOneWidget);
      expect(find.text('Local workflow preview'), findsNothing);
      expect(
        find.byKey(const Key('accident.case.readOnlyStatus')),
        findsOneWidget,
      );
    });

    testWidgets('${workspace.name} stays readable on compact Arabic (RTL)',
        (WidgetTester tester) async {
      await _pump(tester, workspace, locale: const Locale('ar'));
      expect(tester.takeException(), isNull);
      expect(
        Directionality.of(tester.element(find.byKey(const Key('body')))),
        TextDirection.rtl,
      );
      expect(find.text('مسار العمل $step من 7'), findsOneWidget);
      expect(_mockFinder(workspace), findsOneWidget);
      expect(find.text('Local workflow preview'), findsNothing);
    });
  }

  testWidgets('damage mapping stays the read-only inline workspace',
      (WidgetTester tester) async {
    await _pump(tester, AccidentCaseWorkspace.damageMapping);
    expect(find.byType(VehicleDamageDiagram), findsOneWidget);
    expect(find.text('Boom section 3'), findsOneWidget);
    expect(find.textContaining('ACC-2026-0148'), findsWidgets);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsOneWidget,
    );
    expect(find.text('Not recorded'), findsWidgets);
    expect(find.text('Recorded'), findsNothing);
    expect(tester.takeException(), isNull);
  });

  testWidgets('damage mapping ledger shows waiver reason and progress',
      (WidgetTester tester) async {
    await _pump(
      tester,
      AccidentCaseWorkspace.damageMapping,
      workstreams: const <AccidentWorkstream>[
        AccidentWorkstream(
          id: 'ws',
          key: 'incident_evidence',
          status: 'waived',
          notApplicable: true,
          naReason: 'No repair required after review',
          progressPct: 25,
        ),
      ],
    );
    expect(find.text('No repair required after review'), findsOneWidget);
    expect(find.text('Recorded progress'), findsOneWidget);
    expect(find.text('25%'), findsOneWidget);
  });

  testWidgets('timeline is the mock timeline and notifications workspace',
      (WidgetTester tester) async {
    await _pump(tester, AccidentCaseWorkspace.timeline);
    expect(find.text('Case timeline & notifications'), findsOneWidget);
    expect(find.text('Workstream 7 of 7'), findsOneWidget);
    expect(find.textContaining('Delivered'), findsNothing);
    expect(tester.takeException(), isNull);
  });
}
