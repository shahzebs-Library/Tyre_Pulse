/// One `work_orders` row, decoded for the Work Orders list and its detail
/// screen.
///
/// Ported from `mobile/app/(app)/work-orders.tsx`'s own `WorkOrder`
/// interface (`mobile/` is READ-ONLY reference material - see `AGENTS.md`).
/// Mirrors `features/approvals/data/inspection_approval_item.dart`'s own
/// shape exactly: the list reads [workOrderListColumns] (the reference
/// screen's own lean column set - `id,work_order_no,asset_no,work_type,
/// status,priority,description,site,total_cost,opened_at`, verbatim), the
/// detail screen reads [workOrderDetailColumns] (the same set plus
/// `started_at`/`completed_at`/`country`, all real `work_orders` columns
/// already written by `CommandType.workOrderStatus`'s own field allow-list
/// in `core/sync/command_registry.dart` - a genuinely new surface, not a
/// literal 1:1 port of a modal, per `routes.dart`'s own doc comment on
/// [WorkOrderDetailRoute]), and both are decoded through this SAME
/// [WorkOrderItem.fromRow].
///
/// # `total_cost` is read, and deliberately never displayed
///
/// [totalCost] exists only for parity with the reference query, which also
/// selects `total_cost` and then never renders it anywhere in that
/// screen's own UI. This port goes one step further, deliberately: a
/// figure is not surfaced at all rather than surfaced with no currency
/// attached. `core/workspace/workspace_context.dart`'s own library comment
/// states the rule this follows - "a monetary figure with no currency is
/// not shown at all" - and a `work_orders` row here can genuinely be in a
/// DIFFERENT country from the signed-in user's active one (see
/// [workOrderCountryFilter]'s own doc comment: a row with `country = null`
/// is visible under every country filter), so there is no currency this
/// screen can honestly attribute to it. Do not add a currency symbol or
/// code around [totalCost] without first resolving a genuine per-row
/// currency.
library;

/// Every column [WorkOrderItem.fromRow] can read for the LIST. Matches
/// `work-orders.tsx`'s own `.select(...)` string verbatim, column for
/// column and in the same order.
const String workOrderListColumns =
    'id,work_order_no,asset_no,work_type,'
    'status,priority,description,site,total_cost,opened_at';

/// Every column [WorkOrderItem.fromRow] can read for the DETAIL screen.
/// The list columns plus the three real, already-written columns the
/// detail screen additionally renders. See the library comment.
const String workOrderDetailColumns =
    '$workOrderListColumns,'
    'started_at,completed_at,country';

String? _asString(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

num? _asNum(Object? raw) => raw is num ? raw : null;

final class WorkOrderItem {
  const WorkOrderItem({
    required this.id,
    this.workOrderNo,
    this.assetNo,
    this.workType,
    this.status,
    this.priority,
    this.description,
    this.site,
    this.totalCost,
    this.openedAt,
    this.startedAt,
    this.completedAt,
    this.country,
  });

  /// The server row id. Never null on a real row - `work_orders.id` is the
  /// primary key - so a row this cannot be read from is a genuinely broken
  /// invariant, mirroring `InspectionApprovalItem.fromRow`'s own throwing
  /// convention over the same shape of table.
  final String id;

  final String? workOrderNo;
  final String? assetNo;
  final String? workType;

  /// Free text on the live schema - see `domain/work_order_status.dart`'s
  /// own library comment on why this is never decoded into an enum here.
  final String? status;

  /// One of [kWorkOrderPriorities] on a row the create form wrote; free
  /// text on the column itself.
  final String? priority;

  final String? description;
  final String? site;

  /// Read for parity with the reference query only. See the library
  /// comment on why this is never rendered.
  final num? totalCost;

  final String? openedAt;

  /// Stamped by `CommandType.workOrderStatus` when this work order is
  /// advanced to [kWorkOrderStatusInProgress]. Null on a row nobody has
  /// advanced yet.
  final String? startedAt;

  /// Stamped by `CommandType.workOrderStatus` when this work order is
  /// advanced to [kWorkOrderStatusCompleted]. Null on a row that has not
  /// reached that state.
  final String? completedAt;

  /// Only selected/decoded for the detail screen - see
  /// [workOrderDetailColumns]. Null on a row decoded from
  /// [workOrderListColumns] even when the underlying column is populated,
  /// exactly as `InspectionApprovalItem.fromRow`'s own library comment
  /// describes for a column its row never selected.
  final String? country;

  /// Decodes [row] as read via [workOrderListColumns] or
  /// [workOrderDetailColumns].
  factory WorkOrderItem.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException('Work order row has no usable "id".');
    }

    return WorkOrderItem(
      id: rawId,
      workOrderNo: _asString(row['work_order_no']),
      assetNo: _asString(row['asset_no']),
      workType: _asString(row['work_type']),
      status: _asString(row['status']),
      priority: _asString(row['priority']),
      description: _asString(row['description']),
      site: _asString(row['site']),
      totalCost: _asNum(row['total_cost']),
      openedAt: _asString(row['opened_at']),
      startedAt: _asString(row['started_at']),
      completedAt: _asString(row['completed_at']),
      country: _asString(row['country']),
    );
  }
}
