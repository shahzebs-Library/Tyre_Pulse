/// The tyre diagram resolver: 13 production layouts, the vehicle-type
/// resolver that picks one, the tyreless-equipment gate, and the type-aware
/// V1-to-V2 position relabeller.
///
/// Ported rule-for-rule from `mobile/lib/tyreDiagramLayouts.ts`, per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md`. This is a
/// faithful, whole-module port of a SINGLE resolver - never a
/// `switch (vehicleType) { ... }` that hand-lists layouts. Artifact section
/// 6 names exactly that shape as what let the native Kotlin port ship with
/// a missing Bus layout (defect K1), a 10-tyre concrete pump that should be
/// 14 (K2), and six layouts that do not exist at all (K3). Every rule here
/// traces to a named line range in the artifact; changing an order without
/// re-reading section 3 first is how those defects happen again.
library;

import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

// The 13 production layouts (artifact section 2).
//
// Every coordinate below was transcribed directly from
// `mobile/lib/tyreDiagramLayouts.ts:57-252`, verified against the artifact's
// own execution of that file. 98 slots total, 0 spares (artifact section
// 1.2 - "no `Spare` slot ... in ANY of the 13 layouts"). Declaration order
// is render order: `y` is non-decreasing within every layout (invariant 89).
//
// Layouts 4 (Canter), 6 (Tata), 7 (Ashok Leyland) and 8/10 (Tanker) share
// identical slot sets and differ only in `bodyKey`/`viewH`; layouts 1-2-3
// (Pickup / Wheel loader / Skid loader) likewise. That duplication is
// deliberate - `bodyKey` is what selects the artwork - and must not be
// collapsed.
const Map<String, DiagramLayout> kTyreDiagramLayouts = {
  'Pickup': DiagramLayout(
    key: 'Pickup',
    viewH: 320,
    bodyKey: TyreDiagramBodyKey.pickup,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 32, y: 48, w: 23, h: 44),
      TyreSlot(id: 'FR', x: 145, y: 48, w: 23, h: 44),
      TyreSlot(id: 'RL', x: 32, y: 192, w: 23, h: 44),
      TyreSlot(id: 'RR', x: 145, y: 192, w: 23, h: 44),
    ],
  ),
  'Wheel loader': DiagramLayout(
    key: 'Wheel loader',
    viewH: 258,
    bodyKey: TyreDiagramBodyKey.wheelLoader,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 24, y: 22, w: 32, h: 56),
      TyreSlot(id: 'FR', x: 144, y: 22, w: 32, h: 56),
      TyreSlot(id: 'RL', x: 24, y: 155, w: 32, h: 56),
      TyreSlot(id: 'RR', x: 144, y: 155, w: 32, h: 56),
    ],
  ),
  'Skid loader': DiagramLayout(
    key: 'Skid loader',
    viewH: 258,
    bodyKey: TyreDiagramBodyKey.wheelLoader,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 24, y: 22, w: 32, h: 56),
      TyreSlot(id: 'FR', x: 144, y: 22, w: 32, h: 56),
      TyreSlot(id: 'RL', x: 24, y: 155, w: 32, h: 56),
      TyreSlot(id: 'RR', x: 144, y: 155, w: 32, h: 56),
    ],
  ),
  'Canter': DiagramLayout(
    key: 'Canter',
    viewH: 310,
    bodyKey: TyreDiagramBodyKey.canter,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 31, y: 36, w: 22, h: 40),
      TyreSlot(id: 'FR', x: 147, y: 36, w: 22, h: 40),
      TyreSlot(id: 'RLo', x: 16, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RLi', x: 38, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RRi', x: 142, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RRo', x: 164, y: 170, w: 20, h: 38),
    ],
  ),
  'Tri-mixer': DiagramLayout(
    key: 'Tri-mixer',
    viewH: 360,
    bodyKey: TyreDiagramBodyKey.triMixer,
    tyres: <TyreSlot>[
      TyreSlot(id: 'F1L', x: 29, y: 24, w: 22, h: 38),
      TyreSlot(id: 'F1R', x: 149, y: 24, w: 22, h: 38),
      TyreSlot(id: 'F2L', x: 29, y: 76, w: 22, h: 38),
      TyreSlot(id: 'F2R', x: 149, y: 76, w: 22, h: 38),
      TyreSlot(id: 'R1Lo', x: 14, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Li', x: 35, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Ri', x: 146, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Ro', x: 167, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R2Lo', x: 14, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Li', x: 35, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Ri', x: 146, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Ro', x: 167, y: 218, w: 19, h: 35),
    ],
  ),
  'Bus': DiagramLayout(
    key: 'Bus',
    viewH: 330,
    bodyKey: TyreDiagramBodyKey.bus,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 14, y: 38, w: 22, h: 42),
      TyreSlot(id: 'FR', x: 164, y: 38, w: 22, h: 42),
      TyreSlot(id: 'RLo', x: 0, y: 192, w: 20, h: 38),
      TyreSlot(id: 'RLi', x: 22, y: 192, w: 20, h: 38),
      TyreSlot(id: 'RRi', x: 158, y: 192, w: 20, h: 38),
      TyreSlot(id: 'RRo', x: 180, y: 192, w: 20, h: 38),
    ],
  ),
  'Tata': DiagramLayout(
    key: 'Tata',
    viewH: 305,
    bodyKey: TyreDiagramBodyKey.tata,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 31, y: 32, w: 22, h: 40),
      TyreSlot(id: 'FR', x: 147, y: 32, w: 22, h: 40),
      TyreSlot(id: 'RLo', x: 16, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RLi', x: 38, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RRi', x: 142, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RRo', x: 164, y: 178, w: 20, h: 36),
    ],
  ),
  'Ashok Leyland': DiagramLayout(
    key: 'Ashok Leyland',
    viewH: 305,
    bodyKey: TyreDiagramBodyKey.ashokLeyland,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 31, y: 32, w: 22, h: 40),
      TyreSlot(id: 'FR', x: 147, y: 32, w: 22, h: 40),
      TyreSlot(id: 'RLo', x: 16, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RLi', x: 38, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RRi', x: 142, y: 178, w: 20, h: 36),
      TyreSlot(id: 'RRo', x: 164, y: 178, w: 20, h: 36),
    ],
  ),
  // Heavy 6x4 truck (D tanker family, spider/line pump chassis, crane,
  // 8/10-wheeler): 1 steer axle + 2 dual-tyre drive axles = 10 tyres.
  'Truck 6x4': DiagramLayout(
    key: 'Truck 6x4',
    viewH: 310,
    bodyKey: TyreDiagramBodyKey.canter,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 31, y: 36, w: 22, h: 40),
      TyreSlot(id: 'FR', x: 147, y: 36, w: 22, h: 40),
      TyreSlot(id: 'R1Lo', x: 14, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Li', x: 35, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Ri', x: 146, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R1Ro', x: 167, y: 170, w: 19, h: 35),
      TyreSlot(id: 'R2Lo', x: 14, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Li', x: 35, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Ri', x: 146, y: 218, w: 19, h: 35),
      TyreSlot(id: 'R2Ro', x: 167, y: 218, w: 19, h: 35),
    ],
  ),
  // Diesel / water tanker: 1 single-tyre steer axle + 1 dual-tyre drive
  // axle = 6 tyres. A 2-axle rigid, on the same chassis geometry as Canter.
  'Tanker': DiagramLayout(
    key: 'Tanker',
    viewH: 310,
    bodyKey: TyreDiagramBodyKey.canter,
    tyres: <TyreSlot>[
      TyreSlot(id: 'FL', x: 31, y: 36, w: 22, h: 40),
      TyreSlot(id: 'FR', x: 147, y: 36, w: 22, h: 40),
      TyreSlot(id: 'RLo', x: 16, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RLi', x: 38, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RRi', x: 142, y: 170, w: 20, h: 38),
      TyreSlot(id: 'RRo', x: 164, y: 170, w: 20, h: 38),
    ],
  ),
  // Trailer: 2 dual-tyre axles, no steer axle - 8 tyres. A towed unit has
  // no cab, so it reuses the truck body for lack of a trailer artwork; the
  // wheel arrangement is the part that is accurate.
  'Trailer': DiagramLayout(
    key: 'Trailer',
    viewH: 270,
    bodyKey: TyreDiagramBodyKey.canter,
    tyres: <TyreSlot>[
      TyreSlot(id: 'R1Lo', x: 14, y: 96, w: 19, h: 35),
      TyreSlot(id: 'R1Li', x: 35, y: 96, w: 19, h: 35),
      TyreSlot(id: 'R1Ri', x: 146, y: 96, w: 19, h: 35),
      TyreSlot(id: 'R1Ro', x: 167, y: 96, w: 19, h: 35),
      TyreSlot(id: 'R2Lo', x: 14, y: 168, w: 19, h: 35),
      TyreSlot(id: 'R2Li', x: 35, y: 168, w: 19, h: 35),
      TyreSlot(id: 'R2Ri', x: 146, y: 168, w: 19, h: 35),
      TyreSlot(id: 'R2Ro', x: 167, y: 168, w: 19, h: 35),
    ],
  ),
  // Line pump: 2 single-tyre steer axles + 2 dual-tyre drive axles = 12
  // tyres. Rides a shorter chassis than the truck-mounted concrete pump
  // (which has a third steer axle and 14 tyres), but it IS a pump and must
  // read as one, so it keeps the pump body art.
  'Line pump': DiagramLayout(
    key: 'Line pump',
    viewH: 375,
    bodyKey: TyreDiagramBodyKey.concretePump,
    tyres: <TyreSlot>[
      TyreSlot(id: 'F1L', x: 29, y: 40, w: 22, h: 38),
      TyreSlot(id: 'F1R', x: 149, y: 40, w: 22, h: 38),
      TyreSlot(id: 'F2L', x: 29, y: 84, w: 22, h: 38),
      TyreSlot(id: 'F2R', x: 149, y: 84, w: 22, h: 38),
      TyreSlot(id: 'R1Lo', x: 13, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Li', x: 34, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Ri', x: 147, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Ro', x: 168, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R2Lo', x: 13, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Li', x: 34, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Ri', x: 147, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Ro', x: 168, y: 300, w: 19, h: 33),
    ],
  ),
  // MP concrete pump: 3 single-tyre steer axles up front, then 2 dual-tyre
  // drive axles at the rear - 14 tyres total.
  'Concrete pump': DiagramLayout(
    key: 'Concrete pump',
    viewH: 375,
    bodyKey: TyreDiagramBodyKey.concretePump,
    tyres: <TyreSlot>[
      TyreSlot(id: 'F1L', x: 29, y: 40, w: 22, h: 38),
      TyreSlot(id: 'F1R', x: 149, y: 40, w: 22, h: 38),
      TyreSlot(id: 'F2L', x: 29, y: 84, w: 22, h: 38),
      TyreSlot(id: 'F2R', x: 149, y: 84, w: 22, h: 38),
      TyreSlot(id: 'F3L', x: 29, y: 128, w: 22, h: 38),
      TyreSlot(id: 'F3R', x: 149, y: 128, w: 22, h: 38),
      TyreSlot(id: 'R1Lo', x: 13, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Li', x: 34, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Ri', x: 147, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R1Ro', x: 168, y: 258, w: 19, h: 33),
      TyreSlot(id: 'R2Lo', x: 13, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Li', x: 34, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Ri', x: 147, y: 300, w: 19, h: 33),
      TyreSlot(id: 'R2Ro', x: 168, y: 300, w: 19, h: 33),
    ],
  ),
};

/// Case/spacing-insensitive index of the layout keys, built once. Maps
/// `'tr-mixer'`, `'tri mixer'`, `'  Tri-Mixer '` (compacted: lower-cased,
/// whitespace/dash/underscore stripped) to the real `'Tri-mixer'` key.
final Map<String, String> _layoutKeyIndex = <String, String>{
  for (final String key in kTyreDiagramLayouts.keys) _compact(key): key,
};

String _compact(String s) =>
    s.toLowerCase().replaceAll(RegExp(r'[\s\-_]+'), '');

/// Asset-code prefix (first two letters, IMMEDIATELY followed by a digit)
/// to layout key. Mirrors `PREFIX_MAP` in the source exactly - a closed,
/// curated list, never an inference engine (artifact test 37: an
/// unmapped prefix like `IP` is never guessed as "ice plant").
const Map<String, String> _kAssetPrefixLayout = <String, String>{
  'TM': 'Tri-mixer',
  'MP': 'Concrete pump',
  'WL': 'Wheel loader',
  'SL': 'Skid loader',
  'PL': 'Pickup',
};

final RegExp _assetCodePrefixRe = RegExp(r'^([A-Za-z]{2,3})\s*\d');
final RegExp _wheelerRe = RegExp(r'(\d+)wheeler');

/// Resolves ONE string, returning `null` when nothing matched rather than
/// falling back to a default. The `null` is what lets [resolveVehicleType]
/// try the asset number instead of settling for a Pickup (artifact rule R10
/// - "a real type always beats the asset number", via `??` short-circuit).
String? _resolveOne(String? vt) {
  final String raw = (vt ?? '').trim();
  if (raw.isEmpty) return null;

  final String s = raw.toLowerCase();
  final String compact = _compact(raw);

  // R1: exact layout-key match, case/spacing-insensitive.
  final String? exact = _layoutKeyIndex[compact];
  if (exact != null) return exact;

  // R2: asset-code prefix detection, for a caller passing an asset number
  // (TM634) instead of a type. MUST require a digit immediately after the
  // letters: matching on leading letters alone reads "PLACING BOOM" as a
  // PL-prefixed pickup before the keyword rules below ever see "boom".
  final Match? assetCode = _assetCodePrefixRe.firstMatch(raw);
  if (assetCode != null) {
    final String captured = assetCode.group(1)!.toUpperCase();
    final String prefix =
        captured.length > 2 ? captured.substring(0, 2) : captured;
    final String? mapped = _kAssetPrefixLayout[prefix];
    if (mapped != null) return mapped;
  }

  // R3: explicit "N-Wheeler" names run BEFORE the "wheel" keyword below -
  // "wheeler" contains "wheel" and would otherwise fall into the 4-tyre
  // Wheel loader layout.
  final Match? wheeler = _wheelerRe.firstMatch(compact);
  if (wheeler != null) {
    final int n = int.parse(wheeler.group(1)!);
    if (n >= 12) return 'Tri-mixer';
    if (n >= 8) return 'Truck 6x4';
    if (n >= 6) return 'Canter';
    return 'Pickup';
  }

  // Keyword fallback - covers the real fleet's vehicle_type spellings
  // (Tr-Mixer, Wheel_Loader, Line/Spider/Stationary Pump, Placing Boom, ...).
  if (s.contains('tri') || s.contains('mixer') || s.contains('transit')) {
    return 'Tri-mixer';
  }

  // R7 (artifact section 3.1): mobile and web disagree on this guard, and
  // the artifact directs porting the WEB form. Mobile's own line 307 tests
  // "boom"/"placing" FIRST and returns 'Concrete pump', which - for any
  // "placing"-containing string - permanently shadows its own later
  // "stationary" defensive stop and makes the comment above that stop
  // ("any caller that skips the tyreless check can never fall through to
  // the pump branch") false for exactly the case it claims to cover. The
  // web guards `placing` and `stationary` TOGETHER and is checked here
  // BEFORE any pump/boom rule, so it is actually reachable rather than
  // permanently shadowed. See artifact test 22b, section 3.1 and section 8
  // decision 6. A bare "boom" (no "placing", no "pump") still resolves to
  // 'Concrete pump' via the rule immediately below, so no real-fleet
  // spelling loses coverage - "BOOM PUMP" (artifact test 20) resolves to
  // 'Concrete pump' regardless, via that rule or the generic "pump" rule
  // further down.
  if (s.contains('placing') || s.contains('stationary')) return 'Pickup';
  if (s.contains('boom')) return 'Concrete pump';

  // Line pump: its own 12-tyre pump layout, NOT the 10-tyre 6x4 it used to
  // share with the spider pump.
  if (compact.contains('linepump')) return 'Line pump';
  // Spider pump still rides a standard 6x4 truck chassis (10 tyres).
  if (compact.contains('spiderpump') || s.contains('spider')) {
    return 'Truck 6x4';
  }
  if (s.contains('concrete') || s.contains('pump')) return 'Concrete pump';
  if (s.contains('skid')) return 'Skid loader';
  if (s.contains('wheel') || s.contains('loader') || s.contains('load')) {
    return 'Wheel loader';
  }
  if (s.contains('canter')) return 'Canter';
  if (s.contains('bus') || s.contains('coaster')) return 'Bus';
  if (s.contains('tata')) return 'Tata';
  if (s.contains('ashok') || s.contains('leyland')) return 'Ashok Leyland';
  if (s.contains('pickup') || s.contains('pick up') || s.contains('pick-up')) {
    return 'Pickup';
  }
  // Tankers are 2-axle rigids: 6 tyres, not the 10 a generic truck match
  // would give.
  if (s.contains('tanker')) return 'Tanker';
  // A towed trailer: 2 dual axles, 8 tyres, no steer axle.
  if (s.contains('trailer') || compact.contains('trl')) return 'Trailer';
  // Heavy 6x4 chassis family (cranes, generic trucks): 10 tyres.
  if (s.contains('crane') || s.contains('truck')) return 'Truck 6x4';

  // R9: nothing recognised. Report that rather than guessing extra axles.
  return null;
}

/// Maps a vehicle type onto a layout key, optionally using the ASSET NUMBER
/// when the type says nothing useful.
///
/// The fleet register carries junk catch-all types - "HEAVY EQP" covers
/// four wheel loaders, a skid loader and an ice plant - and in those rows
/// the asset number is the only thing that identifies the machine. The type
/// always wins whenever it resolves (R10): a real type is never overridden
/// by a prefix guessed from the asset number.
String resolveVehicleType(String? vehicleType, [String? assetNo]) {
  return _resolveOne(vehicleType) ?? _resolveOne(assetNo) ?? 'Pickup';
}

// Legacy diagram-id -> canonical GCC position code (type-aware).

const Map<String, String> _kLegacyBase = <String, String>{
  'FL': 'LHF1',
  'FR': 'RHF1',
  'RL': 'LHR1',
  'RR': 'RHR1',
  'RLo': 'LHRO',
  'RLi': 'LHRI',
  'RRi': 'RHRI',
  'RRo': 'RHRO',
  'F1L': 'LHF1',
  'F1R': 'RHF1',
  'F2L': 'LHF2',
  'F2R': 'RHF2',
  'F3L': 'LHF3',
  'F3R': 'RHF3',
  'R1Lo': 'LHR1-O',
  'R1Li': 'LHR1-I',
  'R1Ri': 'RHR1-I',
  'R1Ro': 'RHR1-O',
  'R2Lo': 'LHR2-O',
  'R2Li': 'LHR2-I',
  'R2Ri': 'RHR2-I',
  'R2Ro': 'RHR2-O',
  // R3Lo..R3Ri are provision for a future 3-drive-axle layout; no built-in
  // layout uses them today (artifact section 1.3).
  'R3Lo': 'LHR3-O',
  'R3Li': 'LHR3-I',
  'R3Ri': 'RHR3-I',
  'R3Ro': 'RHR3-O',
};

/// Tri-mixer (8x4): the first rear axle is the CENTRE drive axle (C), not
/// the first rear axle - artifact section 2, the sharpest parity trap in
/// this whole engine.
const Map<String, String> _kLegacyTriMixer = <String, String>{
  'R1Lo': 'LHCO',
  'R1Li': 'LHCI',
  'R1Ri': 'RHCI',
  'R1Ro': 'RHCO',
  'R2Lo': 'LHRO',
  'R2Li': 'LHRI',
  'R2Ri': 'RHRI',
  'R2Ro': 'RHRO',
};

/// The V2 canonical GCC position code for slot [id] on [vehicleTypeKey].
///
/// TYPE-AWARE: the override is keyed on whether [vehicleTypeKey] contains
/// `tri` or `mixer` (case-insensitive, substring), matching
/// `'TRANSIT MIXER'` as well as `'Tri-mixer'` itself. An id this function
/// does not recognise passes through UNCHANGED (never invented) - a wheel
/// that cannot be relabelled keeps its own name, because an invented one
/// sends a fitter to the wrong tyre.
String legacyPositionCode(String vehicleTypeKey, String id) {
  if (id.isEmpty) return id;
  final String key = vehicleTypeKey.toLowerCase();
  if (key.contains('tri') || key.contains('mixer')) {
    final String? mixerLabel = _kLegacyTriMixer[id];
    if (mixerLabel != null) return mixerLabel;
  }
  return _kLegacyBase[id] ?? id;
}

// Tyreless (stationary / non-wheeled) equipment.

/// Equipment that carries no tyres at all. Matching here short-circuits
/// BOTH the diagram and [diagramPositions], so an inspector is asked for
/// nothing rather than for wheels the machine does not have.
///
/// A substring match, case-insensitive, on the trimmed vehicle type -
/// mirrors `NO_TYRE_EQUIPMENT` in the source exactly.
const List<String> kNoTyreEquipmentKeywords = <String>[
  'generator',
  'genset',
  'chiller',
  'reclaimer',
  'compressor',
  'tower light',
  'light tower',
  // ANY plant is a fixed installation - bt-plant, ice plant, batching
  // plant, water treatment plant. One word covers every spelling.
  'plant',
  'batch',
  // A placing boom is mast-mounted concrete placing gear, not a vehicle -
  // a different machine from the truck-mounted concrete pump, and must not
  // borrow that pump's 14 tyres.
  'placing boom',
  'placing',
  // A stationary pump is skid-mounted concrete pumping gear with NO
  // wheels.
  'stationary',
  'building',
];

/// Whether [vt] names equipment with no tyres to inspect at all.
bool isTyrelessEquipment(String? vt) {
  if (vt == null || vt.isEmpty) return false;
  final String s = vt.toLowerCase().trim();
  return kNoTyreEquipmentKeywords.any(s.contains);
}

/// Canonical (V1) tyre position ids for [vehicleType], sourced from the
/// SAME layout the diagram renders, so the diagram and the inspection
/// position list can never disagree (invariant 90). Returns `[]` for
/// tyreless equipment.
///
/// Takes the same optional asset number as [resolveVehicleType], so a row
/// whose type is a junk catch-all still lists the right positions.
List<String> diagramPositions(String vehicleType, [String? assetNo]) {
  if (isTyrelessEquipment(vehicleType)) return const <String>[];
  final DiagramLayout layout =
      kTyreDiagramLayouts[resolveVehicleType(vehicleType, assetNo)] ??
          kTyreDiagramLayouts['Pickup']!;
  return <String>[for (final TyreSlot t in layout.tyres) t.id];
}
