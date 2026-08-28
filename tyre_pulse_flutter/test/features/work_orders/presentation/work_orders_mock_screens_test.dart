import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_item.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_order_detail_screen.dart';
import 'package:tyre_pulse/features/work_orders/presentation/work_orders_list_screen.dart';
import 'package:tyre_pulse/features/work_orders/work_orders_providers.dart';

void main() {
  testWidgets('light list matches the compact three-filter work-order mock', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const WorkOrdersListScreen(route: WorkOrdersRoute()),
    );

    expect(find.byKey(WorkOrdersListScreenKeys.filters), findsOneWidget);
    expect(find.byKey(WorkOrdersListScreenKeys.results), findsOneWidget);
    expect(find.byKey(WorkOrdersListScreenKeys.row('wo-open')), findsNothing);
    expect(
      find.byKey(WorkOrdersListScreenKeys.row('wo-progress')),
      findsOneWidget,
    );
    expect(
      find.byKey(WorkOrdersListScreenKeys.row('wo-completed')),
      findsNothing,
    );
    expect(find.text('Replace 2RO tyre'), findsNothing);
    expect(find.text('Qiddiya G2'), findsOneWidget);

    await tester.tap(find.widgetWithText(ChoiceChip, 'All'));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkOrdersListScreenKeys.row('wo-open')), findsOneWidget);
    expect(
      find.byKey(WorkOrdersListScreenKeys.row('wo-progress')),
      findsOneWidget,
    );
    expect(
      find.byKey(WorkOrdersListScreenKeys.row('wo-completed')),
      findsOneWidget,
    );
    expect(find.text('Replace 2RO tyre'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('light detail keeps mock header, tabs and real lifecycle', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const WorkOrderDetailScreen(
        route: WorkOrderDetailRoute(workOrderId: WorkOrderId('wo-progress')),
      ),
    );

    expect(find.byKey(WorkOrderDetailScreenKeys.header), findsOneWidget);
    expect(find.byKey(WorkOrderDetailScreenKeys.tabs), findsOneWidget);
    expect(find.byKey(WorkOrderDetailScreenKeys.bottomAction), findsOneWidget);
    expect(find.textContaining('Mixer 4271'), findsOneWidget);
    expect(find.text('Engine overheating'), findsWidgets);
    expect(find.text('High'), findsOneWidget);

    await tester.ensureVisible(find.text('History'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('History'));
    await tester.pumpAndSettle();
    expect(find.byKey(WorkOrderDetailScreenKeys.lifecycle), findsOneWidget);
    expect(find.text('2/3'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('dark detail matches the card-based job view without fake tasks',
      (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const WorkOrderDetailScreen(
        route: WorkOrderDetailRoute(workOrderId: WorkOrderId('wo-progress')),
      ),
      dark: true,
    );

    expect(find.byKey(WorkOrderDetailScreenKeys.header), findsOneWidget);
    expect(find.byKey(WorkOrderDetailScreenKeys.lifecycle), findsOneWidget);
    expect(find.byKey(WorkOrderDetailScreenKeys.tabs), findsNothing);
    expect(find.textContaining('WO-2025-0056'), findsOneWidget);
    expect(find.textContaining('Mixer 4271'), findsOneWidget);
    expect(find.text('2/3'), findsOneWidget);
    expect(
      tester.widget<Scaffold>(find.byType(Scaffold)).backgroundColor,
      TpPalette.dark.background,
    );
    expect(tester.takeException(), isNull);
  });

  testWidgets('work-order list preserves RTL at the phone viewport', (
    WidgetTester tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await _pump(
      tester,
      const WorkOrdersListScreen(route: WorkOrdersRoute()),
      locale: const Locale('ar'),
    );

    expect(
      Directionality.of(
        tester.element(find.byKey(WorkOrdersListScreenKeys.filters)),
      ),
      TextDirection.rtl,
    );
    expect(tester.takeException(), isNull);
  });
}

Future<void> _pump(
  WidgetTester tester,
  Widget home, {
  bool dark = false,
  Locale locale = const Locale('en'),
}) async {
  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        workOrderRepositoryProvider.overrideWithValue(_FakeRepository()),
      ],
      child: MaterialApp(
        debugShowCheckedModeBanner: false,
        theme: dark ? TpTheme.dark : TpTheme.light,
        locale: locale,
        supportedLocales: TpLocalizations.supportedLocales,
        localizationsDelegates: TpLocalizations.delegates,
        home: home,
      ),
    ),
  );
  await tester.pumpAndSettle();
}

final class _FakeRepository implements WorkOrderRepository {
  static const WorkOrderItem open = WorkOrderItem(
    id: 'wo-open',
    workOrderNo: 'WO-2025-0055',
    assetNo: 'Loader 509',
    workType: 'Alignment',
    description: 'Alignment check',
    status: 'Open',
    priority: 'Medium',
    site: 'Qiddiya G2',
    openedAt: '2026-08-28T08:00:00Z',
  );

  static const WorkOrderItem progress = WorkOrderItem(
    id: 'wo-progress',
    workOrderNo: 'WO-2025-0056',
    assetNo: 'Mixer 4271',
    workType: 'Inspection',
    description: 'Engine overheating',
    status: 'In Progress',
    priority: 'High',
    site: 'Qiddiya G2',
    country: 'Saudi Arabia',
    openedAt: '2026-08-28T08:00:00Z',
    startedAt: '2026-08-28T10:28:00Z',
  );

  static const WorkOrderItem completed = WorkOrderItem(
    id: 'wo-completed',
    workOrderNo: 'WO-2025-0054',
    assetNo: 'Mixer 2841',
    workType: 'Tyre Change',
    description: 'Replace 2RO tyre',
    status: 'Completed',
    priority: 'Low',
    site: 'Qiddiya G2',
    openedAt: '2026-08-27T08:00:00Z',
    startedAt: '2026-08-27T09:00:00Z',
    completedAt: '2026-08-27T11:00:00Z',
  );

  @override
  Future<Set<String>?> advanceStatus({
    required WorkspaceContext workspace,
    required WorkOrderItem current,
  }) async =>
      <String>{};

  @override
  Future<WorkOrderItem?> byId(String id) async => switch (id) {
        'wo-progress' => progress,
        'wo-completed' => completed,
        'wo-open' => open,
        _ => null,
      };

  @override
  Future<Set<String>> create({
    required WorkspaceContext workspace,
    required CreateWorkOrderInput input,
  }) async =>
      <String>{};

  @override
  Future<String?> currentUserDisplayName(String userId) async => null;

  @override
  Future<List<WorkOrderItem>> listRecent({
    String? country,
    int limit = 300,
  }) async =>
      const <WorkOrderItem>[open, progress, completed];
}
