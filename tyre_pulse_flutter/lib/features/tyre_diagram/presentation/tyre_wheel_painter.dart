/// Draws every wheel of one resolved layout as a `CustomPainter`.
///
/// A painter rather than one widget per wheel: artifact section 7.1 - "98
/// slots across 13 layouts, all simple rounded rectangles with a
/// rim/glow/dark tri-tone. Painting is cheaper than 14 widgets." Colour
/// comes from [TpPalette.forStatus] (see `tyre_condition.dart`'s library
/// comment for why this app's own theme tokens are used in place of the RN
/// source's fixed hex `RISK` palette).
///
/// REDESIGNED for a realistic 3D tyre - a ground shadow, a radial-gradient
/// rubber body, seven rows of directional (split-pair) tread blocks, a
/// sidewall highlight ring, a status-coloured rim disc with its own
/// gradient, an eight-bolt lug-nut ring and a gradient hub cap with a shine
/// highlight - matching the structure of the production RN `Tyre` component
/// (`mobile/components/VehicleTyreDiagram.tsx`) while staying entirely
/// `dart:ui`-gradient driven, so the rim colour still comes from
/// [TpPalette.forStatus] rather than a hex palette baked into an asset (see
/// `tyre_body_painter.dart`'s own library comment for why that split is
/// deliberate). [_glowOf]/[_darkOf] derive a lighter and a darker variant of
/// the status colour via HSL, standing in for the RN palette's own separate
/// `rim`/`glow`/`dark` triad without this app needing to declare one.
///
/// Hit-testing is NOT done here: `vehicle_tyre_diagram.dart` lays real
/// [GestureDetector]/[Semantics] widgets over the geometry
/// [TyreDiagramViewport.hitRect] computes, matching spec section 24's rule
/// against "one giant static image with invisible buttons" - these are real
/// widgets over a slot whose geometry is known, not the reverse.
library;

import 'dart:math' as math;
import 'dart:ui' as ui show Gradient;
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
    final double corner = body.shortestSide * 0.3;
    final RRect rounded = RRect.fromRectAndRadius(
      body,
      Radius.circular(corner),
    );

    // Ground shadow, offset down-right - the same cheap depth cue the
    // reference tyre uses instead of an SVG drop-shadow filter.
    final Paint shadow = Paint()..color = const Color(0x33020617);
    canvas.drawOval(
      Rect.fromCenter(
        center: body.center.translate(body.width * 0.03, body.height * 0.05),
        width: body.width + 3,
        height: body.height + 2.4,
      ),
      shadow,
    );

    // Rubber body - dark, with a slight top-left sheen so it reads as
    // moulded rubber rather than a flat fill.
    final Paint rubber = Paint()
      ..shader = ui.Gradient.radial(
        body.topLeft.translate(body.width * 0.33, body.height * 0.24),
        body.longestSide * 0.82,
        const <Color>[Color(0xFF454545), Color(0xFF161616), Color(0xFF050505)],
        const <double>[0, 0.5, 1],
      );
    canvas.drawRRect(rounded, rubber);
    canvas.drawRRect(
      rounded,
      Paint()
        ..color = Colors.black
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.7,
    );

    // Directional tread - seven rows, each a split pair of blocks, matching
    // the reference tyre's own row spacing.
    final Paint tread = Paint()..color = Colors.black.withValues(alpha: 0.55);
    for (int i = 0; i < 7; i++) {
      final double rowY = body.top + body.height * (0.08 + i * 0.128);
      final double blockW = (body.width - 2) * 0.44;
      final double blockH = body.height * 0.07;
      final double blockRadius = math.min(0.8, blockH / 2);
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(body.left + 1, rowY, blockW, blockH),
          Radius.circular(blockRadius),
        ),
        tread,
      );
      canvas.drawRRect(
        RRect.fromRectAndRadius(
          Rect.fromLTWH(
            body.left + 1 + (body.width - 2) * 0.52,
            rowY,
            blockW,
            blockH,
          ),
          Radius.circular(blockRadius),
        ),
        tread,
      );
    }

    // Sidewall ring + a faint top highlight.
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        body.deflate(0.7),
        Radius.circular(corner * 0.9),
      ),
      Paint()
        ..color = const Color(0xFF5B6470).withValues(alpha: 0.55)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.6,
    );
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromLTWH(
          body.left + 1,
          body.top + 1,
          body.width - 2,
          body.height * 0.3,
        ),
        Radius.circular(corner * 0.8),
      ),
      Paint()..color = Colors.white.withValues(alpha: 0.09),
    );

    // Rim disc - status-coloured, its own tri-tone radial gradient.
    final Offset centre = body.center;
    final double rimRx = body.width * 0.37;
    final double rimRy = body.height * 0.35;
    final Rect rimRect = Rect.fromCenter(
      center: centre,
      width: rimRx * 2,
      height: rimRy * 2,
    );
    final Color rimDark = _darkOf(colors.base);
    canvas.drawOval(
      rimRect,
      Paint()
        ..shader = ui.Gradient.radial(
          centre.translate(-rimRx * 0.17, -rimRy * 0.24),
          math.max(rimRx, rimRy) * 1.05,
          <Color>[_glowOf(colors.base), colors.base, rimDark],
          const <double>[0, 0.55, 1],
        ),
    );
    canvas.drawOval(
      rimRect,
      Paint()
        ..color = rimDark
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.7,
    );
    canvas.drawOval(
      rimRect,
      Paint()
        ..color = Colors.black.withValues(alpha: 0.3)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.4,
    );

    // Lug-nut ring - eight bolts around the hub, matching the reference's
    // own w*0.2/h*0.19 placement radius.
    final Paint lug = Paint()..color = rimDark.withValues(alpha: 0.9);
    for (int k = 0; k < 8; k++) {
      final double angle = k * math.pi / 4;
      final Offset lugCentre = Offset(
        centre.dx + math.cos(angle) * body.width * 0.2,
        centre.dy + math.sin(angle) * body.height * 0.19,
      );
      canvas.drawCircle(
        lugCentre,
        math.max(0.7, body.width * 0.035),
        lug,
      );
    }

    // Hub cap - a gradient disc with a small shine highlight.
    final double hubRx = body.width * 0.13;
    final double hubRy = body.height * 0.13;
    final Rect hubRect = Rect.fromCenter(
      center: centre,
      width: hubRx * 2,
      height: hubRy * 2,
    );
    canvas.drawOval(
      hubRect,
      Paint()
        ..shader = ui.Gradient.radial(
          centre.translate(-hubRx * 0.36, -hubRy * 0.36),
          math.max(hubRx, hubRy) * 1.3,
          const <Color>[
            Color(0xFFEEF2F6),
            Color(0xFF94A3B8),
            Color(0xFF28313D),
          ],
          const <double>[0, 0.6, 1],
        ),
    );
    canvas.drawOval(
      hubRect,
      Paint()
        ..color = const Color(0xFF1F2937)
        ..style = PaintingStyle.stroke
        ..strokeWidth = 0.4,
    );
    canvas.drawOval(
      Rect.fromCenter(
        center: centre.translate(-hubRx * 0.35, -hubRy * 0.35),
        width: hubRx * 0.9,
        height: hubRy * 0.9,
      ),
      Paint()..color = const Color(0xFFF8FAFC).withValues(alpha: 0.85),
    );

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

  /// A lighter variant of [base], used as the rim gradient's highlight
  /// stop - the reference tyre's own `col.glow`, derived here via HSL
  /// rather than declared as a fourth colour on [TpStatusColors].
  static Color _glowOf(Color base) {
    final HSLColor hsl = HSLColor.fromColor(base);
    return hsl
        .withLightness((hsl.lightness + 0.2).clamp(0.0, 1.0))
        .withSaturation((hsl.saturation + 0.1).clamp(0.0, 1.0))
        .toColor();
  }

  /// A darker variant of [base], used for the rim's stroke and the lug
  /// nuts - the reference tyre's own `col.dark`.
  static Color _darkOf(Color base) {
    final HSLColor hsl = HSLColor.fromColor(base);
    return hsl.withLightness((hsl.lightness - 0.28).clamp(0.0, 1.0)).toColor();
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
