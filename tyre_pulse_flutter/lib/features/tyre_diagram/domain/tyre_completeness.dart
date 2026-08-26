/// "Are all this machine's wheels actually filled in?"
///
/// Ported rule-for-rule from `mobile/lib/tyreCompleteness.ts`, per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 5 group
/// H. That file's own header explains the design better than a summary
/// could, so its reasoning is repeated here rather than paraphrased:
///
/// `condition` is present on effectively every entry, so it looks like the
/// obvious "was this wheel touched" test. It is not: BOTH capture forms
/// pre-seed every position with `condition: 'Good'` before an inspector
/// touches anything, so a seeded 'Good' and a deliberate one are byte
/// identical. `pressure_psi` is real signal but not universal (recorded on
/// ~84% of entries in the production data), so it must not be the only
/// thing that counts as filled, and it must not block by default.
/// `tread_depth_mm` and `serial_number` are recorded on effectively none of
/// the production data - requiring either would make a real inspection
/// unsubmittable, so neither is ever required and neither is ever reported
/// as a gap.
///
/// A wheel counts as filled when the inspector left EVIDENCE on it: a
/// pressure, a tread depth, a serial, a note, a photo, or a condition they
/// had to choose deliberately (anything other than the seeded 'Good') - or
/// an explicit `checked: true` marker for an inspector who genuinely
/// checked a wheel, found it fine, and had no gauge. That marker is the
/// escape hatch the pressure-based signal alone cannot provide.
///
/// HONESTY RULES BAKED IN, each pinned by a group-H test case:
///  - Tyreless equipment reports "not applicable", never "0 of 0 done"
///    (test 78).
///  - A vehicle type whose layout is not recognised reports `known: false`
///    and blocks NOTHING - [resolveVehicleType] falls back to a 4-wheel
///    Pickup for anything it cannot place, and blocking a real inspection
///    against a guessed wheel count would be worse than the gap this
///    module exists to close (test 77, 79).
///  - A recorded position the layout has no slot for (a spare, a foreign
///    vocabulary) is reported as `extra` and can never block. No
///    production layout has a spare slot at all, so a spare is never
///    "missing" either (test 80).
///  - If readings exist but NONE line up with this machine's wheels, that
///    is reported (`matched: false`) and blocks nothing, rather than
///    declaring every wheel missing on the strength of a vocabulary this
///    module failed to read (test 81).
///
/// # A deliberate departure from this codebase's "no English in domain
/// # code" convention, and why
///
/// [TyreCompletenessResult.summary] and [TyreSlotStatus.reason] carry
/// hard-coded English sentences, unlike every other domain file in this
/// port (`vehicle_asset.dart`'s own library comment states the house rule:
/// a domain decoder has no `BuildContext` to translate with, so an English
/// fallback baked in there is a string with no way to become Arabic or
/// Urdu). That rule is right in general, and it is deliberately NOT applied
/// here for one narrow reason: artifact test cases 74 and 78 pin these
/// EXACT English strings as the parity contract itself (`'2 of 12 tyres
/// still need details.'`, `'No tyres to inspect on this equipment.'`), and
/// this Flutter port's hard gate is behavioural fidelity to that contract.
/// [TyreDiagramWidget] - the one screen surface this phase actually builds
/// - does not render [TyreCompletenessResult.summary] at all (it renders
/// its OWN localised pending banner, built from the structured
/// `pending`/`expected` fields). Should a future screen (Phase 5's
/// inspection submit flow, most likely) ever want to show this summary to
/// a user, that is the moment to add a presentation-layer localisation of
/// it - this file's structured fields ([applicable], [known], [matched],
/// [expected], [pending]) already carry everything needed to build one
/// without re-deriving the underlying logic.
library;

import 'dart:convert';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

/// One wheel slot's completeness state.
enum TyreSlotState {
  /// No entry recorded for this slot at all.
  missing,

  /// An entry exists but carries no evidence - indistinguishable from the
  /// pre-seeded default.
  blank,

  /// An entry carries evidence but no pressure reading.
  incomplete,

  /// An entry carries evidence AND a pressure reading.
  complete,
}

/// #mirror: PENDING_STATES. Every state other than [TyreSlotState.complete].
const List<TyreSlotState> kPendingStates = <TyreSlotState>[
  TyreSlotState.missing,
  TyreSlotState.blank,
  TyreSlotState.incomplete,
];

/// #mirror: BLOCKING_DEFAULTS. Which states block submission by default,
/// before [TyreCompletenessOptions] is applied. Only a truly MISSING wheel
/// blocks out of the box; `blank`/`incomplete` are reported but do not stop
/// work unless the caller opts in.
const Map<TyreSlotState, bool> kBlockingDefaults = <TyreSlotState, bool>{
  TyreSlotState.missing: true,
  TyreSlotState.blank: false,
  TyreSlotState.incomplete: false,
};

/// #mirror: SEEDED_CONDITION. The value both capture forms pre-seed every
/// wheel with before an inspector touches anything.
const String kSeededCondition = 'good';

const List<String> _kPressureFields = <String>[
  'pressure_psi',
  'pressure',
  'psi',
];
const List<String> _kTreadFields = <String>[
  'tread_depth_mm',
  'tread_depth',
  'treadDepth',
  'tread',
];
const List<String> _kSerialFields = <String>[
  'serial_number',
  'serial_no',
  'serial',
];
const List<String> _kNotesFields = <String>['notes', 'note'];
const List<String> _kPhotoFields = <String>['photo_url', 'photo_uri', 'photo'];

/// #mirror: REASONS. English-only - see the library comment.
const Map<TyreSlotState, String> kPendingReasons = <TyreSlotState, String>{
  TyreSlotState.missing: 'Not recorded at all',
  TyreSlotState.blank: 'No details recorded',
  TyreSlotState.incomplete: 'Pressure not recorded',
};

/// Position-key comparison form: upper-cased with every non-alphanumeric
/// character stripped, so `'LHR1-O'` and `'LHR1O'` compare equal. Exported
/// so the presentation layer's pending-key resolution reuses the SAME
/// normalisation this file uses internally, rather than a second, possibly
/// drifting copy.
String keyOf(Object? v) {
  if (v == null) return '';
  return v.toString().toUpperCase().replaceAll(RegExp('[^A-Z0-9]'), '');
}

/// Text is present when the value is a finite number, or a string that is
/// non-empty once trimmed. `0` is a real reading; `''` is not - compare
/// against `null`, never truthiness, or a pressure of `0` on a flat tyre
/// is silently discarded (artifact test 71, section 7.2's own warning).
bool _hasText(Object? v) {
  if (v == null) return false;
  if (v is num) return v.isFinite;
  return v.toString().trim().isNotEmpty;
}

Object? _pick(Map<String, Object?>? entry, List<String> names) {
  if (entry == null) return null;
  for (final String name in names) {
    if (entry.containsKey(name) && _hasText(entry[name])) return entry[name];
  }
  return null;
}

/// One raw recorded entry, with its position key exactly as it was stored.
@immutable
class TyreEntryPair {
  const TyreEntryPair({required this.key, required this.entry});

  final String key;
  final Map<String, Object?> entry;
}

/// Reads a raw `tyre_conditions` payload in every shape the app has ever
/// written it: a `Map` keyed by position, a `List` of per-position maps
/// (using each item's own `position` field when present, else its list
/// index), a JSON-encoded `String` of either, and a value that is a bare
/// condition string rather than a map. Never throws - a payload this
/// cannot make sense of decodes to an empty list rather than an error.
List<TyreEntryPair> readTyreEntries(Object? source) {
  Object? tc = source;
  if (source is Map<String, Object?> && source.containsKey('tyre_conditions')) {
    tc = source['tyre_conditions'];
  }
  if (tc is String) {
    try {
      tc = jsonDecode(tc);
    } on FormatException {
      return const <TyreEntryPair>[];
    }
  }
  if (tc == null) return const <TyreEntryPair>[];
  final bool isMap = tc is Map<String, Object?>;
  final bool isList = tc is List<Object?>;
  if (!isMap && !isList) return const <TyreEntryPair>[];

  final List<MapEntry<String, Object?>> pairs = <MapEntry<String, Object?>>[];
  if (isList) {
    final List<Object?> items = tc;
    for (int i = 0; i < items.length; i++) {
      final Object? d = items[i];
      final bool named = d is Map<String, Object?> && _hasText(d['position']);
      final String key = named ? d['position'].toString() : i.toString();
      pairs.add(MapEntry<String, Object?>(key, d));
    }
  } else {
    (tc as Map<String, Object?>).forEach((String k, Object? v) {
      pairs.add(MapEntry<String, Object?>(k, v));
    });
  }

  final List<TyreEntryPair> out = <TyreEntryPair>[];
  for (final MapEntry<String, Object?> pair in pairs) {
    final Object? value = pair.value;
    final Map<String, Object?> entry = value is Map<String, Object?>
        ? value
        : <String, Object?>{'condition': value?.toString()};
    out.add(TyreEntryPair(key: pair.key, entry: entry));
  }
  return out;
}

/// The result of classifying one recorded entry.
@immutable
class EntryClassification {
  const EntryClassification({
    required this.state,
    required this.pressure,
    required this.condition,
  });

  final TyreSlotState state;
  final Object? pressure;
  final String? condition;
}

/// Classifies ONE recorded entry. The rule ORDER is the contract:
///
/// 1. Any evidence field filled -> at least [TyreSlotState.incomplete].
/// 2. A deliberately-chosen condition (anything other than the seeded
///    `'Good'`) also counts as evidence.
/// 3. Otherwise -> [TyreSlotState.blank], indistinguishable from the seed.
///
/// A slot with evidence is [TyreSlotState.complete] only once a pressure
/// reading is ALSO present (compared against `null`, never truthiness -
/// see [_hasText]).
EntryClassification classifyEntry(Map<String, Object?>? entry) {
  final Object? pressure = _pick(entry, _kPressureFields);
  final Object? tread = _pick(entry, _kTreadFields);
  final Object? serial = _pick(entry, _kSerialFields);
  final Object? notes = _pick(entry, _kNotesFields);
  final Object? photo = _pick(entry, _kPhotoFields);
  // A wheel the inspector deliberately opened and edited counts as attended
  // to, even left Good with no reading - the escape hatch for someone who
  // checked the tyre and has no gauge. Only an explicit `true` counts; the
  // seed writes `false`.
  final bool checked = entry != null && entry['checked'] == true;
  final String conditionRaw = (entry != null && _hasText(entry['condition']))
      ? entry['condition'].toString().trim()
      : '';
  final bool deliberateCondition =
      conditionRaw.isNotEmpty && keyOf(conditionRaw) != keyOf(kSeededCondition);

  final bool evidence = pressure != null ||
      tread != null ||
      serial != null ||
      notes != null ||
      photo != null ||
      deliberateCondition ||
      checked;

  final String? condition = conditionRaw.isEmpty ? null : conditionRaw;
  if (!evidence) {
    return EntryClassification(
      state: TyreSlotState.blank,
      pressure: null,
      condition: condition,
    );
  }
  if (pressure == null) {
    return EntryClassification(
      state: TyreSlotState.incomplete,
      pressure: null,
      condition: condition,
    );
  }
  return EntryClassification(
    state: TyreSlotState.complete,
    pressure: pressure,
    condition: condition,
  );
}

/// Do we actually know this machine's wheel arrangement?
///
/// [resolveVehicleType] never returns null - an unrecognised type silently
/// becomes a 4-wheel Pickup. That fallback is right for DRAWING something,
/// and completely wrong for telling somebody a wheel is missing, so it is
/// detected here.
bool layoutIsKnown(String? vehicleType, String? assetNo) {
  final String vt = (vehicleType ?? '').trim();
  final String an = (assetNo ?? '').trim();
  if (vt.isEmpty && an.isEmpty) return false;
  if (resolveVehicleType(vt, an) != 'Pickup') return true;
  // Pickup is also a real answer, but only when something actually said so.
  return RegExp(r'pickup|pick[\s-]?up', caseSensitive: false).hasMatch(vt) ||
      RegExp(r'^PL\s*\d', caseSensitive: false).hasMatch(vt) ||
      RegExp(r'^PL\s*\d', caseSensitive: false).hasMatch(an);
}

/// One wheel slot's completeness state, positioned by both vocabularies.
@immutable
class TyreSlotStatus {
  const TyreSlotStatus({
    required this.slot,
    required this.code,
    required this.state,
    required this.reason,
    required this.blocking,
  });

  /// The V1 diagram-slot id.
  final String slot;

  /// The V2 canonical GCC code - the name a fitter says out loud.
  final String code;

  final TyreSlotState state;

  /// English-only. See the library comment.
  final String? reason;

  final bool blocking;
}

/// Everything needed to decide whether an inspection can be submitted, and
/// to tell a person exactly which wheel is holding it up.
@immutable
class TyreCompletenessResult {
  const TyreCompletenessResult({
    required this.applicable,
    required this.known,
    required this.matched,
    required this.layoutKey,
    required this.expected,
    required this.recorded,
    required this.complete,
    required this.slots,
    required this.pending,
    required this.missing,
    required this.blank,
    required this.incomplete,
    required this.blocked,
    required this.extra,
    required this.blocking,
    required this.ok,
    required this.summary,
  });

  /// `false` only for tyreless equipment - there is nothing to fill in.
  final bool applicable;

  /// Whether the vehicle's wheel arrangement was recognised at all. See
  /// [layoutIsKnown].
  final bool known;

  /// Whether any recorded entry could be placed onto a real wheel. `true`
  /// vacuously when there were no entries to place.
  final bool matched;

  final String? layoutKey;

  /// `null` when the layout is not known - there is no honest count.
  final int? expected;

  /// Slots with at least an entry, whatever its state.
  final int recorded;

  final int complete;

  final List<TyreSlotStatus> slots;
  final List<TyreSlotStatus> pending;
  final List<TyreSlotStatus> missing;
  final List<TyreSlotStatus> blank;
  final List<TyreSlotStatus> incomplete;

  /// The subset of [pending] that actually blocks submission.
  final List<TyreSlotStatus> blocked;

  /// Recorded keys that named no wheel this layout has.
  final List<String> extra;

  final Map<TyreSlotState, bool> blocking;

  /// `true` when nothing in [blocked] is non-empty.
  final bool ok;

  /// English-only. See the library comment.
  final String summary;
}

/// Options that widen which pending states actually block submission.
/// Neither defaults to blocking (see [kBlockingDefaults]).
@immutable
class TyreCompletenessOptions {
  const TyreCompletenessOptions({
    this.requireEvidence = false,
    this.requirePressure = false,
  });

  /// Also block on [TyreSlotState.blank]. Measured against real production
  /// data before this default was chosen: 711 of 4,782 entries (14.9%)
  /// carry no evidence at all, spread across 97 of 401 inspections -
  /// blocking on this by default would refuse one inspection in four that
  /// submits today. That is an operational policy change, not a bug fix,
  /// so it stays opt-in.
  final bool requireEvidence;

  /// Also block on [TyreSlotState.incomplete] (evidence present, no
  /// pressure).
  final bool requirePressure;
}

/// Assesses whether every wheel [vehicleType] should carry has been filled
/// in, from [tyreConditions] (accepted in any shape [readTyreEntries]
/// tolerates).
///
/// [assetNo] is used only when [vehicleType] identifies nothing.
TyreCompletenessResult tyreCompleteness(
  String? vehicleType,
  String? assetNo,
  Object? tyreConditions, [
  TyreCompletenessOptions opts = const TyreCompletenessOptions(),
]) {
  final Map<TyreSlotState, bool> blocking = <TyreSlotState, bool>{
    TyreSlotState.missing: kBlockingDefaults[TyreSlotState.missing]!,
    TyreSlotState.blank: opts.requireEvidence,
    TyreSlotState.incomplete: opts.requirePressure,
  };

  final List<TyreEntryPair> entries = readTyreEntries(tyreConditions);

  // Tyreless equipment: nothing is outstanding because there is nothing to
  // fill.
  if (isTyrelessEquipment(vehicleType)) {
    return _buildResult(
      applicable: false,
      known: true,
      matched: true,
      layoutKey: null,
      expected: 0,
      slots: const <TyreSlotStatus>[],
      extra: <String>[for (final TyreEntryPair e in entries) e.key],
      blocking: blocking,
      summary: 'No tyres to inspect on this equipment.',
    );
  }

  final bool known = layoutIsKnown(vehicleType, assetNo);
  final String layoutKey = resolveVehicleType(vehicleType, assetNo);
  final List<String> slotIds =
      known ? diagramPositions(vehicleType ?? '', assetNo) : const <String>[];

  if (!known) {
    return _buildResult(
      applicable: true,
      known: false,
      matched: false,
      layoutKey: null,
      expected: null,
      slots: const <TyreSlotStatus>[],
      extra: <String>[for (final TyreEntryPair e in entries) e.key],
      blocking: blocking,
      summary: 'Wheel layout not known for this machine, so tyre details '
          'were not checked.',
    );
  }

  // slot -> every name a recorded key might use for it: the slot id itself
  // and the canonical GCC code the diagram labels it with.
  final Map<String, String> aliasToSlot = <String, String>{};
  final Map<String, String> codeOf = <String, String>{};
  for (final String slot in slotIds) {
    final String code = legacyPositionCode(layoutKey, slot);
    codeOf[slot] = code;
    aliasToSlot[keyOf(slot)] = slot;
    if (code.isNotEmpty) aliasToSlot[keyOf(code)] = slot;
  }

  final Map<String, Map<String, Object?>> bySlot =
      <String, Map<String, Object?>>{};
  final List<String> extra = <String>[];
  for (final TyreEntryPair pair in entries) {
    final String? slot = aliasToSlot[keyOf(pair.key)];
    if (slot == null) {
      extra.add(pair.key);
      continue;
    }
    // First reading for a slot wins; a duplicate key cannot un-record it.
    bySlot.putIfAbsent(slot, () => pair.entry);
  }

  // Readings exist but not one of them names a wheel this machine has. We
  // have failed to read the vocabulary, not proved the wheels are empty.
  final bool matched = entries.isEmpty || bySlot.isNotEmpty;
  if (!matched) {
    return _buildResult(
      applicable: true,
      known: true,
      matched: false,
      layoutKey: layoutKey,
      expected: slotIds.length,
      slots: const <TyreSlotStatus>[],
      extra: extra,
      blocking: blocking,
      summary: 'Recorded tyre readings could not be matched to this machine, '
          'so they were not checked.',
    );
  }

  final List<TyreSlotStatus> slots = <TyreSlotStatus>[
    for (final String slot in slotIds)
      _statusFor(slot, codeOf[slot] ?? slot, bySlot[slot], blocking),
  ];

  return _buildResult(
    applicable: true,
    known: true,
    matched: true,
    layoutKey: layoutKey,
    expected: slotIds.length,
    slots: slots,
    extra: extra,
    blocking: blocking,
    summary: null,
  );
}

TyreSlotStatus _statusFor(
  String slot,
  String code,
  Map<String, Object?>? entry,
  Map<TyreSlotState, bool> blocking,
) {
  final EntryClassification c = entry == null
      ? const EntryClassification(
          state: TyreSlotState.missing,
          pressure: null,
          condition: null,
        )
      : classifyEntry(entry);
  return TyreSlotStatus(
    slot: slot,
    code: code,
    state: c.state,
    reason: c.state == TyreSlotState.complete ? null : kPendingReasons[c.state],
    blocking: c.state != TyreSlotState.complete && (blocking[c.state] ?? false),
  );
}

/// Assembles the public result shape once, so every early return above
/// carries the same fields.
TyreCompletenessResult _buildResult({
  required bool applicable,
  required bool known,
  required bool matched,
  required String? layoutKey,
  required int? expected,
  required List<TyreSlotStatus> slots,
  required List<String> extra,
  required Map<TyreSlotState, bool> blocking,
  required String? summary,
}) {
  final Map<TyreSlotState, List<TyreSlotStatus>> byState =
      <TyreSlotState, List<TyreSlotStatus>>{
    for (final TyreSlotState state in TyreSlotState.values)
      state: <TyreSlotStatus>[
        for (final TyreSlotStatus s in slots)
          if (s.state == state) s,
      ],
  };
  final List<TyreSlotStatus> pending = <TyreSlotStatus>[
    for (final TyreSlotStatus s in slots)
      if (s.state != TyreSlotState.complete) s,
  ];
  final List<TyreSlotStatus> blocked = <TyreSlotStatus>[
    for (final TyreSlotStatus s in pending)
      if (s.blocking) s,
  ];
  final int recorded = slots.length - byState[TyreSlotState.missing]!.length;

  String text = summary ?? '';
  if (summary == null) {
    if (pending.isEmpty) {
      text = expected == 1
          ? 'The 1 tyre has details recorded.'
          : 'All $expected tyres have details recorded.';
    } else {
      text = '${pending.length} of $expected tyres still need details.';
    }
  }

  return TyreCompletenessResult(
    applicable: applicable,
    known: known,
    matched: matched,
    layoutKey: layoutKey,
    expected: expected,
    recorded: recorded,
    complete: byState[TyreSlotState.complete]!.length,
    slots: slots,
    pending: pending,
    missing: byState[TyreSlotState.missing]!,
    blank: byState[TyreSlotState.blank]!,
    incomplete: byState[TyreSlotState.incomplete]!,
    blocked: blocked,
    extra: extra,
    blocking: blocking,
    ok: blocked.isEmpty,
    summary: text,
  );
}

/// Position codes still needing attention, in wheel order.
List<String> pendingCodes(TyreCompletenessResult? res) {
  if (res == null) return const <String>[];
  return <String>[for (final TyreSlotStatus p in res.pending) p.code];
}

/// Per-slot state, keyed by BOTH the slot id and its canonical code, so a
/// caller can look up with whichever vocabulary it holds.
Map<String, TyreSlotState> slotStateMap(TyreCompletenessResult? res) {
  final Map<String, TyreSlotState> out = <String, TyreSlotState>{};
  if (res == null) return out;
  for (final TyreSlotStatus s in res.slots) {
    out[s.slot] = s.state;
    if (s.code.isNotEmpty) out[s.code] = s.state;
  }
  return out;
}

/// Whether [position] (a slot id or a canonical code) still needs details.
bool isPendingPosition(TyreCompletenessResult? res, String position) {
  final TyreSlotState? state = slotStateMap(res)[position];
  return state != null && state != TyreSlotState.complete;
}
