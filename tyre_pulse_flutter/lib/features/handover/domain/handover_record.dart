/// A `handover_reports` row read back for the history list, the detail screen
/// and the two-stage sign-off, with its approval ladder columns.
///
/// Decode is tolerant, mirroring `inspection_record.dart`: a missing numeric is
/// null (never 0 - that would fabricate a reading), an unparseable date is
/// null, and a malformed `damages` value yields an empty list rather than
/// throwing. The DTO (this class) stays separate from the write payload
/// (`handover_payload.dart`) so a column rename does not spread through the UI.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/handover/domain/handover_approval.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';
import 'package:tyre_pulse/features/handover/domain/handover_payload.dart';

/// The columns the history/detail reads select, in one place so the `.select()`
/// and the decode can never disagree about what was asked for.
const String handoverRecordColumns = 'id,document_no,report_no,asset_no,'
    'country,handover_type,from_driver,to_driver,handover_at,odometer_km,'
    'fuel_level_pct,condition_rating,cleanliness,damages,damage_count,'
    'signature_url,photo_url,photos,notes,approval_status,review_note,'
    'supervisor_name,supervisor_signature,supervisor_at,'
    'incharge_name,incharge_signature,incharge_at,created_by,created_at';

@immutable
class HandoverRecord {
  const HandoverRecord({
    required this.id,
    required this.assetNo,
    this.documentNo,
    this.reportNo,
    this.country,
    this.handoverType,
    this.fromDriver,
    this.toDriver,
    this.handoverAt,
    this.odometerKm,
    this.fuelLevelPct,
    this.conditionRating,
    this.cleanliness,
    this.damages = const <HandoverDamageMarker>[],
    this.damageCount,
    this.signatureUrl,
    this.photos = const <String>[],
    this.notes,
    this.approvalStatus,
    this.reviewNote,
    this.supervisorName,
    this.supervisorSignature,
    this.supervisorAt,
    this.inchargeName,
    this.inchargeSignature,
    this.inchargeAt,
    this.createdBy,
    this.createdAt,
  });

  final String id;
  final String? documentNo;
  final String? reportNo;
  final String assetNo;
  final String? country;
  final HandoverType? handoverType;
  final String? fromDriver;
  final String? toDriver;
  final DateTime? handoverAt;
  final double? odometerKm;
  final double? fuelLevelPct;
  final HandoverConditionRating? conditionRating;
  final HandoverCleanliness? cleanliness;
  final List<HandoverDamageMarker> damages;
  final int? damageCount;

  /// The driver's own field signature (`signature_url`), a `data:` URL or a
  /// `tp-storage://` reference.
  final String? signatureUrl;

  /// General evidence photos as references.
  final List<String> photos;

  final String? notes;

  /// `draft` / `pending_supervisor` / `pending_incharge` / `approved` /
  /// `rejected`. Null is treated by the ladder as "no stage".
  final String? approvalStatus;
  final String? reviewNote;
  final String? supervisorName;
  final String? supervisorSignature;

  /// ISO timestamp strings, kept as text for the ladder's language-free facts.
  final String? supervisorAt;
  final String? inchargeName;
  final String? inchargeSignature;
  final String? inchargeAt;
  final String? createdBy;
  final DateTime? createdAt;

  /// The number of logged damages, preferring the explicit column and falling
  /// back to the decoded list length when the column is absent.
  int get effectiveDamageCount => damageCount ?? damages.length;

  /// The ladder view of this row, for `handover_approval.dart`.
  HandoverApprovalLike get approval => HandoverApprovalLike(
        approvalStatus: approvalStatus,
        supervisorName: supervisorName,
        supervisorSignature: supervisorSignature,
        supervisorAt: supervisorAt,
        inchargeName: inchargeName,
        inchargeSignature: inchargeSignature,
        inchargeAt: inchargeAt,
        reviewNote: reviewNote,
      );

  static HandoverRecord fromRow(Map<String, dynamic> row) {
    final Object? rawPhotos = row['photos'];
    final List<String> photos = <String>[];
    if (rawPhotos is List) {
      for (final Object? item in rawPhotos) {
        if (item is String && item.trim().isNotEmpty) photos.add(item);
      }
    }
    // The legacy single `photo_url` column, folded in so an older row's one
    // photo is not silently lost.
    final Object? legacyPhoto = row['photo_url'];
    if (legacyPhoto is String &&
        legacyPhoto.trim().isNotEmpty &&
        !photos.contains(legacyPhoto)) {
      photos.add(legacyPhoto);
    }

    return HandoverRecord(
      id: (row['id'] as Object?)?.toString() ?? '',
      documentNo: _stringOrNull(row['document_no']),
      reportNo: _stringOrNull(row['report_no']),
      assetNo: (row['asset_no'] as Object?)?.toString() ?? '',
      country: _stringOrNull(row['country']),
      handoverType: HandoverType.fromKey(row['handover_type'] as String?),
      fromDriver: _stringOrNull(row['from_driver']),
      toDriver: _stringOrNull(row['to_driver']),
      handoverAt: _dateTimeOrNull(row['handover_at']),
      odometerKm: (row['odometer_km'] as num?)?.toDouble(),
      fuelLevelPct: (row['fuel_level_pct'] as num?)?.toDouble(),
      conditionRating:
          HandoverConditionRating.fromKey(row['condition_rating'] as String?),
      cleanliness: HandoverCleanliness.fromKey(row['cleanliness'] as String?),
      damages: HandoverDamageMarker.listFromJson(row['damages']),
      damageCount: (row['damage_count'] as num?)?.toInt(),
      signatureUrl: _stringOrNull(row['signature_url']),
      photos: photos,
      notes: _stringOrNull(row['notes']),
      approvalStatus: _stringOrNull(row['approval_status']),
      reviewNote: _stringOrNull(row['review_note']),
      supervisorName: _stringOrNull(row['supervisor_name']),
      supervisorSignature: _stringOrNull(row['supervisor_signature']),
      supervisorAt: _stringOrNull(row['supervisor_at']),
      inchargeName: _stringOrNull(row['incharge_name']),
      inchargeSignature: _stringOrNull(row['incharge_signature']),
      inchargeAt: _stringOrNull(row['incharge_at']),
      createdBy: _stringOrNull(row['created_by']),
      createdAt: _dateTimeOrNull(row['created_at']),
    );
  }

  static String? _stringOrNull(Object? raw) {
    if (raw is! String) return null;
    final String trimmed = raw.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  static DateTime? _dateTimeOrNull(Object? raw) {
    if (raw is! String || raw.isEmpty) return null;
    return DateTime.tryParse(raw);
  }
}
