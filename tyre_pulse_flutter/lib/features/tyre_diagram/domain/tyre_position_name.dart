/// Decodes a tyre-map DISPLAY code (`LHF1`, `LHCO`, `RHR2-I`, `LHRCO`, ...)
/// into the parts a plain-English name is built from ("Left, centre axle,
/// outer"). Display helper only: it never changes what is stored.
///
/// The vocabulary is exactly the codes the shared tyre map can print
/// (`kTyreSpecCodesBase` plus the Tri-mixer and concrete pump overrides in
/// `tyre_layout_spec.g.dart`):
///
///   LH|RH + FN             front axle N
///   LH|RH + RN             rear axle N (single wheel)
///   LH|RH + RN-I|O        rear axle N, inner/outer
///   LH|RH + RI|RO           rear axle, inner/outer
///   LH|RH + CI|CO           centre axle, inner/outer (Tri-mixer)
///   LH|RH + RCI|RCO         rear-centre axle, inner/outer (concrete pump)
///   LH|RH + RRI|RRO         rearmost axle, inner/outer (concrete pump)
///
/// Anything else returns `null`, so the caller shows only the code rather
/// than a guessed name that could send a fitter to the wrong wheel.
library;

import 'package:flutter/foundation.dart';

enum TyrePositionNameSide { left, right }

enum TyrePositionNameAxle {
  front,
  rearNumbered,
  rear,
  centre,
  rearCentre,
  rearmost
}

enum TyrePositionNameRole { inner, outer }

@immutable
class TyrePositionName {
  const TyrePositionName({
    required this.side,
    required this.axle,
    this.axleNumber,
    this.role,
  });

  final TyrePositionNameSide side;
  final TyrePositionNameAxle axle;

  /// Set for [TyrePositionNameAxle.front] and
  /// [TyrePositionNameAxle.rearNumbered] only.
  final int? axleNumber;

  /// `null` for a single-wheel position (steer, single rear).
  final TyrePositionNameRole? role;

  @override
  bool operator ==(Object other) =>
      other is TyrePositionName &&
      other.side == side &&
      other.axle == axle &&
      other.axleNumber == axleNumber &&
      other.role == role;

  @override
  int get hashCode => Object.hash(side, axle, axleNumber, role);

  @override
  String toString() => 'TyrePositionName($side, $axle, $axleNumber, $role)';
}

final RegExp _codeRe = RegExp(r'^(LH|RH)(.+)$');
final RegExp _frontRe = RegExp(r'^F(\d+)$');
final RegExp _rearNumberedRe = RegExp(r'^R(\d+)([IO])?$');
final RegExp _rearCentreRe = RegExp(r'^RC([IO])$');
final RegExp _rearmostRe = RegExp(r'^RR([IO])$');
final RegExp _centreRe = RegExp(r'^C([IO])$');
final RegExp _rearRe = RegExp(r'^R([IO])$');

/// Parses [code]; case, spaces, `-` and `_` are ignored (stored codes can
/// carry stray whitespace).
TyrePositionName? parseTyrePositionName(String? code) {
  if (code == null) return null;
  final String u = code.toUpperCase().replaceAll(RegExp(r'[\s\-_]+'), '');
  final RegExpMatch? m = _codeRe.firstMatch(u);
  if (m == null) return null;
  final TyrePositionNameSide side = m.group(1) == 'LH'
      ? TyrePositionNameSide.left
      : TyrePositionNameSide.right;
  final String rest = m.group(2)!;

  TyrePositionNameRole? roleOf(String? letter) => switch (letter) {
        'I' => TyrePositionNameRole.inner,
        'O' => TyrePositionNameRole.outer,
        _ => null,
      };

  RegExpMatch? x = _frontRe.firstMatch(rest);
  if (x != null) {
    final int n = int.parse(x.group(1)!);
    if (n < 1) return null;
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.front,
      axleNumber: n,
    );
  }
  x = _rearNumberedRe.firstMatch(rest);
  if (x != null) {
    final int n = int.parse(x.group(1)!);
    if (n < 1) return null;
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.rearNumbered,
      axleNumber: n,
      role: roleOf(x.group(2)),
    );
  }
  x = _rearCentreRe.firstMatch(rest);
  if (x != null) {
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.rearCentre,
      role: roleOf(x.group(1)),
    );
  }
  x = _rearmostRe.firstMatch(rest);
  if (x != null) {
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.rearmost,
      role: roleOf(x.group(1)),
    );
  }
  x = _centreRe.firstMatch(rest);
  if (x != null) {
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.centre,
      role: roleOf(x.group(1)),
    );
  }
  x = _rearRe.firstMatch(rest);
  if (x != null) {
    return TyrePositionName(
      side: side,
      axle: TyrePositionNameAxle.rear,
      role: roleOf(x.group(1)),
    );
  }
  return null;
}
