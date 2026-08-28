/// The single place semantic colour is decided.
///
/// Spec section 53: the field application is tuned for direct sunlight. Bright
/// near-white surfaces, near-black text, saturated status colours and hairline
/// borders rather than soft shadows, because a shadow does not read outdoors.
///
/// Spec section 32 is why [TpStatus.unknown] exists as its own value rather
/// than being folded into [TpStatus.neutral]: a measurement that was never
/// taken must not look like a measurement that came back clean. `0` and `-`
/// are different claims and they get different colours.
///
/// The neutral/status scale remains aligned with the production field app.
/// The interaction accents match the approved mobile mock family: indigo on
/// the daylight surfaces and safety yellow on the night-shift surfaces.
library;

import 'package:flutter/material.dart';

/// The status vocabulary. Every status colour in the application resolves
/// through this enum; no feature picks a hex value of its own.
enum TpStatus {
  /// Measured and within tolerance.
  ok,

  /// Measured and outside tolerance, but not stopping work.
  warning,

  /// Measured and stopping work. The strongest signal available.
  critical,

  /// Neutral information that is not a judgement.
  info,

  /// A value with no judgement attached at all.
  neutral,

  /// NOT measured. Deliberately distinct from [neutral]: neutral means "we
  /// looked and there is nothing to flag", unknown means "we never looked".
  unknown,
}

/// A status rendered three ways: a strong fill, a tinted background, and the
/// ink that stays legible on each.
@immutable
class TpStatusColors {
  const TpStatusColors({
    required this.base,
    required this.soft,
    required this.onBase,
    required this.onSoft,
  });

  /// Strong fill. Badges, bars, icons drawn on a light surface.
  final Color base;

  /// Tinted background for soft chips and banners.
  final Color soft;

  /// Ink that sits legibly on [base].
  final Color onBase;

  /// Ink that sits legibly on [soft].
  final Color onSoft;
}

/// The full token set for one brightness.
@immutable
class TpPalette {
  const TpPalette({
    required this.brightness,
    required this.background,
    required this.surface,
    required this.surfaceAlt,
    required this.surfaceSunken,
    required this.text,
    required this.textSecondary,
    required this.textMuted,
    required this.textInverse,
    required this.primary,
    required this.primaryDark,
    required this.primarySoft,
    required this.onPrimary,
    required this.border,
    required this.borderStrong,
    required this.focus,
    required this.overlay,
    required this.ok,
    required this.warning,
    required this.critical,
    required this.info,
    required this.neutral,
    required this.unknown,
  });

  /// Light is the primary theme. Spec section 53.
  static const TpPalette light = TpPalette(
    brightness: Brightness.light,
    background: Color(0xFFF7F8FC),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF3F4F8),
    surfaceSunken: Color(0xFFE9ECF3),
    text: Color(0xFF0A1120),
    textSecondary: Color(0xFF334155),
    textMuted: Color(0xFF647389),
    textInverse: Color(0xFFFFFFFF),
    primary: Color(0xFF4338CA),
    primaryDark: Color(0xFF312E81),
    primarySoft: Color(0xFFEEF2FF),
    onPrimary: Color(0xFFFFFFFF),
    border: Color(0xFFE2E5EC),
    borderStrong: Color(0xFFCBD1DC),
    focus: Color(0xFF4338CA),
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
    // Deliberately a different hue family from neutral, and paired with a
    // dashed border wherever it is drawn, so "not measured" cannot be mistaken
    // for "measured and unremarkable".
    unknown: TpStatusColors(
      base: Color(0xFF7C3AED),
      soft: Color(0xFFF3EEFE),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF5B21B6),
    ),
  );

  /// The established three-country login identity.
  ///
  /// The signed-out country artwork and its accessibility-backed golden
  /// contract predate the operational mock family. Keeping this palette
  /// explicit lets the authenticated app use the approved indigo/yellow
  /// system without silently recolouring the already-approved login flow.
  static const TpPalette loginLight = TpPalette(
    brightness: Brightness.light,
    background: Color(0xFFF5F8FC),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFEDF2F8),
    surfaceSunken: Color(0xFFE3E9F1),
    text: Color(0xFF0A1120),
    textSecondary: Color(0xFF334155),
    textMuted: Color(0xFF647389),
    textInverse: Color(0xFFFFFFFF),
    primary: Color(0xFF15803D),
    primaryDark: Color(0xFF166534),
    primarySoft: Color(0xFFDCFCE7),
    onPrimary: Color(0xFFFFFFFF),
    border: Color(0xFFDFE6EF),
    borderStrong: Color(0xFFC3CDDB),
    focus: Color(0xFF15803D),
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

  /// Dark is secondary: night shifts and indoor management. It is not tuned
  /// for sunlight and must never become the default.
  static const TpPalette dark = TpPalette(
    brightness: Brightness.dark,
    background: Color(0xFF080C10),
    surface: Color(0xFF11161B),
    surfaceAlt: Color(0xFF171D23),
    surfaceSunken: Color(0xFF0C1116),
    text: Color(0xFFF1F5F9),
    textSecondary: Color(0xFFC3CEDE),
    textMuted: Color(0xFF8CA0B8),
    textInverse: Color(0xFF080C10),
    primary: Color(0xFFFFD400),
    primaryDark: Color(0xFFEAB308),
    primarySoft: Color(0xFF332A00),
    onPrimary: Color(0xFF181200),
    border: Color(0xFF252C33),
    borderStrong: Color(0xFF39424C),
    focus: Color(0xFFFFD400),
    overlay: Color(0xB302060E),
    ok: TpStatusColors(
      base: Color(0xFF22C55E),
      soft: Color(0xFF14301F),
      onBase: Color(0xFF04140A),
      onSoft: Color(0xFF86EFAC),
    ),
    warning: TpStatusColors(
      base: Color(0xFFF59E0B),
      soft: Color(0xFF33260B),
      onBase: Color(0xFF1A1200),
      onSoft: Color(0xFFFCD34D),
    ),
    critical: TpStatusColors(
      base: Color(0xFFF87171),
      soft: Color(0xFF3A1717),
      onBase: Color(0xFF200606),
      onSoft: Color(0xFFFCA5A5),
    ),
    info: TpStatusColors(
      base: Color(0xFF38BDF8),
      soft: Color(0xFF10293A),
      onBase: Color(0xFF04121C),
      onSoft: Color(0xFF7DD3FC),
    ),
    neutral: TpStatusColors(
      base: Color(0xFF94A3B8),
      soft: Color(0xFF1E293B),
      onBase: Color(0xFF0B1220),
      onSoft: Color(0xFFCBD5E1),
    ),
    unknown: TpStatusColors(
      base: Color(0xFFA78BFA),
      soft: Color(0xFF241A3D),
      onBase: Color(0xFF150A2B),
      onSoft: Color(0xFFC4B5FD),
    ),
  );

  final Brightness brightness;

  final Color background;
  final Color surface;
  final Color surfaceAlt;
  final Color surfaceSunken;

  final Color text;
  final Color textSecondary;
  final Color textMuted;
  final Color textInverse;

  final Color primary;
  final Color primaryDark;
  final Color primarySoft;
  final Color onPrimary;

  final Color border;
  final Color borderStrong;

  final Color focus;

  /// Modal scrim.
  final Color overlay;

  final TpStatusColors ok;
  final TpStatusColors warning;
  final TpStatusColors critical;
  final TpStatusColors info;
  final TpStatusColors neutral;
  final TpStatusColors unknown;

  /// The palette for the ambient theme.
  ///
  /// Deliberately resolved from [Brightness] rather than through a
  /// `ThemeExtension`. Two palettes, chosen by brightness, cannot get out of
  /// step with the `ThemeData` they were registered against.
  static TpPalette of(BuildContext context) {
    final ThemeData theme = Theme.of(context);
    final TpPaletteTheme? override = theme.extension<TpPaletteTheme>();
    if (override != null) return override.palette;
    return theme.brightness == Brightness.dark ? dark : light;
  }

  /// The colours for one status. This is the only mapping; a feature that
  /// needs a status colour asks for it here.
  TpStatusColors forStatus(TpStatus status) {
    return switch (status) {
      TpStatus.ok => ok,
      TpStatus.warning => warning,
      TpStatus.critical => critical,
      TpStatus.info => info,
      TpStatus.neutral => neutral,
      TpStatus.unknown => unknown,
    };
  }
}

/// Carries the exact [TpPalette] used to build a local [Theme].
///
/// Most of the app resolves by brightness. A small number of approved visual
/// identities (currently the country-aware login) intentionally use a local
/// palette with the same brightness, so brightness alone cannot distinguish
/// them.
@immutable
final class TpPaletteTheme extends ThemeExtension<TpPaletteTheme> {
  const TpPaletteTheme(this.palette);

  final TpPalette palette;

  @override
  TpPaletteTheme copyWith({TpPalette? palette}) =>
      TpPaletteTheme(palette ?? this.palette);

  @override
  TpPaletteTheme lerp(covariant TpPaletteTheme? other, double t) =>
      t < 0.5 || other == null ? this : other;
}
