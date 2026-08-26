/// Draws every wheel of one resolved layout as a `CustomPainter`.
///
/// A painter rather than one widget per wheel: artifact section 7.1 - "98
/// slots across 13 layouts, all simple rounded rectangles with a
/// rim/glow/dark tri-tone. Painting is cheaper than 14 widgets." Colour
/// comes from [TpPalette.forStatus] (see `tyre_condition.dart`'s library
/// comment for why this app's own theme tokens are used in place of the RN
/// source's fixed hex `RISK` palette).
///
/// Hit-testing is NOT done here: `vehicle_tyre_diagram.dart` lays real
/// [GestureDetector]/[Semantics] widgets over the geometry
/// [TyreDiagramViewport.hitRect] computes, matching spec section 24's rule
/// against "one giant static image with invisible buttons" - these are real
/// widgets over a slot whose geometry is known, not the reverse.
library;

import 'dart:ui' show PathMetric;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';

/// Everything the painter needs to draw ONE wheel.
@immutable
class TyreWheelPaintData {
  const TyreWheelPaintData({
    required this.svgX,
    required this.svgY,
    required this.svgW,
    required this.svgH,
    required this.status,
    required this.isSelected,
    required this.isOutstanding,
    required this.isRecorded,
  });

  final double svgX;
  final double svgY;
  final double svgW;
  final double svgH;

  /// The colour band this wheel currently draws at.
  final TpStatus status;

  final bool isSelected;

  /// Nobody has filled this wheel in yet - drawn as a dashed outline, a
  /// SEPARATE visual channel from [status] so the rim colour keeps saying
  /// how the tyre is while the outline says nobody has recorded it.
  final bool isOutstanding;

  /// At least one field was recorded for this wheel - drawn as a small
  /// filled dot, distinct from [isSelected]'s ring.
  final bool isRecorded;
}

/// Paints every wheel in [wheels] against [viewport] and [palette].
class TyreWheelPainter extends CustomPainter {
  TyreWheelPainter({
    required this.wheels,
    required this.viewport,
    required this.palette,
  });

  final List<TyreWheelPaintData> wheels;
  final TyreDiagramViewport viewport;
  final TpPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    for (final TyreWheelPaintData wheel in wheels) {
      _paintWheel(canvas, wheel);
    }
  }

  void _paintWheel(Canvas canvas, TyreWheelPaintData wheel) {
    final Rect body = viewport.wheelRect(
      wheel.svgX,
      wheel.svgY,
      wheel.svgW,
      wheel.svgH,
    );
    final TpStatusColors colors = palette.forStatus(wheel.status);
    final RRect rounded = RRect.fromRectAndRadius(
      body,
      Radius.circular(body.shortestSide * 0.32),
    );

    // Tri-tone rim: a dark rubber base, then the status colour as a rim
    // band, then a hub-cap disc - the RN painter's rubber/rim/hub layering,
    // simplified to flat fills (that source's radial gradients + lug-nut
    // ring are cosmetic detail this port does not attempt to reproduce
    // pixel-for-pixel; the STRUCTURE that matters - a wheel drawn per real
    // slot geometry, coloured by real status - is preserved).
    final Paint rubber = Paint()..color = const Color(0xFF16161A);
    canvas.drawRRect(rounded, rubber);

    final Paint rim = Paint()
      ..color = colors.base
      ..style = PaintingStyle.stroke
      ..strokeWidth = body.shortestSide * 0.16;
    canvas.drawRRect(rounded.deflate(rim.strokeWidth / 2), rim);

    final Offset centre = body.center;
    final double hubRadius = body.shortestSide * 0.16;
    final Paint hub = Paint()..color = colors.soft;
    canvas.drawCircle(centre, hubRadius, hub);

    if (wheel.isRecorded && !wheel.isSelected) {
      final Paint dot = Paint()..color = colors.base;
      canvas.drawCircle(
        Offset(body.right - 1, body.top + 1),
        body.shortestSide * 0.1,
        dot,
      );
    }

    if (wheel.isOutstanding && !wheel.isSelected) {
      _paintDashedOutline(canvas, rounded.inflate(3), palette.borderStrong);
    }

    if (wheel.isSelected) {
      final Paint selected = Paint()
        ..color = palette.focus
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.5;
      canvas.drawRRect(rounded.inflate(3), selected);
    }
  }

  void _paintDashedOutline(Canvas canvas, RRect rrect, Color color) {
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = 1.2;
    final Path path = Path()..addRRect(rrect);
    const double dash = 3;
    const double gap = 2;
    for (final PathMetric metric in path.computeMetrics()) {
      double distance = 0;
      while (distance < metric.length) {
        final double end =
            (distance + dash > metric.length) ? metric.length : distance + dash;
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(covariant TyreWheelPainter oldDelegate) {
    // Always true. `wheels` has no value-equality override, so comparing
    // list instances would be an identity check that is virtually always
    // true anyway on a StatelessWidget rebuild (a fresh list is normally
    // built each time) - a real diff would need `==`/`hashCode` on
    // [TyreWheelPaintData] and `listEquals`, which is not worth the extra
    // surface for a cheap-to-redraw painter covering at most 14 wheels.
    return true;
  }
}
