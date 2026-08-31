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

/// One recorded mark: which zone, how severe, and an optional free-text note
/// (e.g. "cracked, not shattered").
@immutable
class AccidentDamageMark {
  const AccidentDamageMark({
    required this.zoneId,
    required this.severity,
    this.note,
    this.view,
    this.normalizedX,
    this.normalizedY,
    this.areaLabel,
  });

  final String zoneId;
  final AccidentDamageSeverity severity;
  final String? note;
  final AccidentDamageView? view;
  final double? normalizedX;
  final double? normalizedY;
  final String? areaLabel;

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
    String? note,
    AccidentDamageView? view,
    double? normalizedX,
    double? normalizedY,
    String? areaLabel,
  }) =>
      AccidentDamageMark(
        zoneId: zoneId,
        severity: severity ?? this.severity,
        note: note ?? this.note,
        view: view ?? this.view,
        normalizedX: normalizedX ?? this.normalizedX,
        normalizedY: normalizedY ?? this.normalizedY,
        areaLabel: areaLabel ?? this.areaLabel,
      );
}

/// One exact tap on one truthful vehicle view.
@immutable
class AccidentDamagePoint {
  const AccidentDamagePoint({
    required this.view,
    required this.normalizedX,
    required this.normalizedY,
  });

  final AccidentDamageView view;
  final double normalizedX;
  final double normalizedY;
}

/// The full set of marks for one accident report, keyed by zone id so a
/// second tap on an already-marked zone edits it rather than creating a
/// duplicate.
@immutable
class AccidentDamageMap {
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

  final Map<String, AccidentDamageMark> _marks;

  AccidentDamageMark? markFor(String zoneId) => _marks[zoneId];

  bool hasMark(String zoneId) => _marks.containsKey(zoneId);

  int get count => _marks.length;

  bool get isEmpty => _marks.isEmpty;

  List<AccidentDamageMark> get marks =>
      List<AccidentDamageMark>.unmodifiable(_marks.values);

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
}

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

/// The zones registered for [view], in catalog order.
List<AccidentDamageZone> accidentDamageZonesFor(AccidentDamageView view) =>
    kAccidentDamageZones
        .where((AccidentDamageZone z) => z.view == view)
        .toList(growable: false);

/// The view a given zone id belongs to, or `null` for an unrecognised id.
///
/// Used to badge the view switcher with a per-view mark count without the
/// caller needing to know the catalog's own shape.
AccidentDamageView? accidentDamageViewOfZone(String zoneId) {
  for (final AccidentDamageZone zone in kAccidentDamageZones) {
    if (zone.id == zoneId) return zone.view;
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
  double dy,
) {
  for (final AccidentDamageZone zone in kAccidentDamageZones) {
    if (zone.view != view) continue;
    final bool insideX = dx >= zone.left && dx <= zone.left + zone.width;
    final bool insideY = dy >= zone.top && dy <= zone.top + zone.height;
    if (insideX && insideY) return zone;
  }
  return null;
}
