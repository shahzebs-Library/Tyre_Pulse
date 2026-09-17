import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/features/accidents/accidents_providers.dart';
import 'package:tyre_pulse/features/accidents/data/accident_repository.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_case_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_detail_screen.dart';
import 'package:tyre_pulse/features/accidents/presentation/accident_ui.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workspaces.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_dispatch_handover.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_fleet_validation.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_insurance_claim.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_responsibility.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_timeline.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_ws_workshop_assessment.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/vehicle_damage_diagram.dart';

import 'presentation/accident_case_workspace_fakes.dart';

void main() {
  testWidgets(
      'persistent workspace navigation reaches all seven screens on phone',
      (tester) async {
    await tester.binding.setSurfaceSize(const Size(320, 760));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
    );
    final navigation = find.byKey(AccidentCaseScreenKeys.workspaceNavigation);
    expect(navigation, findsOneWidget);
    expect(
      find.descendant(
        of: navigation,
        matching: find.text('Insurance / Claims'),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: navigation,
        matching: find.byIcon(Icons.policy_outlined),
      ),
      findsOneWidget,
    );
    expect(
      find.descendant(
        of: navigation,
        matching: find.text('Workstream 3 of 7'),
      ),
      findsOneWidget,
    );
    for (int index = 2; index > 0; index--) {
      await tester.tap(find.byKey(AccidentCaseScreenKeys.previousWorkspace));
      await tester.pumpAndSettle();
    }
    expect(
      tester
          .widget<IconButton>(
            find.byKey(AccidentCaseScreenKeys.previousWorkspace),
          )
          .onPressed,
      isNull,
    );
    for (int step = 1; step <= 7; step++) {
      expect(
        find.descendant(
          of: navigation,
          matching: find.text('Workstream $step of 7'),
        ),
        findsOneWidget,
      );
      expect(
        find.byKey(AccidentCaseScreenKeys.workspaceSelector).hitTestable(),
        findsOneWidget,
      );
      if (step < 7) {
        await tester.tap(find.byKey(AccidentCaseScreenKeys.nextWorkspace));
        await tester.pumpAndSettle();
      }
    }
    expect(
      tester
          .widget<IconButton>(
            find.byKey(AccidentCaseScreenKeys.nextWorkspace),
          )
          .onPressed,
      isNull,
    );
    await tester.tap(find.byKey(AccidentCaseScreenKeys.workspaceSelector));
    await tester.pumpAndSettle();
    expect(find.widgetWithText(ListTile, 'Fleet validation'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
  testWidgets('case overview matches the approved compact hierarchy', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentDetailScreen(
        route: AccidentDetailRoute(accidentId: AccidentId('acc-1')),
      ),
    );

    expect(find.text('ACC-2026-0182'), findsOneWidget);
    expect(find.text('Accident'), findsOneWidget);
    expect(find.text('Mixer 3208'), findsOneWidget);
    expect(find.text('Reported on 11 May 2026'), findsOneWidget);
    expect(find.text('PROGRESS'), findsOneWidget);
    expect(find.text('Register insurance claim'), findsOneWidget);
    expect(find.text('Insurance Team'), findsOneWidget);
    expect(find.text('2026-09-03'), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.progress), findsOneWidget);
    expect(find.byType(AccidentProgressLadder), findsOneWidget);
    expect(find.bySemanticsLabel('Insurance, In progress'), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.nextAction), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.responsible), findsOneWidget);
    expect(find.byKey(AccidentDetailScreenKeys.dueDate), findsOneWidget);
    expect(find.text('View Case Details'), findsOneWidget);
    expect(find.text('DESCRIPTION'), findsNothing);
    expect(find.text('EVIDENCE (4)'), findsNothing);
    await expectLater(
      find.byType(AccidentDetailScreen),
      matchesGoldenFile('goldens/accident_case_overview_light.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('case detail walks the seven mock workspaces in case-flow order',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
    );

    // The case opens on its active workstream: insurance, workstream 3 of 7.
    expect(find.byKey(AccidentCaseScreenKeys.tabs), findsOneWidget);
    expect(find.byKey(AccidentCaseScreenKeys.insurance), findsOneWidget);
    expect(find.text('Workstream 3 of 7'), findsWidgets);
    expect(find.byType(AccidentInsuranceClaimMockWorkspace), findsOneWidget);

    await _selectCaseWorkspace(tester, 'Damage mapping');
    expect(find.byKey(AccidentCaseScreenKeys.damageMapping), findsOneWidget);
    expect(find.text('Workstream 5 of 7'), findsWidgets);
    expect(find.byType(VehicleDamageDiagram), findsOneWidget);
    expect(find.text('Boom section 3'), findsOneWidget);
    expect(find.textContaining('ACC-2026-0182'), findsWidgets);
    expect(find.textContaining('Mixer 3208'), findsWidgets);
    expect(find.text('11 May 2026 • 08:15'), findsOneWidget);
    expect(
      find.text('Vehicle collided with barrier while reversing.'),
      findsOneWidget,
    );
    expect(find.text('Local workflow preview'), findsNothing);

    await _selectCaseWorkspace(tester, 'Fleet validation');
    expect(find.byKey(AccidentCaseScreenKeys.fleet), findsOneWidget);
    expect(find.text('Workstream 1 of 7'), findsWidgets);
    expect(find.byType(AccidentFleetValidationMockWorkspace), findsOneWidget);

    await _selectCaseWorkspace(tester, 'Workshop assessment');
    expect(find.byKey(AccidentCaseScreenKeys.assessment), findsOneWidget);
    expect(find.text('Workstream 2 of 7'), findsWidgets);
    expect(
      find.byType(AccidentWorkshopAssessmentMockWorkspace),
      findsOneWidget,
    );

    await _selectCaseWorkspace(tester, 'Responsibility & payer');
    expect(find.byKey(AccidentCaseScreenKeys.responsibility), findsOneWidget);
    expect(find.text('Workstream 4 of 7'), findsWidgets);
    expect(find.byType(AccidentResponsibilityMockWorkspace), findsOneWidget);

    await _selectCaseWorkspace(tester, 'External workshop');
    expect(find.byKey(AccidentCaseScreenKeys.externalWorkshop), findsOneWidget);
    expect(find.text('Workstream 6 of 7'), findsWidgets);
    expect(find.byType(AccidentDispatchHandoverMockWorkspace), findsOneWidget);

    await _selectCaseWorkspace(tester, 'Timeline & notifications');
    expect(find.byKey(AccidentCaseScreenKeys.timeline), findsOneWidget);
    expect(find.text('Workstream 7 of 7'), findsWidgets);
    expect(find.byType(AccidentTimelineMockWorkspace), findsOneWidget);
    expect(find.text('Local workflow preview'), findsNothing);

    await tester.tap(find.byKey(AccidentCaseScreenKeys.boundaryAction));
    await tester.pumpAndSettle();
    expect(
      find.textContaining('require verified server actions'),
      findsWidgets,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('a workstream widget can jump to another workspace by flow key',
      (WidgetTester tester) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
    );
    final AccidentCaseWorkspaceView view = tester.widget(
      find.byType(AccidentCaseWorkspaceView),
    );
    expect(view.onNavigateWorkspace, isNotNull);
    view.onNavigateWorkspace!(AccidentCaseWorkspace.fromFlowKey('handover')!);
    await tester.pumpAndSettle();
    expect(find.byKey(AccidentCaseScreenKeys.externalWorkshop), findsOneWidget);
    expect(find.text('Workstream 6 of 7'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets('case detail preserves RTL without horizontal overflow', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const AccidentCaseScreen(
        route: AccidentCaseRoute(accidentId: AccidentId('acc-1')),
      ),
      locale: const Locale('ar'),
    );

    expect(
      Directionality.of(
        tester.element(find.byKey(AccidentCaseScreenKeys.insurance)),
      ),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });
}

Future<void> _selectCaseWorkspace(WidgetTester tester, String label) async {
  await tester.tap(find.byKey(AccidentCaseScreenKeys.tabs));
  await tester.pumpAndSettle();
  await tester.tap(find.widgetWithText(ListTile, label));
  await tester.pumpAndSettle();
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: <Override>[
        ...accidentCaseWorkspaceOverrides(),
        accidentRepositoryProvider.overrideWithValue(_FakeRepository()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final class _FakeRepository implements AccidentRepository {
  static const AccidentRecord record = AccidentRecord(
    id: 'acc-1',
    referenceNo: 'ACC-2026-0182',
    assetNo: 'Mixer 3208',
    site: 'Diriyah',
    incidentDate: '2026-05-11 08:15',
    location: 'Diriyah',
    caseStatus: 'under_insurance_review',
    workflowStage: 'insurance',
    description: 'Vehicle collided with barrier while reversing.',
    damageDescription:
        '{"version":2,"marks":[{"zone_id":"left_boom","view":"left","x":0.5,"y":0.5,"area":"Boom section 3","damage_type":"cracked","severity":"severe","photo_references":["tp-storage://accident-photos/damage-1.jpg"]}]}',
    reporterName: 'Ahmed K.',
    photos: <String>[
      'tp-storage://accident-photos/evidence-1.jpg',
      'tp-storage://accident-photos/evidence-2.jpg',
      'tp-storage://accident-photos/evidence-3.jpg',
      'tp-storage://accident-photos/evidence-4.jpg',
    ],
    nextStep: 'Register insurance claim',
    insurer: 'Insurer record',
    insuranceClaimNo: 'CLM-8821',
    claimStatus: 'pending',
    repairType: 'internal',
    workshopName: 'Central Workshop',
    expectedReleaseDate: '2026-09-03',
    faultStatus: 'under_review',
    responsibleParty: 'driver',
    liableParty: 'pending',
    payer: 'pending',
    driverName: 'Salim R.',
    injuries: false,
    injuryCount: 0,
    thirdPartyInvolved: true,
    policeReportNo: 'DUB-2026-88142',
    najmStatus: 'received',
    najmFault: 'other_party',
    taqdeerStatus: 'pending',
    taqdeerNo: 'TQD-994',
    damageCondition: 'major_body_damage',
    estimatedDamageCost: 46900,
    workshopLocation: 'Dubai Industrial City',
    deductible: 1500,
    amountTransfer: 24000,
  );

  static const AccidentCaseSnapshot snapshot = AccidentCaseSnapshot(
    accident: record,
    provisioned: true,
    workstreams: <AccidentWorkstream>[
      AccidentWorkstream(
        id: 'ws-evidence',
        key: 'incident_evidence',
        status: 'completed',
        required: true,
      ),
      AccidentWorkstream(
        id: 'ws-insurance',
        key: 'insurance',
        status: 'in_progress',
        required: true,
        team: 'Insurance Team',
      ),
      AccidentWorkstream(
        id: 'ws-repair',
        key: 'repair',
        status: 'not_started',
        required: true,
      ),
    ],
  );

  @override
  Future<AccidentRecord?> byId(String id) async => record;

  @override
  Future<AccidentCaseSnapshot?> caseById(String id, {String? country}) async =>
      snapshot;

  @override
  Future<AccidentListPage> list({
    required int offset,
    required int pageSize,
    String? country,
    String? reporterId,
  }) async =>
      const AccidentListPage(items: <AccidentRecord>[], hasMore: false);
}
