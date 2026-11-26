/// The tyre diagram resolver: the production layouts, the vehicle-type
/// resolver that picks one, the tyreless-equipment gate, and the type-aware
/// slot-to-position-code relabeller.
///
/// Every list here comes from the shared tyre map,
/// `docs/document-specs/tyre-layouts.json`, through the generated
/// `tyre_layout_spec.g.dart`. The web app (screen and PDF) reads the same
/// file, so a machine has one wheel layout, one set of position names and
/// one colour rule on every surface. This file holds the rule INTERPRETER
/// only, never a list of its own: change the JSON and regenerate
/// (`node scripts/gen-tyre-layout-spec.mjs`), and
/// `tyre_layout_spec_parity_test.dart` keeps the two in step.
library;

import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/vehicle_axle_registry.dart';

const Map<String, TyreDiagramBodyKey> _kBodyKeys = <String, TyreDiagramBodyKey>{
  'pickup': TyreDiagramBodyKey.pickup,
  'canter': TyreDiagramBodyKey.canter,
  'triMixer': TyreDiagramBodyKey.triMixer,
  'linePump': TyreDiagramBodyKey.linePump,
  'concretePump': TyreDiagramBodyKey.concretePump,
  'wheelLoader': TyreDiagramBodyKey.wheelLoader,
  'skidLoader': TyreDiagramBodyKey.skidLoader,
  'bus': TyreDiagramBodyKey.bus,
  'tata': TyreDiagramBodyKey.tata,
  'ashokLeyland': TyreDiagramBodyKey.ashokLeyland,
};

/// Every production layout, keyed by layout key, in the spec's order.
/// Declaration order is render order: `y` is non-decreasing within every
/// layout (invariant 89).
final Map<String, DiagramLayout> kTyreDiagramLayouts =
    Map<String, DiagramLayout>.unmodifiable(<String, DiagramLayout>{
  for (final (
    String,
    double,
    String,
    List<(String, double, double, double, double)>
  ) l in kTyreSpecLayouts)
    l.$1: DiagramLayout(
      key: l.$1,
      viewH: l.$2,
      bodyKey: _kBodyKeys[l.$3] ?? TyreDiagramBodyKey.canter,
      tyres: List<TyreSlot>.unmodifiable(<TyreSlot>[
        for (final (String, double, double, double, double) t in l.$4)
          TyreSlot(id: t.$1, x: t.$2, y: t.$3, w: t.$4, h: t.$5),
      ]),
    ),
});

/// Case/spacing-insensitive index of the layout keys, built once. Maps
/// `'tr-mixer'`, `'tri mixer'`, `'  Tri-Mixer '` (compacted: lower-cased,
/// whitespace/dash/underscore stripped) to the real `'Tri-mixer'` key.
final Map<String, String> _layoutKeyIndex = <String, String>{
  for (final String key in kTyreDiagramLayouts.keys) _compact(key): key,
};

String _compact(String s) =>
    s.toLowerCase().replaceAll(RegExp(r'[\s\-_]+'), '');

// Hyphenated codes are real production values (for example BH-037 and
// PL-090). Requiring the following digit still prevents prose such as
// "PLACING BOOM" from being mistaken for the PL asset class.
final RegExp _assetCodePrefixRe = RegExp(kTyreSpecAssetPrefixPattern);
final RegExp _wheelerRe = RegExp(r'(\d+)wheeler');

bool _hits(List<String> words, List<String> compactWords, String s, String c) =>
    words.any(s.contains) || compactWords.any(c.contains);

/// The layout an asset number's class prefix names (TM634, PL-090), or
/// `null` for a prefix the spec does not list (an unmapped `IP` is never
/// guessed as "ice plant").
String? layoutForAssetPrefix(String? raw) {
  final Match? m = _assetCodePrefixRe.firstMatch((raw ?? '').trim());
  if (m == null) return null;
  final String captured = m.group(1)!.toUpperCase();
  final String prefix =
      captured.length > 2 ? captured.substring(0, 2) : captured;
  return kTyreSpecAssetPrefixMap[prefix];
}

/// Resolves ONE string, returning `null` when nothing matched rather than
/// falling back to a default. The order is the spec's: exact key, asset
/// prefix, N-wheeler, identified pickup models, then the keyword rules top
/// to bottom. The `null` is what lets [resolveVehicleType] try the asset
/// number instead of settling for a Pickup.
String? _resolveOne(String? vt) {
  final String raw = (vt ?? '').trim();
  if (raw.isEmpty) return null;
  final String s = raw.toLowerCase();
  final String c = _compact(raw);

  final String? exact = _layoutKeyIndex[c];
  if (exact != null) return exact;

  final String? byPrefix = layoutForAssetPrefix(raw);
  if (byPrefix != null) return byPrefix;

  // "wheeler" contains "wheel" and would otherwise fall into the 4-tyre
  // Wheel loader layout, so the N-wheeler rule runs first.
  final Match? wheeler = _wheelerRe.firstMatch(c);
  if (wheeler != null) {
    final int n = int.parse(wheeler.group(1)!);
    for (final (int, String) w in kTyreSpecWheeler) {
      if (n >= w.$1) return w.$2;
    }
  }

  // Triton is not a transit mixer and Xenon is not a dual-rear Tata truck.
  if (_hits(kTyreSpecPickupWords, kTyreSpecPickupCompact, s, c)) {
    return 'Pickup';
  }
  for (final (String, List<String>, List<String>) rule
      in kTyreSpecKeywordRules) {
    if (_hits(rule.$2, rule.$3, s, c)) return rule.$1;
  }
  return null;
}

/// Maps a vehicle type onto a layout key, optionally using the ASSET NUMBER
/// when the type says nothing useful.
///
/// The fleet register carries junk catch-all types - "HEAVY EQP" covers
/// four wheel loaders, a skid loader and an ice plant - and in those rows
/// the asset number is the only thing that identifies the machine. The type
/// always wins whenever it resolves: a real type is never overridden by a
/// prefix guessed from the asset number.
String resolveVehicleType(String? vehicleType, [String? assetNo]) {
  final String key = _resolveOne(vehicleType) ??
      _resolveOne(assetNo) ??
      kTyreSpecFallbackLayout;
  // A type with more than one build (4- vs 5-axle concrete pumps) draws the
  // one this machine actually is, when the fleet register says so.
  return layoutForAsset(key, assetNo);
}

/// The same resolution without the Pickup fallback: `null` when neither
/// the type nor the asset number identifies a machine.
String? resolveVehicleTypeStrict(String? vehicleType, [String? assetNo]) =>
    _resolveOne(vehicleType) ?? _resolveOne(assetNo);

/// Field-based fleet resolution. Only identified pickup models override an
/// imported type; a make alone cannot prove a body or axle configuration.
String resolveVehicleTypeFor({
  String? vehicleType,
  String? assetNo,
  String? make,
  String? model,
}) {
  final String identity = <String?>[make, model].whereType<String>().join(' ');
  if (_hits(
    kTyreSpecPickupWords,
    kTyreSpecPickupCompact,
    identity.toLowerCase(),
    _compact(identity),
  )) {
    return 'Pickup';
  }
  return resolveVehicleType(vehicleType, assetNo);
}

/// The canonical GCC position code shown for slot [id] on [vehicleTypeKey].
///
/// TYPE-AWARE: an override applies when the lower-cased key contains one of
/// its `match` words (`'TRANSIT MIXER'` matches the mixer override as well
/// as `'Tri-mixer'` itself; `'Concrete pump'` gets the codes its records
/// carry - LHR1-I, LHRCO, LHRRO). [erpScope] leaves out the display-only
/// overrides, mirroring the web ERP position service. An id the spec does
/// not list passes through UNCHANGED (never invented): an invented name
/// sends a fitter to the wrong tyre.
String legacyPositionCode(
  String vehicleTypeKey,
  String id, {
  bool erpScope = false,
}) {
  if (id.isEmpty) return id;
  // A raw fleet type (PUMPS, TRANSIT MIXER) resolves to its layout first.
  final String key = (kTyreDiagramLayouts.containsKey(vehicleTypeKey)
          ? vehicleTypeKey
          : (_resolveOne(vehicleTypeKey) ?? vehicleTypeKey))
      .toLowerCase();
  for (final (List<String>, String, Map<String, String>) o
      in kTyreSpecCodeOverrides) {
    if (erpScope && o.$2 == 'display') continue;
    final String? code = o.$3[id];
    if (code != null && o.$1.any(key.contains)) return code;
  }
  return kTyreSpecCodesBase[id] ?? id;
}

String _norm(String s) =>
    s.trim().toUpperCase().replaceAll(RegExp(r'[\s\-_]+'), '');

/// Which wheel of a built-in layout a STORED position names: the slot id
/// itself, the code shown for it, or a spelling the spec confirms for that
/// wheel (the concrete pump's LHCO / LHR1-O family). `null` when none does,
/// so the caller lights nothing rather than guessing.
String? slotForStoredPosition(String layoutKey, String? token) {
  final DiagramLayout? layout = kTyreDiagramLayouts[layoutKey];
  final String u = _norm(token ?? '');
  if (layout == null || u.isEmpty) return null;
  for (final TyreSlot t in layout.tyres) {
    if (t.id.toUpperCase() == u) return t.id;
  }
  for (final TyreSlot t in layout.tyres) {
    if (_norm(legacyPositionCode(layoutKey, t.id)) == u) return t.id;
  }
  final Map<String, List<String>> aliases =
      kTyreSpecAliases[layoutKey] ?? const <String, List<String>>{};
  for (final TyreSlot t in layout.tyres) {
    if ((aliases[t.id] ?? const <String>[]).any((String a) => _norm(a) == u)) {
      return t.id;
    }
  }
  return null;
}

/// Equipment that carries no tyres at all. Matching here short-circuits
/// BOTH the diagram and [diagramPositions], so an inspector is asked for
/// nothing rather than for wheels the machine does not have.
const List<String> kNoTyreEquipmentKeywords = kTyreSpecTyreless;

/// Whether [vt] names equipment with no tyres to inspect at all.
bool isTyrelessEquipment(String? vt) {
  if (vt == null || vt.isEmpty) return false;
  final String s = vt.toLowerCase().trim();
  return kNoTyreEquipmentKeywords.any(s.contains);
}

/// Canonical tyre position ids for [vehicleType], sourced from the SAME
/// layout the diagram renders, so the diagram and the inspection position
/// list can never disagree (invariant 90). Returns `[]` for tyreless
/// equipment.
List<String> diagramPositions(String vehicleType, [String? assetNo]) {
  if (isTyrelessEquipment(vehicleType)) return const <String>[];
  final DiagramLayout layout =
      kTyreDiagramLayouts[resolveVehicleType(vehicleType, assetNo)] ??
          kTyreDiagramLayouts[kTyreSpecFallbackLayout]!;
  return <String>[for (final TyreSlot t in layout.tyres) t.id];
}
