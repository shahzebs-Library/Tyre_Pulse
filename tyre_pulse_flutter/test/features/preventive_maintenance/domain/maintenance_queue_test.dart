import 'package:flutter_test/flutter_test.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

void main() {
  final DateTime now = DateTime(2026, 8, 28, 10);

  MaintenanceWorkOrder order(
    String id, {
    String workType = 'Repair',
    String? priority,
    DateTime? opened,
    DateTime? target,
  }) =>
      MaintenanceWorkOrder(
        id: id,
        workType: workType,
        priority: priority,
        openedAt: opened,
        targetCompletion: target,
      );

  test('a breakdown is an Emergency work type, case-insensitively', () {
    expect(order('a', workType: 'Emergency').isBreakdown, isTrue);
    expect(order('b', workType: ' emergency ').isBreakdown, isTrue);
    expect(order('c').isBreakdown, isFalse);
  });

  test('terminal statuses are exactly the finished values of the V497 CHECK',
      () {
    expect(kTerminalWorkOrderStatuses, <String>[
      'Completed',
      'Closed',
      'Cancelled',
    ]);
  });

  test('daysToTarget is null without a target and negative when overdue', () {
    expect(order('a').daysToTarget(now), isNull);
    expect(
      order('b', target: DateTime(2026, 8, 27, 18)).daysToTarget(now),
      -1,
    );
    expect(
      order('c', target: DateTime(2026, 8, 28, 23)).daysToTarget(now),
      0,
    );
  });

  test('urgency: breakdowns, then priority, then the longest open', () {
    final List<MaintenanceWorkOrder> sorted = sortWorkOrdersByUrgency(
      <MaintenanceWorkOrder>[
        order('low-old', priority: 'Low', opened: DateTime(2026, 8)),
        order('high-new', priority: 'High', opened: DateTime(2026, 8, 20)),
        order('high-old', priority: 'High', opened: DateTime(2026, 8, 10)),
        order(
          'breakdown',
          workType: 'Emergency',
          priority: 'Low',
          opened: DateTime(2026, 8, 27),
        ),
        order('unknown', priority: 'whatever'),
      ],
    );
    expect(sorted.map((MaintenanceWorkOrder o) => o.id), <String>[
      'breakdown',
      'high-old',
      'high-new',
      'low-old',
      'unknown',
    ]);
  });

  test('queue merges breakdowns, overdue PM, other work, then the rest', () {
    final PmPlan overdue = PmPlan(
      id: 'pm-overdue',
      nextDue: now.subtract(const Duration(days: 2)),
    );
    final PmPlan soon = PmPlan(
      id: 'pm-soon',
      nextDue: now.add(const Duration(days: 3)),
    );
    final List<MaintenanceQueueEntry> queue = buildMaintenanceQueue(
      workOrders: <MaintenanceWorkOrder>[
        order('repair', priority: 'High'),
        order('breakdown', workType: 'Emergency'),
      ],
      plans: <PmPlan>[soon, overdue],
      now: now,
    );
    expect(
      queue.map(
        (MaintenanceQueueEntry entry) => switch (entry) {
          WorkOrderQueueEntry(:final MaintenanceWorkOrder workOrder) =>
            workOrder.id,
          PmPlanQueueEntry(:final PmPlan plan) => plan.id,
        },
      ),
      <String>['breakdown', 'pm-overdue', 'repair', 'pm-soon'],
    );
  });

  test('the queue previews at most the limit of work orders', () {
    final List<MaintenanceQueueEntry> queue = buildMaintenanceQueue(
      workOrders: <MaintenanceWorkOrder>[
        for (int i = 0; i < 12; i++) order('wo-$i'),
      ],
      plans: const <PmPlan>[],
      now: now,
    );
    expect(queue, hasLength(kQueueWorkOrderPreview));
  });
}
