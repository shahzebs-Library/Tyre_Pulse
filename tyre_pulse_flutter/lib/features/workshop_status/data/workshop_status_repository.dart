/// Workshop Status data access.
///
/// Reads `workshop_status_records` (RLS decides what the caller may see) and
/// writes ONLY through `workshop_status_update_record`, which checks the
/// permission, validates the vocabulary, refuses Excel-owned fields and stamps
/// who/when itself. Nothing here sends a name or a time.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/assets/data/vehicle_fleet_repository.dart'
    show PagedRows, fetchAllPages;
import 'package:tyre_pulse/features/workshop_status/domain/workshop_status_record.dart';

/// Thrown when someone else saved the record after it was read (PT409).
/// The screen tells the user to reload rather than overwrite their change.
final class WorkshopStatusStaleError implements Exception {
  const WorkshopStatusStaleError();

  @override
  String toString() => 'WorkshopStatusStaleError';
}

/// The active list, with the honesty flag [truncated].
final class WorkshopStatusList {
  const WorkshopStatusList({required this.records, required this.truncated});

  final List<WorkshopStatusRecord> records;

  /// The read stopped at the row ceiling, not at the end of the data.
  final bool truncated;
}

abstract interface class WorkshopStatusRepository {
  /// Vehicles currently in the report (`current_active`, not deleted).
  Future<WorkshopStatusList> listActive({String? country});

  /// One record by id, or null when it is no longer visible.
  Future<WorkshopStatusRecord?> fetch(String id);

  /// The caller's own action flags. Fails closed on any read failure.
  Future<WorkshopStatusPermissions> myPermissions();

  /// Saves [patch] (changed fields only). Throws [WorkshopStatusStaleError]
  /// on a stale [expectedUpdatedAt].
  Future<void> update({
    required String recordId,
    required Map<String, String?> patch,
    required String? expectedUpdatedAt,
  });
}

const String _cols = 'id,asset_no,site,country,complaint,current_stage,'
    'delay_reason,detailed_reason,work_done,action_taken,next_action,'
    'parts_status,mr_number,po_number,responsible_user_id,supporting_user_id,'
    'expected_part_date,expected_release_date,blocker,remarks,current_active,'
    'deleted_at,ooc_since,excel_down_days,updated_at,last_updated_by_name,'
    'last_manual_update_at';

/// A generous ceiling: a workshop report is hundreds of vehicles, not
/// thousands. Reaching it is reported, never hidden.
const int kWorkshopStatusMaxRows = 10000;

final class SupabaseWorkshopStatusRepository
    with SupabaseGateway
    implements WorkshopStatusRepository {
  SupabaseWorkshopStatusRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<WorkshopStatusList> listActive({String? country}) {
    return guard<WorkshopStatusList>(() async {
      var query = _client
          .from(SupabaseTables.workshopStatusRecords)
          .select(_cols)
          .eq('current_active', true)
          .isFilter('deleted_at', null);
      final String scope = country?.trim() ?? '';
      if (scope.isNotEmpty && scope != 'All') {
        query = query.or('country.eq.$scope,country.is.null');
      }
      // Paged past the 1000-row response cap; the id tiebreak makes the
      // order total so no row is dropped or repeated at a page boundary.
      final PagedRows<Map<String, dynamic>> result =
          await fetchAllPages<Map<String, dynamic>>(
        (int from, int to) => query
            .order('asset_no', ascending: true)
            .order('id', ascending: true)
            .range(from, to),
        maxRows: kWorkshopStatusMaxRows,
      );
      return WorkshopStatusList(
        records: result.rows
            .map(WorkshopStatusRecord.fromRow)
            .where((WorkshopStatusRecord r) => r.id.isNotEmpty)
            .toList(growable: false),
        truncated: result.truncated,
      );
    });
  }

  @override
  Future<WorkshopStatusRecord?> fetch(String id) {
    return guard<WorkshopStatusRecord?>(() async {
      final Map<String, dynamic>? row = await _client
          .from(SupabaseTables.workshopStatusRecords)
          .select(_cols)
          .eq('id', id)
          .maybeSingle();
      return row == null ? null : WorkshopStatusRecord.fromRow(row);
    });
  }

  @override
  Future<WorkshopStatusPermissions> myPermissions() async {
    try {
      final Object? raw = await _client.rpc<Object?>(
        SupabaseRpcs.workshopStatusMyPermissions,
      );
      return WorkshopStatusPermissions.fromJson(raw);
    } on Object {
      // Fails closed: a permission we cannot read is a permission we do not
      // have. RLS is still the boundary either way.
      return const WorkshopStatusPermissions();
    }
  }

  @override
  Future<void> update({
    required String recordId,
    required Map<String, String?> patch,
    required String? expectedUpdatedAt,
  }) async {
    try {
      await guard<Object?>(
        () => _client.rpc<Object?>(
          SupabaseRpcs.workshopStatusUpdateRecord,
          params: <String, dynamic>{
            'p_record_id': recordId,
            'p_patch': patch,
            // Exactly the string that was read. A parsed DateTime would drop
            // microseconds and read as stale on every save.
            'p_expected_updated_at': expectedUpdatedAt,
          },
        ),
      );
    } on SupabaseFailure catch (failure) {
      if (isWorkshopStaleFailure(failure)) {
        throw const WorkshopStatusStaleError();
      }
      rethrow;
    }
  }
}

/// True for the server's optimistic-concurrency refusal.
bool isWorkshopStaleFailure(SupabaseFailure failure) =>
    failure.code == 'PT409' ||
    (failure.rawMessage ?? '').contains('record_changed');
