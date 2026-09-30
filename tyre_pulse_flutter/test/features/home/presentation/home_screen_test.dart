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
import 'package:tyre_pulse/core/auth/auth_providers.dart';
import 'package:tyre_pulse/core/database/app_database_provider.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/permission_providers.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/alerts/alerts_providers.dart';
import 'package:tyre_pulse/features/alerts/domain/tyre_alert.dart';
import 'package:tyre_pulse/features/home/domain/home_work.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_draft_summary.dart';
import 'package:tyre_pulse/features/my_work/data/my_work_loader.dart';
import 'package:tyre_pulse/features/my_work/domain/my_work_item.dart';
import 'package:tyre_pulse/features/my_work/my_work_providers.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';

import '../../../core/database/database_test_support.dart';

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _tyreMan = AccessState(role: UserRole.known(RoleId.tyreMan));
const AccessState _director =
    AccessState(role: UserRole.known(RoleId.director));
const AccessState _driver = AccessState(role: UserRole.known(RoleId.driver));

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

HomePendingApprovals _approvals(int count) => HomePendingApprovals(
      count: count,
      newestAt: _now.subtract(const Duration(minutes: 25)),
    );

Future<void> _pumpHome(
  WidgetTester tester, {
  required AccessState access,
  String? legacySite = 'NHC',
  SiteScope siteScope = SiteScope.none,
  bool accessFailed = false,
  VoidCallback? onRetryAccess,
  Locale locale = const Locale('en'),
  ThemeData? theme,
  int notificationCount = 0,
  AsyncValue<int> pendingSync = const AsyncData<int>(0),
  Future<InspectionDraftSummary?> Function()? draft,
  Future<List<TyreAlert>> Function()? alerts,
  Future<HomePendingApprovals> Function()? approvals,
  Future<List<HomeRecentAsset>> Function()? recent,
  Future<MyWorkSnapshot> Function()? plan,
  GoRouter? router,
  Widget Function(Widget home)? wrap,
}) async {
  final WorkspaceContext workspace = WorkspaceContext(
    userId: 'user-1',
    role: access.role,
    effectivePermissions: access,
    countryScope: CountryScope.none,
    siteScope: siteScope,
    companyId: 'org-1',
    tenantId: 'org-1',
    legacySite: legacySite,
    fullName: 'Mohammed A.',
  );

  final db = newMemoryDatabase();
  addTearDown(db.close);

  final List<Override> overrides = <Override>[
    accessStateProvider.overrideWithValue(access),
    accessLoadFailedProvider.overrideWithValue(accessFailed),
    retryAccessLoadProvider.overrideWithValue(onRetryAccess),
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
      (Ref ref) => draft == null
          ? Stream<InspectionDraftSummary?>.value(null)
          : Stream<InspectionDraftSummary?>.fromFuture(draft()),
    ),
    tyreAlertsProvider.overrideWith(
      (Ref ref) => alerts == null
          ? Future<List<TyreAlert>>.value(const <TyreAlert>[])
          : alerts(),
    ),
    homePendingInspectionApprovalsProvider.overrideWith(
      (Ref ref) => approvals == null
          ? Future<HomePendingApprovals>.value(
              const HomePendingApprovals(count: 0),
            )
          : approvals(),
    ),
    myWorkClockProvider.overrideWithValue(() => _now),
    myWorkSnapshotProvider.overrideWith(
      (Ref ref) => plan == null
          ? Future<MyWorkSnapshot>.value(
              MyWorkSnapshot(items: const <MyWorkItem>[], loadedAt: _now),
            )
          : plan(),
    ),
    homeRecentAssetsProvider.overrideWith(
      (Ref ref) => recent == null
          ? Future<List<HomeRecentAsset>>.value(const <HomeRecentAsset>[])
          : recent(),
    ),
  ];

  final Widget app = router == null
      ? MaterialApp(
          debugShowCheckedModeBanner: false,
          theme: theme ?? TpTheme.light,
          locale: locale,
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: wrap == null
              ? const HomeScreen(route: HomeRoute())
              : wrap(const HomeScreen(route: HomeRoute())),
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
      expect(find.text('Tread depth: \u20664.8 mm\u2069'), findsOneWidget);

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
        approvals: () => Future<HomePendingApprovals>.error(
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
    'an organisation wide site scope reads as All sites, not No site on file',
    (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _tyreMan,
        legacySite: '',
        siteScope: SiteScope.fromValues(const <String>['ALL']),
      );

      expect(tester.takeException(), isNull);
      expect(find.text('All sites'), findsOneWidget);
      expect(find.text('No site on file'), findsNothing);
    },
  );

  testWidgets(
    'a failed access read says so with Retry instead of an empty role',
    (WidgetTester tester) async {
      int retries = 0;
      await _pumpHome(
        tester,
        access: _driver,
        accessFailed: true,
        onRetryAccess: () => retries++,
      );

      final Finder row = find.byKey(HomeScreenKeys.workRow('access'));
      expect(row, findsOneWidget);
      expect(find.text('Your access could not be loaded'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.workRow('none')), findsNothing);
      await tester.tap(row);
      await tester.pump();
      expect(retries, 1);
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

  testWidgets(
    'section headers keep "View all" on screen at a large text scale',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      // No work items: this pins the header row only. The Today's work
      // timeline row has its own, separately tracked, large-scale issue.
      await _pumpHome(
        tester,
        access: _admin,
        locale: const Locale('ur'),
        wrap: (Widget home) => Builder(
          builder: (BuildContext context) => MediaQuery(
            data: MediaQuery.of(context).copyWith(
              textScaler: const TextScaler.linear(2),
            ),
            child: home,
          ),
        ),
      );
      await tester.pumpAndSettle();

      expect(tester.takeException(), isNull);
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

      // The lazy list only learns its full extent once the rows below the
      // fold lay out, so the first jump can stop short; settle and jump
      // again so the tap lands on the tile, not past the viewport edge.
      await tester.ensureVisible(find.byKey(HomeScreenKeys.action('more')));
      await tester.pumpAndSettle();
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

  testWidgets(
    'reduced motion shows Home at once, with no entrance animation',
    (WidgetTester tester) async {
      tester.platformDispatcher.accessibilityFeaturesTestValue =
          const FakeAccessibilityFeatures(disableAnimations: true);
      addTearDown(
        tester.platformDispatcher.clearAccessibilityFeaturesTestValue,
      );

      await _pumpHome(tester, access: _admin, draft: () async => _draft());

      expect(
        find.descendant(
          of: find.byType(HomeScreen),
          matching: find.byType(TweenAnimationBuilder<double>),
        ),
        findsNothing,
      );
      expect(find.byKey(HomeScreenKeys.newInspection), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'forward chevrons use the self-mirroring glyph, so RTL points the '
    'reading direction',
    (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _admin,
        locale: const Locale('ar'),
        draft: () async => _draft(),
      );
      await tester.pumpAndSettle();

      // chevron_right_rounded already flips under RTL; choosing
      // chevron_left_rounded there would flip it back to point the wrong way.
      expect(find.byIcon(Icons.chevron_left_rounded), findsNothing);
      expect(find.byIcon(Icons.chevron_right_rounded), findsWidgets);
      expect(Icons.chevron_right_rounded.matchTextDirection, isTrue);
    },
  );

  group('signer gate, exact count, honest empty states', () {
    testWidgets(
      'a Director reaches approvals but cannot sign (V606), so no '
      '"awaiting signature" row is shown or even read',
      (WidgetTester tester) async {
        int reads = 0;
        await _pumpHome(
          tester,
          access: _director,
          approvals: () async {
            reads++;
            return _approvals(5);
          },
        );
        await tester.pumpAndSettle();

        expect(find.byKey(HomeScreenKeys.workRow('approvals')), findsNothing);
        expect(reads, 0);
        expect(tester.takeException(), isNull);
      },
    );

    testWidgets('the approvals row shows the exact server count, not a page', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        access: _admin,
        approvals: () async => _approvals(140),
      );
      await tester.pumpAndSettle();

      expect(find.text('140 awaiting sign-off'), findsOneWidget);
    });

    testWidgets(
      'a role with no work source says so instead of "Nothing needs you"',
      (WidgetTester tester) async {
        await _pumpHome(tester, access: _driver);
        await tester.pumpAndSettle();

        expect(find.byKey(HomeScreenKeys.workRow('none')), findsOneWidget);
        expect(find.text('Nothing to check for your role'), findsOneWidget);
        expect(find.byKey(HomeScreenKeys.workRow('empty')), findsNothing);
      },
    );

    testWidgets(
      'every source failing never claims "Nothing needs you", and the '
      '"Could not check" row retries',
      (WidgetTester tester) async {
        int approvalReads = 0;
        await _pumpHome(
          tester,
          access: _admin,
          draft: () => Future<InspectionDraftSummary?>.error(StateError('db')),
          alerts: () => Future<List<TyreAlert>>.error(StateError('offline')),
          approvals: () {
            approvalReads++;
            return Future<HomePendingApprovals>.error(StateError('offline'));
          },
        );
        await tester.pumpAndSettle();

        expect(
          find.byKey(HomeScreenKeys.workRow('unavailable')),
          findsOneWidget,
        );
        expect(find.byKey(HomeScreenKeys.workRow('empty')), findsNothing);
        expect(find.text('Nothing needs you right now'), findsNothing);
        expect(find.text('Try again'), findsOneWidget);

        final int before = approvalReads;
        await tester.tap(find.byKey(HomeScreenKeys.workRow('unavailable')));
        await tester.pumpAndSettle();
        expect(approvalReads, greaterThan(before));
      },
    );
  });

  group('refresh while mounted', () {
    testWidgets('pull-to-refresh re-reads the sources', (
      WidgetTester tester,
    ) async {
      int approvalReads = 0;
      await _pumpHome(
        tester,
        access: _admin,
        approvals: () async {
          approvalReads++;
          return _approvals(approvalReads);
        },
      );
      await tester.pumpAndSettle();
      expect(find.text('1 awaiting sign-off'), findsOneWidget);

      await tester.fling(
        find.byType(ListView).first,
        const Offset(0, 400),
        1000,
      );
      await tester.pumpAndSettle();

      expect(approvalReads, greaterThan(1));
      expect(find.text('2 awaiting sign-off'), findsOneWidget);
      expect(tester.takeException(), isNull);
    });

    testWidgets('becoming visible again (tab re-entry or pop) refreshes', (
      WidgetTester tester,
    ) async {
      int approvalReads = 0;
      final ValueNotifier<bool> visible = ValueNotifier<bool>(true);
      addTearDown(visible.dispose);
      await _pumpHome(
        tester,
        access: _admin,
        approvals: () async {
          approvalReads++;
          return _approvals(1);
        },
        wrap: (Widget home) => ValueListenableBuilder<bool>(
          valueListenable: visible,
          builder: (BuildContext _, bool on, Widget? __) =>
              TickerMode(enabled: on, child: home),
        ),
      );
      await tester.pumpAndSettle();
      final int afterFirstLoad = approvalReads;

      visible.value = false;
      await tester.pumpAndSettle();
      expect(approvalReads, afterFirstLoad);

      visible.value = true;
      await tester.pumpAndSettle();
      expect(approvalReads, greaterThan(afterFirstLoad));
    });
  });

  group('Your recent inspections', () {
    const List<HomeRecentAsset> recent = <HomeRecentAsset>[
      HomeRecentAsset(
        assetNo: 'TM102',
        vehicleType: 'TR-MIXER',
        health: HomeAssetHealth.good,
      ),
      HomeRecentAsset(
        assetNo: 'CP045',
        vehicleType: 'PUMPS',
        health: HomeAssetHealth.critical,
      ),
      HomeRecentAsset(assetNo: 'PL012', health: HomeAssetHealth.notChecked),
    ];

    testWidgets('renders each asset with the status that inspection recorded',
        (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin, recent: () async => recent);
      await tester.pumpAndSettle();

      expect(find.text('Your recent inspections'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.recentAsset('TM102')), findsOneWidget);
      expect(
        find.descendant(
          of: find.byKey(HomeScreenKeys.recentAsset('CP045')),
          matching: find.text('Critical'),
        ),
        findsOneWidget,
      );
      expect(
        find.descendant(
          of: find.byKey(HomeScreenKeys.recentAsset('PL012')),
          matching: find.text('Not checked'),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    });

    testWidgets('no recent inspections hides the section entirely', (
      WidgetTester tester,
    ) async {
      await _pumpHome(tester, access: _admin);
      await tester.pumpAndSettle();

      expect(find.byKey(HomeScreenKeys.recentAssets), findsNothing);
      expect(find.text('Your recent inspections'), findsNothing);
    });

    testWidgets('a failed read says "Could not check" and retries', (
      WidgetTester tester,
    ) async {
      int reads = 0;
      await _pumpHome(
        tester,
        access: _admin,
        recent: () {
          reads++;
          return Future<List<HomeRecentAsset>>.error(StateError('offline'));
        },
      );
      await tester.pumpAndSettle();

      final Finder section = find.byKey(HomeScreenKeys.recentAssets);
      expect(section, findsOneWidget);
      expect(
        find.descendant(of: section, matching: find.text('Could not check')),
        findsOneWidget,
      );
      final int before = reads;
      await tester.ensureVisible(section);
      await tester.tap(
        find.descendant(of: section, matching: find.text('Try again')),
      );
      await tester.pumpAndSettle();
      expect(reads, greaterThan(before));
    });

    testWidgets('tapping a card opens that asset', (WidgetTester tester) async {
      final GoRouter router = GoRouter(
        initialLocation: '/',
        routes: <RouteBase>[
          GoRoute(
            path: '/',
            builder: (BuildContext context, GoRouterState state) =>
                const HomeScreen(route: HomeRoute()),
          ),
          GoRoute(
            path: TpRoutePaths.vehicles,
            builder: (BuildContext context, GoRouterState state) => Text(
              'vehicle:'
              '${state.uri.queryParameters[TpRoutePaths.qAssetNo] ?? ''}',
            ),
          ),
        ],
      );
      await _pumpHome(
        tester,
        access: _admin,
        router: router,
        recent: () async => recent,
      );
      await tester.pumpAndSettle();

      final Finder card = find.byKey(HomeScreenKeys.recentAsset('CP045'));
      await tester.ensureVisible(card);
      await tester.tap(card);
      await tester.pumpAndSettle();

      expect(find.text('vehicle:CP045'), findsOneWidget);
    });
  });

  group('today\'s plan and operational summary (mocks 07-10)', () {
    MyWorkSnapshot planOf(List<MyWorkItem> items, {bool capped = false}) =>
        MyWorkSnapshot(
          items: items,
          loadedAt: _now,
          attempted: const <MyWorkSource>{MyWorkSource.inspectionPlans},
          incomplete: capped
              ? const <MyWorkSource>{MyWorkSource.inspectionPlans}
              : const <MyWorkSource>{},
        );
    final DateTime today = DateTime(2026, 8, 28);

    testWidgets(
        'the next open item on today\'s plan joins the timeline with a count '
        'of the rest', (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _admin,
        plan: () async => planOf(<MyWorkItem>[
          MyWorkItem(
            id: 'inspectionPlan:p1',
            kind: MyWorkKind.inspectionPlan,
            state: MyWorkState.dueToday,
            title: 'Tyre inspection',
            assetNo: 'PUMP-014',
            site: 'Al Quoz Yard',
            dueDay: today,
            dueAt: DateTime(2026, 8, 28, 13),
          ),
          MyWorkItem(
            id: 'inspectionPlan:p2',
            kind: MyWorkKind.inspectionPlan,
            state: MyWorkState.upcoming,
            title: 'Tomorrow check',
            assetNo: 'BUS-062',
            dueDay: today.add(const Duration(days: 1)),
          ),
          MyWorkItem(
            id: 'checklist:c1',
            kind: MyWorkKind.checklist,
            state: MyWorkState.dueToday,
            title: 'Daily Plant Checklist',
            assetNo: 'CP-045',
            dueDay: today,
          ),
        ]),
      );
      await tester.pumpAndSettle();

      final Finder row = find.byKey(HomeScreenKeys.workRow('plan'));
      expect(row, findsOneWidget);
      expect(
        find.descendant(of: row, matching: find.text('Tyre inspection')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: row, matching: find.textContaining('1 more today')),
        findsOneWidget,
        reason: 'tomorrow\'s item is not on today\'s plan',
      );
    });

    testWidgets('an empty plan adds no row', (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);
      await tester.pumpAndSettle();
      expect(find.byKey(HomeScreenKeys.workRow('plan')), findsNothing);
    });

    testWidgets(
        'summary tiles show real counts, a capped read as N+, and a failed '
        'read as "Could not check", never 0', (WidgetTester tester) async {
      await _pumpHome(
        tester,
        access: _admin,
        pendingSync: const AsyncData<int>(7),
        alerts: () async => <TyreAlert>[_criticalAlert],
        approvals: () async => _approvals(9),
        plan: () async => planOf(
          <MyWorkItem>[
            MyWorkItem(
              id: 'inspectionPlan:p1',
              kind: MyWorkKind.inspectionPlan,
              state: MyWorkState.overdue,
              assetNo: 'CP045',
              dueDay: today.subtract(const Duration(days: 1)),
            ),
          ],
          capped: true,
        ),
      );
      await tester.pumpAndSettle();

      Finder tile(String id) => find.byKey(HomeScreenKeys.summaryTile(id));
      await tester.ensureVisible(tile('approvals'));
      expect(
        find.descendant(of: tile('inspections'), matching: find.text('1+')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tile('sync'), matching: find.text('7')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tile('tyres'), matching: find.text('1')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: tile('approvals'), matching: find.text('9')),
        findsOneWidget,
      );
    });

    testWidgets('a failed queue read is said, not shown as zero', (
      WidgetTester tester,
    ) async {
      await _pumpHome(
        tester,
        access: _admin,
        pendingSync: AsyncError<int>(StateError('x'), StackTrace.empty),
      );
      await tester.pumpAndSettle();
      final Finder sync = find.byKey(HomeScreenKeys.summaryTile('sync'));
      await tester.ensureVisible(sync);
      expect(
        find.descendant(of: sync, matching: find.text('Could not check')),
        findsOneWidget,
      );
      expect(
        find.descendant(of: sync, matching: find.text('0')),
        findsNothing,
      );
    });

    testWidgets('a role without the approvals queue gets no approvals tile', (
      WidgetTester tester,
    ) async {
      await _pumpHome(tester, access: _driver);
      await tester.pumpAndSettle();
      expect(
        find.byKey(HomeScreenKeys.summaryTile('approvals')),
        findsNothing,
      );
    });
  });
}
