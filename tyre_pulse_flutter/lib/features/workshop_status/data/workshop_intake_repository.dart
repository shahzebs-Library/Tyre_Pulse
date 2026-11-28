/// Workshop Status -> Vehicle intake data access (phone).
///
/// Reads through RLS; writes ONLY through the SECURITY DEFINER RPCs of
/// 20261128090000_workshop_intake.sql, which check the permission, route the
/// vehicle, stamp who and when from the server clock and refuse a
/// self-confirm. The phone sends its own clock only as `client_entered_at`.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/workshop_status/domain/workshop_intake.dart';

abstract interface class WorkshopIntakeRepository {
  Future<WorkshopIntakePermissions> myPermissions();

  /// Vehicles waiting for confirmation that were routed to [userId].
  Future<List<WorkshopIntakeRecord>> listWaiting({
    required String userId,
    String? country,
  });

  /// Adds one vehicle from the phone. Returns the server's ingest result.
  Future<Object?> addVehicle({
    required String country,
    required Map<String, String> fields,
    required String clientKey,
  });

  Future<Object?> confirm(List<String> ids);

  Future<void> returnToSender({required String id, required String reason});
}

const String _cols = 'id,asset_no,site,reg_no,complaint,job_card_ref,priority,'
    'confirm_status,intake_source,routed_to,current_active,submitted_by,'
    'submitted_by_name,submitted_at,updated_at';

final class SupabaseWorkshopIntakeRepository
    with SupabaseGateway
    implements WorkshopIntakeRepository {
  SupabaseWorkshopIntakeRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<WorkshopIntakePermissions> myPermissions() async {
    try {
      final Object? raw = await _client.rpc<Object?>(
        SupabaseRpcs.workshopStatusMyPermissions,
      );
      return WorkshopIntakePermissions.fromJson(raw);
    } on Object {
      return const WorkshopIntakePermissions();
    }
  }

  @override
  Future<List<WorkshopIntakeRecord>> listWaiting({
    required String userId,
    String? country,
  }) {
    return guard<List<WorkshopIntakeRecord>>(() async {
      if (userId.isEmpty) return const <WorkshopIntakeRecord>[];
      var query = _client
          .from(SupabaseTables.workshopStatusRecords)
          .select(_cols)
          .eq('current_active', true)
          .isFilter('deleted_at', null)
          .eq('confirm_status', 'pending_confirm')
          .contains('routed_to', <String>[userId]);
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.eq('country', scope);
      }
      final List<Map<String, dynamic>> rows = await query
          .order('submitted_at', ascending: false)
          .order('id', ascending: true)
          .limit(500);
      return rows
          .map(WorkshopIntakeRecord.fromRow)
          .where((WorkshopIntakeRecord r) => r.id.isNotEmpty)
          .toList(growable: false);
    });
  }

  @override
  Future<Object?> addVehicle({
    required String country,
    required Map<String, String> fields,
    required String clientKey,
  }) {
    return guard<Object?>(
      () => _client.rpc<Object?>(
        SupabaseRpcs.workshopIntakeUpsertRows,
        params: <String, dynamic>{
          'p_country': country,
          'p_source': 'phone',
          'p_rows': <Map<String, String>>[
            <String, String>{
              ...fields,
              'source_key': clientKey,
              'client_entered_at': DateTime.now().toUtc().toIso8601String(),
            },
          ],
        },
      ),
    );
  }

  @override
  Future<Object?> confirm(List<String> ids) {
    return guard<Object?>(
      () => _client.rpc<Object?>(
        SupabaseRpcs.workshopIntakeConfirm,
        params: <String, dynamic>{'p_ids': ids, 'p_note': null},
      ),
    );
  }

  @override
  Future<void> returnToSender({required String id, required String reason}) {
    return guard<void>(() async {
      await _client.rpc<Object?>(
        SupabaseRpcs.workshopIntakeReturn,
        params: <String, dynamic>{'p_id': id, 'p_reason': reason},
      );
    });
  }
}
