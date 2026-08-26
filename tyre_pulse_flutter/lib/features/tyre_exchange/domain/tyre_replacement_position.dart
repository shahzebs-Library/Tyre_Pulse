/// Per-vehicle-type tyre-position options for the tyre replacement picker.
///
/// `mobile/app/(app)/tyre-change.tsx` (`mobile/` is READ-ONLY reference
/// material - see `AGENTS.md` rule "Never edit them from this project")
/// offers a single fixed nine-value chip list -
/// `['FL','FR','RL','RR','RLO','RLI','RRO','RRI','Spare']` - regardless of
/// the vehicle being worked on. That is a real simplification, not a
/// contract: the reference screen never looks up the asset at all, so it
/// has no vehicle type to be more specific with. A Tri-mixer (12 wheel
/// positions) or a Concrete pump (14) can only be served correctly by that
/// list through its free-text override field.
///
/// This module derives the FULL, correct position set for whatever vehicle
/// is actually being worked on, by reusing - never re-implementing - the
/// already-verified, fully parity-tested tyre diagram engine under
/// `features/tyre_diagram/domain/tyre_diagram_layouts.dart`
/// ([diagramPositions], [legacyPositionCode], [resolveVehicleType]).
/// AGENTS.md rule 10 ("never change tyre position IDs") is exactly why that
/// engine, and not a second hand-written vocabulary, is the right thing to
/// build this on: its 13 production layouts and their V1-to-V2 relabelling
/// are the one place in this codebase those ids are pinned.
///
/// # Which vocabulary is actually submitted - V1 diagram ids, or the V2
/// # canonical GCC code?
///
/// This is the one genuinely ambiguous call in this feature, so it is
/// recorded here rather than silently decided. Two pieces of evidence in
/// this SAME migration disagree at first glance:
///
/// - `features/inspections/presentation/controllers/
///   inspection_wizard_controller.dart`'s `resumeOrStart` matches a
///   `NewInspectionRoute.tyrePosition` prefill against
///   `diagramPositions(...)` case-insensitively - i.e. for
///   `inspections.tyre_conditions`, the wire vocabulary is the RAW V1
///   diagram slot id (`FL`, `R1Lo`, ...).
/// - `app/router/routes.dart`'s own `TyrePosition` identifier type is
///   documented "`tyre_records.tyre_position`, for example `LHF1` or
///   `RHCO`" - i.e. for `tyre_records` specifically, the documented
///   convention is the CANONICAL GCC code, not the raw diagram id. The
///   shared test fixture `seedCommand` in
///   `test/core/database/database_test_support.dart` independently agrees:
///   its own example `TYRE_CHANGE` payload is
///   `'{"asset_no":"TM514","position":"LHF1"}'`.
///
/// These are two DIFFERENT tables (`inspections.tyre_conditions` vs
/// `tyre_records.position`/`.tyre_position`), so there is no contradiction:
/// each keeps its own documented vocabulary. This module follows the
/// `tyre_records` evidence, because that is the table [SubmitTyreReplacementInput]
/// (`data/tyre_replacement_repository.dart`) actually writes to - the V2
/// canonical GCC code (`LHF1`, `RHCO`, `LHCO` for a Tri-mixer's centre
/// axle, ...) is what [tyreReplacementPositions] returns as
/// [TyreReplacementPositionOption.code], via [legacyPositionCode].
///
/// The reference screen's literal `'Spare'` chip is kept, appended after
/// every derived position, because it names a real business state (a tyre
/// held in reserve, fitted to no wheel) that has no slot in any of the 13
/// layouts (`tyre_diagram_layouts.dart`'s own library comment: "0 spares
/// ... in ANY of the 13 layouts").
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';

/// The literal, untranslated position code for the reserve tyre. Preserved
/// verbatim from the reference screen's own `POSITIONS` array. Kept as a
/// real position VALUE - never localised, exactly like every derived
/// [TyreReplacementPositionOption.code] - because it is a value this app
/// writes to a database column, not interface text.
const String tyreReplacementSparePositionCode = 'Spare';

/// One selectable position for the picker.
@immutable
class TyreReplacementPositionOption {
  const TyreReplacementPositionOption({required this.code, this.diagramSlotId});

  /// The value to submit as `tyre_records.position` - a canonical GCC code
  /// (`LHF1`, `RHCO`, ...) for every derived option, or
  /// [tyreReplacementSparePositionCode] for the reserve-tyre option. Never
  /// translated - see the library comment and repository rule 10.
  final String code;

  /// The V1 diagram slot id (`features/tyre_diagram`) [code] was derived
  /// from - `FL`, `R1Lo`, ... Null for the Spare option, which has no slot
  /// on any layout.
  final String? diagramSlotId;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TyreReplacementPositionOption &&
          other.code == code &&
          other.diagramSlotId == diagramSlotId);

  @override
  int get hashCode => Object.hash(code, diagramSlotId);

  @override
  String toString() =>
      'TyreReplacementPositionOption(code: $code, diagramSlotId: $diagramSlotId)';
}

/// The full, correctly-shaped position list for [vehicleType] (optionally
/// helped along by [assetNo] when the type is a junk catch-all or absent -
/// see [resolveVehicleType]'s own doc comment on why the type always wins
/// when it resolves).
///
/// Every derived option's [TyreReplacementPositionOption.code] is the V2
/// canonical GCC label for its slot, via [legacyPositionCode] - TYPE-AWARE,
/// so the very same slot id reads `LHCO` on a Tri-mixer and `LHR1-O` on
/// (for example) a Line pump. [tyreReplacementSparePositionCode] is always
/// appended last, even for equipment [isTyrelessEquipment] would refuse a
/// diagram for - the picker must never be empty, and a spare tyre can
/// always be logged regardless of what [diagramPositions] itself returns.
List<TyreReplacementPositionOption> tyreReplacementPositions(
  String? vehicleType, [
  String? assetNo,
]) {
  final String vt = vehicleType ?? '';
  final String resolvedLayoutKey = resolveVehicleType(vehicleType, assetNo);
  final List<String> slotIds = diagramPositions(vt, assetNo);

  return <TyreReplacementPositionOption>[
    for (final String slotId in slotIds)
      TyreReplacementPositionOption(
        code: legacyPositionCode(resolvedLayoutKey, slotId),
        diagramSlotId: slotId,
      ),
    const TyreReplacementPositionOption(code: tyreReplacementSparePositionCode),
  ];
}
