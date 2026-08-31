import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
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
import 'package:tyre_pulse/features/work_orders/presentation/work_order_detail_screen.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

const WorkspaceContext _workspace = WorkspaceContext(
  userId: 'user-1',
  role: UserRole.known(RoleId.admin),
  effectivePermissions: AccessState(role: UserRole.known(RoleId.admin)),
  countryScope: CountryScope.none,
  siteScope: SiteScope.none,
);

final class _WorkOrderRepository implements WorkOrderRepository {
  bool advanced = false;

  static const WorkOrderItem _open = WorkOrderItem(
    id: 'wo-1',
    workOrderNo: 'WO-1',
    assetNo: 'Mixer 4271',
    workType: 'Inspection',
    description: 'Engine overheating',
    status: 'Open',
    priority: 'High',
    site: 'Qiddiya G2',
    openedAt: '2026-08-28T08:00:00Z',
  );

  static const WorkOrderItem _inProgress = WorkOrderItem(
    id: 'wo-1',
    workOrderNo: 'WO-1',
    assetNo: 'Mixer 4271',
    workType: 'Inspection',
    description: 'Engine overheating',
    status: 'In Progress',
    priority: 'High',
    site: 'Qiddiya G2',
    openedAt: '2026-08-28T08:00:00Z',
    startedAt: '2026-08-28T10:28:00Z',
  );

  @override
  Future<Set<String>?> advanceStatus({
    required WorkspaceContext workspace,
    required WorkOrderItem current,
  }) async {
    advanced = true;
    return const <String>{};
  }

  @override
  Future<WorkOrderItem?> byId(String id) async =>
      advanced ? _inProgress : _open;

  @override
  Future<Set<String>> create({
    required WorkspaceContext workspace,
    required CreateWorkOrderInput input,
  }) async =>
      const <String>{};

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<List<WorkOrderItem>> listRecent({
    String? country,
    int limit = 300,
  }) async =>
      <WorkOrderItem>[advanced ? _inProgress : _open];
}

void main() {
  testWidgets('compact work-order action advances and refreshes the detail', (
    WidgetTester tester,
  ) async {
    tester.view.physicalSize = const Size(320, 640);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.reset);
    final _WorkOrderRepository repository = _WorkOrderRepository();

    await tester.pumpWidget(
      ProviderScope(
        overrides: [
          workspaceContextProvider.overrideWithValue(_workspace),
          workOrderRepositoryProvider.overrideWithValue(repository),
        ],
        child: MaterialApp(
          theme: TpTheme.light,
          locale: const Locale('en'),
          supportedLocales: TpLocalizations.supportedLocales,
          localizationsDelegates: TpLocalizations.delegates,
          home: const WorkOrderDetailScreen(
            route: WorkOrderDetailRoute(
              workOrderId: WorkOrderId('wo-1'),
            ),
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('In Progress'), findsOneWidget);
    await tester.tap(
      find.byKey(WorkOrderDetailScreenKeys.bottomAction),
    );
    await tester.pumpAndSettle();

    expect(repository.advanced, isTrue);
    expect(find.text('Completed'), findsOneWidget);
    expect(
      find.text('Status update saved. It will sync automatically.'),
      findsOneWidget,
    );
    expect(tester.takeException(), isNull);
  });
}
