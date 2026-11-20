/// Stock transfers: read through RLS, written only through the `inv_*` RPCs.
///
/// Online only, by decision: whether a dispatch is allowed depends on the
/// CURRENT balance at the source (stock never goes negative, docs/inventory/07
/// correction 1), so it cannot be blindly queued (AGENTS.md: decisions that
/// depend on server state are not queued). Each form mints ONE idempotency key
/// when it opens and reuses it on every retry, so a retry after a timeout can
/// never post the movement twice.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/features/inventory/data/inventory_backend.dart';
import 'package:tyre_pulse/features/inventory/domain/transfer_models.dart';

abstract interface class InventoryTransferRepository {
  /// Recent transfers visible to the user (RLS scoped), newest first.
  Future<List<StockTransfer>> list({int limit = 100});

  Future<Object?> dispatch({
    required String idempotencyKey,
    required String fromLocationId,
    required String toLocationId,
    required List<DispatchLineDraft> lines,
    String? remarks,
  });

  Future<Object?> receive({
    required String idempotencyKey,
    required String transferId,
    required List<ReceiveLineDraft> lines,
  });
}

final class SupabaseInventoryTransferRepository
    with SupabaseGateway
    implements InventoryTransferRepository {
  SupabaseInventoryTransferRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<StockTransfer>> list({int limit = 100}) {
    return guard<List<StockTransfer>>(() async {
      // select('*') rather than a guessed column list: a column PostgREST
      // cannot find fails the whole request, and the DB lane owns the shape.
      final List<Map<String, dynamic>> rows = await _client
          .from(InventoryTables.stockTransfers)
          // Item codes come from the item master through the line's FK;
          // stock_transfers has no created_at (dispatched_at is its time), and
          // ordering on a missing column would fail the whole request.
          .select(
            '*, ${InventoryTables.stockTransferLines}'
            '(*, itm:material_master(item_code, item_name))',
          )
          .order('dispatched_at', ascending: false)
          .order('id')
          .limit(limit);
      return rows
          .map((Map<String, dynamic> r) => StockTransfer.fromJson(r))
          .where((StockTransfer t) => t.id.isNotEmpty)
          .toList(growable: false);
    });
  }

  @override
  Future<Object?> dispatch({
    required String idempotencyKey,
    required String fromLocationId,
    required String toLocationId,
    required List<DispatchLineDraft> lines,
    String? remarks,
  }) =>
      guard<Object?>(
        () => _client.rpc<Object?>(
          InventoryRpcs.transferDispatch,
          params: <String, Object?>{
            'p_payload': <String, Object?>{
              'idempotency_key': idempotencyKey,
              'from_location_id': fromLocationId,
              'to_location_id': toLocationId,
              'remarks': (remarks ?? '').trim().isEmpty ? null : remarks,
              'lines': <Map<String, Object?>>[
                for (final DispatchLineDraft l in lines)
                  <String, Object?>{'scanned_code': l.code, 'qty': l.qty},
              ],
            },
          },
        ),
      );

  @override
  Future<Object?> receive({
    required String idempotencyKey,
    required String transferId,
    required List<ReceiveLineDraft> lines,
  }) =>
      guard<Object?>(
        () => _client.rpc<Object?>(
          InventoryRpcs.transferReceive,
          params: <String, Object?>{
            'p_payload': <String, Object?>{
              'idempotency_key': idempotencyKey,
              'transfer_id': transferId,
              'lines': <Map<String, Object?>>[
                for (final ReceiveLineDraft l in lines) l.toJson(),
              ],
            },
          },
        ),
      );
}
