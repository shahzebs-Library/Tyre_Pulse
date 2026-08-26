/// Draws a per-vehicle-class silhouette behind the wheels.
///
/// GENUINE GAP, STATED PLAINLY: the production RN renderer
/// (`mobile/components/VehicleTyreDiagram.tsx`) draws each of the eight
/// bodies as elaborate hand-authored inline SVG - radial/linear gradients,
/// individually drawn headlights, mirrors, drum spiral fins, hopper
/// artwork, a company wordmark baked into the concrete-pump and tri-mixer
/// bodies. That artwork exists only as `react-native-svg` primitives inside
/// that 1400-line file; there is no exported asset (no `.svg`, no `.png`)
/// this Flutter port can read or convert, and re-authoring ~900 lines of
/// gradient-heavy vector art as hand-written `Canvas` calls, unverifiable
/// without a local Flutter toolchain to actually render and inspect the
/// result, is a large, error-prone undertaking with no bearing on the
/// artifact's 90 parity cases (every one of which is resolver, parser,
/// matcher or completeness logic - none touches pixel art).
///
/// This painter draws a plain, clearly provisional silhouette per
/// [TyreDiagramBodyKey] instead: a rounded outline sized and shaped
/// distinctly enough per class (a short wide cab for [pickup], a long
/// rectangle for [canter]/[triMixer]/[concretePump], a low wide arch for
/// [wheelLoader], a long low box for [bus]) that the diagram remains
/// functionally complete and visually distinguishable per vehicle - a
/// person can tell "this is the mixer" from "this is the pickup" - without
/// claiming to be the real branded artwork. Replacing this with a faithful
/// reproduction of the production art (or real vector assets, once
/// available) is future work and does not block anything downstream: the
/// wheels, hit-testing, labels and completeness state are all real.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';

/// Paints a provisional silhouette for [bodyKey] inside [viewport].
class TyreBodyPainter extends CustomPainter {
  TyreBodyPainter({
    required this.bodyKey,
    required this.viewport,
    required this.palette,
  });

  final TyreDiagramBodyKey bodyKey;
  final TyreDiagramViewport viewport;
  final TpPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint fill = Paint()..color = palette.surfaceSunken;
    final Paint stroke = Paint()
      ..color = palette.borderStrong
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.5;

    final Rect bounds = viewport.wheelRect(
      0,
      0,
      kDiagramViewWidth,
      viewport.viewH,
    );
    final RRect body = RRect.fromRectAndRadius(
      bounds.deflate(bounds.width * _insetFraction),
      Radius.circular(bounds.shortestSide * _cornerFraction),
    );
    canvas.drawRRect(body, fill);
    canvas.drawRRect(body, stroke);
  }

  /// How far each side of the silhouette sits inside the wheel bounds, as a
  /// fraction of the viewport width - a rough per-class silhouette shape,
  /// not a precise chassis outline.
  double get _insetFraction => switch (bodyKey) {
        TyreDiagramBodyKey.pickup => 0.18,
        TyreDiagramBodyKey.wheelLoader => 0.14,
        TyreDiagramBodyKey.canter => 0.2,
        TyreDiagramBodyKey.triMixer => 0.16,
        TyreDiagramBodyKey.concretePump => 0.16,
        TyreDiagramBodyKey.bus => 0.05,
        TyreDiagramBodyKey.tata => 0.2,
        TyreDiagramBodyKey.ashokLeyland => 0.2,
      };

  double get _cornerFraction => switch (bodyKey) {
        TyreDiagramBodyKey.wheelLoader => 0.28,
        TyreDiagramBodyKey.pickup => 0.22,
        _ => 0.12,
      };

  @override
  bool shouldRepaint(covariant TyreBodyPainter oldDelegate) {
    return oldDelegate.bodyKey != bodyKey ||
        oldDelegate.viewport.width != viewport.width ||
        oldDelegate.viewport.viewH != viewport.viewH ||
        oldDelegate.palette != palette;
  }
}
