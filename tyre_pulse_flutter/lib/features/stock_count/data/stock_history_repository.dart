/// Reads the stock ledger (`stock_movements`) for the store history screens,
/// and posts a stock receipt or return through the audited
/// `post_stock_movement` RPC.
///
/// Read paths respect the table's own row policies (org, country, site and
/// blind-count). Names come from the PII-free staff directory
/// (`list_profile_directory`), never a select on `profiles`.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/stock_count/data/stock_count_repository.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_movement.dart';

const String _movementCols =
    'id,stock_id,site,description,movement_type,source_doc_type,'
    'qty_before,qty_change,qty_after,reason,reference_no,source_doc_id,'
    'effective_at,posted_at,created_at,actor_id,created_by';

/// The types a store keeper can post from the phone. The server decides who
/// may post which (receipt needs an org admin; return needs the stock
/// `receive` capability) and refuses with a plain sentence otherwise.
enum StockPostType { receipt, returned }

String stockPostTypeToken(StockPostType type) => switch (type) {
      StockPostType.receipt => 'receipt',
      StockPostType.returned => 'return',
    };

/// The server's answer to a posted movement.
final class StockPostResult {
  const StockPostResult({this.before, this.change, this.after, this.status});

  factory StockPostResult.fromJson(Object? value) {
    final Map<String, dynamic> map =
        value is Map ? Map<String, dynamic>.from(value) : <String, dynamic>{};
    num? n(Object? v) => v is num ? v : num.tryParse(v?.toString() ?? '');
    return StockPostResult(
      before: n(map['qty_before']),
      change: n(map['qty_change']),
      after: n(map['qty_after']),
      status: map['stock_status']?.toString(),
    );
  }

  final num? before;
  final num? change;
  final num? after;
  final String? status;
}

/// Validation for the receive form. Returns a copy key for the problem, or
/// null when the input can be posted.
String? validateStockPost({
  required String quantity,
  required String reference,
}) {
  final num? qty = num.tryParse(quantity.trim());
  if (qty == null) return 'qtyRequired';
  if (qty <= 0) return 'qtyPositive';
  if (qty != qty.floor()) return 'qtyWhole';
  if (qty > 100000) return 'qtyTooLarge';
  if (reference.trim().length > 120) return 'refTooLong';
  return null;
}

/// How long a ledger read may wait for an answer.
const Duration stockHistoryReadTimeout = Duration(seconds: 20);

abstract interface class StockHistoryRepository {
  /// One page of the ledger, newest first, with an id tiebreak so paging
  /// never drops or repeats a row that shares a timestamp.
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  });

  /// Every movement matching [query] (lean columns), for the in / out / net
  /// totals. Refuses rather than summing a truncated set.
  Future<MovementSummary> summary(StockHistoryQuery query);

  Future<StockPostResult> post({
    required StockItem item,
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  });
}

final class DefaultStockHistoryRepository
    with SupabaseGateway
    implements StockHistoryRepository {
  DefaultStockHistoryRepository(this._client);

  final SupabaseClient _client;

  PostgrestFilterBuilder<List<Map<String, dynamic>>> _filtered(
    String columns,
    StockHistoryQuery query,
  ) {
    var q = _client.from(SupabaseTables.stockMovements).select(columns);
    if (query.stockId != null) q = q.eq('stock_id', query.stockId!);
    final String country = query.country?.trim() ?? '';
    if (country.isNotEmpty && country != 'All') {
      q = q.or('country.eq.$country,country.is.null');
    }
    final String site = query.site?.trim() ?? '';
    if (site.isNotEmpty) q = q.eq('site', site);
    final String search = query.search?.trim() ?? '';
    if (search.isNotEmpty) {
      q = q.ilike('description', '%${escapeLike(search)}%');
    }
    if (query.type == MovementTypeFilter.erpLedger) {
      q = q.eq('source_doc_type', 'erp_ledger');
    } else {
      final List<String>? types = movementTypesFor(query.type);
      if (types != null) q = q.inFilter('movement_type', types);
    }
    if (query.from != null) {
      final DateTime f = query.from!;
      q = q.gte(
        'effective_at',
        DateTime(f.year, f.month, f.day).toUtc().toIso8601String(),
      );
    }
    if (query.to != null) {
      final DateTime t = query.to!;
      q = q.lt(
        'effective_at',
        DateTime(t.year, t.month, t.day + 1).toUtc().toIso8601String(),
      );
    }
    return q;
  }

  @override
  Future<List<StockMovement>> page(
    StockHistoryQuery query, {
    required int offset,
    required int limit,
  }) {
    return guard<List<StockMovement>>(
      () async {
        final List<Map<String, dynamic>> rows = await _filtered(
          _movementCols,
          query,
        )
            .order('effective_at', ascending: false)
            .order('id', ascending: false)
            .range(offset, offset + limit - 1);
        final List<StockMovement> list = rows
            .map(StockMovement.fromRow)
            .where((StockMovement m) => m.id.isNotEmpty)
            .toList(growable: false);
        return _withNames(list);
        // A read with no answer (offline, auth retrying) becomes an offline
        // error instead of an endless spinner.
      },
      timeout: stockHistoryReadTimeout,
    );
  }

  @override
  Future<MovementSummary> summary(StockHistoryQuery query) {
    return guard<MovementSummary>(
      () async {
        final List<Map<String, dynamic>> rows = await fetchStockPages(
          (int from, int to) => _filtered(
            'id,movement_type,source_doc_type,qty_change,effective_at,'
            'posted_at,created_at',
            query,
          ).order('effective_at', ascending: false).order('id').range(from, to),
        );
        return summarizeMovements(rows.map(StockMovement.fromRow));
      },
      timeout: stockHistoryReadTimeout,
    );
  }

  Future<List<StockMovement>> _withNames(List<StockMovement> list) async {
    final List<String> ids = <String>{
      for (final StockMovement m in list)
        if (m.actorId != null) m.actorId!,
    }.toList(growable: false);
    if (ids.isEmpty) return list;
    try {
      final Object? rows = await _client.rpc<Object?>(
        SupabaseRpcs.listProfileDirectory,
        params: <String, Object?>{'p_ids': ids, 'p_limit': 1000},
      );
      final Map<String, String> names = <String, String>{
        if (rows is List)
          for (final Object? row in rows)
            if (row is Map &&
                row['id'] != null &&
                (row['full_name']?.toString().trim() ?? '').isNotEmpty)
              row['id'].toString(): row['full_name'].toString().trim(),
      };
      return <StockMovement>[
        for (final StockMovement m in list) m.withActorName(names[m.actorId]),
      ];
    } on Object {
      // A missing name never hides the movement: the row shows without one.
      return list;
    }
  }

  @override
  Future<StockPostResult> post({
    required StockItem item,
    required StockPostType type,
    required int quantity,
    String? reference,
    String? reason,
  }) {
    return guard<StockPostResult>(() async {
      final Object? result = await _client.rpc<Object?>(
        SupabaseRpcs.postStockMovement,
        params: <String, Object?>{
          'p_stock_id': item.id,
          'p_type': stockPostTypeToken(type),
          'p_qty': quantity,
          'p_reason': _blankToNull(reason),
          'p_reference': _blankToNull(reference),
        },
      );
      return StockPostResult.fromJson(result);
    });
  }
}

String? _blankToNull(String? value) {
  final String text = value?.trim() ?? '';
  return text.isEmpty ? null : text;
}
