/// [HomeScreen] rendered over a real [AccessState], the same override shape
/// `main.dart` wires at the composition root
/// (`accessStateProvider.overrideWith((ref) =>
/// ref.watch(workspaceContextProvider)?.effectivePermissions ??
/// AccessState.signedOut)`).
///
/// # Why this file exists
///
/// These tests pump the real responsive hierarchy at compact and default
/// widths. They protect both the earlier unbounded-stat-row failure and the
/// fixed-aspect quick-action grid that clipped longer translated labels.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_riverpod/misc.dart' show Override;
import 'package:flutter_test/flutter_test.dart';
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
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart';
import 'package:tyre_pulse/features/assets/presentation/'
    'vehicle_fleet_providers.dart';
import 'package:tyre_pulse/features/home/home_providers.dart';
import 'package:tyre_pulse/features/home/presentation/home_screen.dart';
import 'package:tyre_pulse/features/notifications/notifications_providers.dart';
import 'package:tyre_pulse/features/tasks/data/task_item.dart';

import '../../../core/database/database_test_support.dart';

/// A trivial fleet source: an empty page for every read, never a Supabase
/// call. `vehicleFleetSourceProvider`'s real default reads
/// `supabaseClientProvider`, which throws until `Supabase.initialize` has
/// run - never true in a widget test - so any role this suite gives
/// `ModuleKey.vehicles` access to needs this override or the pump never
/// reaches a settled frame at all.
class _EmptyVehicleFleetSource implements VehicleFleetSource {
  @override
  Future<List<Map<String, dynamic>>> fetchPage({
    required int from,
    required int to,
    required String? country,
  }) async =>
      <Map<String, dynamic>>[];

  @override
  Future<Map<String, dynamic>?> fetchByAssetNo({
    required String assetNo,
    required String? country,
  }) async =>
      null;
}

const AccessState _admin = AccessState(role: UserRole.known(RoleId.admin));
const AccessState _tyreMan = AccessState(role: UserRole.known(RoleId.tyreMan));

Future<void> _pumpHome(
  WidgetTester tester, {
  required AccessState access,
  String? legacySite = 'NHC',
  Locale locale = const Locale('en'),
  int notificationCount = 0,
  List<Override> extraOverrides = const <Override>[],
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
    vehicleFleetSourceProvider.overrideWith(
      (Ref ref) => _EmptyVehicleFleetSource(),
    ),
    unreadNotificationsCountProvider.overrideWithValue(
      AsyncData<int>(notificationCount),
    ),
    ...extraOverrides,
  ];

  await tester.pumpWidget(
    ProviderScope(
      overrides: overrides,
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: const HomeScreen(route: HomeRoute()),
      ),
    ),
  );
  // Deliberately not `pumpAndSettle`: the app bar's `NavigationBar`-style
  // ripple/scale animations elsewhere in this app never fully quiesce on
  // their own within a bounded pump, matching the reasoning
  // `profile_screen_test.dart` gives for the same choice. Two bounded pumps
  // is enough for the fleet `FutureProvider` to resolve and the stat cards
  // to settle into their final state.
  await tester.pump();
  await tester.pump(const Duration(milliseconds: 50));
}

void main() {
  testWidgets(
    'approved Home dashboard has a deterministic full-data visual contract',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 780);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      final List<InspectionApprovalItem> approvals = List.generate(
        8,
        (int index) => InspectionApprovalItem(id: 'approval-$index'),
      );
      final List<TaskItem> tasks = List.generate(
        12,
        (int index) => TaskItem(
          id: 'task-$index',
          title: index == 0 ? 'PM • Mixer 3821' : 'Scheduled work ${index + 1}',
          priority: index == 0 ? 'urgent' : 'normal',
          status: 'open',
          site: index == 0 ? 'Diriyah' : 'NHC',
          assetNo: index == 0 ? 'Mixer 3821' : null,
          description: index == 0 ? 'Preventive Maintenance' : null,
          assignedTo: index == 0 ? 'user-1' : null,
          dueDate: DateTime(2025, 1, index + 1),
        ),
      );
      const List<TyreAlert> alerts = <TyreAlert>[
        TyreAlert(
          id: 'alert-1',
          riskLevel: 'critical',
          assetNo: 'Mixer 4271',
          position: 'Rear outer tyre',
          site: 'Qiddiya G2',
          issueDate: '2026-08-28T12:00:00Z',
        ),
        TyreAlert(id: 'alert-2', riskLevel: 'critical'),
        TyreAlert(id: 'alert-3', riskLevel: 'critical'),
      ];

      await _pumpHome(
        tester,
        access: _admin,
        legacySite: 'Qiddiya G2',
        notificationCount: 3,
        extraOverrides: <Override>[
          homePendingInspectionApprovalsProvider.overrideWith(
            (Ref ref) async => approvals,
          ),
          homeTaskPreviewProvider.overrideWith((Ref ref) async => tasks),
          tyreAlertsProvider.overrideWith((Ref ref) async => alerts),
        ],
      );

      for (final String value in <String>['8', '12', '3']) {
        expect(
          find.descendant(
            of: find.byKey(HomeScreenKeys.stats),
            matching: find.text(value),
          ),
          findsOneWidget,
        );
      }
      expect(find.text('Mixer 4271'), findsOneWidget);
      expect(find.text('Rear outer tyre • Qiddiya G2'), findsOneWidget);
      expect(find.text('PM • Mixer 3821'), findsOneWidget);
      expect(
        find.text('Mixer 3821 • Preventive Maintenance'),
        findsOneWidget,
      );
      expect(find.byIcon(Icons.fact_check_outlined), findsNothing);
      expect(find.byIcon(Icons.schedule_rounded), findsNothing);

      expect(find.byType(HomeScreen), findsOneWidget);
      expect(
        find.byKey(
          const ValueKey<String>(
            'assets/vehicle_photos/concrete_pump.png',
          ),
        ),
        findsOneWidget,
      );
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'an Admin renders the full Home hub with no layout exception: '
    'greeting, both quick-action buttons, the stat-card row and every '
    'section - never a blank body under a normal app bar',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin);

      expect(
        tester.takeException(),
        isNull,
        reason: 'the stat-card Row must never throw a layout exception - '
            'see this file\'s own library comment for the defect this guards',
      );

      expect(find.text('Mohammed'), findsOneWidget);
      expect(find.text('ATTENTION REQUIRED'), findsOneWidget);
      expect(find.text('Approvals'), findsOneWidget);
      expect(find.text('Overdue'), findsOneWidget);
      expect(find.text('Critical'), findsOneWidget);
      expect(find.text('MY WORK'), findsOneWidget);
      expect(find.text('QUICK ACTIONS'), findsOneWidget);
      expect(find.text('Inspect'), findsWidgets);
      expect(find.text('Asset'), findsOneWidget);
      expect(find.text('Report issue'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.hero), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.stats), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('inspect')), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('asset')), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('reportIssue')), findsOneWidget);
      expect(find.byType(GridView), findsNothing);
      // The Admin break-glass allows every module, so there is never a
      // reason to fall back to the "nothing available" empty state.
      expect(
        find.text(
          'Nothing is available to you here yet. Contact your '
          'administrator if you need access to a feature.',
        ),
        findsNothing,
      );
    },
  );

  testWidgets(
    'a role scoped to only some modules still renders the unconditional '
    'header content with no layout exception',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _tyreMan);

      expect(tester.takeException(), isNull);
      expect(find.text('Mohammed'), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.hero), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.stats), findsOneWidget);
      expect(find.text('Inspect'), findsWidgets);
    },
  );

  testWidgets(
    'no site on the profile renders the honest "unavailable" stat card, '
    'not a fabricated one, and still no layout exception',
    (WidgetTester tester) async {
      await _pumpHome(tester, access: _admin, legacySite: null);

      expect(tester.takeException(), isNull);
      expect(find.text('No site on file'), findsOneWidget);
    },
  );

  testWidgets(
    'a compact phone keeps the PMV hierarchy readable without overflow',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpHome(tester, access: _admin);

      expect(tester.takeException(), isNull);
      expect(find.byKey(HomeScreenKeys.hero), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.stats), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('inspect')), findsOneWidget);
      expect(find.byType(GridView), findsNothing);
    },
  );

  testWidgets(
    'the approved compact hierarchy remains ordered on a narrow phone',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(320, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpHome(tester, access: _admin);

      final double attentionY =
          tester.getTopLeft(find.text('ATTENTION REQUIRED')).dy;
      final double workY = tester.getTopLeft(find.text('MY WORK')).dy;
      final double actionsY = tester.getTopLeft(find.text('QUICK ACTIONS')).dy;
      expect(attentionY, lessThan(workY));
      expect(workY, lessThan(actionsY));
      expect(tester.takeException(), isNull);
    },
  );

  testWidgets(
    'Arabic keeps the compact approved layout and all primary actions',
    (WidgetTester tester) async {
      tester.view.physicalSize = const Size(360, 720);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);

      await _pumpHome(
        tester,
        access: _admin,
        locale: const Locale('ar'),
      );

      expect(find.byKey(HomeScreenKeys.action('asset')), findsOneWidget);
      expect(find.byKey(HomeScreenKeys.action('reportIssue')), findsOneWidget);
      expect(tester.takeException(), isNull);
    },
  );
}
