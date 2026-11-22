/// Elevation and motion tokens (Porcelain).
///
/// Owner decision 5 (2026-11-22): one soft shadow level is allowed, and only
/// for the single primary action and floating surfaces (bottom sheet,
/// floating navigation). Everything else stays flat with a hairline border,
/// because a shadow does not read in direct sun (spec section 53).
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';

/// The three elevation levels. Most surfaces are [flat].
abstract final class TpElevation {
  /// No shadow. Cards, rows, chips: a hairline border carries the edge.
  static const List<BoxShadow> flat = <BoxShadow>[];

  /// The primary action. A tinted glow under the button, light mode only;
  /// in dark mode shadows are invisible, so this returns [flat].
  static List<BoxShadow> lift(TpPalette palette) {
    if (palette.brightness == Brightness.dark) return flat;
    return <BoxShadow>[
      BoxShadow(
        color: palette.brandInk.withValues(alpha: 0.08),
        blurRadius: 2,
        offset: const Offset(0, 1),
      ),
      BoxShadow(
        color: palette.brandAccent.withValues(alpha: 0.45),
        blurRadius: 24,
        spreadRadius: -8,
        offset: const Offset(0, 10),
      ),
    ];
  }

  /// Floating surfaces: bottom sheets and the floating navigation bar.
  static List<BoxShadow> overlay(TpPalette palette) {
    return <BoxShadow>[
      BoxShadow(
        color: palette.brandInk.withValues(
          alpha: palette.brightness == Brightness.dark ? 0.5 : 0.18,
        ),
        blurRadius: 32,
        spreadRadius: -12,
        offset: const Offset(0, -12),
      ),
    ];
  }
}

/// Motion durations and curves. Everything resolves to zero when the system
/// "reduce motion" setting is on (see [TpMotion.resolve]).
abstract final class TpMotion {
  /// Press feedback, chip select, toggles.
  static const Duration fast = Duration(milliseconds: 120);

  /// Expand and collapse, tab change.
  static const Duration base = Duration(milliseconds: 200);

  /// Sheet and dialog enter and exit.
  static const Duration slow = Duration(milliseconds: 300);

  /// Progress rings and gauges filling on first show.
  static const Duration reveal = Duration(milliseconds: 600);

  static const Curve standard = Curves.easeOutCubic;
  static const Curve emphasized = Curves.easeInOutCubic;

  /// Scale applied to a pressed primary button.
  static const double pressScale = 0.97;

  /// [duration], or zero when the user asked the system to reduce motion.
  static Duration resolve(BuildContext context, Duration duration) {
    final bool reduce = MediaQuery.maybeDisableAnimationsOf(context) ?? false;
    return reduce ? Duration.zero : duration;
  }
}
