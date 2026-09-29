/// Reads behind the Vehicle 360 header facts: the latest engine-hour
/// reading, the asset's active preventive-maintenance plans, its open tyre
/// actions and the permit columns on its `vehicle_fleet` row.
///
/// Every call is PostgREST on a real table (AGENTS.md rule 3):
///
/// - `engine_hours_logs`: asset_no, country, reading_date, engine_hours
///   (V161; the same read `asset_insights_repository.dart` makes).
/// - `pm_programs`: id, name, asset_no, status, meter_source, meter_interval,
///   next_due, next_due_meter, priority, country (V253; the columns the PM
///   screen's `pm_repository.dart` already selects).
/// - `corrective_actions`: id, status, asset_no, country, source_type
///   (V496 added source_type).
/// - `vehicle_fleet`: registration_no, insurance_type, insurance_name,
///   insurance_start, insurance_expiry, operating_card_no,
///   operating_card_issue, operating_card_expiry, driver_licence_issue,
///   driver_licence_expiry, current_hours - the columns the applied V415 /
///   V439 ERP promotion writes. Read by the row id the detail screen already
///   holds, so RLS scopes it exactly as it scoped the row itself.
///
/// Each read is small (one asset), bounded, and ordered with an `id`
/// tiebreak. A failure here never blocks the screen: the provider maps it to
/// "not shown", because each fact is supplementary to the fleet record.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/assets/data/asset_insights_repository.dart'
    show AssetScope;

/// The columns the Documents tab reads from `vehicle_fleet`.
const String assetDocumentColumns =
    'id, registration_no, insurance_type, insurance_name, insurance_start, '
    'insurance_expiry, operating_card_no, operating_card_issue, '
    'operating_card_expiry, driver_licence_issue, driver_licence_expiry, '
    'current_hours';

abstract interface class Asset360Source {
  /// The newest `engine_hours_logs` row for the asset, or null.
  Future<Map<String, dynamic>?> latestEngineHours(AssetScope scope);

  /// Active `pm_programs` rows for the asset.
  Future<List<Map<String, dynamic>>> pmPlans(AssetScope scope);

  /// `corrective_actions` raised from an inspection for the asset, capped at
  /// [Asset360Source.actionLimit] rows.
  Future<List<Map<String, dynamic>>> tyreActions(AssetScope scope);

  /// The permit columns of the `vehicle_fleet` row [fleetRowId], or null.
  Future<Map<String, dynamic>?> documents(String fleetRowId);
}

/// Row cap for the tyre-action read. A read that fills it is reported as
/// incomplete rather than as a count.
const int assetTyreActionLimit = 200;

final class SupabaseAsset360Source
    with SupabaseGateway
    implements Asset360Source {
  SupabaseAsset360Source(this._client);

  final SupabaseClient _client;

  @override
  Future<Map<String, dynamic>?> latestEngineHours(AssetScope scope) {
    return guard(() async {
      var q = _client
          .from(SupabaseTables.engineHoursLogs)
          .select('id, reading_date, engine_hours')
          .eq('asset_no', scope.assetNo);
      if (scope.country != null) q = q.eq('country', scope.country!);
      final List<Map<String, dynamic>> rows = await q
          .order('reading_date', ascending: false)
          .order('id', ascending: false)
          .limit(1);
      return rows.isEmpty ? null : rows.first;
    });
  }

  @override
  Future<List<Map<String, dynamic>>> pmPlans(AssetScope scope) {
    return guard(() async {
      var q = _client
          .from(SupabaseTables.pmPrograms)
          .select(
            'id, name, asset_no, status, meter_source, meter_interval, '
            'next_due, next_due_meter, priority',
          )
          .eq('asset_no', scope.assetNo)
          .eq('status', 'active');
      if (scope.country != null) {
        q = q.or('country.eq.${scope.country},country.is.null');
      }
      return q.order('id').limit(100);
    });
  }

  @override
  Future<List<Map<String, dynamic>>> tyreActions(AssetScope scope) {
    return guard(() async {
      var q = _client
          .from(SupabaseTables.correctiveActions)
          .select('id, status')
          .eq('asset_no', scope.assetNo)
          .eq('source_type', 'inspection');
      if (scope.country != null) {
        q = q.or('country.eq.${scope.country},country.is.null');
      }
      return q.order('id').limit(assetTyreActionLimit);
    });
  }

  @override
  Future<Map<String, dynamic>?> documents(String fleetRowId) {
    return guard(() async {
      return _client
          .from(SupabaseTables.vehicleFleet)
          .select(assetDocumentColumns)
          .eq('id', fleetRowId)
          .maybeSingle();
    });
  }
}
