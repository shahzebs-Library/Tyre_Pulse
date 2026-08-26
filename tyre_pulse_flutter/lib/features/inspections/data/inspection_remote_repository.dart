/// Everything this feature reads from or writes to Supabase directly:
/// the site list, pushing a completed inspection, and reading back
/// already-synced ones for the detail screen and for history.
///
/// Vehicle picking is deliberately NOT duplicated here - the wizard
/// consumes `features/assets`' own `vehicleFleetListProvider` /
/// `VehicleFleetRepository` for that, the same way this whole port
/// consumes `features/tyre_diagram`'s widget and engine, rather than
/// re-querying `vehicle_fleet` a second, possibly-drifting way.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_payload.dart';
import 'package:tyre_pulse/features/inspections/domain/inspection_record.dart';

/// The narrow surface this feature needs from Supabase. Abstract so the
/// wizard controller and the sync engine can both be tested against a
/// fake - see `test/features/inspections/data/`.
abstract interface class InspectionRemoteRepository {
  /// Distinct, active site names, optionally scoped to [country]. Reads
  /// are best-effort: production's own `loadSites` falls back to an empty
  /// list on any failure "so the inspector is never blocked from
  /// starting", which this mirrors by returning `[]` rather than
  /// throwing.
  Future<List<String>> listSites({String? country});

  /// Pushes [payload] as a real `inspections` row, upserting on
  /// `client_uuid` so a retried write can never create a duplicate -
  /// mirrors `mobile/lib/offlineQueue.ts`'s own
  /// `.upsert({...}, { onConflict: 'client_uuid', ignoreDuplicates: true
  /// })` exactly. Throws [SupabaseFailure] (via [SupabaseGateway.guard])
  /// on any failure - the caller (`InspectionSyncEngine`) decides from
  /// there whether that means "queue it" or "genuinely rejected".
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  });

  /// One inspection by its SERVER row id.
  Future<InspectionRecord?> byId(String id);

  /// This user's synced inspections, newest first, bounded to [limit] -
  /// this is a scoped "my work" list, never an unbounded fleet-wide read
  /// (artifact rule 5.19: `.limit()` alone is not a bound past 1000, but
  /// well under that ceiling a plain limited read is the right tool for a
  /// single person's own history).
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  });
}

final class SupabaseInspectionRemoteRepository
    with SupabaseGateway
    implements InspectionRemoteRepository {
  SupabaseInspectionRemoteRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<List<String>> listSites({String? country}) async {
    try {
      return await guard<List<String>>(() async {
        var query = _client
            .from(SupabaseTables.sites)
            .select('name')
            .eq('active', true);
        if (country != null && country.isNotEmpty) {
          query = query.eq('country', country);
        }
        final List<Map<String, dynamic>> rows =
            await query.order('name') as List<Map<String, dynamic>>;
        final List<String> names = <String>[];
        final Set<String> seen = <String>{};
        for (final row in rows) {
          final Object? name = row['name'];
          if (name is String && name.trim().isNotEmpty && seen.add(name)) {
            names.add(name);
          }
        }
        return names;
      });
    } on Object {
      // Best-effort, matching the production `loadSites` fallback: an
      // inspector must never be blocked from starting because the site
      // picker failed to populate.
      return const <String>[];
    }
  }

  @override
  Future<void> upsertInspection({
    required InspectionPayload payload,
    required String clientUuid,
  }) {
    return guard<void>(() async {
      await _client.from(SupabaseTables.inspections).upsert(
        <String, Object?>{...payload.toRow(), 'client_uuid': clientUuid},
        onConflict: 'client_uuid',
        ignoreDuplicates: true,
      );
    });
  }

  @override
  Future<InspectionRecord?> byId(String id) async {
    final Map<String, dynamic>? row = await guard<Map<String, dynamic>?>(
      () => _client
          .from(SupabaseTables.inspections)
          .select(inspectionRecordColumns)
          .eq('id', id)
          .maybeSingle(),
    );
    if (row == null) return null;
    return InspectionRecord.fromRow(row);
  }

  @override
  Future<List<InspectionRecord>> myInspections({
    required String createdBy,
    int limit = 100,
  }) async {
    final List<Map<String, dynamic>> rows =
        await guard<List<Map<String, dynamic>>>(
      () async => await _client
          .from(SupabaseTables.inspections)
          .select(inspectionRecordColumns)
          .eq('created_by', createdBy)
          .order('inspection_date', ascending: false)
          .limit(limit) as List<Map<String, dynamic>>,
    );
    return <InspectionRecord>[
      for (final row in rows) InspectionRecord.fromRow(row),
    ];
  }
}
