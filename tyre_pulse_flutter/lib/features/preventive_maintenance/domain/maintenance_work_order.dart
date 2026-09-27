/// Open work orders as the Maintenance Control Center reads them, and the
/// pure rule that merges them with due preventive maintenance plans into one
/// priority queue.
///
/// # Where every field comes from
///
/// All columns are real `work_orders` columns, each traced to the migration
/// that creates it:
///
/// - `id`, `work_order_no`, `asset_no`, `work_type`, `status`, `priority`,
///   `site`, `opened_at`, `target_completion` - `MIGRATIONS_V16.sql`.
/// - `asset_category` - `MIGRATIONS_V381_JOB_CARD_INTAKE.sql`.
/// - `assigned_owner_id` (uuid -> `profiles.id`) -
///   `MIGRATIONS_V291_WORKSHOP_LIVE_CONTROL.sql`.
///
/// # "Open" and "breakdown"
///
/// `work_orders_status_check` (`MIGRATIONS_V497_WORK_ORDER_STATUS_CHECK_UNION
/// .sql`) allows exactly the canonical Title Case vocabulary plus the legacy
/// `Open`, `Closed` and `Awaiting Parts`, and the column is NOT NULL. So the
/// finished set is exactly [kTerminalWorkOrderStatuses] - `Completed`,
/// `Closed` (the legacy spelling of Completed that `normalizeWoStatus` in
/// `src/lib/workOrderStatus.js` folds onto it) and `Cancelled` - and every
/// other value is active work. No casing variant can be stored, so an exact
/// `not in` is correct server side.
///
/// A breakdown is `work_type = 'Emergency'`: the job card intake maps the
/// ERP's "Break Down" type onto it (V381) and `get_daily_job_cards` (V381c)
/// counts breakdowns the same way.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/pm_plan.dart';

/// Statuses that mean the work order is finished. See the library comment.
const List<String> kTerminalWorkOrderStatuses = <String>[
  'Completed',
  'Closed',
  'Cancelled',
];

/// The `work_type` value a breakdown carries. See the library comment.
const String kBreakdownWorkType = 'Emergency';

/// How many open work orders the control center previews. The full list is
/// one tap away on the Work Orders screen; the KPI tile carries the exact
/// total, so a preview never pretends to be the whole register.
const int kQueueWorkOrderPreview = 8;

@immutable
final class MaintenanceWorkOrder {
  const MaintenanceWorkOrder({
    required this.id,
    this.workOrderNo,
    this.assetNo,
    this.assetCategory,
    this.workType,
    this.status,
    this.priority,
    this.site,
    this.openedAt,
    this.targetCompletion,
    this.assignedOwnerId,
    this.technicianName,
  });

  final String id;
  final String? workOrderNo;
  final String? assetNo;
  final String? assetCategory;
  final String? workType;
  final String? status;
  final String? priority;
  final String? site;
  final DateTime? openedAt;
  final DateTime? targetCompletion;
  final String? assignedOwnerId;

  /// `profiles.full_name` of [assignedOwnerId]. Null when nobody is assigned
  /// or the name could not be read - never a guessed name.
  final String? technicianName;

  bool get isBreakdown =>
      (workType ?? '').trim().toLowerCase() == kBreakdownWorkType.toLowerCase();

  /// Whole days from today to [targetCompletion]; negative when overdue,
  /// null when no target is recorded.
  int? daysToTarget(DateTime now) {
    final DateTime? target = targetCompletion?.toLocal();
    if (target == null) return null;
    final DateTime today = DateTime.utc(now.year, now.month, now.day);
    final DateTime day = DateTime.utc(target.year, target.month, target.day);
    return day.difference(today).inDays;
  }

  MaintenanceWorkOrder withTechnician(String? name) => MaintenanceWorkOrder(
        id: id,
        workOrderNo: workOrderNo,
        assetNo: assetNo,
        assetCategory: assetCategory,
        workType: workType,
        status: status,
        priority: priority,
        site: site,
        openedAt: openedAt,
        targetCompletion: targetCompletion,
        assignedOwnerId: assignedOwnerId,
        technicianName: name,
      );
}

/// 0 is the most urgent. Unknown or blank priorities sort last.
int workOrderPriorityRank(String? priority) =>
    switch ((priority ?? '').trim().toLowerCase()) {
      'critical' => 0,
      'high' => 1,
      'medium' => 2,
      'low' => 3,
      _ => 4,
    };

/// One row of the priority queue: either an open work order or a PM plan.
@immutable
sealed class MaintenanceQueueEntry {
  const MaintenanceQueueEntry();
}

final class WorkOrderQueueEntry extends MaintenanceQueueEntry {
  const WorkOrderQueueEntry(this.workOrder);
  final MaintenanceWorkOrder workOrder;
}

final class PmPlanQueueEntry extends MaintenanceQueueEntry {
  const PmPlanQueueEntry(this.plan);
  final PmPlan plan;
}

/// Orders work orders the way the queue shows them: breakdowns first, then
/// by priority, then the one open longest first (a job that has waited
/// longer is the more urgent of two equals). Ties break on id so the order
/// is stable between refreshes.
List<MaintenanceWorkOrder> sortWorkOrdersByUrgency(
  Iterable<MaintenanceWorkOrder> orders,
) {
  final List<MaintenanceWorkOrder> sorted = orders.toList();
  sorted.sort((MaintenanceWorkOrder a, MaintenanceWorkOrder b) {
    if (a.isBreakdown != b.isBreakdown) return a.isBreakdown ? -1 : 1;
    final int byPriority = workOrderPriorityRank(a.priority)
        .compareTo(workOrderPriorityRank(b.priority));
    if (byPriority != 0) return byPriority;
    final DateTime? ao = a.openedAt;
    final DateTime? bo = b.openedAt;
    if (ao != null && bo != null && ao != bo) return ao.compareTo(bo);
    if (ao == null && bo != null) return 1;
    if (ao != null && bo == null) return -1;
    return a.id.compareTo(b.id);
  });
  return sorted;
}

/// Merges open work orders with the PM plans already filtered for display.
///
/// Urgency order, most urgent first:
/// 1. breakdown work orders;
/// 2. overdue PM plans;
/// 3. every other open work order, by priority then age;
/// 4. the remaining PM plans (due soon, then the rest), in the order given.
///
/// At most [workOrderLimit] work orders are included; the rest are one tap
/// away on the Work Orders screen.
List<MaintenanceQueueEntry> buildMaintenanceQueue({
  required List<MaintenanceWorkOrder> workOrders,
  required List<PmPlan> plans,
  required DateTime now,
  int workOrderLimit = kQueueWorkOrderPreview,
}) {
  final List<MaintenanceWorkOrder> orders =
      sortWorkOrdersByUrgency(workOrders).take(workOrderLimit).toList();
  final List<PmPlan> overdue = plans
      .where((PmPlan plan) => plan.dueBand(now) == PmDueBand.overdue)
      .toList(growable: false);
  final List<PmPlan> rest = plans
      .where((PmPlan plan) => plan.dueBand(now) != PmDueBand.overdue)
      .toList(growable: false);
  return <MaintenanceQueueEntry>[
    for (final MaintenanceWorkOrder order in orders)
      if (order.isBreakdown) WorkOrderQueueEntry(order),
    for (final PmPlan plan in overdue) PmPlanQueueEntry(plan),
    for (final MaintenanceWorkOrder order in orders)
      if (!order.isBreakdown) WorkOrderQueueEntry(order),
    for (final PmPlan plan in rest) PmPlanQueueEntry(plan),
  ];
}
