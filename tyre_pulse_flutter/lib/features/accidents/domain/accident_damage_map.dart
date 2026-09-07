/// The per-vehicle-view damage map: which zone of the vehicle body was
/// marked as damaged, from which side, and how severely.
///
/// Deliberately dependency-free (no `BuildContext`, no I/O) so the mapping
/// rules - which zones exist per view, and how a tap coordinate resolves to
/// one - can be tested without a widget tree, mirroring
/// `lib/features/home/home_layout.dart`'s own reasoning for staying pure.
///
/// New reports store an exact normalized point, selected view and editable
/// area label. The legacy fixed-zone catalog remains below only so drafts
/// created by the earlier build can still be read and rendered; the current
/// report UI never places those generic rectangles over a fleet image.
library;

import 'package:flutter/foundation.dart';

/// One side the vehicle is viewed from.
enum AccidentDamageView { front, rear, left, right, top }

/// Component geometry used to hit-test the selected asset's own artwork.
///
/// A road vehicle, a concrete pump and a wheel loader do not share body
/// parts. Keeping that distinction in the pure domain layer prevents a tap on
/// a visible lamp, bucket or equipment panel from being interpreted through
/// the old generic truck rectangles.
enum AccidentDamageAssetClass {
  roadVehicle,
  bus,
  heavyTruck,
  loader,
  fixedEquipment,
  legacy,
}

/// Resolves damage geometry from verified asset master fields only.
///
/// Unknown records deliberately use [AccidentDamageAssetClass.legacy] so an
/// older draft remains editable without pretending the asset is another
/// class.
AccidentDamageAssetClass accidentDamageAssetClassFor({
  String? assetNo,
  String? vehicleType,
  String? make,
  String? model,
}) {
  final String value = <String?>[assetNo, vehicleType, make, model]
      .whereType<String>()
      .join(' ')
      .toLowerCase()
      .replaceAll(RegExp(r'[-_/]+'), ' ')
      .replaceAll(RegExp(r'\s+'), ' ')
      .trim();
  if (value.contains('wheel loader') ||
      value.contains('skid loader') ||
      value.contains('skid steer') ||
      RegExp(r'(^|\s)(wl|sl)\s*\d').hasMatch(value)) {
    return AccidentDamageAssetClass.loader;
  }
  if (value.contains('chiller') ||
      value.contains('generator') ||
      value.contains('genset') ||
      value.contains('batching plant') ||
      value.contains('placing boom') ||
      value.contains('stationary pump')) {
    return AccidentDamageAssetClass.fixedEquipment;
  }
  if (value.contains('concrete pump') ||
      value.contains('line pump') ||
      value.contains('transit mixer') ||
      value.contains('concrete mixer') ||
      value.contains('pump truck') ||
      RegExp(r'(^|\s)(cp|mp|lp|tm)\s*\d').hasMatch(value)) {
    return AccidentDamageAssetClass.heavyTruck;
  }
  if (value.contains('bus') ||
      value.contains('coach') ||
      value.contains('hiace') ||
      value.contains('hi ace') ||
      value.contains('coaster') ||
      value.contains('seater')) {
    return AccidentDamageAssetClass.bus;
  }
  if (value.contains('pickup') ||
      value.contains('pick up') ||
      value.contains('double cab') ||
      value.contains('double cabin') ||
      value.contains('xenon') ||
      value.contains('l200') ||
      value.contains('triton')) {
    return AccidentDamageAssetClass.roadVehicle;
  }
  return AccidentDamageAssetClass.legacy;
}

/// One tappable body region on a given [AccidentDamageView].
///
/// [rect] is in the view's own 0..1 normalised canvas space - the same
/// convention `tyre_diagram_geometry.dart` uses for its viewport percentages
/// - so the painter and the hit-tester both scale it against whatever pixel
/// size the widget is actually given, rather than a fixed device size.
@immutable
class AccidentDamageZone {
  const AccidentDamageZone({
    required this.id,
    required this.view,
    required this.left,
    required this.top,
    required this.width,
    required this.height,
  });

  /// Stable across views - e.g. `left_front_door` never collides with
  /// `right_front_door` - so a mark can be looked up without also carrying
  /// [view] as part of its key.
  final String id;
  final AccidentDamageView view;
  final double left;
  final double top;
  final double width;
  final double height;
}

/// How severely one zone was marked - the same three-value vocabulary
/// `accidents.severity` itself uses (`minor` / `moderate` / `severe`),
/// deliberately reused rather than inventing a parallel scale for one zone.
enum AccidentDamageSeverity { minor, moderate, severe }

/// The visible form of damage at one marked point.
///
/// These tokens deliberately match the field vocabulary used by the accident
/// evidence and technical-assessment specs. Keep the enum names stable: they
/// are persisted as lowercase JSON strings by [AccidentDamageMark.toJson].
enum AccidentDamageType { dent, scratch, cracked, broken, missing, other }

/// The reporter's explicit disposition of an automated suggestion.
enum AccidentDamageSuggestionDecision { pending, confirmed, corrected }

/// Finder (or another automated source) metadata kept beside the final human
/// decision rather than overwriting it.
///
/// [suggestedType] and [suggestedArea] are the machine proposal. The final
/// values remain on [AccidentDamageMark], which makes a correction auditable.
/// [reviewedBy], [reviewedAt], and [correctionNote] are additive hooks for a
/// future authenticated Finder integration; this source-only mapper does not
/// invent an operator identity.
@immutable
final class AccidentDamageSuggestion {
  const AccidentDamageSuggestion({
    required this.source,
    required this.confidence,
    this.suggestedType,
    this.suggestedArea,
    this.decision = AccidentDamageSuggestionDecision.pending,
    this.reviewedBy,
    this.reviewedAt,
    this.correctionNote,
  })  : assert(confidence >= 0),
        assert(confidence <= 1);

  factory AccidentDamageSuggestion.fromJson(Map<String, Object?> json) {
    final num rawConfidence =
        json['confidence'] is num ? json['confidence']! as num : 0;
    return AccidentDamageSuggestion(
      source: _nonEmptyString(json['source']) ?? 'unknown',
      confidence: rawConfidence.toDouble().clamp(0, 1),
      suggestedType: _enumByName<AccidentDamageType>(
        AccidentDamageType.values,
        json['suggested_type'] ?? json['suggestedType'],
      ),
      suggestedArea: _nonEmptyString(
        json['suggested_area'] ?? json['suggestedArea'],
      ),
      decision: _enumByName<AccidentDamageSuggestionDecision>(
            AccidentDamageSuggestionDecision.values,
            json['decision'],
          ) ??
          AccidentDamageSuggestionDecision.pending,
      reviewedBy: _nonEmptyString(
        json['reviewed_by'] ?? json['reviewedBy'],
      ),
      reviewedAt: _dateTimeValue(
        json['reviewed_at'] ?? json['reviewedAt'],
      ),
      correctionNote: _nonEmptyString(
        json['correction_note'] ?? json['correctionNote'],
      ),
    );
  }

  final String source;
  final double confidence;
  final AccidentDamageType? suggestedType;
  final String? suggestedArea;
  final AccidentDamageSuggestionDecision decision;
  final String? reviewedBy;
  final DateTime? reviewedAt;
  final String? correctionNote;

  bool get isReviewed => decision != AccidentDamageSuggestionDecision.pending;

  bool matchesSelection({
    required AccidentDamageType type,
    required String area,
  }) {
    final String normalizedArea = area.trim().toLowerCase();
    final String? normalizedSuggestion = suggestedArea?.trim().toLowerCase();
    return (suggestedType == null || suggestedType == type) &&
        (normalizedSuggestion == null ||
            normalizedSuggestion == normalizedArea);
  }

  AccidentDamageSuggestion reviewed({
    required AccidentDamageSuggestionDecision decision,
    required DateTime reviewedAt,
    String? reviewedBy,
    String? correctionNote,
  }) {
    assert(decision != AccidentDamageSuggestionDecision.pending);
    return AccidentDamageSuggestion(
      source: source,
      confidence: confidence,
      suggestedType: suggestedType,
      suggestedArea: suggestedArea,
      decision: decision,
      reviewedBy: _nonEmptyString(reviewedBy),
      reviewedAt: reviewedAt,
      correctionNote: _nonEmptyString(correctionNote),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'source': source,
        'confidence': confidence,
        if (suggestedType != null) 'suggested_type': suggestedType!.name,
        if (_nonEmptyString(suggestedArea) != null)
          'suggested_area': suggestedArea!.trim(),
        'decision': decision.name,
        if (_nonEmptyString(reviewedBy) != null)
          'reviewed_by': reviewedBy!.trim(),
        if (reviewedAt != null)
          'reviewed_at': reviewedAt!.toUtc().toIso8601String(),
        if (_nonEmptyString(correctionNote) != null)
          'correction_note': correctionNote!.trim(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AccidentDamageSuggestion &&
          other.source == source &&
          other.confidence == confidence &&
          other.suggestedType == suggestedType &&
          other.suggestedArea == suggestedArea &&
          other.decision == decision &&
          other.reviewedBy == reviewedBy &&
          other.reviewedAt == reviewedAt &&
          other.correctionNote == correctionNote;

  @override
  int get hashCode => Object.hash(
        source,
        confidence,
        suggestedType,
        suggestedArea,
        decision,
        reviewedBy,
        reviewedAt,
        correctionNote,
      );
}

/// One recorded mark: exact point, human classification, optional evidence,
/// and the original automated suggestion when one was offered.
@immutable
final class AccidentDamageMark {
  const AccidentDamageMark({
    required this.zoneId,
    required this.severity,
    this.damageType = AccidentDamageType.other,
    this.note,
    this.view,
    this.normalizedX,
    this.normalizedY,
    this.areaLabel,
    List<String> photoReferences = const <String>[],
    this.suggestion,
  }) : _photoReferences = photoReferences;

  factory AccidentDamageMark.fromJson(Map<String, Object?> json) {
    final String? zoneId = _nonEmptyString(
      json['zone_id'] ?? json['zoneId'] ?? json['id'],
    );
    if (zoneId == null) {
      throw const FormatException('Damage mark is missing zone_id.');
    }

    final Object? rawPhotos =
        json['photo_references'] ?? json['photoReferences'] ?? json['photos'];
    final List<String> photoReferences = <String>[
      if (rawPhotos is Iterable<Object?>)
        for (final Object? value in rawPhotos)
          if (_nonEmptyString(value) case final String reference) reference,
    ];
    final Map<String, Object?>? suggestionJson = _jsonMap(json['suggestion']);

    return AccidentDamageMark(
      zoneId: zoneId,
      severity: _enumByName<AccidentDamageSeverity>(
            AccidentDamageSeverity.values,
            json['severity'],
          ) ??
          AccidentDamageSeverity.minor,
      damageType: _enumByName<AccidentDamageType>(
            AccidentDamageType.values,
            json['damage_type'] ?? json['damageType'],
          ) ??
          AccidentDamageType.other,
      note: _nonEmptyString(json['note']),
      view: _enumByName<AccidentDamageView>(
        AccidentDamageView.values,
        json['view'],
      ),
      normalizedX: _doubleValue(json['x'] ?? json['normalizedX']),
      normalizedY: _doubleValue(json['y'] ?? json['normalizedY']),
      areaLabel: _nonEmptyString(
        json['area'] ?? json['area_label'] ?? json['areaLabel'],
      ),
      photoReferences: List<String>.unmodifiable(photoReferences),
      suggestion: suggestionJson == null
          ? null
          : AccidentDamageSuggestion.fromJson(suggestionJson),
    );
  }

  final String zoneId;
  final AccidentDamageSeverity severity;
  final AccidentDamageType damageType;
  final String? note;
  final AccidentDamageView? view;
  final double? normalizedX;
  final double? normalizedY;
  final String? areaLabel;
  final List<String> _photoReferences;
  final AccidentDamageSuggestion? suggestion;

  /// References into the report's evidence checklist (for example a durable
  /// local path or uploaded evidence id). The mapper never opens files itself.
  List<String> get photoReferences =>
      List<String>.unmodifiable(_photoReferences);

  int get photoCount => _photoReferences.length;

  AccidentDamageView? get effectiveView =>
      view ?? accidentDamageViewOfZone(zoneId);

  bool get hasExactPoint =>
      normalizedX != null &&
      normalizedY != null &&
      normalizedX! >= 0 &&
      normalizedX! <= 1 &&
      normalizedY! >= 0 &&
      normalizedY! <= 1;

  AccidentDamageMark copyWith({
    AccidentDamageSeverity? severity,
    AccidentDamageType? damageType,
    String? note,
    bool clearNote = false,
    AccidentDamageView? view,
    double? normalizedX,
    double? normalizedY,
    String? areaLabel,
    List<String>? photoReferences,
    AccidentDamageSuggestion? suggestion,
    bool clearSuggestion = false,
  }) =>
      AccidentDamageMark(
        zoneId: zoneId,
        severity: severity ?? this.severity,
        damageType: damageType ?? this.damageType,
        note: clearNote ? null : note ?? this.note,
        view: view ?? this.view,
        normalizedX: normalizedX ?? this.normalizedX,
        normalizedY: normalizedY ?? this.normalizedY,
        areaLabel: areaLabel ?? this.areaLabel,
        photoReferences: List<String>.unmodifiable(
          photoReferences ?? _photoReferences,
        ),
        suggestion: clearSuggestion ? null : suggestion ?? this.suggestion,
      );

  Map<String, Object?> toJson() => <String, Object?>{
        'zone_id': zoneId,
        if (view != null) 'view': view!.name,
        if (normalizedX != null) 'x': normalizedX,
        if (normalizedY != null) 'y': normalizedY,
        if (_nonEmptyString(areaLabel) != null) 'area': areaLabel!.trim(),
        'damage_type': damageType.name,
        'severity': severity.name,
        if (_nonEmptyString(note) != null) 'note': note!.trim(),
        if (_photoReferences.isNotEmpty)
          'photo_references': List<String>.of(_photoReferences),
        if (suggestion != null) 'suggestion': suggestion!.toJson(),
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AccidentDamageMark &&
          other.zoneId == zoneId &&
          other.severity == severity &&
          other.damageType == damageType &&
          other.note == note &&
          other.view == view &&
          other.normalizedX == normalizedX &&
          other.normalizedY == normalizedY &&
          other.areaLabel == areaLabel &&
          listEquals(other._photoReferences, _photoReferences) &&
          other.suggestion == suggestion;

  @override
  int get hashCode => Object.hash(
        zoneId,
        severity,
        damageType,
        note,
        view,
        normalizedX,
        normalizedY,
        areaLabel,
        Object.hashAll(_photoReferences),
        suggestion,
      );
}

/// One exact tap on one truthful vehicle view.
@immutable
final class AccidentDamagePoint {
  const AccidentDamagePoint({
    required this.view,
    required this.normalizedX,
    required this.normalizedY,
  });

  final AccidentDamageView view;
  final double normalizedX;
  final double normalizedY;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AccidentDamagePoint &&
          other.view == view &&
          other.normalizedX == normalizedX &&
          other.normalizedY == normalizedY;

  @override
  int get hashCode => Object.hash(view, normalizedX, normalizedY);
}

/// The full set of marks for one accident report, keyed by zone id so a
/// second tap on an already-marked zone edits it rather than creating a
/// duplicate.
@immutable
final class AccidentDamageMap {
  const AccidentDamageMap._(this._marks);

  const AccidentDamageMap.empty()
      : this._(const <String, AccidentDamageMark>{});

  factory AccidentDamageMap.fromMarks(Iterable<AccidentDamageMark> marks) {
    final Map<String, AccidentDamageMark> byZone = <String, AccidentDamageMark>{
      for (final AccidentDamageMark mark in marks) mark.zoneId: mark,
    };
    return AccidentDamageMap._(
      Map<String, AccidentDamageMark>.unmodifiable(byZone),
    );
  }

  factory AccidentDamageMap.fromJson(Map<String, Object?> json) {
    final Object? rawMarks = json['marks'] ?? json['damage_marks'];
    if (rawMarks is! Iterable<Object?>) {
      return const AccidentDamageMap.empty();
    }
    return AccidentDamageMap.fromMarks(<AccidentDamageMark>[
      for (final Object? rawMark in rawMarks)
        if (_jsonMap(rawMark) case final Map<String, Object?> markJson)
          AccidentDamageMark.fromJson(markJson),
    ]);
  }

  final Map<String, AccidentDamageMark> _marks;

  AccidentDamageMark? markFor(String zoneId) => _marks[zoneId];

  bool hasMark(String zoneId) => _marks.containsKey(zoneId);

  int get count => _marks.length;

  bool get isEmpty => _marks.isEmpty;

  List<AccidentDamageMark> get marks =>
      List<AccidentDamageMark>.unmodifiable(_marks.values);

  List<AccidentDamageMark> marksForView(AccidentDamageView view) =>
      List<AccidentDamageMark>.unmodifiable(
        _marks.values.where(
          (AccidentDamageMark mark) => mark.effectiveView == view,
        ),
      );

  int? markerNumberFor(String zoneId) {
    var number = 1;
    for (final String id in _marks.keys) {
      if (id == zoneId) return number;
      number++;
    }
    return null;
  }

  /// How many marked zones fall under [view] - used for the per-view badge
  /// on the view switcher, so a marked zone on the side the user is not
  /// looking at is never silently invisible.
  int countForView(
    String Function(String zoneId) viewOfZone,
    AccidentDamageView view,
  ) {
    var total = 0;
    for (final String zoneId in _marks.keys) {
      if (viewOfZone(zoneId) == view.name) total++;
    }
    return total;
  }

  int exactCountForView(AccidentDamageView view) => _marks.values
      .where((AccidentDamageMark mark) => mark.effectiveView == view)
      .length;

  AccidentDamageMap withMark(AccidentDamageMark mark) {
    final Map<String, AccidentDamageMark> next =
        Map<String, AccidentDamageMark>.of(_marks);
    next[mark.zoneId] = mark;
    return AccidentDamageMap._(
      Map<String, AccidentDamageMark>.unmodifiable(next),
    );
  }

  AccidentDamageMap withoutMark(String zoneId) {
    if (!_marks.containsKey(zoneId)) return this;
    final Map<String, AccidentDamageMark> next =
        Map<String, AccidentDamageMark>.of(_marks)..remove(zoneId);
    return AccidentDamageMap._(
      Map<String, AccidentDamageMark>.unmodifiable(next),
    );
  }

  Map<String, Object?> toJson() => <String, Object?>{
        'version': 2,
        'marks': <Map<String, Object?>>[
          for (final AccidentDamageMark mark in _marks.values) mark.toJson(),
        ],
      };

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AccidentDamageMap && mapEquals(other._marks, _marks);

  @override
  int get hashCode => Object.hashAllUnordered(
        _marks.entries.map(
          (MapEntry<String, AccidentDamageMark> entry) =>
              Object.hash(entry.key, entry.value),
        ),
      );
}

String? _nonEmptyString(Object? value) {
  if (value is! String) return null;
  final String normalized = value.trim();
  return normalized.isEmpty ? null : normalized;
}

double? _doubleValue(Object? value) => value is num ? value.toDouble() : null;

DateTime? _dateTimeValue(Object? value) {
  if (value is DateTime) return value;
  if (value is! String) return null;
  return DateTime.tryParse(value);
}

T? _enumByName<T extends Enum>(Iterable<T> values, Object? raw) {
  if (raw is! String) return null;
  final String normalized = raw.trim().toLowerCase();
  for (final T value in values) {
    if (value.name.toLowerCase() == normalized) return value;
  }
  return null;
}

Map<String, Object?>? _jsonMap(Object? value) {
  if (value is! Map<Object?, Object?>) return null;
  return <String, Object?>{
    for (final MapEntry<Object?, Object?> entry in value.entries)
      if (entry.key is String) entry.key! as String: entry.value,
  };
}

const List<AccidentDamageZone> _roadVehicleDamageZones = <AccidentDamageZone>[
  AccidentDamageZone(
    id: 'front_windshield',
    view: AccidentDamageView.front,
    left: .27,
    top: .27,
    width: .46,
    height: .20,
  ),
  AccidentDamageZone(
    id: 'front_hood',
    view: AccidentDamageView.front,
    left: .38,
    top: .49,
    width: .24,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'front_left_light',
    view: AccidentDamageView.front,
    left: .25,
    top: .51,
    width: .12,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'front_right_light',
    view: AccidentDamageView.front,
    left: .63,
    top: .51,
    width: .12,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'front_bumper',
    view: AccidentDamageView.front,
    left: .26,
    top: .65,
    width: .48,
    height: .11,
  ),
  AccidentDamageZone(
    id: 'rear_windshield',
    view: AccidentDamageView.rear,
    left: .28,
    top: .27,
    width: .44,
    height: .20,
  ),
  AccidentDamageZone(
    id: 'rear_tailgate',
    view: AccidentDamageView.rear,
    left: .36,
    top: .49,
    width: .28,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_left_light',
    view: AccidentDamageView.rear,
    left: .25,
    top: .50,
    width: .10,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_right_light',
    view: AccidentDamageView.rear,
    left: .65,
    top: .50,
    width: .10,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_bumper',
    view: AccidentDamageView.rear,
    left: .27,
    top: .67,
    width: .46,
    height: .09,
  ),
  AccidentDamageZone(
    id: 'left_front_door',
    view: AccidentDamageView.left,
    left: .56,
    top: .36,
    width: .15,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'left_rear_door',
    view: AccidentDamageView.left,
    left: .40,
    top: .36,
    width: .15,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'left_front_fender',
    view: AccidentDamageView.left,
    left: .72,
    top: .50,
    width: .12,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'left_rear_fender',
    view: AccidentDamageView.left,
    left: .24,
    top: .50,
    width: .15,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'left_side_panel',
    view: AccidentDamageView.left,
    left: .12,
    top: .36,
    width: .27,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'left_mirror',
    view: AccidentDamageView.left,
    left: .72,
    top: .34,
    width: .08,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'left_roof',
    view: AccidentDamageView.left,
    left: .28,
    top: .27,
    width: .43,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'right_front_door',
    view: AccidentDamageView.right,
    left: .29,
    top: .36,
    width: .15,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'right_rear_door',
    view: AccidentDamageView.right,
    left: .45,
    top: .36,
    width: .15,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'right_front_fender',
    view: AccidentDamageView.right,
    left: .16,
    top: .50,
    width: .12,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'right_rear_fender',
    view: AccidentDamageView.right,
    left: .61,
    top: .50,
    width: .15,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'right_side_panel',
    view: AccidentDamageView.right,
    left: .61,
    top: .36,
    width: .27,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'right_mirror',
    view: AccidentDamageView.right,
    left: .20,
    top: .34,
    width: .08,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'right_roof',
    view: AccidentDamageView.right,
    left: .29,
    top: .27,
    width: .43,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'top_hood',
    view: AccidentDamageView.top,
    left: .35,
    top: .16,
    width: .30,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'top_roof',
    view: AccidentDamageView.top,
    left: .31,
    top: .35,
    width: .38,
    height: .34,
  ),
  AccidentDamageZone(
    id: 'top_tailgate',
    view: AccidentDamageView.top,
    left: .35,
    top: .70,
    width: .30,
    height: .16,
  ),
];

const List<AccidentDamageZone> _busDamageZones = <AccidentDamageZone>[
  AccidentDamageZone(
    id: 'front_windshield',
    view: AccidentDamageView.front,
    left: .27,
    top: .27,
    width: .46,
    height: .20,
  ),
  AccidentDamageZone(
    id: 'front_cab_panel',
    view: AccidentDamageView.front,
    left: .38,
    top: .49,
    width: .24,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'front_left_light',
    view: AccidentDamageView.front,
    left: .25,
    top: .51,
    width: .12,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'front_right_light',
    view: AccidentDamageView.front,
    left: .63,
    top: .51,
    width: .12,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'front_bumper',
    view: AccidentDamageView.front,
    left: .26,
    top: .65,
    width: .48,
    height: .11,
  ),
  AccidentDamageZone(
    id: 'rear_windshield',
    view: AccidentDamageView.rear,
    left: .28,
    top: .27,
    width: .44,
    height: .20,
  ),
  AccidentDamageZone(
    id: 'rear_body_panel',
    view: AccidentDamageView.rear,
    left: .36,
    top: .49,
    width: .28,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_left_light',
    view: AccidentDamageView.rear,
    left: .25,
    top: .50,
    width: .10,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_right_light',
    view: AccidentDamageView.rear,
    left: .65,
    top: .50,
    width: .10,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'rear_bumper',
    view: AccidentDamageView.rear,
    left: .27,
    top: .67,
    width: .46,
    height: .09,
  ),
  AccidentDamageZone(
    id: 'left_driver_door',
    view: AccidentDamageView.left,
    left: .70,
    top: .37,
    width: .13,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'left_passenger_door',
    view: AccidentDamageView.left,
    left: .56,
    top: .37,
    width: .13,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'left_body_panel',
    view: AccidentDamageView.left,
    left: .18,
    top: .36,
    width: .37,
    height: .24,
  ),
  AccidentDamageZone(
    id: 'left_front_fender',
    view: AccidentDamageView.left,
    left: .72,
    top: .61,
    width: .12,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'left_rear_fender',
    view: AccidentDamageView.left,
    left: .24,
    top: .61,
    width: .15,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'left_mirror',
    view: AccidentDamageView.left,
    left: .84,
    top: .35,
    width: .07,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'left_roof',
    view: AccidentDamageView.left,
    left: .22,
    top: .27,
    width: .61,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'right_driver_door',
    view: AccidentDamageView.right,
    left: .17,
    top: .37,
    width: .13,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'right_passenger_door',
    view: AccidentDamageView.right,
    left: .31,
    top: .37,
    width: .13,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'right_body_panel',
    view: AccidentDamageView.right,
    left: .45,
    top: .36,
    width: .37,
    height: .24,
  ),
  AccidentDamageZone(
    id: 'right_front_fender',
    view: AccidentDamageView.right,
    left: .16,
    top: .61,
    width: .12,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'right_rear_fender',
    view: AccidentDamageView.right,
    left: .61,
    top: .61,
    width: .15,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'right_mirror',
    view: AccidentDamageView.right,
    left: .09,
    top: .35,
    width: .07,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'right_roof',
    view: AccidentDamageView.right,
    left: .17,
    top: .27,
    width: .61,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'top_front_cab',
    view: AccidentDamageView.top,
    left: .31,
    top: .12,
    width: .38,
    height: .20,
  ),
  AccidentDamageZone(
    id: 'top_passenger_body',
    view: AccidentDamageView.top,
    left: .31,
    top: .33,
    width: .38,
    height: .54,
  ),
];

const List<AccidentDamageZone> _heavyTruckDamageZones = <AccidentDamageZone>[
  AccidentDamageZone(
    id: 'front_windshield',
    view: AccidentDamageView.front,
    left: .31,
    top: .29,
    width: .38,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'front_cab_panel',
    view: AccidentDamageView.front,
    left: .39,
    top: .49,
    width: .22,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'front_left_light',
    view: AccidentDamageView.front,
    left: .29,
    top: .50,
    width: .09,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'front_right_light',
    view: AccidentDamageView.front,
    left: .62,
    top: .50,
    width: .09,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'front_bumper',
    view: AccidentDamageView.front,
    left: .29,
    top: .65,
    width: .42,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'rear_equipment',
    view: AccidentDamageView.rear,
    left: .35,
    top: .31,
    width: .30,
    height: .30,
  ),
  AccidentDamageZone(
    id: 'rear_left_light',
    view: AccidentDamageView.rear,
    left: .24,
    top: .55,
    width: .10,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'rear_right_light',
    view: AccidentDamageView.rear,
    left: .66,
    top: .55,
    width: .10,
    height: .12,
  ),
  AccidentDamageZone(
    id: 'rear_bumper',
    view: AccidentDamageView.rear,
    left: .29,
    top: .68,
    width: .42,
    height: .09,
  ),
  AccidentDamageZone(
    id: 'left_cab',
    view: AccidentDamageView.left,
    left: .04,
    top: .37,
    width: .20,
    height: .21,
  ),
  AccidentDamageZone(
    id: 'left_boom',
    view: AccidentDamageView.left,
    left: .25,
    top: .30,
    width: .68,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'left_equipment_body',
    view: AccidentDamageView.left,
    left: .26,
    top: .44,
    width: .66,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'left_outrigger',
    view: AccidentDamageView.left,
    left: .23,
    top: .58,
    width: .10,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'right_cab',
    view: AccidentDamageView.right,
    left: .76,
    top: .37,
    width: .20,
    height: .21,
  ),
  AccidentDamageZone(
    id: 'right_boom',
    view: AccidentDamageView.right,
    left: .07,
    top: .30,
    width: .68,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'right_equipment_body',
    view: AccidentDamageView.right,
    left: .08,
    top: .44,
    width: .66,
    height: .13,
  ),
  AccidentDamageZone(
    id: 'right_outrigger',
    view: AccidentDamageView.right,
    left: .67,
    top: .58,
    width: .10,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'top_cab',
    view: AccidentDamageView.top,
    left: .08,
    top: .35,
    width: .18,
    height: .30,
  ),
  AccidentDamageZone(
    id: 'top_boom',
    view: AccidentDamageView.top,
    left: .28,
    top: .35,
    width: .58,
    height: .30,
  ),
  AccidentDamageZone(
    id: 'top_rear_equipment',
    view: AccidentDamageView.top,
    left: .87,
    top: .38,
    width: .08,
    height: .24,
  ),
];

const List<AccidentDamageZone> _loaderDamageZones = <AccidentDamageZone>[
  AccidentDamageZone(
    id: 'front_bucket',
    view: AccidentDamageView.front,
    left: .20,
    top: .57,
    width: .60,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'front_boom',
    view: AccidentDamageView.front,
    left: .25,
    top: .40,
    width: .50,
    height: .15,
  ),
  AccidentDamageZone(
    id: 'front_cab',
    view: AccidentDamageView.front,
    left: .36,
    top: .23,
    width: .28,
    height: .16,
  ),
  AccidentDamageZone(
    id: 'rear_counterweight',
    view: AccidentDamageView.rear,
    left: .25,
    top: .48,
    width: .50,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'rear_left_light',
    view: AccidentDamageView.rear,
    left: .24,
    top: .37,
    width: .10,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'rear_right_light',
    view: AccidentDamageView.rear,
    left: .66,
    top: .37,
    width: .10,
    height: .10,
  ),
  AccidentDamageZone(
    id: 'left_bucket',
    view: AccidentDamageView.left,
    left: .02,
    top: .49,
    width: .20,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'left_lift_arm',
    view: AccidentDamageView.left,
    left: .22,
    top: .39,
    width: .20,
    height: .11,
  ),
  AccidentDamageZone(
    id: 'left_front_wheel',
    view: AccidentDamageView.left,
    left: .25,
    top: .51,
    width: .18,
    height: .17,
  ),
  AccidentDamageZone(
    id: 'left_cab',
    view: AccidentDamageView.left,
    left: .43,
    top: .31,
    width: .18,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'left_engine_cover',
    view: AccidentDamageView.left,
    left: .62,
    top: .37,
    width: .25,
    height: .14,
  ),
  AccidentDamageZone(
    id: 'left_rear_wheel',
    view: AccidentDamageView.left,
    left: .64,
    top: .52,
    width: .18,
    height: .17,
  ),
  AccidentDamageZone(
    id: 'right_bucket',
    view: AccidentDamageView.right,
    left: .78,
    top: .49,
    width: .20,
    height: .18,
  ),
  AccidentDamageZone(
    id: 'right_lift_arm',
    view: AccidentDamageView.right,
    left: .58,
    top: .39,
    width: .20,
    height: .11,
  ),
  AccidentDamageZone(
    id: 'right_front_wheel',
    view: AccidentDamageView.right,
    left: .57,
    top: .51,
    width: .18,
    height: .17,
  ),
  AccidentDamageZone(
    id: 'right_cab',
    view: AccidentDamageView.right,
    left: .39,
    top: .31,
    width: .17,
    height: .23,
  ),
  AccidentDamageZone(
    id: 'right_engine_cover',
    view: AccidentDamageView.right,
    left: .13,
    top: .37,
    width: .25,
    height: .14,
  ),
  AccidentDamageZone(
    id: 'right_rear_wheel',
    view: AccidentDamageView.right,
    left: .18,
    top: .52,
    width: .18,
    height: .17,
  ),
  AccidentDamageZone(
    id: 'top_bucket',
    view: AccidentDamageView.top,
    left: .05,
    top: .30,
    width: .20,
    height: .40,
  ),
  AccidentDamageZone(
    id: 'top_lift_arm',
    view: AccidentDamageView.top,
    left: .27,
    top: .34,
    width: .20,
    height: .32,
  ),
  AccidentDamageZone(
    id: 'top_cab',
    view: AccidentDamageView.top,
    left: .49,
    top: .30,
    width: .20,
    height: .40,
  ),
  AccidentDamageZone(
    id: 'top_engine_cover',
    view: AccidentDamageView.top,
    left: .71,
    top: .32,
    width: .23,
    height: .36,
  ),
];

const List<AccidentDamageZone> _fixedEquipmentDamageZones =
    <AccidentDamageZone>[
  AccidentDamageZone(
    id: 'front_equipment_panel',
    view: AccidentDamageView.front,
    left: .22,
    top: .28,
    width: .52,
    height: .42,
  ),
  AccidentDamageZone(
    id: 'front_pipework',
    view: AccidentDamageView.front,
    left: .75,
    top: .34,
    width: .10,
    height: .30,
  ),
  AccidentDamageZone(
    id: 'front_base_frame',
    view: AccidentDamageView.front,
    left: .22,
    top: .71,
    width: .63,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'rear_equipment_panel',
    view: AccidentDamageView.rear,
    left: .26,
    top: .28,
    width: .48,
    height: .42,
  ),
  AccidentDamageZone(
    id: 'rear_pipework',
    view: AccidentDamageView.rear,
    left: .15,
    top: .34,
    width: .10,
    height: .30,
  ),
  AccidentDamageZone(
    id: 'rear_base_frame',
    view: AccidentDamageView.rear,
    left: .15,
    top: .71,
    width: .63,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'left_equipment_panel',
    view: AccidentDamageView.left,
    left: .20,
    top: .31,
    width: .55,
    height: .36,
  ),
  AccidentDamageZone(
    id: 'left_control_panel',
    view: AccidentDamageView.left,
    left: .76,
    top: .35,
    width: .10,
    height: .24,
  ),
  AccidentDamageZone(
    id: 'left_base_frame',
    view: AccidentDamageView.left,
    left: .20,
    top: .68,
    width: .66,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'right_equipment_panel',
    view: AccidentDamageView.right,
    left: .25,
    top: .31,
    width: .55,
    height: .36,
  ),
  AccidentDamageZone(
    id: 'right_control_panel',
    view: AccidentDamageView.right,
    left: .14,
    top: .35,
    width: .10,
    height: .24,
  ),
  AccidentDamageZone(
    id: 'right_base_frame',
    view: AccidentDamageView.right,
    left: .14,
    top: .68,
    width: .66,
    height: .08,
  ),
  AccidentDamageZone(
    id: 'top_equipment_body',
    view: AccidentDamageView.top,
    left: .22,
    top: .20,
    width: .56,
    height: .60,
  ),
  AccidentDamageZone(
    id: 'top_pipework',
    view: AccidentDamageView.top,
    left: .79,
    top: .28,
    width: .10,
    height: .44,
  ),
];

/// Legacy fixed-zone catalog retained for backward-compatible draft reads.
///
/// Coordinates are hand-placed against the exact shapes
/// [VehicleDamageDiagramPainter] draws for each view - see that file's own
/// comment on why the two must be changed together.
const List<AccidentDamageZone> kAccidentDamageZones = <AccidentDamageZone>[
  // FRONT - facing the vehicle head-on.
  // Coordinates are hand-placed against the truck-cab shapes
  // `VehicleDamageDiagram`'s `_paintCabFace` draws - see that method's own
  // comment for the cab/grille/bumper/lamp layout these rectangles sit on.
  AccidentDamageZone(
    id: 'front_bumper',
    view: AccidentDamageView.front,
    left: 0.12,
    top: 0.72,
    width: 0.76,
    height: 0.14,
  ),
  AccidentDamageZone(
    id: 'front_hood',
    view: AccidentDamageView.front,
    left: 0.20,
    top: 0.40,
    width: 0.60,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'front_windshield',
    view: AccidentDamageView.front,
    left: 0.20,
    top: 0.17,
    width: 0.60,
    height: 0.18,
  ),
  AccidentDamageZone(
    id: 'front_left_light',
    view: AccidentDamageView.front,
    left: 0.12,
    top: 0.46,
    width: 0.08,
    height: 0.16,
  ),
  AccidentDamageZone(
    id: 'front_right_light',
    view: AccidentDamageView.front,
    left: 0.80,
    top: 0.46,
    width: 0.08,
    height: 0.16,
  ),

  // REAR - the same cab shape as front; `_paintCabFace(isRear: true)` swaps
  // only the lamp style and drops the grille slats, so the rectangles match.
  AccidentDamageZone(
    id: 'rear_bumper',
    view: AccidentDamageView.rear,
    left: 0.12,
    top: 0.72,
    width: 0.76,
    height: 0.14,
  ),
  AccidentDamageZone(
    id: 'rear_tailgate',
    view: AccidentDamageView.rear,
    left: 0.20,
    top: 0.40,
    width: 0.60,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'rear_windshield',
    view: AccidentDamageView.rear,
    left: 0.20,
    top: 0.17,
    width: 0.60,
    height: 0.18,
  ),
  AccidentDamageZone(
    id: 'rear_left_light',
    view: AccidentDamageView.rear,
    left: 0.12,
    top: 0.46,
    width: 0.08,
    height: 0.16,
  ),
  AccidentDamageZone(
    id: 'rear_right_light',
    view: AccidentDamageView.rear,
    left: 0.80,
    top: 0.46,
    width: 0.08,
    height: 0.16,
  ),

  // LEFT - a cab at the RIGHT of the canvas (mirroring how a person actually
  // stands to photograph the driver's side) with a long load body to its
  // left. Coordinates match `_paintTruckProfile`'s unmirrored drawing
  // exactly - that method is what `left` renders without a canvas flip.
  // Widths on either side of a shared boundary are trimmed by a hairline
  // (0.006) rather than meeting exactly - `zone.left + zone.width` and a
  // neighbour's literal `left` are computed by two different paths and can
  // land on adjacent doubles (classic `0.02 + 0.28 != 0.30` float drift),
  // which the overlap test below would then flag as touching zones
  // overlapping by less than a rounding error. A real, if imperceptible,
  // gap makes the test's outcome independent of floating-point rounding.
  AccidentDamageZone(
    id: 'left_front_fender',
    view: AccidentDamageView.left,
    left: 0.64,
    top: 0.40,
    width: 0.054,
    height: 0.22,
  ),
  AccidentDamageZone(
    id: 'left_front_door',
    view: AccidentDamageView.left,
    left: 0.70,
    top: 0.34,
    width: 0.28,
    height: 0.26,
  ),
  AccidentDamageZone(
    id: 'left_rear_door',
    view: AccidentDamageView.left,
    left: 0.32,
    top: 0.30,
    width: 0.30,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'left_rear_fender',
    view: AccidentDamageView.left,
    left: 0.04,
    top: 0.30,
    width: 0.274,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'left_mirror',
    view: AccidentDamageView.left,
    left: 0.92,
    top: 0.12,
    width: 0.07,
    height: 0.14,
  ),
  AccidentDamageZone(
    id: 'left_roof',
    view: AccidentDamageView.left,
    left: 0.70,
    top: 0.04,
    width: 0.28,
    height: 0.08,
  ),

  // RIGHT - the exact mirror of LEFT (right.left = 1 - left.left -
  // left.width for every zone above), matching `_paintTruckProfile`'s own
  // `canvas.scale(-1, 1)` flip for this view.
  AccidentDamageZone(
    id: 'right_front_fender',
    view: AccidentDamageView.right,
    left: 0.30,
    top: 0.40,
    width: 0.06,
    height: 0.22,
  ),
  AccidentDamageZone(
    id: 'right_front_door',
    view: AccidentDamageView.right,
    left: 0.02,
    top: 0.34,
    width: 0.274,
    height: 0.26,
  ),
  AccidentDamageZone(
    id: 'right_rear_door',
    view: AccidentDamageView.right,
    left: 0.38,
    top: 0.30,
    width: 0.294,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'right_rear_fender',
    view: AccidentDamageView.right,
    left: 0.68,
    top: 0.30,
    width: 0.28,
    height: 0.30,
  ),
  AccidentDamageZone(
    id: 'right_mirror',
    view: AccidentDamageView.right,
    left: 0.01,
    top: 0.12,
    width: 0.07,
    height: 0.14,
  ),
  AccidentDamageZone(
    id: 'right_roof',
    view: AccidentDamageView.right,
    left: 0.02,
    top: 0.04,
    width: 0.28,
    height: 0.08,
  ),

  // TOP - looking straight down on a cab-over truck: a cab block at the
  // front (no separate hood/windshield read from directly above) and the
  // long body/load area behind it. Matches `_paintTop`'s cab and chassis
  // rectangles exactly.
  AccidentDamageZone(
    id: 'top_roof',
    view: AccidentDamageView.top,
    left: 0.30,
    top: 0.06,
    width: 0.40,
    height: 0.22,
  ),
  AccidentDamageZone(
    id: 'top_tailgate',
    view: AccidentDamageView.top,
    left: 0.30,
    top: 0.30,
    width: 0.40,
    height: 0.64,
  ),
];

List<AccidentDamageZone> _damageCatalogFor(
  AccidentDamageAssetClass assetClass,
) =>
    switch (assetClass) {
      AccidentDamageAssetClass.roadVehicle => _roadVehicleDamageZones,
      AccidentDamageAssetClass.bus => _busDamageZones,
      AccidentDamageAssetClass.heavyTruck => _heavyTruckDamageZones,
      AccidentDamageAssetClass.loader => _loaderDamageZones,
      AccidentDamageAssetClass.fixedEquipment => _fixedEquipmentDamageZones,
      AccidentDamageAssetClass.legacy => kAccidentDamageZones,
    };

/// The zones registered for [view], in catalog order.
List<AccidentDamageZone> accidentDamageZonesFor(
  AccidentDamageView view, {
  AccidentDamageAssetClass assetClass = AccidentDamageAssetClass.legacy,
}) =>
    _damageCatalogFor(assetClass)
        .where((AccidentDamageZone z) => z.view == view)
        .toList(growable: false);

/// The view a given zone id belongs to, or `null` for an unrecognised id.
///
/// Used to badge the view switcher with a per-view mark count without the
/// caller needing to know the catalog's own shape.
AccidentDamageView? accidentDamageViewOfZone(String zoneId) {
  for (final AccidentDamageAssetClass assetClass
      in AccidentDamageAssetClass.values) {
    for (final AccidentDamageZone zone in _damageCatalogFor(assetClass)) {
      if (zone.id == zoneId) return zone.view;
    }
  }
  return null;
}

/// The zone at [dx]/[dy] (each 0..1 within the view's own canvas) for
/// [view], or `null` when the tap landed outside every registered zone.
///
/// Zones are checked in catalog order and the FIRST match wins - the
/// catalog above is hand-placed with no overlaps, so ordering is not a
/// meaningful tie-break today, but a future zone that does overlap another
/// (e.g. a mirror sitting on top of a door) resolves to the more specific,
/// earlier-declared one rather than an arbitrary one.
AccidentDamageZone? accidentDamageZoneAt(
  AccidentDamageView view,
  double dx,
  double dy, {
  AccidentDamageAssetClass assetClass = AccidentDamageAssetClass.legacy,
}) {
  for (final AccidentDamageZone zone in _damageCatalogFor(assetClass)) {
    if (zone.view != view) continue;
    final bool insideX = dx >= zone.left && dx <= zone.left + zone.width;
    final bool insideY = dy >= zone.top && dy <= zone.top + zone.height;
    if (insideX && insideY) return zone;
  }
  return null;
}
