/// The plain-language name for a tyre-map code ("Left, centre axle, outer"),
/// in the reader's language. `null` when the code is not one the shared map
/// prints, so the caller shows only the code instead of a guess.
library;

import 'package:tyre_pulse/app/localization/tp_localizations.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_name.dart';

String? tyrePositionPlainName(AppLocalizations l10n, String? code) {
  final TyrePositionName? name = parseTyrePositionName(code);
  if (name == null) return null;
  final String side = switch (name.side) {
    TyrePositionNameSide.left => l10n.tyrePosSideLeft,
    TyrePositionNameSide.right => l10n.tyrePosSideRight,
  };
  final String axle = switch (name.axle) {
    TyrePositionNameAxle.front =>
      l10n.tyrePosAxleFront('${name.axleNumber ?? 1}'),
    TyrePositionNameAxle.rearNumbered =>
      l10n.tyrePosAxleRearNumbered('${name.axleNumber ?? 1}'),
    TyrePositionNameAxle.rear => l10n.tyrePosAxleRear,
    TyrePositionNameAxle.centre => l10n.tyrePosAxleCentre,
    TyrePositionNameAxle.rearCentre => l10n.tyrePosAxleRearCentre,
    TyrePositionNameAxle.rearmost => l10n.tyrePosAxleRearmost,
  };
  final TyrePositionNameRole? role = name.role;
  if (role == null) return l10n.tyrePosNameNoRole(side, axle);
  final String roleText = switch (role) {
    TyrePositionNameRole.inner => l10n.tyrePosRoleInner,
    TyrePositionNameRole.outer => l10n.tyrePosRoleOuter,
  };
  return l10n.tyrePosNameWithRole(side, axle, roleText);
}
