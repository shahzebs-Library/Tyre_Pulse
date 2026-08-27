/// "How many of this machine's tyres are OK, need monitoring, or are
/// critical?" - the compact stat row shown above the diagram and the
/// vehicle layout board's Total/OK/Monitor/Critical tiles.
///
/// Deliberately reads [Map]-shaped raw entries, keyed by the SAME position
/// vocabulary the caller already renders positions under - exactly how
/// `inspection_detail_screen.dart`'s own `_PositionSummaryRow` loop and
/// `inspection_approval_review_screen.dart`'s own `_TyreConditionsSection`
/// already look a position up (`view.tyreConditions[position]`), rather than
/// re-running the full layout/slot-matching machinery
/// [matchPositionsToLayout] exists for. That machinery answers "which SVG
/// slot does this position id belong to"; this file answers a narrower
/// question - "what status band is this position at" - and does so through
/// [wheelStatusFor], the SAME function [VehicleTyreDiagram] itself resolves
/// a wheel's colour from, so a stat tile can never disagree with the wheel
/// sitting under it.
library;

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';

/// The counted summary for one vehicle's tyre positions.
@immutable
class TyreDiagramStats {
  const TyreDiagramStats({
    required this.total,
    required this.ok,
    required this.monitor,
    required this.critical,
    required this.unrecorded,
  });

  /// How many positions this vehicle carries in total.
  final int total;

  /// [TpStatus.ok] - measured and within tolerance.
  final int ok;

  /// [TpStatus.warning] - measured, outside tolerance, not yet stopping
  /// work. Named "Monitor" on screen: a worn or flat tyre needs watching,
  /// not necessarily an immediate stop.
  final int monitor;

  /// [TpStatus.critical] - damaged or punctured, the strongest signal.
  final int critical;

  /// [TpStatus.unknown] - nothing was ever recorded for this position.
  /// Counted SEPARATELY from [ok]/[monitor]/[critical] rather than folded
  /// into any of them: a wheel nobody has looked at is a different claim
  /// from one measured and found fine.
  final int unrecorded;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is TyreDiagramStats &&
          other.total == total &&
          other.ok == ok &&
          other.monitor == monitor &&
          other.critical == critical &&
          other.unrecorded == unrecorded);

  @override
  int get hashCode => Object.hash(total, ok, monitor, critical, unrecorded);

  @override
  String toString() => 'TyreDiagramStats(total: $total, ok: $ok, '
      'monitor: $monitor, critical: $critical, unrecorded: $unrecorded)';
}

/// Summarises [positions] against [tyreData], keyed by position exactly as
/// every real caller already keys it.
TyreDiagramStats computeTyreDiagramStats(
  List<String> positions,
  Map<String, Map<String, Object?>> tyreData,
) {
  int ok = 0;
  int monitor = 0;
  int critical = 0;
  int unrecorded = 0;

  for (final String position in positions) {
    final TpStatus status = wheelStatusFor(tyreData[position]);
    switch (status) {
      case TpStatus.ok:
        ok++;
      case TpStatus.warning:
        monitor++;
      case TpStatus.critical:
        critical++;
      case TpStatus.unknown:
        unrecorded++;
      case TpStatus.info:
      case TpStatus.neutral:
        // Not a band `wheelStatusFor` ever returns - kept exhaustive so a
        // future status value fails to compile here rather than silently
        // vanishing from every count.
        break;
    }
  }

  return TyreDiagramStats(
    total: positions.length,
    ok: ok,
    monitor: monitor,
    critical: critical,
    unrecorded: unrecorded,
  );
}
