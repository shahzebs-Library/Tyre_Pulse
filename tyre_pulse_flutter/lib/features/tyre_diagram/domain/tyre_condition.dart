/// The tyre-condition vocabulary and its mapping onto the status colours.
///
/// The rule is the shared tyre map's (`docs/document-specs/tyre-layouts.json`,
/// generated into `tyre_layout_spec.g.dart`), the same rule the web screen
/// and the printed PDF use: Flat / Damaged / Burst / Puncture are critical
/// (red), Worn / Wear a warning (amber), Good is ok (green), and a word no
/// rule knows is "No data" - never Good. (This app once mapped Flat to
/// warning and any unknown word to Good; the owner approved the shared rule
/// in 2026-11, so the phone no longer paints a reported flat tyre amber or
/// an unreadable condition green.)
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_completeness.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';

/// The six tyre-condition values the fleet register carries, matching the
/// web app's set exactly: `Good / Worn / Damaged / Puncture / Flat /
/// Missing`.
enum TyreCondition { good, worn, damaged, puncture, flat, missing }

final Map<String, RegExp> _bandRe = <String, RegExp>{
  for (final MapEntry<String, String> e in kTyreSpecConditionPatterns.entries)
    e.key: RegExp(e.value, caseSensitive: false),
};

/// The band (`good` / `warning` / `critical` / `none`) the shared rule
/// gives [raw]: the exact words first, then the patterns in spec order.
String tyreConditionBand(String? raw) {
  final String s = (raw ?? '').trim();
  if (s.isEmpty) return 'none';
  final String? exact = kTyreSpecConditionExact[s];
  if (exact != null) return exact;
  for (final String band in kTyreSpecConditionOrder) {
    if (_bandRe[band]?.hasMatch(s) ?? false) return band;
  }
  return 'none';
}

/// Maps a raw DB/legacy condition string onto [TyreCondition], or `null`
/// when nothing readable was recorded (empty, or a word the shared rule does
/// not know). `null` draws as "No data", never as Good.
///
/// Case-insensitive; `'wear'` folds onto [TyreCondition.worn] and
/// `'damage'` onto [TyreCondition.damaged]. Other fault words (burst, cut,
/// bulge, separation) are [TyreCondition.damaged].
TyreCondition? normaliseCondition(String? raw) {
  switch ((raw ?? '').trim().toLowerCase()) {
    case 'good':
      return TyreCondition.good;
    case 'worn':
    case 'wear':
      return TyreCondition.worn;
    case 'damaged':
    case 'damage':
      return TyreCondition.damaged;
    case 'puncture':
      return TyreCondition.puncture;
    case 'flat':
      return TyreCondition.flat;
    case 'missing':
      return TyreCondition.missing;
  }
  final String s = (raw ?? '').toLowerCase();
  switch (tyreConditionBand(raw)) {
    case 'good':
      return TyreCondition.good;
    case 'warning':
      return TyreCondition.worn;
    case 'critical':
      if (s.contains('flat')) return TyreCondition.flat;
      if (s.contains('puncture')) return TyreCondition.puncture;
      return TyreCondition.damaged;
    default:
      return null;
  }
}

/// Maps [condition] onto a design-system status; `null` (nothing readable
/// recorded) is [TpStatus.unknown], the "No data" band.
TpStatus tyreConditionStatus(TyreCondition? condition) => switch (condition) {
      TyreCondition.good => TpStatus.ok,
      TyreCondition.worn => TpStatus.warning,
      TyreCondition.damaged => TpStatus.critical,
      TyreCondition.puncture => TpStatus.critical,
      TyreCondition.flat => TpStatus.critical,
      TyreCondition.missing => TpStatus.unknown,
      null => TpStatus.unknown,
    };

/// The condition recorded on a raw `tyre_conditions` entry, or `null` when
/// nothing was ever recorded for this wheel. A capture form seeds every slot
/// with `condition: Good, checked: false`; that seed is not an inspection
/// result and must remain visually/accessibly "not measured" until the entry
/// contains evidence or the inspector explicitly checks it.
///
/// `entry` is the plain
/// `Map<String, Object?>` shape both [VehicleTyreDiagram] and this app's
/// tyre-completeness engine already read `tyre_conditions` payloads as -
/// never a typed model, so a caller in ANY top-level feature can classify a
/// wheel without depending on another feature's domain layer (see
/// `inspection_approval_review_screen.dart`'s own library comment on why
/// sibling features do not share domain code).
TyreCondition? wheelConditionFor(Map<String, Object?>? entry) {
  if (entry == null) return null;
  if (classifyEntry(entry).state == TyreSlotState.blank) return null;
  return normaliseCondition(entry['condition']?.toString());
}

/// The status band ONE wheel currently draws at, from its raw entry (or
/// `null` when nothing was recorded - see [wheelConditionFor]).
///
/// This is the SINGLE place that decision is made: [VehicleTyreDiagram]'s
/// own wheel resolution and `tyre_diagram_stats.dart`'s summary counts both
/// call this, so a stat tile and the diagram it sits above can never
/// disagree about how many wheels are OK, need monitoring or are critical.
TpStatus wheelStatusFor(Map<String, Object?>? entry) {
  final TyreCondition? condition = wheelConditionFor(entry);
  return condition == null ? TpStatus.unknown : tyreConditionStatus(condition);
}
