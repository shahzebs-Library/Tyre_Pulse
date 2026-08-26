/// The card surface.
///
/// Spec section 53: elevation is expressed with a HAIRLINE BORDER and only a
/// faint shadow, because a shadow is invisible in direct sunlight. A card that
/// relies on shadow alone stops reading as a card the moment somebody walks
/// outside, which is where this application is used.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_spacing.dart';

/// A bordered surface.
class TpCard extends StatelessWidget {
  const TpCard({
    required this.child,
    this.onTap,
    this.padding = const EdgeInsets.all(TpSpace.lg),
    this.margin = EdgeInsets.zero,
    this.borderColor,
    this.background,
    this.isDashed = false,
    super.key,
  });

  final Widget child;

  /// When set, the whole card becomes one large touch target.
  final VoidCallback? onTap;

  final EdgeInsets padding;
  final EdgeInsets margin;

  /// Overrides the hairline. Used to carry a status without filling the card.
  final Color? borderColor;

  final Color? background;

  /// Draws the border as a dashed outline.
  ///
  /// Reserved for content that is NOT MEASURED. Spec section 32: a value that
  /// was never taken must not look like a value that came back clean, and
  /// colour alone is not enough for somebody who cannot distinguish it.
  final bool isDashed;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final BorderRadius radius = BorderRadius.circular(TpRadius.lg);

    final Widget surface = DecoratedBox(
      decoration: BoxDecoration(
        color: background ?? palette.surface,
        borderRadius: radius,
        border: Border.all(
          color: borderColor ?? palette.border,
          width: TpBorderWidth.hairline,
        ),
      ),
      child: Padding(padding: padding, child: child),
    );

    final Widget body = isDashed
        ? CustomPaint(
            painter: _DashedBorderPainter(
              color: borderColor ?? palette.unknown.base,
              radius: TpRadius.lg,
            ),
            child: Padding(padding: padding, child: child),
          )
        : surface;

    if (onTap == null) {
      return Padding(padding: margin, child: body);
    }

    return Padding(
      padding: margin,
      child: Material(
        color: Colors.transparent,
        borderRadius: radius,
        child: InkWell(
          onTap: onTap,
          borderRadius: radius,
          child: body,
        ),
      ),
    );
  }
}

/// Draws a dashed rounded rectangle.
///
/// Deliberately a painter rather than a package: spec section 64 says not to
/// add a dependency to shorten a few lines.
class _DashedBorderPainter extends CustomPainter {
  const _DashedBorderPainter({required this.color, required this.radius});

  final Color color;
  final double radius;

  @override
  void paint(Canvas canvas, Size size) {
    final Paint paint = Paint()
      ..color = color
      ..style = PaintingStyle.stroke
      ..strokeWidth = TpBorderWidth.hairline;

    final RRect rect = RRect.fromRectAndRadius(
      Offset.zero & size,
      Radius.circular(radius),
    );

    final Path path = Path()..addRRect(rect);
    const double dash = 6;
    const double gap = 4;

    for (final PathMetric metric in path.computeMetrics()) {
      double distance = 0;
      while (distance < metric.length) {
        final double end =
            distance + dash > metric.length ? metric.length : distance + dash;
        canvas.drawPath(metric.extractPath(distance, end), paint);
        distance = end + gap;
      }
    }
  }

  @override
  bool shouldRepaint(_DashedBorderPainter oldDelegate) =>
      oldDelegate.color != color || oldDelegate.radius != radius;
}
