/// The type scale.
///
/// Spec section 53: readable in direct sunlight, at arm's length, by somebody
/// who is standing next to a running machine. That is why the scale runs one
/// step larger and one weight heavier than a typical application, and why the
/// muted greys are used sparingly - glare washes out mid greys first.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';

/// Builds the Material text theme from a palette.
///
/// Only the Material 3 slot names are used, so a widget that takes a
/// `TextStyle` from `Theme.of(context).textTheme` gets these values without
/// knowing this file exists.
abstract final class TpTypography {
  static TextTheme textThemeFor(TpPalette palette) {
    final Color ink = palette.text;
    final Color inkSecondary = palette.textSecondary;

    return TextTheme(
      displaySmall: TextStyle(
        fontSize: 32,
        height: 38 / 32,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.5,
        color: ink,
      ),
      headlineMedium: TextStyle(
        fontSize: 26,
        height: 32 / 26,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.3,
        color: ink,
      ),
      headlineSmall: TextStyle(
        fontSize: 21,
        height: 27 / 21,
        fontWeight: FontWeight.w800,
        letterSpacing: -0.2,
        color: ink,
      ),
      titleLarge: TextStyle(
        fontSize: 18,
        height: 24 / 18,
        fontWeight: FontWeight.w700,
        color: ink,
      ),
      titleMedium: TextStyle(
        fontSize: 16,
        height: 22 / 16,
        fontWeight: FontWeight.w700,
        color: ink,
      ),
      bodyLarge: TextStyle(
        fontSize: 15,
        height: 22 / 15,
        fontWeight: FontWeight.w500,
        color: ink,
      ),
      bodyMedium: TextStyle(
        fontSize: 15,
        height: 22 / 15,
        fontWeight: FontWeight.w500,
        color: inkSecondary,
      ),
      labelLarge: TextStyle(
        fontSize: 15,
        height: 20 / 15,
        fontWeight: FontWeight.w700,
        color: ink,
      ),
      labelMedium: TextStyle(
        fontSize: 13,
        height: 17 / 13,
        fontWeight: FontWeight.w700,
        letterSpacing: 0.2,
        color: inkSecondary,
      ),
      labelSmall: TextStyle(
        fontSize: 12,
        height: 16 / 12,
        fontWeight: FontWeight.w600,
        letterSpacing: 0.2,
        color: palette.textMuted,
      ),
    );
  }

  /// The style used for a technical identifier - a tyre position, an asset
  /// number, a serial. Monospaced digits keep a column of codes aligned, and
  /// these strings are also wrapped in an LTR isolate before they are drawn.
  /// See `TpDirection` in the localisation layer and spec section 52.
  static TextStyle identifier(TpPalette palette) {
    return TextStyle(
      fontSize: 14,
      height: 18 / 14,
      fontWeight: FontWeight.w700,
      letterSpacing: 0.4,
      fontFeatures: const <FontFeature>[FontFeature.tabularFigures()],
      color: palette.text,
    );
  }
}
