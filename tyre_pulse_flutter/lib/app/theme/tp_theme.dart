/// The application themes.
///
/// Spec section 53: light is primary and is tuned for direct sunlight; dark is
/// optional and exists for night shifts and indoor management.
///
/// WHY THIS FILE SETS SO LITTLE ON [ThemeData]:
///
/// Only `colorScheme`, `textTheme`, `scaffoldBackgroundColor`, `brightness`,
/// `visualDensity` and `dividerColor` are configured here. The component sub
/// themes (cards, dialogs, inputs, app bars) are deliberately NOT set. Two
/// reasons, and the second is the load-bearing one:
///
/// 1. The design system widgets in `lib/core/design_system/` own their own
///    appearance. A component theme would be a second place that decides how a
///    card looks, and the two would drift.
/// 2. Flutter has been renaming those sub theme classes across releases
///    (`CardTheme` to `CardThemeData` and so on). Every one of those set here
///    is a field that can stop compiling on a Flutter upgrade for no product
///    reason. The design system is the stable surface; keep it that way.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_typography.dart';

/// Builds [ThemeData] from a [TpPalette].
abstract final class TpTheme {
  /// The light theme. This is the product default.
  static ThemeData get light => _themeFor(TpPalette.light);

  /// The dark theme. Optional, and never the default: it is not readable in
  /// the sun and most of this application is used outdoors.
  static ThemeData get dark => _themeFor(TpPalette.dark);

  /// Builds a scoped theme for an approved feature palette.
  static ThemeData forPalette(TpPalette palette) => _themeFor(palette);

  static ThemeData _themeFor(TpPalette palette) {
    final ColorScheme scheme = ColorScheme.fromSeed(
      seedColor: palette.primary,
      brightness: palette.brightness,
    ).copyWith(
      primary: palette.primary,
      onPrimary: palette.onPrimary,
      surface: palette.surface,
      onSurface: palette.text,
      error: palette.critical.base,
      onError: palette.critical.onBase,
      outline: palette.borderStrong,
      outlineVariant: palette.border,
      scrim: palette.overlay,
    );

    return ThemeData(
      useMaterial3: true,
      brightness: palette.brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: palette.background,
      dividerColor: palette.border,
      textTheme: TpTypography.textThemeFor(palette),
      // Standard rather than compact. Density is achieved through the spacing
      // scale; shrinking Material's own hit boxes would take touch targets
      // below the 48dp minimum that spec section 53 asks for.
      visualDensity: VisualDensity.standard,
      // Spec section 55: avoid unnecessary animation on low-memory phones.
      splashFactory: NoSplash.splashFactory,
      extensions: <ThemeExtension<dynamic>>[
        TpPaletteTheme(palette),
      ],
    );
  }
}
