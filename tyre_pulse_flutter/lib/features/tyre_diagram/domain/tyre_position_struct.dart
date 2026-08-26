/// The single parser for BOTH position-id vocabularies.
///
/// Ported rule-for-rule from `parsePositionStruct` in
/// `mobile/lib/tyreDiagramLayouts.ts:434-477`, per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 4.3. The
/// app carries two position vocabularies that this one parser resolves onto
/// a common structural shape:
///
///   V1 diagram ids:        `FL`, `RLo`, `F1L`, `R2Ro`, ...
///   V3 `types.ts` ids:      `FL1`, `RL1`..`RL4`, `SL`/`SR`, `AxleL1`, ...
///
/// [parsePositionStruct] is used two places: [matchPositionsToLayout]
/// (`tyre_position_matcher.dart`) uses it to place a caller-supplied
/// position of EITHER vocabulary onto the right wheel slot, and
/// `tyreCompleteness` uses it nowhere directly - but the rule ORDER below is
/// still the contract, because getting rule 6 ahead of rule 1 (say) would
/// make `SP` parse as a drive wheel instead of a spare. See the 8 numbered
/// rules inline; the artifact names two ordering traps explicitly: rule 1
/// (spare) must precede rule 3 (lift), and rule 4 (`F[LR]`) must precede
/// rule 5 (`F<digits>[LR]`) - `F1L` is not `FL`.
library;

import 'package:flutter/foundation.dart';

/// What kind of wheel a position occupies.
enum PositionKind {
  /// A steer axle wheel (`F...`).
  steer,

  /// A drive axle wheel (`R...`).
  drive,

  /// A lift/tag axle wheel (`S[LR]`).
  lift,

  /// A generic named axle (`Axle[LR]`), used by the Vehicle Designer's
  /// custom layouts (artifact section 7.5) - no built-in layout uses this
  /// kind today.
  axle,

  /// A spare wheel. No production layout carries a spare SLOT (artifact
  /// section 1.2) - this kind exists so a caller-supplied `Spare`/`SP` token
  /// is recognised and deliberately SKIPPED by the matcher, rather than
  /// falling through as an unrecognised position.
  spare,

  /// A token this parser does not recognise at all.
  unknown,
}

/// Which side of the vehicle. `null` on [PositionKind.spare] and
/// [PositionKind.unknown] - a spare and an unknown token have no side.
enum PositionSide { left, right }

/// A wheel's role within its axle, for a dual-tyre (or wider) axle.
enum PositionRole {
  /// The wheel furthest from the vehicle's centreline.
  outer,

  /// The wheel closest to the vehicle's centreline.
  inner,

  /// The only wheel on this axle-and-side (a steer wheel, or a
  /// single-tyre drive axle).
  single,
}

/// The structural shape a position id decodes to.
@immutable
class PositionStruct {
  const PositionStruct({
    required this.kind,
    required this.side,
    required this.axle,
    required this.role,
  });

  final PositionKind kind;
  final PositionSide? side;

  /// 1-based axle ordinal, front to back. `0` for [PositionKind.spare] and
  /// [PositionKind.unknown], which have no axle.
  final int axle;

  final PositionRole role;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PositionStruct &&
          other.kind == kind &&
          other.side == side &&
          other.axle == axle &&
          other.role == role);

  @override
  int get hashCode => Object.hash(kind, side, axle, role);

  @override
  String toString() =>
      'PositionStruct(kind: $kind, side: $side, axle: $axle, role: $role)';
}

const PositionStruct _unknownStruct = PositionStruct(
  kind: PositionKind.unknown,
  side: null,
  axle: 0,
  role: PositionRole.single,
);

final RegExp _spareRe = RegExp(r'^SP(ARE)?\d*$');
final RegExp _axleRe = RegExp(r'^AXLE([LR])(\d*)$');
final RegExp _liftRe = RegExp(r'^S([LR])(\d*)$');
final RegExp _steerNoDigitRe = RegExp(r'^F([LR])(\d*)$');
final RegExp _steerDigitFirstRe = RegExp(r'^F(\d+)([LR])$');
final RegExp _driveWithRoleRe = RegExp(r'^R(\d*)([LR])([OI])$');
final RegExp _driveOrdinalRe = RegExp(r'^R([LR])(\d*)$');

/// Decodes [id] into its structural shape. Never throws: an id that matches
/// none of the eight rules below is [PositionKind.unknown].
///
/// Input is upper-cased, trimmed, and stripped of every whitespace, `-` and
/// `_` character before matching (mirrors `mobile/lib/tyreDiagramLayouts.ts`
/// line 435), so `'r2ri'`, `'R2-RI'` and `' R2_Ri '` all parse identically.
PositionStruct parsePositionStruct(String id) {
  final String u = id.toUpperCase().trim().replaceAll(RegExp(r'[\s\-_]+'), '');
  if (u.isEmpty) return _unknownStruct;

  // Rule 1: SP / SPARE, optionally numbered. Must precede rule 3 (lift) -
  // `SP` is not a lift axle.
  if (_spareRe.hasMatch(u)) {
    return const PositionStruct(
      kind: PositionKind.spare,
      side: null,
      axle: 0,
      role: PositionRole.single,
    );
  }

  // Rule 2: Axle[L|R], for the Vehicle Designer's custom layouts.
  Match? m = _axleRe.firstMatch(u);
  if (m != null) {
    return PositionStruct(
      kind: PositionKind.axle,
      side: _sideOf(m.group(1)!),
      axle: _axleOrDefault(m.group(2)),
      role: PositionRole.single,
    );
  }

  // Rule 3: S[L|R], a lift/tag axle.
  m = _liftRe.firstMatch(u);
  if (m != null) {
    return PositionStruct(
      kind: PositionKind.lift,
      side: _sideOf(m.group(1)!),
      axle: _axleOrDefault(m.group(2)),
      role: PositionRole.single,
    );
  }

  // Rule 4: F[L|R], optionally numbered (FL, FR, FL2). Must precede rule 5 -
  // `FL` is not `F1L`.
  m = _steerNoDigitRe.firstMatch(u);
  if (m != null) {
    return PositionStruct(
      kind: PositionKind.steer,
      side: _sideOf(m.group(1)!),
      axle: _axleOrDefault(m.group(2)),
      role: PositionRole.single,
    );
  }

  // Rule 5: F<digits>[L|R] (F1L, F3R) - the V3 vocabulary's steer form.
  m = _steerDigitFirstRe.firstMatch(u);
  if (m != null) {
    return PositionStruct(
      kind: PositionKind.steer,
      side: _sideOf(m.group(2)!),
      axle: int.parse(m.group(1)!),
      role: PositionRole.single,
    );
  }

  // Rule 6: R<digits>[L|R][O|I] (RLo, R2Ri) - the V1 dual-wheel form, role
  // stated explicitly by the trailing O/I.
  m = _driveWithRoleRe.firstMatch(u);
  if (m != null) {
    return PositionStruct(
      kind: PositionKind.drive,
      side: _sideOf(m.group(2)!),
      axle: _axleOrDefault(m.group(1)),
      role: m.group(3) == 'O' ? PositionRole.outer : PositionRole.inner,
    );
  }

  // Rule 7: R[L|R]<digits> (RL, RR, RL1..RR4) - the V3 ordinal form. The
  // trailing number is the wheel ordinal across ALL drive wheels on that
  // side; consecutive pairs form one dual axle, and the outer/inner role is
  // MIRRORED by side - odd is outer on the left but inner on the right.
  // Getting that mirroring backwards silently swaps every dual-wheel
  // diagram's outer and inner tyres (artifact section 4.3).
  m = _driveOrdinalRe.firstMatch(u);
  if (m != null) {
    final PositionSide side = _sideOf(m.group(1)!);
    final String? digits = m.group(2);
    if (digits == null || digits.isEmpty) {
      return PositionStruct(
        kind: PositionKind.drive,
        side: side,
        axle: 1,
        role: PositionRole.single,
      );
    }
    final int k = int.parse(digits);
    final bool first = k % 2 == 1;
    final PositionRole role = side == PositionSide.left
        ? (first ? PositionRole.outer : PositionRole.inner)
        : (first ? PositionRole.inner : PositionRole.outer);
    return PositionStruct(
      kind: PositionKind.drive,
      side: side,
      axle: (k / 2).ceil(),
      role: role,
    );
  }

  // Rule 8: fallback.
  return _unknownStruct;
}

PositionSide _sideOf(String letter) =>
    letter == 'L' ? PositionSide.left : PositionSide.right;

int _axleOrDefault(String? digits) =>
    (digits == null || digits.isEmpty) ? 1 : int.parse(digits);
