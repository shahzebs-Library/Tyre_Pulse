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
