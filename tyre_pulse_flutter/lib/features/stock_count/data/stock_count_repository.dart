library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/sync/command_registry.dart';
import 'package:tyre_pulse/core/sync/queued_command_repository.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

abstract interface class StockCountRepository {
  Future<List<StockItem>> list({String? country});

  Future<bool> setCount({
    required StockItem item,
    required num count,
    required String? reason,
    required WorkspaceContext workspace,
  });

  /// Quick +/- adjustment by a signed [delta] (Expo `adjustStock`,
  /// `mobile/lib/stock.ts`): the audited `post_stock_movement` RPC
  /// (`adjustment_up` / `adjustment_down`) when online, an absolute
  /// `STOCK_ADJUST` from the last-known quantity when the network is down.
  /// Returns true when the change was queued offline.
  Future<bool> adjust({
    required StockItem item,
    required int delta,
    required WorkspaceContext workspace,
  });

  /// Creates a new stock row for a tyre size at a site (Expo
  /// `createStockRecord`). The size is prefixed into `description` because
  /// `stock_records` has no size column. Thresholds are written only when
  /// [minLevel]/[criticalLevel] are supplied (admin callers); otherwise the
  /// server defaults govern. Online only: there is no row to reconcile a
  /// queued insert against, so a failure is thrown for the caller.
  Future<void> create({
    required String size,
    required String? description,
    required String site,
    required int quantity,
    required WorkspaceContext workspace,
    int? minLevel,
    int? criticalLevel,
    bool writeThresholds = false,
  });
}

/// Mirror of Expo `composeStockDescription`: the size leads the description
/// so the size parse still buckets the new row, without doubling it.
String composeStockDescription(String size, String? description) {
  final String sz = size.trim();
  final String rest = description?.trim() ?? '';
  if (sz.isEmpty) return rest;
  if (rest.toUpperCase().startsWith(sz.toUpperCase())) return rest;
  return rest.isEmpty ? sz : '$sz $rest';
}

/// Mirror of Expo `statusFor`: a missing threshold never makes a row Low or
/// Critical.
String stockStatusFor(int quantity, int? minimum, int? critical) {
  if (critical != null && quantity <= critical) return 'Critical';
  if (minimum != null && quantity <= minimum) return 'Low';
  return 'OK';
}

final class DefaultStockCountRepository
    with SupabaseGateway
    implements StockCountRepository {
  DefaultStockCountRepository(this._client, this._commands);

  final SupabaseClient _client;
  final QueuedCommandRepository _commands;

  @override
  Future<List<StockItem>> list({String? country}) {
    return guard<List<StockItem>>(() async {
      var query = _client.from(SupabaseTables.stockRecords).select(
            'id,site,description,stock_qty,min_level,critical_level,'
            'stock_status,updated_at',
          );
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      final List<Map<String, dynamic>> rows =
          await query.order('site').limit(1000);
      return rows
          .map(_fromRow)
          .where((StockItem item) => item.id.isNotEmpty)
          .toList(growable: false);
    });
  }

  @override
  Future<bool> setCount({
    required StockItem item,
    required num count,
    required String? reason,
    required WorkspaceContext workspace,
  }) async {
    final num whole = count.floor();
    try {
      await guard<Object?>(
        () => _client.rpc<Object?>(
          SupabaseRpcs.setStockCount,
          params: <String, Object?>{
            'p_stock_id': item.id,
            'p_count': whole,
            'p_reason': _text(reason),
          },
        ),
      );
      return false;
    } on SupabaseFailure catch (failure) {
      if (!failure.isConnectivity) rethrow;
    }

    final DateTime now = DateTime.now();
    await _commands.enqueue(
      type: CommandType.stockAdjust,
      entityId: item.id,
      payload: <String, Object?>{
        'id': item.id,
        'stock_qty': whole,
        'stock_status': stockStatus(whole, item.minimum, item.critical),
        'updated_by': workspace.userId,
        'updated_at': now.toUtc().toIso8601String(),
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
    );
    return true;
  }

  @override
  Future<bool> adjust({
    required StockItem item,
    required int delta,
    required WorkspaceContext workspace,
  }) async {
    if (delta == 0) return false;
    try {
      await guard<Object?>(
        () => _client.rpc<Object?>(
          SupabaseRpcs.postStockMovement,
          params: <String, Object?>{
            'p_stock_id': item.id,
            'p_type': delta > 0 ? 'adjustment_up' : 'adjustment_down',
            'p_qty': delta.abs(),
            'p_reason': null,
            'p_reference': null,
          },
        ),
      );
      return false;
    } on SupabaseFailure catch (failure) {
      if (!failure.isConnectivity) rethrow;
    }

    final int next =
        (item.quantity.floor() + delta) < 0 ? 0 : item.quantity.floor() + delta;
    final DateTime now = DateTime.now();
    await _commands.enqueue(
      type: CommandType.stockAdjust,
      entityId: item.id,
      payload: <String, Object?>{
        'id': item.id,
        'stock_qty': next,
        'stock_status': stockStatus(next, item.minimum, item.critical),
        'updated_by': workspace.userId,
        'updated_at': now.toUtc().toIso8601String(),
      },
      workspace: workspace,
      now: now,
      country: workspace.activeCountry,
    );
    return true;
  }

  @override
  Future<void> create({
    required String size,
    required String? description,
    required String site,
    required int quantity,
    required WorkspaceContext workspace,
    int? minLevel,
    int? criticalLevel,
    bool writeThresholds = false,
  }) async {
    final int qty = quantity < 0 ? 0 : quantity;
    final String text = composeStockDescription(size, description);
    final String siteName = site.trim();
    final Map<String, Object?> row = <String, Object?>{
      'site': siteName,
      'description': text,
      'stock_qty': qty,
      'stock_status': stockStatusFor(
        qty,
        writeThresholds ? minLevel : null,
        writeThresholds ? criticalLevel : null,
      ),
      'country': _scopeCountry(workspace),
      'updated_by': workspace.userId,
      'updated_at': DateTime.now().toUtc().toIso8601String(),
      if (writeThresholds) 'min_level': minLevel,
      if (writeThresholds) 'critical_level': criticalLevel,
    };
    final Map<String, dynamic> created = await guard<Map<String, dynamic>>(
      () => _client
          .from(SupabaseTables.stockRecords)
          .insert(row)
          .select('id')
          .single(),
    );
    final String? id = _text(created['id']);
    if (id == null) return;
    // Best-effort audit movement (Initial), exactly as Expo: never blocks
    // the create that already succeeded.
    try {
      await guard<Object?>(
        () => _client.from(SupabaseTables.stockMovements).insert(
          <String, Object?>{
            'stock_id': id,
            'site': siteName,
            'description': text,
            'movement_type': 'Initial',
            'qty_before': 0,
            'qty_change': qty,
            'qty_after': qty,
            'reason': 'Initial stock entry (mobile)',
            'created_by': workspace.userId,
          },
        ),
      );
    } on Object {
      // Audit is best-effort.
    }
  }
}

extension _StockWrites on DefaultStockCountRepository {
  String? _scopeCountry(WorkspaceContext workspace) {
    final String scope = workspace.activeCountry?.trim() ?? '';
    return scope.isEmpty || scope == 'All' ? null : scope;
  }
}

StockItem _fromRow(Map<String, dynamic> row) => StockItem(
      id: _text(row['id']) ?? '',
      site: _text(row['site']),
      description: _text(row['description']),
      quantity: _number(row['stock_qty']),
      minimum: _number(row['min_level']),
      critical: _number(row['critical_level']),
      status: _text(row['stock_status']),
      updatedAt: DateTime.tryParse(_text(row['updated_at']) ?? ''),
    );

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '') ?? 0;
