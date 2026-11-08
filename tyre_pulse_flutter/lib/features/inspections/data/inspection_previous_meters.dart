/// The vehicle's last recorded odometer and engine-hours readings, so the
/// inspection header can WARN (never block) when a typed reading is lower.
///
/// Reads `odometer_logs.odometer_km` (V162) and
/// `engine_hours_logs.engine_hours` (MIGRATIONS_V161_ENGINE_HOURS.sql), newest
/// by `reading_date` then `created_at`. A meter can genuinely be replaced, so
/// a lower reading stays allowed - the same accept-but-warn rule as the meter
/// log screen and V340.
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';

@immutable
class PreviousMeters {
  const PreviousMeters({this.odometerKm, this.engineHours});

  /// Null = no earlier reading, or it could not be read (warning only, so
  /// "could not check" simply shows no warning).
  final double? odometerKm;
  final double? engineHours;

  static const PreviousMeters none = PreviousMeters();
}

/// True when [typed] is a real number below a known previous reading.
bool isBelowPrevious(double? typed, double? previous) =>
    typed != null && previous != null && typed < previous;

abstract interface class InspectionPreviousMetersRepository {
  /// Best-effort; never throws.
  Future<PreviousMeters> forAsset(String assetNo);
}

final class SupabaseInspectionPreviousMetersRepository
    with SupabaseGateway
    implements InspectionPreviousMetersRepository {
  SupabaseInspectionPreviousMetersRepository(this._client);

  final SupabaseClient _client;

  @override
  Future<PreviousMeters> forAsset(String assetNo) async {
    final String asset = assetNo.trim();
    if (asset.isEmpty) return PreviousMeters.none;
    final List<double?> values = await Future.wait(<Future<double?>>[
      _latest(SupabaseTables.odometerLogs, 'odometer_km', asset),
      _latest(SupabaseTables.engineHoursLogs, 'engine_hours', asset),
    ]);
    return PreviousMeters(odometerKm: values[0], engineHours: values[1]);
  }

  Future<double?> _latest(String table, String column, String asset) async {
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(
        () async => await _client
            .from(table)
            .select(column)
            .eq('asset_no', asset)
            .not(column, 'is', null)
            .order('reading_date', ascending: false, nullsFirst: false)
            .order('created_at', ascending: false)
            .limit(1),
      );
      if (rows.isEmpty) return null;
      final Object? v = rows.first[column];
      if (v is num) return v.toDouble();
      return double.tryParse(v?.toString() ?? '');
    } on Object {
      return null;
    }
  }
}
