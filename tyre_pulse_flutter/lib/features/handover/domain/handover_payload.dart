/// The `handover_reports` row this feature writes, and the pure rules that
/// decide whether it is ready to submit.
///
/// Column names match the live table 1:1 (`MIGRATIONS_V181_HANDOVER_REPORTS.sql`
/// plus the two-stage columns added by
/// `20261112130000_handover_two_stage_signoff.sql`). The write is modelled on
/// `inspection_payload.dart`: a plain immutable value with a `toRow()` and a
/// pure `validateHandoverForSubmit` in the order the wizard checks them. The
/// driver's own drawn signature is `signature_url` - FIELD evidence, never a
/// sign-off (the supervisor and incharge signatures are captured separately,
/// through `decide_handover_approval`).
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/handover/domain/handover_damage_marker.dart';

/// `handover_reports.handover_type`. The DB CHECK allows only these two.
enum HandoverType {
  checkout('checkout'),
  checkin('checkin');

  const HandoverType(this.key);

  final String key;

  static HandoverType? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverType type in HandoverType.values) {
      if (type.key == value) return type;
    }
    return null;
  }
}

/// `handover_reports.condition_rating`. The DB CHECK allows only these four.
enum HandoverConditionRating {
  excellent('excellent'),
  good('good'),
  fair('fair'),
  poor('poor');

  const HandoverConditionRating(this.key);

  final String key;

  static HandoverConditionRating? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverConditionRating r in HandoverConditionRating.values) {
      if (r.key == value) return r;
    }
    return null;
  }
}

/// `handover_reports.cleanliness`. The DB CHECK allows only these three.
enum HandoverCleanliness {
  clean('clean'),
  acceptable('acceptable'),
  dirty('dirty');

  const HandoverCleanliness(this.key);

  final String key;

  static HandoverCleanliness? fromKey(String? raw) {
    final String value = raw?.trim().toLowerCase() ?? '';
    for (final HandoverCleanliness c in HandoverCleanliness.values) {
      if (c.key == value) return c;
    }
    return null;
  }
}

/// One reason a handover is not ready to submit, in the order
/// [validateHandoverForSubmit] checks them. A pure code, never prose - the
/// presentation layer decides the sentence, in the user's language.
enum HandoverSubmitIssue {
  missingVehicle,
  missingHandoverType,

  /// Neither an outgoing nor an incoming driver was named.
  missingDriver,
  missingConditionRating,

  /// The odometer or fuel field holds text that is not a readable number.
  /// Raised by the wizard state (which owns the typed text), never by
  /// [validateHandoverForSubmit], which only sees the parsed payload.
  invalidMeterReading,

  /// The driver's own field signature is missing.
  missingSignature,
}

/// The full `handover_reports` row. Column names match the table 1:1.
@immutable
class HandoverPayload {
  const HandoverPayload({
    required this.assetNo,
    required this.handoverType,
    this.fromDriver,
    this.toDriver,
    this.handoverAt,
    this.odometerKm,
    this.fuelLevelPct,
    this.conditionRating,
    this.cleanliness,
    this.damages = const <HandoverDamageMarker>[],
    this.signatureDataUrl,
    this.photos = const <String>[],
    this.notes = '',
    this.createdBy,
    this.country,
    this.approvalStatus,
  });

  final String assetNo;
  final HandoverType handoverType;

  /// The outgoing driver (who is handing the vehicle over).
  final String? fromDriver;

  /// The incoming driver (who is taking it).
  final String? toDriver;

  /// When the handover happened. Null lets the server default (`now()`) apply.
  final DateTime? handoverAt;

  /// Odometer in km. Null, never 0, for "not entered" - a zero here is a real
  /// reading, and folding "not entered" into it fabricates fleet history
  /// (the same `Number('') is 0` trap `inspection_payload.dart` documents).
  final double? odometerKm;

  /// Fuel level 0..100. Null for "not entered".
  final double? fuelLevelPct;

  final HandoverConditionRating? conditionRating;
  final HandoverCleanliness? cleanliness;

  /// Logged damage. Written to `damages` jsonb; `damage_count` is derived.
  final List<HandoverDamageMarker> damages;

  /// The driver's own drawn signature as a `data:` URL, or null. This is FIELD
  /// evidence (`signature_url`), never a sign-off.
  final String? signatureDataUrl;

  /// General evidence photos as `tp-storage://bucket/path` references. Per-
  /// marker damage photos live inside [damages], not here.
  final List<String> photos;

  final String notes;
  final String? createdBy;
  final String? country;

  /// `pending_supervisor` once submitted (the server default). Left null while
  /// the payload is still being assembled so a half-built value can never be
  /// written.
  final String? approvalStatus;

  HandoverPayload copyWith({
    String? assetNo,
    HandoverType? handoverType,
    String? fromDriver,
    bool clearFromDriver = false,
    String? toDriver,
    bool clearToDriver = false,
    DateTime? handoverAt,
    double? odometerKm,
    bool clearOdometerKm = false,
    double? fuelLevelPct,
    bool clearFuelLevelPct = false,
    HandoverConditionRating? conditionRating,
    bool clearConditionRating = false,
    HandoverCleanliness? cleanliness,
    bool clearCleanliness = false,
    List<HandoverDamageMarker>? damages,
    String? signatureDataUrl,
    bool clearSignature = false,
    List<String>? photos,
    String? notes,
    String? createdBy,
    String? country,
    String? approvalStatus,
  }) {
    return HandoverPayload(
      assetNo: assetNo ?? this.assetNo,
      handoverType: handoverType ?? this.handoverType,
      fromDriver: clearFromDriver ? null : (fromDriver ?? this.fromDriver),
      toDriver: clearToDriver ? null : (toDriver ?? this.toDriver),
      handoverAt: handoverAt ?? this.handoverAt,
      odometerKm: clearOdometerKm ? null : (odometerKm ?? this.odometerKm),
      fuelLevelPct:
          clearFuelLevelPct ? null : (fuelLevelPct ?? this.fuelLevelPct),
      conditionRating: clearConditionRating
          ? null
          : (conditionRating ?? this.conditionRating),
      cleanliness: clearCleanliness ? null : (cleanliness ?? this.cleanliness),
      damages: damages ?? this.damages,
      signatureDataUrl:
          clearSignature ? null : (signatureDataUrl ?? this.signatureDataUrl),
      photos: photos ?? this.photos,
      notes: notes ?? this.notes,
      createdBy: createdBy ?? this.createdBy,
      country: country ?? this.country,
      approvalStatus: approvalStatus ?? this.approvalStatus,
    );
  }

  /// The full row, ready to `.insert()` / `.upsert()`. `client_uuid` is added
  /// by the caller at the point of the actual write (the sync engine), never
  /// baked in here - this type has no opinion about which attempt is writing
  /// it. [signatureDataUrl] goes to `signature_url`; [photos] and [damages]
  /// are already resolved to durable references by the time the sync engine
  /// calls this.
  Map<String, Object?> toRow() {
    return <String, Object?>{
      'asset_no': assetNo,
      'country': country,
      'handover_type': handoverType.key,
      'from_driver': _trimmedOrNull(fromDriver),
      'to_driver': _trimmedOrNull(toDriver),
      'handover_at': (handoverAt ?? DateTime.now().toUtc()).toIso8601String(),
      'odometer_km': odometerKm,
      'fuel_level_pct': fuelLevelPct,
      'condition_rating': conditionRating?.key,
      'cleanliness': cleanliness?.key,
      'damages': <Map<String, Object?>>[
        for (final HandoverDamageMarker m in damages) m.toJson(),
      ],
      'damage_count': damages.length,
      'signature_url': signatureDataUrl,
      'photos': List<String>.of(photos),
      'notes': notes,
      'created_by': createdBy,
      'approval_status': approvalStatus,
    };
  }

  static String? _trimmedOrNull(String? raw) {
    final String trimmed = raw?.trim() ?? '';
    return trimmed.isEmpty ? null : trimmed;
  }
}

/// Every reason [payload] is not yet ready to submit, in check order. An empty
/// list means it may be submitted. Mirrors the wizard's step order: vehicle and
/// type, then a driver, then condition, then the driver's signature.
List<HandoverSubmitIssue> validateHandoverForSubmit(HandoverPayload payload) {
  final List<HandoverSubmitIssue> issues = <HandoverSubmitIssue>[];

  if (payload.assetNo.trim().isEmpty) {
    issues.add(HandoverSubmitIssue.missingVehicle);
  }
  final bool hasFrom = payload.fromDriver?.trim().isNotEmpty ?? false;
  final bool hasTo = payload.toDriver?.trim().isNotEmpty ?? false;
  if (!hasFrom && !hasTo) {
    issues.add(HandoverSubmitIssue.missingDriver);
  }
  if (payload.conditionRating == null) {
    issues.add(HandoverSubmitIssue.missingConditionRating);
  }
  if (payload.signatureDataUrl == null ||
      payload.signatureDataUrl!.trim().isEmpty) {
    issues.add(HandoverSubmitIssue.missingSignature);
  }
  return issues;
}
