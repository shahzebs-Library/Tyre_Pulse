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
/// Visual direction "Porcelain" (owner pick, 2026-11-22): warm porcelain
/// surfaces, navy ink, brand green for action and good state, in both
/// brightnesses. See docs/flutter-redesign/02_design_tokens.md.
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

  /// Saved on this phone and waiting to sync. Deliberately NOT [warning]:
  /// nothing is wrong with the record, it simply has not reached the server
  /// yet. Owner decision 4 (Porcelain, 2026-11-22).
  pending,
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
    required this.controlBorder,
    required this.focus,
    required this.overlay,
    required this.brandInk,
    required this.brandAccent,
    required this.ok,
    required this.warning,
    required this.critical,
    required this.info,
    required this.neutral,
    required this.unknown,
    required this.pending,
  });

  /// Light is the primary theme. Spec section 53.
  ///
  /// "Porcelain" (owner pick, 2026-11-22): warm porcelain paper, deep navy
  /// ink, and brand green only where it means something. Every text pair here
  /// is at least 4.5:1; [controlBorder] is at least 3:1 on every surface.
  static const TpPalette light = TpPalette(
    brightness: Brightness.light,
    background: Color(0xFFF3F1EC),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF8F7F3),
    surfaceSunken: Color(0xFFECE9E2),
    text: Color(0xFF0C1626),
    textSecondary: Color(0xFF3D4757),
    textMuted: Color(0xFF5E6675),
    textInverse: Color(0xFFFFFFFF),
    primary: Color(0xFF12873F),
    primaryDark: Color(0xFF0B6B32),
    primarySoft: Color(0xFFE2F3E7),
    onPrimary: Color(0xFFFFFFFF),
    border: Color(0xFFE3DFD6),
    borderStrong: Color(0xFFCFCAC0),
    controlBorder: Color(0xFF737985),
    focus: Color(0xFF12873F),
    overlay: Color(0x7A0C1626),
    brandInk: Color(0xFF0C1626),
    brandAccent: Color(0xFF16A34A),
    ok: TpStatusColors(
      base: Color(0xFF15803D),
      soft: Color(0xFFE2F3E7),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF0B6B32),
    ),
    warning: TpStatusColors(
      base: Color(0xFF9A4A06),
      soft: Color(0xFFFCEFD9),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF7A3A05),
    ),
    critical: TpStatusColors(
      base: Color(0xFFB42318),
      soft: Color(0xFFFDE6E2),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF8A1A12),
    ),
    info: TpStatusColors(
      base: Color(0xFF0369A1),
      soft: Color(0xFFE0F2FE),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF075985),
    ),
    neutral: TpStatusColors(
      base: Color(0xFF475569),
      soft: Color(0xFFECE9E2),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF3D4757),
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
    pending: TpStatusColors(
      base: Color(0xFF2F4F7F),
      soft: Color(0xFFE5ECF6),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF24406B),
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
    background: Color(0xFFFFFFFF),
    surface: Color(0xFFFFFFFF),
    surfaceAlt: Color(0xFFF6F7F9),
    surfaceSunken: Color(0xFFEFF3F7),
    text: Color(0xFF041742),
    textSecondary: Color(0xFF33415A),
    textMuted: Color(0xFF637094),
    textInverse: Color(0xFFFFFFFF),
    primary: Color(0xFF007333),
    primaryDark: Color(0xFF006E30),
    primarySoft: Color(0xFFE5FAED),
    onPrimary: Color(0xFFFFFFFF),
    border: Color(0xFFD1D9E8),
    borderStrong: Color(0xFFB8C4D7),
    controlBorder: Color(0xFF75849F),
    focus: Color(0xFF007333),
    overlay: Color(0x80080E18),
    brandInk: Color(0xFF041742),
    brandAccent: Color(0xFF16A34A),
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
    pending: TpStatusColors(
      base: Color(0xFF2F4F7F),
      soft: Color(0xFFE5ECF6),
      onBase: Color(0xFFFFFFFF),
      onSoft: Color(0xFF24406B),
    ),
  );

  /// Dark is secondary: night shifts and indoor management. It is not tuned
  /// for sunlight and must never become the default.
  ///
  /// Porcelain at night: the same navy family deepened, and brand green (not
  /// yellow) as the action colour so both brightnesses read as one product.
  static const TpPalette dark = TpPalette(
    brightness: Brightness.dark,
    background: Color(0xFF0B111B),
    surface: Color(0xFF121A27),
    surfaceAlt: Color(0xFF182233),
    surfaceSunken: Color(0xFF0E1520),
    text: Color(0xFFF1F4F8),
    textSecondary: Color(0xFFC3CCDA),
    textMuted: Color(0xFF93A0B4),
    textInverse: Color(0xFF0B111B),
    primary: Color(0xFF4ADE80),
    primaryDark: Color(0xFF86EFAC),
    primarySoft: Color(0xFF143022),
    onPrimary: Color(0xFF04210F),
    border: Color(0xFF243044),
    borderStrong: Color(0xFF334156),
    controlBorder: Color(0xFF6B7A8C),
    focus: Color(0xFF4ADE80),
    overlay: Color(0xB302060E),
    brandInk: Color(0xFF070C14),
    brandAccent: Color(0xFF4ADE80),
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
    pending: TpStatusColors(
      base: Color(0xFF7FA7E0),
      soft: Color(0xFF1A2740),
      onBase: Color(0xFF08111F),
      onSoft: Color(0xFFB5CCEF),
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

  /// The identifying outline of an INTERACTIVE control: a search field, a
  /// text input, a dropdown, a segmented control.
  ///
  /// WCAG 2.2 1.4.11 Non-text Contrast asks 3:1 for the boundary that tells a
  /// reader "this is a field". [border] (1.28:1 on white) and [borderStrong]
  /// (1.64:1) are for cards and dividers, which are not controls, and stay
  /// quiet on purpose. This token is at least 3:1 on every surface a control
  /// sits on in its own brightness: light 3.8:1 on surface, 3.3:1 on
  /// surfaceSunken; dark 4.2:1 on surface, 3.9:1 on surfaceAlt.
  final Color controlBorder;

  final Color focus;

  /// Modal scrim.
  final Color overlay;

  /// The navy brand ink: hero cards, the floating navigation bar and the
  /// strongest headers. Owner decision 1 (Porcelain): navy is a named role.
  final Color brandInk;

  /// The bright brand green, for decoration that carries no text: progress
  /// rings, status dots, the scan button glow. NEVER put text on it in light
  /// mode (white on it is 3.3:1); text-bearing fills use [primary].
  final Color brandAccent;

  final TpStatusColors ok;
  final TpStatusColors warning;
  final TpStatusColors critical;
  final TpStatusColors info;
  final TpStatusColors neutral;
  final TpStatusColors unknown;
  final TpStatusColors pending;

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
      TpStatus.pending => pending,
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
