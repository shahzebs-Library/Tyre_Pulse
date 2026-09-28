/// Online-only write of a Repair Request to `public.repair_requests` (V608).
///
/// ONLINE-ONLY, AND WHY. `REPAIR_REQUEST` is not in
/// `lib/core/sync/command_registry.dart` (that file records it as excluded
/// until the table was verified, and it is a protected file this feature may
/// not edit). Rather than invent a second queue, this path submits directly
/// and says plainly when it could not - the form keeps everything typed so the
/// person can retry the moment they have signal.
///
/// IDEMPOTENT. The row carries a client-generated `client_uuid`, which has a
/// partial unique index. A retry after a lost response hits a unique
/// violation; that is read as "already saved" and the stored row is fetched
/// back, so one fault is one request.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

/// `public.repair_requests` (V608), verified live on 2026-09-28.
const String kRepairRequestsTable = SupabaseTables.repairRequests;

/// What the server confirmed.
final class RepairRequestReceipt {
  const RepairRequestReceipt({required this.id, this.rfrNo});

  final String id;

  /// Minted by the server trigger. Null only if the trigger had nothing to
  /// mint from yet; the screen then says the office will issue it.
  final String? rfrNo;
}

/// Boundary the screen talks to.
abstract interface class RepairRequestRepository {
  /// Inserts [row] and returns the stored identity. Throws a
  /// [SupabaseFailure] on anything other than success or an idempotent
  /// replay.
  Future<RepairRequestReceipt> submit(Map<String, Object?> row);
}

/// Production implementation.
final class SupabaseRepairRequestRepository implements RepairRequestRepository {
  SupabaseRepairRequestRepository(this._client);

  final SupabaseClient _client;

  static const String _returning = 'id,rfr_no';

  @override
  Future<RepairRequestReceipt> submit(Map<String, Object?> row) async {
    try {
      final Map<String, dynamic> stored = await _client
          .from(kRepairRequestsTable)
          .insert(row)
          .select(_returning)
          .single();
      return _receipt(stored);
    } on Object catch (error) {
      final SupabaseFailure failure = classifySupabaseError(error);
      final Object? clientUuid = row['client_uuid'];
      if (failure.isIdempotentReplay && clientUuid is String) {
        final Map<String, dynamic>? existing = await _client
            .from(kRepairRequestsTable)
            .select(_returning)
            .eq('client_uuid', clientUuid)
            .maybeSingle();
        if (existing != null) return _receipt(existing);
      }
      throw failure;
    }
  }

  static RepairRequestReceipt _receipt(Map<String, dynamic> row) {
    final Object? rfr = row['rfr_no'];
    return RepairRequestReceipt(
      id: row['id'].toString(),
      rfrNo: rfr is String && rfr.trim().isNotEmpty ? rfr.trim() : null,
    );
  }
}
