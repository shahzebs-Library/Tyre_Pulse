/// The tyre-condition vocabulary and its mapping onto the design system's
/// status colours.
///
/// Ported from `mobile/lib/tyreConditions.ts` (the six-value vocabulary,
/// `normaliseCondition`) and `CONDITION_RISK` in
/// `mobile/components/VehicleTyreDiagram.tsx:65-72`, per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 7.2.
///
/// The production renderer maps each condition onto one of FOUR risk bands
/// (`good`/`warning`/`critical`/`none`) with its own hard-coded hex
/// palette, tuned for that app's fixed dark theme. This app is light-first
/// (`tp_colors.dart`'s own library comment, spec section 53) and already
/// has exactly this four-band shape in [TpStatus] (`ok`/`warning`/
/// `critical`/`unknown`), so [tyreConditionStatus] maps directly onto
/// [TpStatus] rather than re-declaring a parallel four-hue palette that
/// would drift from the one the rest of the app already themes through -
/// the same choice `vehicle_asset.dart`'s `vehicleStatusTone` and
/// `tyre_risk.dart`'s `tyreRiskStatus` already make for their own domain
/// vocabularies. [TpStatus.unknown] is the correct analogue of the
/// production `RISK.none` band: both mean "no reading was ever taken",
/// which is exactly what [TpStatus.unknown]'s own doc comment states.
///
/// `RISK` itself (the hex rim/glow/dark palette) is deliberately NOT
/// ported: the wheel painter (`tyre_wheel_painter.dart`) draws from
/// `TpPalette.forStatus`, so a condition's colour follows this app's real
/// light/dark theme instead of a colour set authored for a different app.
///
/// The one mapping worth reading twice: [TyreCondition.flat] maps to
/// [TpStatus.warning], NOT [TpStatus.critical]. That is the production
/// behaviour (`CONDITION_RISK.Flat = 'warning'`) and it is easy to get
/// backwards by intuition - see artifact section 7.2, "note `Flat` maps to
/// warning, not critical, which is easy to get wrong by intuition".
library;

import 'package:tyre_pulse/app/theme/tp_colors.dart';

/// The six tyre-condition values the fleet register carries, matching the
/// web app's set exactly: `Good / Worn / Damaged / Puncture / Flat /
/// Missing`.
enum TyreCondition { good, worn, damaged, puncture, flat, missing }

/// Maps a raw DB/legacy condition string onto [TyreCondition].
///
/// Case-insensitive; `'wear'` folds onto [TyreCondition.worn] and
/// `'damage'` onto [TyreCondition.damaged] (legacy spellings), matching
/// `normaliseCondition` verbatim. Anything unrecognised - including `null`
/// and an empty string - defaults to [TyreCondition.good], matching the
/// production default exactly (this is the SAME default the capture
/// screens use to pre-seed a wheel before an inspector touches it; see
/// `tyre_completeness.dart`'s own note on why a seeded 'Good' cannot be
/// told apart from a deliberate one by this value alone).
TyreCondition normaliseCondition(String? raw) {
  switch ((raw ?? '').toLowerCase()) {
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
    case 'good':
    default:
      return TyreCondition.good;
  }
}

/// Maps [condition] onto a design-system status. See the library comment
/// for why [TyreCondition.flat] resolves to [TpStatus.warning].
TpStatus tyreConditionStatus(TyreCondition condition) => switch (condition) {
      TyreCondition.good => TpStatus.ok,
      TyreCondition.worn => TpStatus.warning,
      TyreCondition.damaged => TpStatus.critical,
      TyreCondition.puncture => TpStatus.critical,
      TyreCondition.flat => TpStatus.warning,
      TyreCondition.missing => TpStatus.unknown,
    };

/// The condition recorded on a raw `tyre_conditions` entry, or `null` when
/// nothing was ever recorded for this wheel. `entry` is the plain
/// `Map<String, Object?>` shape both [VehicleTyreDiagram] and this app's
/// tyre-completeness engine already read `tyre_conditions` payloads as -
/// never a typed model, so a caller in ANY top-level feature can classify a
/// wheel without depending on another feature's domain layer (see
/// `inspection_approval_review_screen.dart`'s own library comment on why
/// sibling features do not share domain code).
TyreCondition? wheelConditionFor(Map<String, Object?>? entry) {
  if (entry == null) return null;
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
