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
