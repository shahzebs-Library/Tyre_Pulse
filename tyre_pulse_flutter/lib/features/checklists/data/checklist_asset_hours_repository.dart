/// The latest recorded engine-hour reading for one asset, for the checklist
/// hub's selected-asset card ("68,420 km / 8,742 h" in the owner's mock).
///
/// # Source
///
/// `engine_hours_logs` (V161, `photos`/`client_uuid` added by V213): the same
/// table the Daily Meter Log writes. `vehicle_fleet` carries `current_km` but
/// has NO hours column, so the latest log row is the only real source. This is
/// read-only and country-scoped by the table's own RLS.
///
/// # Honest about failure
///
/// Returns null only when the server answered with no reading. A failed read
/// throws the [SupabaseFailure]'s `AppError`, so the card can hide the hours
/// fact instead of claiming the asset has none.
library;

import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_error_mapper.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

abstract interface class ChecklistAssetHoursRepository {
  /// The newest non-null `engine_hours` for [assetNo], or null when none.
  Future<double?> readLastEngineHours(String assetNo);
}

final class SupabaseChecklistAssetHoursRepository
    with SupabaseGateway
    implements ChecklistAssetHoursRepository {
  SupabaseChecklistAssetHoursRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<double?> readLastEngineHours(String assetNo) async {
    final String asset = assetNo.trim();
    if (asset.isEmpty) return null;
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () => _client
            .from(SupabaseTables.engineHoursLogs)
            .select('engine_hours,reading_date,created_at')
            .eq('asset_no', asset)
            .not('engine_hours', 'is', null)
            .order('reading_date', ascending: false, nullsFirst: false)
            .order('created_at', ascending: false)
            .limit(1),
      );
      if (rows.isEmpty) return null;
      return engineHoursFromRow(rows.first);
    } on SupabaseFailure catch (failure) {
      throw failure.error;
    }
  }
}

/// Decodes `engine_hours` from one row. A non-numeric or negative value is not
/// a reading, so it is null rather than a fabricated 0.
double? engineHoursFromRow(Map<String, dynamic> row) {
  final Object? raw = row['engine_hours'];
  final double? value = switch (raw) {
    final num n => n.toDouble(),
    final String s => double.tryParse(s.trim()),
    _ => null,
  };
  if (value == null || value.isNaN || value < 0) return null;
  return value;
}
