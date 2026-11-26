/// The colours a wheel on the tyre map is drawn in.
///
/// The strong colour of each band comes from the shared tyre map
/// (`docs/document-specs/tyre-layouts.json`, one palette with light and dark
/// values), the same hex the web screen and the printed PDF use, so a wheel
/// is the same green / amber / red / grey on every surface. The soft tints
/// and text colours still come from the app theme.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';

String _bandOf(TpStatus status) => switch (status) {
      TpStatus.ok => 'good',
      TpStatus.warning => 'warning',
      TpStatus.critical => 'critical',
      TpStatus.unknown || TpStatus.info || TpStatus.neutral => 'none',
    };

/// The spec's strong colour for [status] in [brightness].
Color tyreRiskBaseColor(TpStatus status, Brightness brightness) {
  final Map<String, int> p =
      kTyreSpecPalette[brightness == Brightness.dark ? 'dark' : 'light'] ??
          kTyreSpecPalette['light']!;
  return Color(p[_bandOf(status)] ?? p['none']!);
}

/// Full colour set for one wheel: the spec's strong colour, the theme's
/// soft tint and text. "No data" is a quiet grey, never the purple
/// [TpPalette.unknown] family, so a 14-wheel pump with few readings does
/// not drown the one red wheel that needs attention.
TpStatusColors tyreRiskColors(TpPalette palette, TpStatus status) {
  final Color base = tyreRiskBaseColor(status, palette.brightness);
  final String band = _bandOf(status);
  if (band == 'none') {
    return TpStatusColors(
      base: base,
      soft: palette.surfaceAlt,
      onBase: palette.textInverse,
      onSoft: palette.textSecondary,
    );
  }
  final TpStatusColors theme = palette.forStatus(status);
  return TpStatusColors(
    base: base,
    soft: theme.soft,
    onBase: theme.onBase,
    onSoft: theme.onSoft,
  );
}
