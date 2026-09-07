import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_models.dart';
import 'package:tyre_pulse/features/accidents/presentation/widgets/accident_case_workspaces.dart';
import 'package:tyre_pulse/features/notifications/domain/app_notification.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

const _record = AccidentRecord(
  id: 'case-1',
  assetNo: 'CP-045',
  site: 'Verified yard',
  incidentDate: '2026-09-01',
  driverName: 'Recorded driver',
  workshopName: 'Recorded workshop',
  workshopLocation: 'Recorded location',
  releaseDate: '2026-09-06',
  policeReportNo: 'POL-42',
  najmStatus: 'received',
  najmFault: 'Shared finding',
  taqdeerNo: 'TAQ-21',
  taqdeerStatus: 'under review',
);
const _context = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);

Future<void> _pump(
  WidgetTester tester,
  AccidentCaseWorkspace workspace, {
  Locale locale = const Locale('en'),
  List<AccidentWorkstream> workstreams = const [],
  List<AppNotification> notifications = const [],
}) async {
  tester.view.physicalSize = const Size(320, 760);
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  final controller = ScrollController();
  addTearDown(controller.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workspaceContextProvider.overrideWithValue(_context),
        notificationsInboxProvider
            .overrideWith((ref) => Stream.value(notifications)),
      ],
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
          ),
        ),
      ),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  for (final entry in {
    AccidentCaseWorkspace.fleet: 'Fleet validation checklist',
    AccidentCaseWorkspace.insurance: 'Deductible',
    AccidentCaseWorkspace.assessment: 'Safe to move',
  }.entries) {
    testWidgets(
        '${entry.key.name} reference-critical details are open initially',
        (tester) async {
      await _pump(tester, entry.key);
      expect(find.text(entry.value), findsOneWidget);
      expect(tester.takeException(), isNull);
    });
  }

  for (final workspace in AccidentCaseWorkspace.values
      .where((value) => value != AccidentCaseWorkspace.damageMapping)) {
    testWidgets(
        '${workspace.name} stays readable on compact Arabic without fake progress',
        (tester) async {
      await _pump(tester, workspace, locale: const Locale('ar'));
      expect(tester.takeException(), isNull);
      expect(
        Directionality.of(tester.element(find.byKey(const Key('body')))),
        TextDirection.rtl,
      );
      expect(find.text('0%'), findsNothing);
      expect(find.text('Local workflow preview'), findsNothing);
    });
  }

  testWidgets(
      'external location and release date never become receipt or acceptance proof',
      (tester) async {
    await _pump(tester, AccidentCaseWorkspace.externalWorkshop);
    expect(find.text('Recorded location'), findsOneWidget);
    expect(find.text('2026-09-06'), findsOneWidget);
    expect(find.text('External workshop arrival confirmed'), findsOneWidget);
    expect(find.text('Recorded'), findsNothing);
    expect(find.text('Not recorded'), findsWidgets);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
      'responsibility documents show each authority field without expanding',
      (tester) async {
    await _pump(tester, AccidentCaseWorkspace.responsibility);
    for (final value in [
      'POL-42',
      'received',
      'Shared finding',
      'TAQ-21',
      'under review',
    ]) {
      expect(find.text(value), findsOneWidget);
    }
    expect(find.text('Verified'), findsNothing);
  });

  testWidgets(
      'workstream ledger shows waiver reason and explicit progress without expanding',
      (tester) async {
    await _pump(
      tester,
      AccidentCaseWorkspace.assessment,
      workstreams: const [
        AccidentWorkstream(
          id: 'ws',
          key: 'assessment',
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

  testWidgets(
      'timeline and real case-linked notifications are visible together',
      (tester) async {
    await _pump(
      tester,
      AccidentCaseWorkspace.timeline,
      notifications: [
        AppNotification(
          id: 'one',
          userId: 'user-1',
          isRead: false,
          createdAt: DateTime.utc(2026, 9, 1),
          entityId: 'case-1',
          entityType: 'accident',
          title: 'Real update',
        ),
        AppNotification(
          id: 'two',
          userId: 'user-1',
          isRead: false,
          createdAt: DateTime.utc(2026, 9, 1),
          entityId: 'case-2',
          entityType: 'accident',
          title: 'Other case',
        ),
      ],
    );
    expect(find.text('Case timeline & notifications'), findsOneWidget);
    expect(find.text('Notifications'), findsOneWidget);
    expect(find.text('Real update'), findsOneWidget);
    expect(find.text('Other case'), findsNothing);
    expect(find.textContaining('Delivered'), findsNothing);
  });
}
