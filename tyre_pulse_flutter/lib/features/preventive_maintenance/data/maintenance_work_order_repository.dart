/// The Maintenance Control Center's reads over `work_orders`: two exact
/// head counts for the KPI tiles and a bounded preview of open work orders
/// for the priority queue.
///
/// Online-only reads; nothing here writes. Country scoping reuses
/// [workOrderCountryFilter] from the Work Orders feature, so a job card with
/// `country = null` is counted under every country, exactly as the Work
/// Orders list shows it (a strict `.eq` on this table once hid 55,606 rows).
///
/// See `domain/maintenance_work_order.dart` for which migration creates each
/// column read here, and why `not in (Completed, Closed, Cancelled)` is the
/// exact definition of "active".
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/preventive_maintenance/domain/maintenance_work_order.dart';
import 'package:tyre_pulse/features/work_orders/data/work_order_repository.dart'
    show workOrderCountryFilter;

/// Columns the queue preview reads. Every one is traced in the domain file.
const String maintenanceWorkOrderColumns =
    'id,work_order_no,asset_no,asset_category,work_type,status,priority,'
    'site,opened_at,target_completion,assigned_owner_id';

/// The PostgREST value for `status=not.in.(...)`.
final String _terminalStatusList = '(${kTerminalWorkOrderStatuses.join(',')})';

abstract interface class MaintenanceWorkOrderRepository {
  /// Exact count of open breakdowns (`work_type = 'Emergency'`, not
  /// finished).
  Future<int> countOpenBreakdowns({String? country});

  /// Exact count of every work order that is not finished.
  Future<int> countActiveWorkOrders({String? country});

  /// Open work orders for the priority queue: open breakdowns (oldest
  /// first) plus the newest other open work orders, each list bounded by
  /// [limit]. Technician names are resolved from `profiles`.
  Future<List<MaintenanceWorkOrder>> listOpenForQueue({
    String? country,
    int limit = 25,
  });
}

final class SupabaseMaintenanceWorkOrderRepository
    with SupabaseGateway
    implements MaintenanceWorkOrderRepository {
  SupabaseMaintenanceWorkOrderRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<int> countOpenBreakdowns({String? country}) {
    return guard<int>(() async {
      var query = _client
          .from(SupabaseTables.workOrders)
          .count(CountOption.exact)
          .eq('work_type', kBreakdownWorkType)
          .not('status', 'in', _terminalStatusList);
      final String? filter = workOrderCountryFilter(country);
      if (filter != null) query = query.or(filter);
      return await query;
    });
  }

  @override
  Future<int> countActiveWorkOrders({String? country}) {
    return guard<int>(() async {
      var query = _client
          .from(SupabaseTables.workOrders)
          .count(CountOption.exact)
          .not('status', 'in', _terminalStatusList);
      final String? filter = workOrderCountryFilter(country);
      if (filter != null) query = query.or(filter);
      return await query;
    });
  }

  @override
  Future<List<MaintenanceWorkOrder>> listOpenForQueue({
    String? country,
    int limit = 25,
  }) async {
    final String? filter = workOrderCountryFilter(country);
    final List<Map<String, dynamic>> breakdowns =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.workOrders)
          .select(maintenanceWorkOrderColumns)
          .eq('work_type', kBreakdownWorkType)
          .not('status', 'in', _terminalStatusList);
      if (filter != null) query = query.or(filter);
      return await query
          .order('opened_at', ascending: true)
          .order('id', ascending: true)
          .limit(limit);
    });
    final List<Map<String, dynamic>> others =
        await guard<List<Map<String, dynamic>>>(() async {
      var query = _client
          .from(SupabaseTables.workOrders)
          .select(maintenanceWorkOrderColumns)
          .neq('work_type', kBreakdownWorkType)
          .not('status', 'in', _terminalStatusList);
      if (filter != null) query = query.or(filter);
      return await query
          .order('opened_at', ascending: false)
          .order('id', ascending: true)
          .limit(limit);
    });
    final List<MaintenanceWorkOrder> orders = <MaintenanceWorkOrder>[
      for (final Map<String, dynamic> row in <Map<String, dynamic>>[
        ...breakdowns,
        ...others,
      ])
        if (maintenanceWorkOrderFromRow(row) case final MaintenanceWorkOrder o)
          o,
    ];
    final Map<String, String> names = await _technicianNames(orders);
    return <MaintenanceWorkOrder>[
      for (final MaintenanceWorkOrder order in orders)
        order.withTechnician(names[order.assignedOwnerId]),
    ];
  }

  /// `profiles.full_name` for every assigned owner. `profiles_select`
  /// (`MIGRATIONS_V5.sql`) lets every authenticated user read every profile,
  /// so this is a plain read. It is decoration on a row that already carries
  /// its real data: a failed lookup leaves the name blank rather than failing
  /// the whole queue, the same best-effort contract
  /// `WorkOrderRepository.currentUserDisplayName` uses over the same columns.
  Future<Map<String, String>> _technicianNames(
    List<MaintenanceWorkOrder> orders,
  ) async {
    final List<String> ids = <String>{
      for (final MaintenanceWorkOrder order in orders)
        if (order.assignedOwnerId != null) order.assignedOwnerId!,
    }.toList(growable: false);
    if (ids.isEmpty) return const <String, String>{};
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.profiles)
            .select('id,full_name')
            .inFilter('id', ids),
      );
      return <String, String>{
        for (final Map<String, dynamic> row in rows)
          if (_text(row['id']) case final String id)
            if (_text(row['full_name']) case final String name) id: name,
      };
    } on Object {
      return const <String, String>{};
    }
  }
}

/// Decodes one row read with [maintenanceWorkOrderColumns]. Returns null for
/// a row with no usable id (never a real row: `id` is the primary key).
MaintenanceWorkOrder? maintenanceWorkOrderFromRow(Map<String, dynamic> row) {
  final String? id = _text(row['id']);
  if (id == null) return null;
  return MaintenanceWorkOrder(
    id: id,
    workOrderNo: _text(row['work_order_no']),
    assetNo: _text(row['asset_no']),
    assetCategory: _text(row['asset_category']),
    workType: _text(row['work_type']),
    status: _text(row['status']),
    priority: _text(row['priority']),
    site: _text(row['site']),
    openedAt: DateTime.tryParse(_text(row['opened_at']) ?? ''),
    targetCompletion: DateTime.tryParse(_text(row['target_completion']) ?? ''),
    assignedOwnerId: _text(row['assigned_owner_id']),
  );
}

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}
