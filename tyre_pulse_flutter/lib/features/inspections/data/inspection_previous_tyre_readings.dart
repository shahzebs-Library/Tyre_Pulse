/// The asset's LAST synced inspection, read per wheel, so the tyre editor can
/// show "Last inspection: 110 psi, 8.5 mm" beside the fields.
///
/// Reads `inspections.tyre_conditions` + `inspection_date` (the same columns
/// [inspectionRecordColumns] already reads), newest by `inspection_date`
/// then `created_at`, one row. Row-level security decides what the caller
/// may read; the company is pinned on top like
/// `inspection_previous_meters.dart`. Best-effort: offline or a failed read
/// returns `null` and the editor simply shows no previous value (it is a
/// hint, never a gate).
library;

import 'package:flutter/foundation.dart';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:tyre_pulse/core/network/supabase_gateway.dart';
import 'package:tyre_pulse/core/network/supabase_tables.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

/// One wheel's measurements on the previous inspection.
@immutable
class PreviousTyreReading {
  const PreviousTyreReading({
    this.inspectionDate,
    this.pressurePsi,
    this.treadDepthMm,
  });

  final DateTime? inspectionDate;
  final double? pressurePsi;
  final double? treadDepthMm;

  bool get hasValue => pressurePsi != null || treadDepthMm != null;
}

/// Maps a stored `tyre_conditions` payload onto this layout's slot ids.
///
/// A key is accepted when it IS a slot id of [layoutKey] or a spelling the
/// shared tyre map confirms for that slot (`LHCO`, `LHR1-O`, ...). Anything
/// that places nowhere is dropped rather than guessed onto a wheel. Entries
/// with neither a pressure nor a tread depth are dropped too: a previous
/// "Good" with no numbers has nothing to show.
Map<String, PreviousTyreReading> previousReadingsBySlot({
  required String layoutKey,
  required Object? tyreConditions,
  DateTime? inspectionDate,
}) {
  final Map<String, PreviousTyreReading> out = <String, PreviousTyreReading>{};
  for (final TyreEntryPair pair in readTyreEntries(tyreConditions)) {
    final String? slot = slotForStoredPosition(layoutKey, pair.key);
    if (slot == null) continue;
    final TyrePositionReading r =
        TyrePositionReading.fromEntry(slot, pair.entry);
    final PreviousTyreReading reading = PreviousTyreReading(
      inspectionDate: inspectionDate,
      pressurePsi: r.pressurePsi,
      treadDepthMm: r.treadDepthMm,
    );
    if (reading.hasValue) out[slot] = reading;
  }
  return Map<String, PreviousTyreReading>.unmodifiable(out);
}

abstract interface class InspectionPreviousTyreReadingsRepository {
  /// The newest synced inspection of [assetNo], per slot of [layoutKey].
  /// Best-effort; never throws (empty map = nothing to show).
  Future<Map<String, PreviousTyreReading>> latestForAsset({
    required String assetNo,
    required String layoutKey,
  });
}

final class SupabaseInspectionPreviousTyreReadingsRepository
    with SupabaseGateway
    implements InspectionPreviousTyreReadingsRepository {
  SupabaseInspectionPreviousTyreReadingsRepository(
    this._client, {
    String? organisationId,
  }) : _organisationId = organisationId;

  final SupabaseClient _client;
  final String? _organisationId;

  @override
  Future<Map<String, PreviousTyreReading>> latestForAsset({
    required String assetNo,
    required String layoutKey,
  }) async {
    final String asset = assetNo.trim();
    if (asset.isEmpty || layoutKey.trim().isEmpty) {
      return const <String, PreviousTyreReading>{};
    }
    try {
      final List<Map<String, dynamic>> rows =
          await guard<List<Map<String, dynamic>>>(() async {
        var q = _client
            .from(SupabaseTables.inspections)
            .select('inspection_date, tyre_conditions')
            .eq('asset_no', asset);
        final String? org = _organisationId;
        if (org != null && org.isNotEmpty) {
          q = q.eq('organisation_id', org);
        }
        return await q
            .order('inspection_date', ascending: false, nullsFirst: false)
            .order('created_at', ascending: false)
            .limit(1);
      });
      if (rows.isEmpty) return const <String, PreviousTyreReading>{};
      final Map<String, dynamic> row = rows.first;
      return previousReadingsBySlot(
        layoutKey: layoutKey,
        tyreConditions: row['tyre_conditions'],
        inspectionDate:
            DateTime.tryParse(row['inspection_date']?.toString() ?? ''),
      );
    } on Object {
      return const <String, PreviousTyreReading>{};
    }
  }
}
