/// A read-only decode of one `inspections` row, for the detail screen and
/// for the "synced" half of the My Inspections list.
///
/// Mirrors `mobile/app/(app)/inspection/[id].tsx`'s own `Inspection`
/// interface: the columns that screen selects are exactly the columns
/// decoded here, plus the GPS/odometer/hour-meter/approval columns that
/// screen does not show but this port's detail screen does (spec section
/// 27's "show exactly what was recorded" applies as much to a completed
/// record as to an in-progress one).
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/inspections/domain/tyre_position_reading.dart';

/// The columns [InspectionRecord.fromRow] reads. Kept as one constant so
/// a query and its decoder cannot silently drift apart - the same
/// discipline `tyre_lookup_repository.dart`'s `_lookupColumns` already
/// established for this codebase.
const String inspectionRecordColumns = 'id, client_uuid, title, site, '
    'asset_no, vehicle_type, inspector, inspection_date, status, notes, '
    'findings, odometer_km, hour_meter, inspector_signature, '
    'approval_status, locked, tyre_conditions, gps_lat, gps_lng, '
    'gps_accuracy, gps_captured_at, country, created_at';

@immutable
class InspectionRecord {
  const InspectionRecord({
    required this.id,
    required this.title,
    required this.site,
    required this.assetNo,
    required this.vehicleType,
    required this.inspector,
    required this.inspectionDate,
    required this.status,
    required this.tyreConditions,
    this.clientUuid,
    this.notes,
    this.findings,
    this.odometerKm,
    this.hourMeter,
    this.inspectorSignature,
    this.approvalStatus,
    this.locked = false,
    this.gpsLat,
    this.gpsLng,
    this.gpsAccuracy,
    this.gpsCapturedAt,
    this.country,
    this.createdAt,
  });

  /// The server row id (a uuid). NOT the same value as [clientUuid] in
  /// general - the server mints its own primary key independently of the
  /// idempotency key a client wrote alongside it.
  final String id;

  final String? clientUuid;
  final String title;
  final String site;
  final String assetNo;
  final String vehicleType;
  final String inspector;
  final String inspectionDate;
  final String status;
  final Map<String, Map<String, Object?>> tyreConditions;
  final String? notes;
  final String? findings;
  final int? odometerKm;
  final double? hourMeter;
  final String? inspectorSignature;
  final String? approvalStatus;
  final bool locked;
  final double? gpsLat;
  final double? gpsLng;
  final double? gpsAccuracy;
  final String? gpsCapturedAt;
  final String? country;
  final String? createdAt;

  bool get hasGpsFix => gpsLat != null && gpsLng != null;

  /// Decodes [row] as read via [inspectionRecordColumns]. Never throws on
  /// a malformed `tyre_conditions` value - it degrades to an empty map,
  /// matching `readTyreEntries`'s own "never fails to make sense of a
  /// payload, returns empty instead" contract, because a detail screen
  /// that cannot render tyre positions is a lesser failure than one that
  /// crashes outright.
  factory InspectionRecord.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException('Inspection row has no usable "id".');
    }

    return InspectionRecord(
      id: rawId,
      clientUuid: row['client_uuid'] as String?,
      title: row['title'] as String? ?? '',
      site: row['site'] as String? ?? '',
      assetNo: row['asset_no'] as String? ?? '',
      vehicleType: row['vehicle_type'] as String? ?? '',
      inspector: row['inspector'] as String? ?? '',
      inspectionDate: row['inspection_date'] as String? ?? '',
      status: row['status'] as String? ?? '',
      notes: row['notes'] as String?,
      findings: row['findings'] as String?,
      odometerKm: (row['odometer_km'] as num?)?.toInt(),
      hourMeter: (row['hour_meter'] as num?)?.toDouble(),
      inspectorSignature: row['inspector_signature'] as String?,
      approvalStatus: row['approval_status'] as String?,
      locked: row['locked'] == true,
      gpsLat: (row['gps_lat'] as num?)?.toDouble(),
      gpsLng: (row['gps_lng'] as num?)?.toDouble(),
      gpsAccuracy: (row['gps_accuracy'] as num?)?.toDouble(),
      gpsCapturedAt: row['gps_captured_at'] as String?,
      country: row['country'] as String?,
      createdAt: row['created_at'] as String?,
      tyreConditions: _decodeConditions(row['tyre_conditions']),
    );
  }

  static Map<String, Map<String, Object?>> _decodeConditions(Object? raw) {
    if (raw is! Map) return const <String, Map<String, Object?>>{};
    final Map<String, Map<String, Object?>> out =
        <String, Map<String, Object?>>{};
    raw.forEach((Object? key, Object? value) {
      if (key is String && value is Map) {
        out[key] = value.cast<String, Object?>();
      }
    });
    return out;
  }

  /// [tyreConditions], decoded into typed readings for reuse by the same
  /// widgets the fill screen already uses (the vehicle tyre diagram and
  /// any position-detail view).
  Map<String, TyrePositionReading> typedTyreConditions() {
    return <String, TyrePositionReading>{
      for (final MapEntry<String, Map<String, Object?>> e
          in tyreConditions.entries)
        e.key: TyrePositionReading.fromEntry(e.key, e.value),
    };
  }
}
