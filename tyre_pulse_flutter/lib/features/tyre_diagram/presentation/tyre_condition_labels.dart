/// Localised text for the diagram: condition legend labels, and the wheel
/// accessibility label the RN renderer never built.
///
/// Per `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 7.2:
/// the production component has NO `accessibilityLabel`, `accessibilityRole`
/// or `accessible` prop anywhere in its 1400 lines, so this must be BUILT,
/// not ported. The artifact's own recommendation is followed exactly: "the
/// V2 canonical code plus the condition, for example 'LHCO, Good, pressure
/// 110 psi' ... because the V2 code is the name a fitter uses out loud. The
/// V1 slot id is an internal key and should not be spoken."
library;

import 'package:tyre_pulse/app/localization/tp_direction.dart';
import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';

/// The user-facing word for [condition], in the active locale.
String tyreConditionLabel(AppLocalizations l10n, TyreCondition condition) {
  return switch (condition) {
    TyreCondition.good => l10n.tyreConditionGood,
    TyreCondition.worn => l10n.tyreConditionWorn,
    TyreCondition.damaged => l10n.tyreConditionDamaged,
    TyreCondition.puncture => l10n.tyreConditionPuncture,
    TyreCondition.flat => l10n.tyreConditionFlat,
    TyreCondition.missing => l10n.tyreConditionMissing,
  };
}

/// Builds the spoken/read label for one wheel: `"LHCO, Good"`,
/// `"LHCO, Not recorded"` for an untouched seed, or
/// `"LHCO, Good, pressure 110 psi"` when a reading was recorded.
///
/// [code] is the V2 canonical GCC code - never [TyreSlot.id]. It is wrapped
/// in an LTR isolate before being concatenated into this otherwise
/// localised sentence, matching `TpDirection.isolateLtr`'s own documented
/// use case ("whenever an identifier is CONCATENATED into a translated
/// sentence") - the same rule spec section 52 states for any technical
/// identifier mixed into prose.
String tyreDiagramAccessibilityLabel(
  AppLocalizations l10n, {
  required String code,
  required TyreCondition? condition,
  String? pressureText,
}) {
  final String isolatedCode = TpDirection.isolateLtr(code);
  final String conditionText = condition == null
      ? l10n.tyreDiagramListNotRecorded
      : tyreConditionLabel(l10n, condition);
  final String base = '$isolatedCode, $conditionText';
  final String? pressure = pressureText?.trim();
  if (pressure == null || pressure.isEmpty) return base;
  return '$base, ${l10n.tyreDiagramPressureDetail(pressure)}';
}
