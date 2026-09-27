/// [HomeScreen] rendered over a real [AccessState], the same override shape
/// `main.dart` wires at the composition root.
///
/// # What this file protects
///
/// Home follows the owner-approved mock 07 ("Home - Today's work"): header,
/// full-width New inspection button, a Today's-work timeline and quick
/// actions. The shared shell bar - not a Home-owned bar - is the bottom
/// navigation (see `test/app/router/app_shell_home_bar_test.dart`).
///
/// The timeline is asserted to contain ONLY rows backed by a real source
/// (inspection draft, critical tyre alert, pending approvals), to say
/// "Could not check" when a source fails rather than looking empty, and the
/// header is asserted never to claim "Online" - there is no connectivity
/// provider to back it.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/approvals/data/inspection_approval_item.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

import '../../../core/database/database_test_support.dart';

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _tyreMan = AccessState(role: UserRole.known(RoleId.tyreMan));

/// The clock every timeline "N minutes ago" is measured against.
final DateTime _now = DateTime(2026, 8, 28, 9, 30);

InspectionDraftSummary _draft() => InspectionDraftSummary(
      draftKey: 'user-1::CP045',
      assetNo: 'CP045',
      vehicleType: 'Concrete Pump',
      site: 'NHC',
      filled: 8,
      total: 10,
      updatedAt: _now.subtract(const Duration(minutes: 10)),
    );

const TyreAlert _criticalAlert = TyreAlert(
  id: 'alert-1',
  riskLevel: 'critical',
  assetNo: 'CP045',
  position: 'R1R',
  site: 'NHC',
  treadDepthMm: 4.8,
  issueDate: '2026-08-27',
);

List<InspectionApprovalItem> _approvals(int count) => List.generate(
      count,
      (int index) => InspectionApprovalItem(
        id: 'approval-$index',
        createdAt:
            _now.subtract(Duration(minutes: 25 + index)).toIso8601String(),
      ),
    );

Future<void> _pumpHome(
  WidgetTester tester, {
  required AccessState access,
  String? legacySite = 'NHC',
  Locale locale = const Locale('en'),
  ThemeData? theme,
  int notificationCount = 0,
  AsyncValue<int> pendingSync = const AsyncData<int>(0),
  Future<InspectionDraftSummary?> Function()? draft,
  Future<List<TyreAlert>> Function()? alerts,
  Future<List<InspectionApprovalItem>> Function()? approvals,
  GoRouter? router,
}) async {
  final WorkspaceContext workspace = WorkspaceContext(
    userId: 'user-1',
    role: access.role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: SiteScope.none,
    companyId: 'org-1',
    tenantId: 'org-1',
    legacySite: legacySite,
    fullName: 'Mohammed A.',
  );

  final db = newMemoryDatabase();
  addTearDown(db.close);

  final List<Override> overrides = <Override>[
    accessStateProvider.overrideWithValue(access),
    workspaceContextProvider.overrideWithValue(workspace),
    appDatabaseProvider.overrideWithValue(db),
    unreadNotificationsCountProvider.overrideWithValue(
      AsyncData<int>(notificationCount),
    ),
    homeHeaderClockProvider.overrideWithValue(() => _now),
    homePendingSyncCountProvider.overrideWith(
      (Ref ref) => switch (pendingSync) {
        AsyncData<int>(:final value) => Future<int>.value(value),
        _ => Future<int>.error(StateError('queue unreadable')),
      },
    ),
    homeLatestInspectionDraftProvider.overrideWith(
      (Ref ref) =>
          draft == null ? Future<InspectionDraftSummary?>.value() : draft(),
    ),
    tyreAlertsProvider.overrideWith(
      (Ref ref) => alerts == null
          ? Future<List<TyreAlert>>.value(const <TyreAlert>[])
          : alerts(),
    ),
    homePendingInspectionApprovalsProvider.overrideWith(
      (Ref ref) => approvals == null
          ? Future<List<InspectionApprovalItem>>.value(
              const <InspectionApprovalItem>[],
            )
          : approvals(),
    ),
  ];

  final Widget app = router == null
      ? MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: theme ?? TpTheme.light,
          locale: locale,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: const HomeScreen(route: HomeRoute()),
        )
      : MaterialApp.router(
          debugShowCheckedModeBanner: false,
          theme: theme ?? TpTheme.light,
          locale: locale,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          routerConfig: router,
        );

  await tester.pumpWidget(ProviderScope(overrides: overrides, child: app));
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

/// A two-route router: Home, and a stand-in for the New Inspection branch
/// that records the query it was opened with.
GoRouter _homeRouter() => GoRouter(
      initialLocation: '/',
      routes: <RouteBase>[
        GoRoute(
          path: '/',
          builder: (BuildContext context, GoRouterState state) =>
              const HomeScreen(route: HomeRoute()),
        ),
        GoRoute(
          path: TpRoutePaths.newInspection,
          builder: (BuildContext context, GoRouterState state) => Text(
            'new-inspection:'
            '${state.uri.queryParameters[TpRoutePaths.qAssetNo] ?? ''}',
          ),
        ),
      ],
    );

void main() {
  testWidgets(
    'Today\'s work shows the draft, critical and approval rows in the mock '
    'order, from real sources only (golden)',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpHome(
        tester,
        access: _admin,
        notificationCount: 3,
        draft: () async => _draft(),
        alerts: () async => const <TyreAlert>[_criticalAlert],
        approvals: () async => _approvals(3),
      );
      await tester.pumpAndSettle();

      expect(find.byKey(HomeScreenKeys.hero), findsOneWidget);
      expect(find.text('Mohammed'), findsOneWidget);
      expect(find.text('MA'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.newInspection), findsOneWidget);
      expect(find.text('New inspection'), findsOneWidget);

      final Finder draftRow = find.byKey(HomeScreenKeys.workRow('draft'));
      final Finder criticalRow = find.byKey(HomeScreenKeys.workRow('critical'));
      final Finder approvalsRow =
          find.byKey(HomeScreenKeys.workRow('approvals'));
      expect(draftRow, findsOneWidget);
      expect(criticalRow, findsOneWidget);
      expect(approvalsRow, findsOneWidget);
      expect(find.byKey(HomeScreenKeys.workRow('empty')), findsNothing);

      expect(
        find.descendant(of: draftRow, matching: find.text('DRAFT')),
        findsOneWidget,
      );
      expect(find.text('Resume inspection'), findsOneWidget);
      expect(find.text('CP045 • Concrete Pump • NHC'), findsOneWidget);
      expect(find.text('8 of 10 checked'), findsOneWidget);
      expect(
        find.descendant(of: draftRow, matching: find.text('10m ago')),
        findsOneWidget,
      );

      expect(find.text('Tyre issue needs attention'), findsOneWidget);
      expect(find.text('R1R • CP045 • NHC'), findsOneWidget);
      expect(find.text('Tread depth: 4.8 mm'), findsOneWidget);

      expect(find.text('Inspection Approvals'), findsOneWidget);
      expect(find.text('3 awaiting sign-off'), findsOneWidget);
      expect(
        find.descendant(
          of: approvalsRow,
          matching: find.text('AWAITING SIGNATURE'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(of: approvalsRow, matching: find.text('25m ago')),
        findsOneWidget,
      );

      final double draftY = tester.getTopLeft(draftRow).dy;
      final double criticalY = tester.getTopLeft(criticalRow).dy;
      final double approvalsY = tester.getTopLeft(approvalsRow).dy;
      expect(draftY, lessThan(criticalY));
      expect(criticalY, lessThan(approvalsY));

      // The mock's rows with no data source are never fabricated.
      expect(find.textContaining('Scheduled'), findsNothing);
      expect(find.textContaining('Fleet pulse'), findsNothing);
      expect(find.text('Online'), findsNothing);

      await expectLater(
        find.byType(HomeScreen),
        matchesGoldenFile('goldens/home_screen_full_data.png'),
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Home no longer draws its own bottom bar - the shell bar is the only one',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);

      expect(find.text("Today's work"), findsOneWidget); // section heading only
      expect(find.text('Alerts'), findsNothing);
      expect(find.byType(BottomNavigationBar), findsNothing);
      expect(find.byType(NavigationBar), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets('New inspection routes to the New Inspection branch', (
    WidgetTester tester,
  ) async {
    await _pumpHome(tester, access: _admin, router: _homeRouter());

    await tester.tap(find.byKey(HomeScreenKeys.newInspection));
    await tester.pumpAndSettle();

    expect(find.text('new-inspection:'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('the draft row resumes that asset\'s inspection', (
    WidgetTester tester,
  ) async {
    await _pumpHome(
      tester,
      access: _admin,
      router: _homeRouter(),
      draft: () async => _draft(),
    );
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(HomeScreenKeys.workRow('draft')));
    await tester.pumpAndSettle();

    expect(find.text('new-inspection:CP045'), findsOneWidget);
  });

  testWidgets(
    'no work anywhere renders the honest empty state, not fabricated rows',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);
      await tester.pumpAndSettle();

      expect(find.byKey(HomeScreenKeys.workRow('empty')), findsOneWidget);
      expect(find.text('Nothing needs you right now'), findsOneWidget);
      for (final String id in <String>['draft', 'critical', 'approvals']) {
        expect(find.byKey(HomeScreenKeys.workRow(id)), findsNothing);
      }
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a failed source says "Could not check" instead of looking empty',
    (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _admin,
        approvals: () => Future<List<InspectionApprovalItem>>.error(
          StateError('offline'),
        ),
      );
      await tester.pumpAndSettle();

      expect(
        find.byKey(HomeScreenKeys.workRow('unavailable')),
        findsOneWidget,
      );
      expect(find.byKey(HomeScreenKeys.workRow('empty')), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'the header sync status reads the real queue and never claims Online',
    (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _admin,
        pendingSync: const AsyncData<int>(2),
      );
      await tester.pumpAndSettle();

      expect(
        find.descendant(
          of: find.byKey(HomeScreenKeys.syncStatus),
          matching: find.text('2 changes waiting to sync'),
        ),
        findsOneWidget,
      );
      expect(find.text('Online'), findsNothing);
    },
  );

  testWidgets('an empty queue reads as all synced', (
    WidgetTester tester,
  ) async {
    await _pumpHome(tester, access: _admin);
    await tester.pumpAndSettle();

    expect(
      find.descendant(
        of: find.byKey(HomeScreenKeys.syncStatus),
        matching: find.text('All changes synced'),
      ),
      findsOneWidget,
    );
  });

  testWidgets(
    'an Admin gets every quick action, the accident shortcut and More',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);

      for (final String id in <String>[
        'scanner',
        'washing',
        'asset',
        'reportIssue',
        'accident',
        'accidents',
        'more',
      ]) {
        expect(find.byKey(HomeScreenKeys.action(id)), findsOneWidget);
      }
      expect(find.byType(GridView), findsNothing);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'a role scoped to some modules keeps the header and its permitted '
    'actions, and More is always reachable',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _tyreMan);

      expect(tester.takeException(), isNull);
      expect(find.text('Mohammed'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.hero), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.newInspection), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('more')), findsOneWidget);
    },
  );

  testWidgets(
    'no site on the profile renders the honest "No site on file"',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin, legacySite: null);

      expect(tester.takeException(), isNull);
      expect(find.text('No site on file'), findsOneWidget);
    },
  );

  testWidgets(
    'a compact phone keeps the mock hierarchy ordered without overflow',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpHome(
        tester,
        access: _admin,
        draft: () async => _draft(),
        alerts: () async => const <TyreAlert>[_criticalAlert],
        approvals: () async => _approvals(2),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
      final double buttonY =
          tester.getTopLeft(find.byKey(HomeScreenKeys.newInspection)).dy;
      final double workY =
          tester.getTopLeft(find.byKey(HomeScreenKeys.todaysWork)).dy;
      expect(buttonY, lessThan(workY));
    },
  );

  testWidgets('dark theme renders the same hierarchy', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(360, 780);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpHome(
      tester,
      access: _admin,
      theme: TpTheme.dark,
      draft: () async => _draft(),
      approvals: () async => _approvals(1),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(HomeScreenKeys.newInspection), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.workRow('draft')), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.workRow('approvals')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('Arabic keeps the RTL layout and all primary actions', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(360, 720);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);

    await _pumpHome(
      tester,
      access: _admin,
      locale: const Locale('ar'),
      draft: () async => _draft(),
    );
    await tester.pumpAndSettle();

    expect(find.byKey(HomeScreenKeys.newInspection), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.workRow('draft')), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.action('asset')), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.action('reportIssue')), findsOneWidget);
    expect(find.byKey(HomeScreenKeys.action('accident')), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets(
    'More exposes every implemented accident, workshop and management module',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);

      await tester.ensureVisible(find.byKey(HomeScreenKeys.action('more')));
      await tester.tap(find.byKey(HomeScreenKeys.action('more')));
      await tester.pumpAndSettle();

      final Finder sheet = find.byKey(HomeScreenKeys.action('servicesSheet'));
      expect(sheet, findsOneWidget);
      expect(
        find.descendant(of: sheet, matching: find.text('New inspection')),
        findsNothing,
      );
      await tester.scrollUntilVisible(
        find.text('My Inspections'),
        220,
        scrollable: find.descendant(
          of: sheet,
          matching: find.byType(Scrollable),
        ),
      );
      expect(find.text('My Inspections'), findsOneWidget);
      expect(find.text('Accident command centre'), findsWidgets);
      expect(find.text('Report an accident'), findsWidgets);
      await tester.drag(sheet, const Offset(0, -850));
      await tester.pumpAndSettle();
      expect(find.text('Maintenance Control Center'), findsOneWidget);
      expect(find.text('Maintenance & workshop'), findsWidgets);
      await tester.drag(sheet, const Offset(0, -850));
      await tester.pumpAndSettle();
      expect(find.text('Fleet Overview'), findsOneWidget);
      expect(find.text('Financial report'), findsOneWidget);
      expect(find.text('Fleet Analytics'), findsOneWidget);
      expect(find.text('Team'), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
