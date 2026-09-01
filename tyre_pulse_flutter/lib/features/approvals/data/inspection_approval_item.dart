/// One `inspections` row, decoded for the approvals queue and its review
/// screen.
///
/// Ported field-for-field from `mobile/lib/inspectionApprovals.ts`'s own
/// `InspectionApprovalItem` interface (`mobile/` is READ-ONLY reference
/// material - see `AGENTS.md`). That file selects two different column
/// sets for two different reasons - the queue reads
/// [inspectionApprovalListColumns] (lean, so a long pending list stays
/// cheap on a field device), the review screen reads
/// [inspectionApprovalFullColumns] (everything a supervisor needs to
/// decide) - and both are decoded through this SAME
/// [InspectionApprovalItem.fromRow], exactly as the TS source decodes both
/// shapes into the one interface: a column this instance's row never
/// selected simply reads back `null`.
///
/// [tyreConditions] remains the RAW row value for compatibility with the shared
/// diagram/completeness engine. [InspectionApprovalItem.tyreReadings] adds a
/// review-safe typed boundary over that same value by calling the engine's
/// `readTyreEntries`, which already accepts every verified legacy shape (map,
/// list, JSON string, and bare condition values). The typed boundary deliberately
/// keeps scalar readings as [Object] so a submitted string stays a string and a
/// numeric pressure of zero stays zero. This feature does NOT depend on
/// `features/inspections/domain/tyre_position_reading.dart`: that type belongs
/// to a sibling capture feature, while an approval must represent old as well as
/// current submitted rows.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart'
    show TyreEntryPair, readTyreEntries;

/// Every column [InspectionApprovalItem.fromRow] can read for the QUEUE
/// list. Kept narrow on purpose - `mobile/lib/inspectionApprovals.ts`'s own
/// `LIST_COLS` comment is "lean columns so the queue stays cheap".
/// #mirror: `LIST_COLS`.
const String inspectionApprovalListColumns =
    'id,title,site,asset_no,vehicle_type,inspector,inspection_date,'
    'created_at,status,approval_status,inspector_signature';

/// Every column [InspectionApprovalItem.fromRow] can read for the REVIEW
/// screen. #mirror: `FULL_COLS`.
const String inspectionApprovalFullColumns =
    'id,title,site,asset_no,vehicle_type,inspector,inspection_date,'
    'created_at,status,approval_status,notes,findings,odometer_km,'
    'hour_meter,tyre_conditions,photo_data,custom_data,'
    'inspector_signature,approver_signature,approver_email,approved_at';

String? _asString(Object? raw) {
  if (raw is! String) return null;
  final String trimmed = raw.trim();
  return trimmed.isEmpty ? null : trimmed;
}

Object? _firstPresent(Map<String, Object?> entry, List<String> keys) {
  for (final String key in keys) {
    if (!entry.containsKey(key)) continue;
    final Object? value = entry[key];
    if (value is String && value.trim().isEmpty) continue;
    if (value != null) return value;
  }
  return null;
}

Map<String, Object?> _asJsonMap(Object? raw) {
  if (raw is! Map) return const <String, Object?>{};
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in raw.entries)
      if (entry.key is String) entry.key! as String: entry.value,
  };
}

/// Reads the legacy row-level photo shapes verified on `inspections` without
/// manufacturing a URL or rewriting a stored reference.
///
/// `photos` is jsonb (V7), `photo_data` is text (V8), and
/// `custom_data.photos` is jsonb (V63 plus the current web reader). Historical
/// `photo_data` can be one ref or a JSON-encoded array. A string that merely
/// starts with `[` but is not valid JSON remains one ref, matching the web
/// `InspectionPhotos.toRefList` contract: malformed-looking text must not make
/// real evidence disappear.
List<String> _photoRefs(Object? raw) {
  if (raw == null) return const <String>[];
  if (raw is String) {
    final String value = raw.trim();
    if (value.isEmpty) return const <String>[];
    if (value.startsWith('[')) {
      try {
        final Object? decoded = jsonDecode(value);
        if (decoded is List) return _photoRefs(decoded);
      } on FormatException {
        // Keep the original value below. It may be a real legacy data URL/ref.
      }
    }
    return <String>[value];
  }
  if (raw is List) {
    return <String>[
      for (final Object? value in raw)
        if (value is String && value.trim().isNotEmpty) value.trim(),
    ];
  }
  return const <String>[];
}

/// One tyre-position reading exactly as it was submitted on an inspection.
///
/// Scalar readings intentionally remain [Object] values. Production records
/// contain both JSON numbers and strings, and coercing them here would alter
/// the submitted evidence (most importantly, numeric pressure `0`). Convenience
/// getters expose the established field aliases while [raw] retains every
/// unknown/legacy key for future readers.
@immutable
final class InspectionApprovalTyreReading {
  InspectionApprovalTyreReading._({
    required this.position,
    required Map<String, Object?> raw,
  }) : raw = Map<String, Object?>.unmodifiable(raw);

  /// The stored inspection position key, unchanged. Inspection rows use the V1
  /// diagram vocabulary (`F1L`, `R2Ro`, ...), while legacy rows can carry V2;
  /// neither is rewritten at this boundary.
  final String position;

  /// Every field submitted for this position, unchanged.
  final Map<String, Object?> raw;

  Object? get pressurePsi =>
      _firstPresent(raw, const <String>['pressure_psi', 'pressure']);
  Object? get treadDepthMm =>
      _firstPresent(raw, const <String>['tread_depth_mm', 'tread_depth']);
  Object? get serialNumber => _firstPresent(
        raw,
        const <String>['serial_number', 'serial_no', 'serial'],
      );
  String? get condition => _asString(raw['condition'] ?? raw['risk']);
  bool get checked => raw['checked'] == true;
  String? get notes => _asString(raw['notes'] ?? raw['note']);

  /// The submitted permanent photo reference when present, with legacy keys as
  /// fallbacks. A local `photo_uri` is retained last for old/degraded rows so an
  /// approval can say evidence was captured even if it is not remotely usable.
  String? get photoRef => _asString(
        raw['photo_url'] ?? raw['photo'] ?? raw['photo_uri'],
      );
}

/// A submitted inspection photo, labelled by its source and tyre position when
/// the evidence belongs to one wheel.
@immutable
final class InspectionApprovalPhotoEvidence {
  const InspectionApprovalPhotoEvidence({
    required this.reference,
    required this.source,
    this.position,
    this.condition,
  });

  final String reference;

  /// `tyre_conditions`, `photos`, `photo_data`, or `custom_data.photos`.
  final String source;
  final String? position;
  final String? condition;

  bool get isPositionPhoto => position != null;
}

List<InspectionApprovalTyreReading> _decodeTyreReadings(Object? raw) {
  return List<InspectionApprovalTyreReading>.unmodifiable(
    <InspectionApprovalTyreReading>[
      for (final TyreEntryPair pair in readTyreEntries(raw))
        InspectionApprovalTyreReading._(
          position: pair.key,
          raw: pair.entry,
        ),
    ],
  );
}

List<InspectionApprovalPhotoEvidence> _decodePhotoEvidence({
  required List<InspectionApprovalTyreReading> readings,
  required Object? photos,
  required Object? photoData,
  required Object? customData,
}) {
  final List<InspectionApprovalPhotoEvidence> out =
      <InspectionApprovalPhotoEvidence>[];
  final Set<String> seen = <String>{};

  void add({
    required String reference,
    required String source,
    String? position,
    String? condition,
  }) {
    final String ref = reference.trim();
    if (ref.isEmpty || !seen.add(ref)) return;
    out.add(
      InspectionApprovalPhotoEvidence(
        reference: ref,
        source: source,
        position: position,
        condition: condition,
      ),
    );
  }

  // Position evidence leads, matching the web inspection viewer. Reading the
  // raw position entries directly is load-bearing: a wheel with only a photo
  // is still evidence and must not disappear for lacking pressure/condition.
  for (final InspectionApprovalTyreReading reading in readings) {
    final String? ref = reading.photoRef;
    if (ref == null) continue;
    add(
      reference: ref,
      source: 'tyre_conditions',
      position: reading.position,
      condition: reading.condition,
    );
  }

  for (final String ref in _photoRefs(photos)) {
    add(reference: ref, source: 'photos');
  }
  for (final String ref in _photoRefs(photoData)) {
    add(reference: ref, source: 'photo_data');
  }
  final Object? customPhotos = _asJsonMap(customData)['photos'];
  for (final String ref in _photoRefs(customPhotos)) {
    add(reference: ref, source: 'custom_data.photos');
  }
  return List<InspectionApprovalPhotoEvidence>.unmodifiable(out);
}

final class InspectionApprovalItem {
  /// Decodes [row] as read via [inspectionApprovalListColumns] or
  /// [inspectionApprovalFullColumns].
  factory InspectionApprovalItem.fromRow(Map<String, Object?> row) {
    final Object? rawId = row['id'];
    if (rawId is! String || rawId.isEmpty) {
      throw const FormatException(
        'Inspection approval row has no usable "id".',
      );
    }

    final Object? rawTyreConditions = row['tyre_conditions'];
    final List<InspectionApprovalTyreReading> readings =
        _decodeTyreReadings(rawTyreConditions);

    return InspectionApprovalItem(
      id: rawId,
      title: _asString(row['title']),
      site: _asString(row['site']),
      assetNo: _asString(row['asset_no']),
      vehicleType: _asString(row['vehicle_type']),
      inspector: _asString(row['inspector']),
      inspectionDate: _asString(row['inspection_date']),
      createdAt: _asString(row['created_at']),
      status: _asString(row['status']),
      approvalStatus: _asString(row['approval_status']),
      notes: _asString(row['notes']),
      findings: _asString(row['findings']),
      odometerKm: (row['odometer_km'] as num?)?.toInt(),
      hourMeter: (row['hour_meter'] as num?)?.toDouble(),
      tyreConditions: rawTyreConditions,
      tyreReadings: readings,
      photoEvidence: _decodePhotoEvidence(
        readings: readings,
        photos: row['photos'],
        photoData: row['photo_data'],
        customData: row['custom_data'],
      ),
      inspectorSignature: _asString(row['inspector_signature']),
      approverSignature: _asString(row['approver_signature']),
      approverEmail: _asString(row['approver_email']),
      approvedAt: _asString(row['approved_at']),
    );
  }
  const InspectionApprovalItem({
    required this.id,
    this.title,
    this.site,
    this.assetNo,
    this.vehicleType,
    this.inspector,
    this.inspectionDate,
    this.createdAt,
    this.status,
    this.approvalStatus,
    this.notes,
    this.findings,
    this.odometerKm,
    this.hourMeter,
    this.tyreConditions,
    this.tyreReadings = const <InspectionApprovalTyreReading>[],
    this.photoEvidence = const <InspectionApprovalPhotoEvidence>[],
    this.inspectorSignature,
    this.approverSignature,
    this.approverEmail,
    this.approvedAt,
  });

  /// The server row id. Never null on a real row - `inspections.id` is the
  /// primary key - so a row this cannot be read from is a genuinely broken
  /// invariant, mirroring `InspectionRecord.fromRow`'s own throwing
  /// convention over the same table.
  final String id;

  final String? title;
  final String? site;
  final String? assetNo;
  final String? vehicleType;
  final String? inspector;
  final String? inspectionDate;
  final String? createdAt;
  final String? status;

  /// `'pending_approval' | 'approved' | 'rejected'` on a well-formed row.
  /// This is a DIFFERENT vocabulary from `checklist_submissions.
  /// approval_status` (`'pending' | 'pending_area_manager' | 'approved' |
  /// 'rejected' | 'not_required'`) - see the TS source's own warning not to
  /// carry tokens across the two tables.
  final String? approvalStatus;

  final String? notes;
  final String? findings;
  final int? odometerKm;
  final double? hourMeter;

  /// Raw `tyre_conditions` jsonb, exactly as PostgREST returned it. See the
  /// library comment on why this is left undecoded here.
  final Object? tyreConditions;

  /// Exact decoded position entries in the row's stored order. The original
  /// [tyreConditions] remains available for existing diagram consumers.
  final List<InspectionApprovalTyreReading> tyreReadings;

  /// All submitted position and row-level evidence references, in display
  /// order, de-duplicated without rewriting any reference.
  final List<InspectionApprovalPhotoEvidence> photoEvidence;

  final String? inspectorSignature;
  final String? approverSignature;
  final String? approverEmail;
  final String? approvedAt;

  /// Whether the queue's own decision on this row has already been made.
  /// `'pending_approval'` is the only outstanding state; anything else -
  /// including an unrecognised or absent value - reads as decided, so a
  /// malformed status can never dress up as something still awaiting
  /// action.
  bool get isPending => approvalStatus == 'pending_approval';

  bool get isApproved => approvalStatus == 'approved';
}
