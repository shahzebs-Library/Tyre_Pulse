/// The vehicle diagram's geometry model: one wheel slot, and the per-vehicle
/// -type layout that groups a set of slots into one machine.
///
/// Ported from `mobile/lib/tyreDiagramLayouts.ts` (`TyreDef`, `DiagramLayout`,
/// the `LAYOUTS` table) per `docs/flutter-migration/07-tyre-layout-parity
/// -tests.md` sections 2 and 4.1. That artifact is the ONLY source these
/// coordinates were transcribed from - every `x`/`y`/`w`/`h` below is a
/// hand-authored literal the production artwork is drawn around, not a
/// computed value. Section 4.2: "Do not invent coordinates."
///
/// ONE RULE MATTERS MORE THAN ANY OTHER HERE (artifact section 1.4): a
/// slot's canonical GCC label (`LHF1`, `LHCO`, `RHR1-O`, ...) is NEVER
/// stored. [TyreSlot] carries only [id] - the storage key for
/// `inspections.tyre_conditions` - and the label is derived fresh, on every
/// call, by the free function `legacyPositionCode(layoutKey, id)` in
/// `tyre_diagram_layouts.dart`. That function is deliberately NOT a method
/// on [DiagramLayout]: keeping it a free function taking the layout's KEY
/// (a plain string) rather than the layout OBJECT means this file never has
/// to import `tyre_diagram_layouts.dart` back, matching how the TS source
/// itself calls `legacyPositionCode(vehicleTypeKey, id)` decoupled from any
/// layout instance.
///
/// The derivation is TYPE-AWARE: the very same slot id (`R1Lo`) means
/// `LHR1-O` on a Line pump and `LHCO` on a Tri-mixer (artifact section 2,
/// the sharpest parity trap in this whole port). Baking the label in beside
/// the id, the way the native Kotlin port did (artifact section 6, defect
/// K9), makes that override impossible to apply to a layout nobody
/// hand-wrote it for.
library;

import 'package:flutter/foundation.dart';

/// The eight vehicle-body artworks the production diagram draws. Purely an
/// ARTWORK selector (artifact section 4.2) - several distinct layouts share
/// one body key on purpose (a Canter and a Tanker are slot-identical AND
/// share `canter`; that is correct and must never be "de-duplicated" away,
/// per the artifact's own instruction on layouts 4-8).
enum TyreDiagramBodyKey {
  pickup,
  canter,
  triMixer,
  concretePump,
  wheelLoader,
  bus,
  tata,
  ashokLeyland,
}

/// One wheel position on a vehicle diagram.
///
/// [id] is the V1 diagram-slot vocabulary (`FL`, `RLo`, `F1L`, `R2Ro`, ...) -
/// the storage key for `inspections.tyre_conditions`. There is no `label`
/// field: see the library comment for why that would be a defect, not a
/// convenience.
@immutable
class TyreSlot {
  const TyreSlot({
    required this.id,
    required this.x,
    required this.y,
    required this.w,
    required this.h,
  });

  /// The V1 diagram-slot id. A technical identifier, never reordered under
  /// an RTL locale and never translated - draw it through `TpIdentifierText`,
  /// not a plain `Text`.
  final String id;

  /// SVG user-space coordinates, exactly as authored in the production
  /// source. The viewBox is `minX -10, width 220, minY -5, height viewH+10`
  /// (artifact section 4.1) - usable `x` runs 0..200, `y` runs 0..[viewH].
  final double x;
  final double y;
  final double w;
  final double h;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TyreSlot &&
          other.id == id &&
          other.x == x &&
          other.y == y &&
          other.w == w &&
          other.h == h);

  @override
  int get hashCode => Object.hash(id, x, y, w, h);

  @override
  String toString() => 'TyreSlot(id: $id, x: $x, y: $y, w: $w, h: $h)';
}

/// One vehicle type's complete wheel arrangement.
///
/// [tyres] is in DECLARATION order, which is also render order (front to
/// back, left to right) - artifact section 2 and invariant 89 (`y` is
/// non-decreasing across the declared list for every one of the 13
/// production layouts).
@immutable
class DiagramLayout {
  const DiagramLayout({
    required this.key,
    required this.viewH,
    required this.bodyKey,
    required this.tyres,
  });

  /// The `kTyreDiagramLayouts` map key this layout is registered under
  /// (`'Tri-mixer'`, `'Pickup'`, ...). Unlike a slot's label, this is not a
  /// DERIVED value - it identifies which of the 13 production layouts this
  /// is, fixed once at construction, exactly as fixed as the TS `LAYOUTS`
  /// object's own key for the same entry. Pass it to
  /// `legacyPositionCode(key, slot.id)` to get a slot's label.
  final String key;

  final double viewH;
  final TyreDiagramBodyKey bodyKey;
  final List<TyreSlot> tyres;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is DiagramLayout &&
          other.key == key &&
          other.viewH == viewH &&
          other.bodyKey == bodyKey &&
          listEquals(other.tyres, tyres));

  @override
  int get hashCode => Object.hash(key, viewH, bodyKey, Object.hashAll(tyres));

  @override
  String toString() =>
      'DiagramLayout(key: $key, bodyKey: $bodyKey, tyres: ${tyres.length})';
}
