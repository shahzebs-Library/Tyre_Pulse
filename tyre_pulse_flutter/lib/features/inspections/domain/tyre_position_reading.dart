/// One recorded tyre position on an inspection: the pure value type this
/// whole feature edits, persists to a draft, and eventually writes into
/// `inspections.tyre_conditions`.
///
/// # The key vocabulary is not a choice, it is a contract
///
/// The map key names below - `pressure_psi`, `tread_depth_mm`,
/// `serial_number`, `condition`, `notes`, `checked`, `photo_url`,
/// `photo_uri` - are read directly by [tyreCompleteness] (via its own
/// `_pick`/`_kPressureFields` etc.) and by [VehicleTyreDiagram] (via
/// `classifyEntry`). Renaming one here silently breaks the ALREADY-GATED
/// Phase 4 completeness engine and diagram widget without failing a single
/// test in either of those two files, because both read this shape
/// dynamically from a `Map<String, Object?>` rather than a typed class.
/// [toEntry] is the one place that shape is produced and must never drift
/// from it.
///
/// # Pressure is stored as a number, not a string - a deliberate departure
///
/// `mobile/lib/types.ts` types `TyrePositionData.pressure_psi` as a
/// `string`, which artifact 07 section 7.2 names as the origin of a real
/// bug class: a stored value of `0` (a flat tyre - the single most
/// important reading on the wheel) reads as falsy under a naive
/// truthiness check. [TyreCompletenessResult]'s own `_hasText` was built
/// to accept EITHER a number or a string and never uses truthiness, so
/// this port is free to store pressure as a proper `double?` throughout -
/// [pressurePsi] is a `double?`, compared against `null` everywhere in
/// this feature, never against `0` or empty-string. This is a disclosed,
/// deliberate choice: a later phase reading raw `tyre_conditions` JSON off
/// the server must expect a JSON NUMBER here, not the string RN would have
/// written.
library;

import 'package:flutter/foundation.dart';

/// The six-value vocabulary already established by
/// `features/tyre_diagram/domain/tyre_condition.dart`. Kept as a plain
/// string constant list here (not that enum) because the STORED value on a
/// position entry must be exactly one of these English words - the raw
/// value [normaliseCondition] reads - and re-exporting a second vocabulary
/// would risk the two drifting apart silently.
abstract final class TyreReadingCondition {
  static const String good = 'Good';
  static const String worn = 'Worn';
  static const String damaged = 'Damaged';
  static const String puncture = 'Puncture';
  static const String flat = 'Flat';
  static const String missing = 'Missing';

  static const List<String> all = <String>[
    good,
    worn,
    damaged,
    puncture,
    flat,
    missing,
  ];
}

/// One position's recorded state.
@immutable
class TyrePositionReading {
  const TyrePositionReading({
    required this.position,
    this.serialNumber,
    this.pressurePsi,
    this.treadDepthMm,
    this.condition = TyreReadingCondition.good,
    this.checked = false,
    this.photoLocalPath,
    this.photoUrl,
    this.notes,
  });

  /// The seeded state a freshly-picked wheel starts in: `condition: 'Good'`,
  /// `checked: false`, everything else empty. This is the RN
  /// `emptyTyrePosition` behaviour verbatim, INCLUDING the fact that
  /// [checked] is deliberately absent (false) from the seed - see that
  /// file's own comment, reproduced on [checked] below.
  factory TyrePositionReading.seed(String position) =>
      TyrePositionReading(position: position);

  /// Decodes one entry from whatever shape
  /// `tyre_diagram/domain/tyre_completeness.dart`'s [readTyreEntries]
  /// already tolerates - this constructor is intentionally as forgiving as
  /// that one, so a draft row, a freshly-seeded position and a value read
  /// back off the server all decode through the same path.
  factory TyrePositionReading.fromEntry(
    String position,
    Map<String, Object?>? entry,
  ) {
    if (entry == null) return TyrePositionReading.seed(position);
    return TyrePositionReading(
      position: position,
      serialNumber: _stringOrNull(
        entry['serial_number'] ?? entry['serial_no'] ?? entry['serial'],
      ),
      pressurePsi: _numOrNull(entry['pressure_psi'] ?? entry['pressure']),
      treadDepthMm: _numOrNull(entry['tread_depth_mm'] ?? entry['tread_depth']),
      condition: _stringOrNull(entry['condition']) ?? TyreReadingCondition.good,
      checked: entry['checked'] == true,
      photoLocalPath: _stringOrNull(entry['photo_uri']),
      photoUrl: _stringOrNull(entry['photo_url']),
      notes: _stringOrNull(entry['notes']),
    );
  }

  final String position;
  final String? serialNumber;

  /// A reading of `0` is a real, meaningful value - a flat tyre - and must
  /// survive every copy and every JSON round trip as `0.0`, never as
  /// `null`. See the library comment.
  final double? pressurePsi;
  final double? treadDepthMm;

  /// One of [TyreReadingCondition.all]. Defaults to
  /// [TyreReadingCondition.good], matching the seed every capture form in
  /// this product uses.
  final String condition;

  /// `true` once the inspector deliberately interacted with this wheel -
  /// including confirming a Good reading with no gauge to hand. The seed
  /// writes `false`. This is the marker
  /// `features/tyre_diagram/domain/tyre_completeness.dart`'s own
  /// `classifyEntry` treats as evidence on its own, and the ONLY correct
  /// way to set it to `true` in this feature is through
  /// `InspectionDraftRepository.saveTyreReading`, which is the single
  /// write path for a tyre edit - see that method's own doc comment.
  /// Constructing a [TyrePositionReading] with `checked: true` directly
  /// anywhere else in this feature is almost certainly a mistake.
  final bool checked;

  /// A local, on-device file path. Present only while a captured photo has
  /// not yet been confirmed by the server - see [InspectionDraftRepository]
  /// and [InspectionSubmissionQueue] for the durability rules around this
  /// field. Never persisted to the server; [toEntry] emits it only when
  /// [photoUrl] is still null, mirroring the RN payload's own
  /// `photo_uri`/`photo_url` pair.
  final String? photoLocalPath;

  /// The permanent Supabase Storage URL, once uploaded.
  final String? photoUrl;

  final String? notes;

  bool get hasPhoto => photoUrl != null || photoLocalPath != null;

  TyrePositionReading copyWith({
    String? serialNumber,
    bool clearSerialNumber = false,
    double? pressurePsi,
    bool clearPressurePsi = false,
    double? treadDepthMm,
    bool clearTreadDepthMm = false,
    String? condition,
    bool? checked,
    String? photoLocalPath,
    bool clearPhotoLocalPath = false,
    String? photoUrl,
    bool clearPhotoUrl = false,
    String? notes,
    bool clearNotes = false,
  }) {
    return TyrePositionReading(
      position: position,
      serialNumber:
          clearSerialNumber ? null : (serialNumber ?? this.serialNumber),
      pressurePsi: clearPressurePsi ? null : (pressurePsi ?? this.pressurePsi),
      treadDepthMm:
          clearTreadDepthMm ? null : (treadDepthMm ?? this.treadDepthMm),
      condition: condition ?? this.condition,
      checked: checked ?? this.checked,
      photoLocalPath:
          clearPhotoLocalPath ? null : (photoLocalPath ?? this.photoLocalPath),
      photoUrl: clearPhotoUrl ? null : (photoUrl ?? this.photoUrl),
      notes: clearNotes ? null : (notes ?? this.notes),
    );
  }

  /// The exact shape [tyreCompleteness], [readTyreEntries] and
  /// [VehicleTyreDiagram] read. See the library comment - never rename a
  /// key here.
  Map<String, Object?> toEntry() {
    return <String, Object?>{
      'position': position,
      if (serialNumber != null) 'serial_number': serialNumber,
      if (pressurePsi != null) 'pressure_psi': pressurePsi,
      if (treadDepthMm != null) 'tread_depth_mm': treadDepthMm,
      'condition': condition,
      'checked': checked,
      // Mirrors the RN payload exactly: a live local path is carried only
      // until it has a permanent URL, and the two are never both written
      // as non-null for long - `photo_url` wins once it exists.
      if (photoUrl != null) 'photo_url': photoUrl,
      if (photoUrl == null && photoLocalPath != null)
        'photo_uri': photoLocalPath,
      if (notes != null) 'notes': notes,
    };
  }

  /// Whether this position has ANY value a person entered - used only to
  /// drive on-screen progress ("N of M touched"), never the submission
  /// gate. The submission gate is
  /// `features/tyre_diagram/domain/tyre_completeness.dart`'s
  /// `tyreCompleteness`, and duplicating its judgement here would be
  /// exactly the second, weaker truthiness check that module's own
  /// consumers were built to avoid - see `vehicle_tyre_diagram.dart`'s
  /// comment on reading a SINGLE classification rather than re-deriving
  /// one.
  bool get isTouched =>
      serialNumber != null ||
      pressurePsi != null ||
      treadDepthMm != null ||
      notes != null ||
      hasPhoto ||
      condition != TyreReadingCondition.good ||
      checked;

  static String? _stringOrNull(Object? v) {
    if (v == null) return null;
    final String s = v.toString().trim();
    return s.isEmpty ? null : s;
  }

  static double? _numOrNull(Object? v) {
    if (v == null) return null;
    if (v is num) return v.isFinite ? v.toDouble() : null;
    if (v is String) {
      final String trimmed = v.trim();
      if (trimmed.isEmpty) return null;
      return double.tryParse(trimmed);
    }
    return null;
  }

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TyrePositionReading &&
          other.position == position &&
          other.serialNumber == serialNumber &&
          other.pressurePsi == pressurePsi &&
          other.treadDepthMm == treadDepthMm &&
          other.condition == condition &&
          other.checked == checked &&
          other.photoLocalPath == photoLocalPath &&
          other.photoUrl == photoUrl &&
          other.notes == notes);

  @override
  int get hashCode => Object.hash(
        position,
        serialNumber,
        pressurePsi,
        treadDepthMm,
        condition,
        checked,
        photoLocalPath,
        photoUrl,
        notes,
      );
}
