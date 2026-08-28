/// The SVG-user-space -> screen-pixel coordinate transform, and the
/// Material-minimum hit-target expansion.
///
/// Ported from `toScreen()` in `mobile/components/VehicleTyreDiagram.tsx`
/// (`:1269-1274`, `:1296-1304`), per
/// `docs/flutter-migration/07-tyre-layout-parity-tests.md` section 7.1.
/// Kept pure and free of Flutter widget classes (only `dart:ui`'s [Rect]
/// and [Size], which have no [BuildContext] dependency) so the transform is
/// unit-testable without pumping a widget tree.
library;

import 'dart:ui';

import 'package:flutter/foundation.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_position_struct.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

/// The production SVG viewBox: `minX -10, width 220, minY -5,
/// height viewH + 10`.
const double kDiagramViewMinX = -10;
const double kDiagramViewMinY = -5;
const double kDiagramViewWidth = 220;

/// Finger padding, in SVG user-space units, added on every side of a wheel
/// before scaling to screen pixels.
const double kDiagramHitPadding = 2;

/// The Material minimum comfortable touch target, matching
/// `TpSizing.minTouchTarget` (`app/theme/tp_spacing.dart`). Declared again
/// here, deliberately: this file is a pure geometry module with no
/// dependency on the design-system token file, and the two are pinned
/// together by a test rather than a shared import, so a change to one is
/// forced to notice the other.
const double kDiagramMinHitTarget = 48;

/// A resolved rendering viewport for one [DiagramLayout]: the pixel width
/// requested by the caller, the SVG viewBox height it maps to, and the
/// derived scale factor.
@immutable
class TyreDiagramViewport {
  const TyreDiagramViewport({required this.width, required this.viewH});

  /// The rendered width, in logical pixels.
  final double width;

  /// The layout's `viewH` (SVG user-space height, before the `+10` margin).
  final double viewH;

  /// Logical pixels per SVG user-space unit.
  double get scale => width / kDiagramViewWidth;

  /// The rendered height, in logical pixels.
  double get height => (viewH + 10) * scale;

  /// Maps an SVG-space slot rectangle onto a screen-pixel [Rect], WITHOUT
  /// the finger-padding expansion - this is what a [CustomPainter] draws
  /// the wheel body at.
  Rect wheelRect(double svgX, double svgY, double svgW, double svgH) {
    return Rect.fromLTWH(
      (svgX - kDiagramViewMinX) * scale,
      (svgY - kDiagramViewMinY) * scale,
      svgW * scale,
      svgH * scale,
    );
  }

  /// Maps an SVG-space slot rectangle onto its screen-pixel HIT rectangle:
  /// [kDiagramHitPadding] of finger padding on every side, THEN expanded
  /// (never shrunk) so neither dimension falls below
  /// [kDiagramMinHitTarget].
  ///
  /// The expansion matters for real production geometry: a Line pump dual
  /// wheel is 19x33 SVG units, which the padded transform alone renders at
  /// roughly 26x45 physical pixels at a 300px-wide diagram - under the
  /// Material minimum on both axes (artifact section 7.1). The RN source
  /// does not correct for this; this port does, by growing the hit rect
  /// outward from its own centre so the visually painted wheel never moves.
  Rect hitRect(double svgX, double svgY, double svgW, double svgH) {
    final Rect padded = Rect.fromLTWH(
      (svgX - kDiagramHitPadding - kDiagramViewMinX) * scale,
      (svgY - kDiagramHitPadding - kDiagramViewMinY) * scale,
      (svgW + kDiagramHitPadding * 2) * scale,
      (svgH + kDiagramHitPadding * 2) * scale,
    );
    return _expandToMinimum(padded, kDiagramMinHitTarget);
  }
}

Rect _expandToMinimum(Rect rect, double minSize) {
  final double width = rect.width < minSize ? minSize : rect.width;
  final double height = rect.height < minSize ? minSize : rect.height;
  if (width == rect.width && height == rect.height) return rect;
  final Offset centre = rect.center;
  return Rect.fromCenter(center: centre, width: width, height: height);
}

/// Builds the hit rectangle for every slot in [layout].
///
/// A centred 48px expansion is correct for a single wheel, but it is wrong
/// for a physically adjacent dual pair: the two expanded rectangles overlap
/// and the later widget in a [Stack] steals part of its neighbour's taps.
/// Dual pairs therefore share one seam. The outer and inner targets meet at
/// that seam without overlapping, remain at least 48px wide, and still cover
/// their own painted wheel. This keeps the wheels visually joined while each
/// stored position remains independently tappable.
Map<String, Rect> buildTyreHitRects({
  required DiagramLayout layout,
  required TyreDiagramViewport viewport,
}) {
  final Map<String, Rect> result = <String, Rect>{
    for (final TyreSlot slot in layout.tyres)
      slot.id: viewport.hitRect(slot.x, slot.y, slot.w, slot.h),
  };

  final Map<(PositionSide, int), List<TyreSlot>> dualGroups =
      <(PositionSide, int), List<TyreSlot>>{};
  for (final TyreSlot slot in layout.tyres) {
    final PositionStruct position = parsePositionStruct(slot.id);
    if (position.kind != PositionKind.drive ||
        position.side == null ||
        position.role == PositionRole.single) {
      continue;
    }
    dualGroups.putIfAbsent(
      (position.side!, position.axle),
      () => <TyreSlot>[],
    ).add(slot);
  }

  for (final List<TyreSlot> pair in dualGroups.values) {
    if (pair.length != 2) continue;
    pair.sort((TyreSlot a, TyreSlot b) => a.x.compareTo(b.x));
    final TyreSlot left = pair.first;
    final TyreSlot right = pair.last;
    final Rect leftWheel = viewport.wheelRect(left.x, left.y, left.w, left.h);
    final Rect rightWheel =
        viewport.wheelRect(right.x, right.y, right.w, right.h);
    final Rect leftDefault = result[left.id]!;
    final Rect rightDefault = result[right.id]!;

    // Keep the seam physically between the two painted wheel centres. A
    // viewport-edge clamp is tempting when preserving the 48px target width,
    // but on a compact phone map that can move the seam *past* the inner
    // wheel's centre. The visible inner tyre would then select Outer. Targets
    // may extend beyond the viewport edge; their visible portion still owns
    // its painted wheel and the two logical positions never overlap or swap.
    final double seam = ((leftWheel.right + rightWheel.left) / 2).clamp(
      leftWheel.center.dx,
      rightWheel.center.dx,
    );
    final double leftWidth = leftDefault.width < kDiagramMinHitTarget
        ? kDiagramMinHitTarget
        : leftDefault.width;
    final double rightWidth = rightDefault.width < kDiagramMinHitTarget
        ? kDiagramMinHitTarget
        : rightDefault.width;

    result[left.id] = Rect.fromLTWH(
      seam - leftWidth,
      leftDefault.top,
      leftWidth,
      leftDefault.height,
    );
    result[right.id] = Rect.fromLTWH(
      seam,
      rightDefault.top,
      rightWidth,
      rightDefault.height,
    );
  }

  return Map<String, Rect>.unmodifiable(result);
}
