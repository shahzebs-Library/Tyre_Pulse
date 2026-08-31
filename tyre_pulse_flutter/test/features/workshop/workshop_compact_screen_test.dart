import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/permissions/access_resolver.dart';
import 'package:tyre_pulse/core/permissions/roles.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/core/workspace/workspace_providers.dart';
import 'package:tyre_pulse/core/workspace/workspace_scope.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_orders_list_screen.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_screen.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'engineer-1',
  role: UserRole.known(RoleId.workshopSupervisor),
  effectivePermissions: AccessState(
    role: UserRole.known(RoleId.workshopSupervisor),
  ),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
  fullName: 'Vinay Kumar',
);

void main() {
  testWidgets('Workshop route renders its compact actionable job-card board', (
    WidgetTester tester,
  ) async {
    final _WorkshopRepository repository = _WorkshopRepository();
    await _pump(tester, repository);

    expect(find.byType(WorkshopScreen), findsOneWidget);
    expect(find.byType(WorkOrdersListScreen), findsOneWidget);
    expect(find.byKey(WorkOrdersListScreenKeys.filters), findsOneWidget);
    expect(find.byKey(WorkOrdersListScreenKeys.row('wo-56')), findsOneWidget);
    await expectLater(
      find.byType(WorkshopScreen),
      matchesGoldenFile('goldens/workshop_compact_en.png'),
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('Workshop board controls filter, advance, and open real targets',
      (
    WidgetTester tester,
  ) async {
    final _WorkshopRepository repository = _WorkshopRepository();
    final GoRouter router = await _pump(tester, repository);

    await tester.tap(find.byIcon(Icons.filter_alt_outlined));
    await tester.pumpAndSettle();
    expect(find.byType(BottomSheet), findsOneWidget);
    await tester.tap(find.text('All').last);
    await tester.pumpAndSettle();
    expect(find.byKey(WorkOrdersListScreenKeys.row('wo-55')), findsOneWidget);

    await tester.tap(find.byIcon(Icons.add_rounded));
    await tester.pumpAndSettle();
    expect(find.text('New work order'), findsOneWidget);
    Navigator.of(tester.element(find.text('New work order'))).pop();
    await tester.pumpAndSettle();

    await tester.tap(find.byKey(WorkOrdersListScreenKeys.row('wo-56')));
    await tester.pumpAndSettle();
    expect(find.text('detail wo-56'), findsOneWidget);

    router.go(TpRoutePaths.workshop);
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(WorkOrdersListScreenKeys.advance('wo-56')));
    await tester.pumpAndSettle();
    expect(repository.advanced, isTrue);
    expect(
      find.text('Status update saved. It will sync automatically.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}

Future<GoRouter> _pump(
  WidgetTester tester,
  WorkOrderRepository repository,
) async {
  await tester.binding.setSurfaceSize(const Size(390, 844));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  final GoRouter router = GoRouter(
    initialLocation: TpRoutePaths.workshop,
    routes: <RouteBase>[
      GoRoute(
        path: TpRoutePaths.workshop,
        builder: (BuildContext context, GoRouterState state) =>
            const WorkshopScreen(),
      ),
      GoRoute(
        path: '/work-orders/:workOrderId',
        builder: (BuildContext context, GoRouterState state) => Scaffold(
          body: Text('detail ${state.pathParameters['workOrderId']}'),
        ),
      ),
    ],
  );
  addTearDown(router.dispose);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workOrderRepositoryProvider.overrideWithValue(repository),
        workspaceContextProvider.overrideWithValue(_workspace),
      ],
      child: MaterialApp.router(
        debugShowCheckedModeBanner: false,
        routerConfig: router,
        theme: TpTheme.light,
        locale: const Locale('en'),
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
      ),
    ),
  );
  await tester.pumpAndSettle();
  return router;
}

final class _WorkshopRepository implements WorkOrderRepository {
  bool advanced = false;

  @override
  Future<Set<String>?> advanceStatus({
    required WorkspaceContext workspace,
    required WorkOrderItem current,
  }) async {
    advanced = true;
    return const <String>{'queued'};
  }

  @override
  Future<WorkOrderItem?> byId(String id) async => null;

  @override
  Future<Set<String>> create({
    required WorkspaceContext workspace,
    required CreateWorkOrderInput input,
  }) async =>
      const <String>{'queued'};

  @override
  Future<String?> currentUserDisplayName(String userId) async => 'Vinay Kumar';

  @override
  Future<List<WorkOrderItem>> listRecent({
    String? country,
    int limit = 300,
  }) async =>
      <WorkOrderItem>[
        const WorkOrderItem(
          id: 'wo-55',
          workOrderNo: 'WO-2026-0055',
          assetNo: 'Loader 509',
          workType: 'Alignment',
          description: 'Alignment check',
          status: 'Open',
          priority: 'Medium',
          site: 'Qiddiya G2',
          openedAt: '2026-08-28T08:00:00Z',
        ),
        WorkOrderItem(
          id: 'wo-56',
          workOrderNo: 'WO-2026-0056',
          assetNo: 'Mixer 4271',
          workType: 'Inspection',
          description: 'Engine overheating',
          status: advanced ? 'Completed' : 'In Progress',
          priority: 'High',
          site: 'Qiddiya G2',
          openedAt: '2026-08-28T08:00:00Z',
          startedAt: '2026-08-28T10:28:00Z',
        ),
      ];
}
