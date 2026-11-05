/// The user-facing tyre-map code for one stored tyre position.
///
/// Positions are STORED as internal diagram-slot ids (`FL`, `R1Li`,
/// `R2Ri`, `F1L`, ...) or, for older rows, in another vocabulary the
/// position matcher understands. People must SEE the business tyre-map
/// code (`LHF1`, `LHCI`, `LHR2-I`, ...). This is a display/label helper
/// only: it never changes what is stored (AGENTS.md rule 10).
library;

import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_matcher.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

/// The tyre-map code for [position] on a vehicle of [vehicleType].
///
/// Resolves the layout exactly the way the diagram does, places [position]
/// on that layout with [matchPositionsToLayout] (so either position
/// vocabulary lands on the right wheel), then labels the matched slot with
/// [legacyPositionCode]. With no vehicle type (and no asset number) the raw
/// [position] is returned unchanged - a guessed vehicle would risk the
/// wrong label (the Tri-mixer override), and an invented label sends a
/// fitter to the wrong tyre.
String tyrePositionDisplayCode(
  String? vehicleType,
  String position, {
  String? assetNo,
}) {
  final String pos = position.trim();
  if (pos.isEmpty) return position;
  final bool hasType = vehicleType != null && vehicleType.trim().isNotEmpty;
  final bool hasAsset = assetNo != null && assetNo.trim().isNotEmpty;
  if (!hasType && !hasAsset) return position;

  final String key = resolveVehicleType(vehicleType, assetNo);
  final DiagramLayout? layout = kTyreDiagramLayouts[key];
  if (layout == null) return legacyPositionCode(key, pos);

  final List<MatchedTyreSlot> matched =
      matchPositionsToLayout(layout, <String>[pos]);
  for (final MatchedTyreSlot slot in matched) {
    if (slot.positionId == pos) {
      return legacyPositionCode(layout.key, slot.id);
    }
  }
  // Not placeable on this layout (spare, unknown token): legacyPositionCode
  // passes an unrecognised id through unchanged.
  return legacyPositionCode(layout.key, pos);
}
