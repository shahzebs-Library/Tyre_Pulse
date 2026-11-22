/// The physical inventory screens' own light identity (owner mockup,
/// 2026-11-22): the same safety-yellow accent as the night-shift theme, on
/// white / light grey surfaces with dark ink.
///
/// Scoped with a local [Theme] around the physical inventory screen only;
/// the rest of the app keeps [TpPalette.light] (fleet green). The dark theme
/// is unchanged: [TpPalette.dark] already carries the same yellow.
///
/// Rule held here: yellow is only ever a FILL behind dark ink
/// ([TpPalette.onPrimary]), never text or a thin line on white. Where an
/// accent foreground is needed on a light surface the widgets use
/// [inventoryAccentInk].
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/app/theme/tp_theme.dart';

/// Safety yellow, identical to [TpPalette.dark] `primary`.
const Color inventoryYellow = Color(0xFFFFD400);

/// Dark ink that sits on [inventoryYellow] (14:1).
const Color inventoryOnYellow = Color(0xFF181200);

/// The light palette for the physical inventory screens.
const TpPalette inventoryLightPalette = TpPalette(
  brightness: Brightness.light,
  background: Color(0xFFF4F5F7),
  surface: Color(0xFFFFFFFF),
  surfaceAlt: Color(0xFFF7F8FA),
  surfaceSunken: Color(0xFFECEEF1),
  text: Color(0xFF111827),
  textSecondary: Color(0xFF374151),
  textMuted: Color(0xFF4B5563),
  textInverse: Color(0xFFFFFFFF),
  primary: inventoryYellow,
  primaryDark: Color(0xFFEAB308),
  primarySoft: Color(0xFFFFF7CC),
  onPrimary: inventoryOnYellow,
  border: Color(0xFFE5E7EB),
  borderStrong: Color(0xFFD1D5DB),
  controlBorder: Color(0xFF6B7280),
  // A focus ring must reach 3:1 on white, which yellow cannot (1.4:1).
  focus: Color(0xFF8A6100),
  overlay: Color(0x80080E18),
  ok: TpStatusColors(
    base: Color(0xFF15803D),
    soft: Color(0xFFDCFCE7),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF0F5C2E),
  ),
  warning: TpStatusColors(
    base: Color(0xFFB45309),
    soft: Color(0xFFFEF3C7),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF8A3D07),
  ),
  critical: TpStatusColors(
    base: Color(0xFFB91C1C),
    soft: Color(0xFFFEE2E2),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF7F1D1D),
  ),
  info: TpStatusColors(
    base: Color(0xFF0369A1),
    soft: Color(0xFFE0F2FE),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF075985),
  ),
  neutral: TpStatusColors(
    base: Color(0xFF475569),
    soft: Color(0xFFEDF2F8),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF33415A),
  ),
  unknown: TpStatusColors(
    base: Color(0xFF7C3AED),
    soft: Color(0xFFF3EEFE),
    onBase: Color(0xFFFFFFFF),
    onSoft: Color(0xFF5B21B6),
  ),
);

/// The scoped theme for the ambient brightness.
///
/// On light, Material's own `colorScheme.primary` (text buttons, selected list
/// tiles, focus underlines, the text cursor, expansion tiles) is set to dark
/// ink instead of yellow, so no stock Material widget draws yellow text or a
/// yellow hairline on white. The design-system widgets still read the yellow
/// from [TpPalette] and use it only as a fill.
ThemeData inventoryThemeFor(Brightness brightness) {
  if (brightness == Brightness.dark) return TpTheme.forPalette(TpPalette.dark);
  final ThemeData base = TpTheme.forPalette(inventoryLightPalette);
  return base.copyWith(
    colorScheme: base.colorScheme.copyWith(
      primary: inventoryLightPalette.text,
      onPrimary: inventoryYellow,
    ),
  );
}

/// An accent-coloured foreground (icon, outline that carries meaning) that
/// stays legible: yellow on the dark theme, dark ink on the light theme.
Color inventoryAccentInk(TpPalette p) =>
    p.brightness == Brightness.dark ? p.primary : p.onPrimary;

/// WCAG relative-luminance contrast ratio between two opaque colours.
double contrastRatio(Color a, Color b) {
  final double la = a.computeLuminance();
  final double lb = b.computeLuminance();
  final double hi = la > lb ? la : lb;
  final double lo = la > lb ? lb : la;
  return (hi + 0.05) / (lo + 0.05);
}
