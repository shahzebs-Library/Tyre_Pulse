library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/core/workspace/workspace_context.dart';
import 'package:tyre_pulse/features/stock_count/domain/stock_item.dart';

/// PostgREST caps every response at 1000 rows whatever `.limit()` asks for,
/// so a single read silently truncates the register once it passes the cap
/// (docs/inventory/05 finding 4). This reads page after page until a short
/// page proves the end, up to [maxRows].
///
/// [maxRows] is a safety ceiling, not a target. Reaching it throws rather than
/// returning a list that looks complete, because a Stock Count screen showing
/// part of the store as the whole store is the defect this exists to stop.
Future<List<Map<String, dynamic>>> fetchStockPages(
  Future<List<Map<String, dynamic>>> Function(int from, int to) readPage, {
  int pageSize = 1000,
  int maxRows = 50000,
}) async {
  final List<Map<String, dynamic>> all = <Map<String, dynamic>>[];
  int from = 0;
  while (true) {
    final List<Map<String, dynamic>> page =
        await readPage(from, from + pageSize - 1);
    all.addAll(page);
    if (page.length < pageSize) return all;
    from += pageSize;
    if (from >= maxRows) {
      throw StateError(
        'The stock register has more than $maxRows rows; refusing to show '
        'a partial list as complete.',
      );
    }
  }
}

abstract interface class StockCountRepository {
  Future<List<StockItem>> list({String? country});

  // A physical count is recorded as evidence through the physical
  // inventory outbox (`StockCountRecorder`), never posted from here: a count
  // difference needs an approver (WP5, migration 20261124091000), so the old
  // absolute `set_stock_count` path is no longer called by the phone.

  /// Quick +/- adjustment by a signed [delta] (Expo `adjustStock`,
  /// `mobile/lib/stock.ts`): the audited `post_stock_movement` RPC
  /// (`adjustment_up` / `adjustment_down`) when online, an absolute
  /// Online only since STOCK_ADJUST was retired: a lost connection is
  /// thrown for the screen to report (count it as a blind count instead).
  /// Returns false (nothing is queued).
  Future<bool> adjust({
    required StockItem item,
    required int delta,
    required WorkspaceContext workspace,
  });

  // There is no create here. A new stock line cannot be inserted from a
  // client: the ledger guard (inv_balance_guard) refuses a non-zero balance
  // and stock_movements is append-only through the inv_* RPCs. "Add stock"
  // records a proposed_new physical inventory capture instead
  // (`StockCountRecorder.recordNew`); a reviewer identifies the item and an
  // approver posts the quantity.
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
  DefaultStockCountRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<StockItem>> list({String? country}) {
    return guard<List<StockItem>>(() async {
      final String scope = country?.trim() ?? '';
      final List<Map<String, dynamic>> rows = await fetchStockPages(
        (int from, int to) {
          var query = _client.from(SupabaseTables.stockRecords).select(
                'id,site,description,stock_qty,min_level,critical_level,'
                'stock_status,updated_at,country,item_id,location_id,'
                'qty_reserved,condition,ownership,uom,'
                // Both foreign keys are single (stock_records_location_fk,
                // stock_records_item_id_fkey), so the embeds are unambiguous.
                'location:inventory_locations(code),'
                'item:material_master(item_code)',
              );
          if (scope.isNotEmpty && scope != 'All') {
            query = query.or('country.eq.$scope,country.is.null');
          }
          // The id tiebreak is load-bearing: ordering a paged read on a
          // non-unique key (site) drops or repeats rows at a page boundary.
          return query.order('site').order('id').range(from, to);
        },
      );
      return rows
          .map(_fromRow)
          .where((StockItem item) => item.id.isNotEmpty)
          .toList(growable: false);
    });
  }

  @override
  Future<bool> adjust({
    required StockItem item,
    required int delta,
    required WorkspaceContext workspace,
  }) async {
    if (delta == 0) return false;
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
    // STOCK_ADJUST is retired: nothing is queued offline (an absolute
    // quantity replayed later would bypass the movement ledger). A lost
    // connection is thrown for the screen to report.
    return false;
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
      country: _text(row['country']),
      itemId: _text(row['item_id']),
      locationId: _text(row['location_id']),
      reserved:
          row['qty_reserved'] == null ? null : _number(row['qty_reserved']),
      condition: _text(row['condition']),
      ownership: _text(row['ownership']),
      uom: _text(row['uom']),
      locationCode: _embedded(row['location'], 'code'),
      itemCode: _embedded(row['item'], 'item_code'),
    );

/// A PostgREST to-one embed is a map (or null when the FK is null or the row
/// is not readable).
String? _embedded(Object? value, String key) =>
    value is Map ? _text(value[key]) : null;

String? _text(Object? value) {
  final String text = value?.toString().trim() ?? '';
  return text.isEmpty ? null : text;
}

num _number(Object? value) =>
    value is num ? value : num.tryParse(_text(value) ?? '') ?? 0;
