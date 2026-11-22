import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

/// Icon sizes in logical pixels. One scale for every icon in the app so rows,
/// chips and cards line up. Mirrors `TpSizing.iconSm/iconMd/iconLg`.
abstract final class TpIconSize {
  static const double sm = 16;
  static const double md = 20;
  static const double lg = 24;
  static const double xl = 32;
}

/// Domain icons that Material does not ship: concrete mixers, boom pumps,
/// loaders, trailers, tyres and a tyre-pressure gauge.
///
/// They are drawn on a 24x24 grid with a 1.75 stroke, round caps and joins,
/// matching the Material Symbols Rounded outline weight, and are tinted with a
/// single colour so they follow the palette in light and dark.
enum TpAssetIconKind { mixer, pump, loader, trailer, tyre, gauge, bus, pickup }

/// Placeholder for the stroke width, filled in per size so large icons do not
/// turn chunky: the stroke is 1.75 on the 24 grid and never exceeds about 3
/// logical pixels on screen.
const String _sw = '@SW@';

const String _open =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
    'fill="none" stroke="#000" stroke-width="$_sw" '
    'stroke-linecap="round" stroke-linejoin="round">';
const String _close = '</svg>';

String _svg(String body) => '$_open$body$_close';

String _sourceFor(TpAssetIconKind kind, double size) {
  final double width = math.min(1.75, 3 * 24 / size);
  return _sources[kind]!.replaceFirst(_sw, width.toStringAsFixed(2));
}

final Map<TpAssetIconKind, String> _sources = <TpAssetIconKind, String>{
  // Drum on a chassis, cab at the right.
  TpAssetIconKind.mixer: _svg(
    '<path d="M3.2 16v-5.4c0-2 1.5-3.6 3.4-3.6L13 9.3V16"/>'
    '<path d="M7.4 7.2 6.6 16M10.4 8.3 9.9 16"/>'
    '<path d="M15 16V9.5h3.4l3.1 3.8V16"/>'
    '<path d="M15 12.5h5.4"/>'
    '<path d="M3 16h18.5"/>'
    '<circle cx="6.5" cy="18" r="1.8"/>'
    '<circle cx="17.5" cy="18" r="1.8"/>',
  ),
  // Truck with a folded placing boom on the back.
  TpAssetIconKind.pump: _svg(
    '<path d="M4 15 7 9l5.5 2L14.5 5.5"/>'
    '<path d="M3 15h3.5"/>'
    '<path d="M16 16V10h3l2.5 3.3V16"/>'
    '<path d="M3 16h18.5"/>'
    '<circle cx="6.5" cy="18" r="1.8"/>'
    '<circle cx="17.5" cy="18" r="1.8"/>',
  ),
  // Wheel loader: cab, boom arm and bucket.
  TpAssetIconKind.loader: _svg(
    '<path d="M3.5 14.5v-4h10v4"/>'
    '<path d="M6 10.5V6.5h4.4l1.6 4"/>'
    '<path d="m13.5 11.5 4.5-3.2"/>'
    '<path d="M17 6.8h4l-.9 5H16.2z"/>'
    '<circle cx="6.5" cy="17.5" r="2.5"/>'
    '<circle cx="14" cy="17.5" r="2.5"/>',
  ),
  // Box trailer with landing gear and a tandem axle.
  TpAssetIconKind.trailer: _svg(
    '<path d="M2.5 7h13v9h-13z"/>'
    '<path d="M15.5 14h6"/>'
    '<path d="M19 14v3M17.5 17h3"/>'
    '<circle cx="6" cy="18" r="1.8"/>'
    '<circle cx="11" cy="18" r="1.8"/>',
  ),
  // Tyre seen from the side: tread blocks, rim and hub.
  TpAssetIconKind.tyre: _svg(
    '<circle cx="12" cy="12" r="9.25"/>'
    '<circle cx="12" cy="12" r="4.75"/>'
    '<circle cx="12" cy="12" r="1.25"/>'
    '<path d="M12 2.75v2M17.13 6.87l1.41-1.41M19.25 12h2'
    'M17.13 17.13l1.41 1.41M12 19.25v2M6.87 17.13l-1.41 1.41'
    'M4.75 12h-2M6.87 6.87 5.46 5.46"/>',
  ),
  // Tyre-pressure gauge: dial, needle and valve nozzle.
  TpAssetIconKind.gauge: _svg(
    '<circle cx="12" cy="11" r="8"/>'
    '<path d="m12 11 3.5-3.5"/>'
    '<path d="M12 4.2v1.6M5.6 7.9l1.4.8M18.4 7.9 17 8.7"/>'
    '<path d="M10 19v2.5h4V19"/>',
  ),
  TpAssetIconKind.bus: _svg(
    '<path d="M4.5 5.5h13c2 0 3.5 1.2 3.5 3.5v7H2.5V7.5a2 2 0 0 1 2-2z"/>'
    '<path d="M2.5 11.5h18.5M8 5.5v6M13.5 5.5v6"/>'
    '<circle cx="6.5" cy="18" r="1.8"/>'
    '<circle cx="17.5" cy="18" r="1.8"/>',
  ),
  TpAssetIconKind.pickup: _svg(
    '<path d="M2.5 11.5h8V16"/>'
    '<path d="M10.5 16V8.5h4.2l3 3.5 2.8.8V16"/>'
    '<path d="M13 10.3v2.2h3.6l-1.7-2.2z"/>'
    '<path d="M2.5 16h19"/>'
    '<circle cx="6" cy="18" r="1.8"/>'
    '<circle cx="17.5" cy="18" r="1.8"/>',
  ),
};

/// Draws one [TpAssetIconKind] at [size], tinted with [color] (default: the
/// ambient [IconTheme] colour, like a Material [Icon]).
///
/// Pass [semanticLabel] (from l10n) when the icon carries meaning on its own;
/// leave it null when a visible label sits beside it and the icon is
/// decorative.
class TpAssetIcon extends StatelessWidget {
  const TpAssetIcon(
    this.kind, {
    this.size = TpIconSize.lg,
    this.color,
    this.semanticLabel,
    super.key,
  });

  final TpAssetIconKind kind;
  final double size;
  final Color? color;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final Color tint = color ?? IconTheme.of(context).color ?? Colors.black;
    return SvgPicture.string(
      _sourceFor(kind, size),
      width: size,
      height: size,
      colorFilter: ColorFilter.mode(tint, BlendMode.srcIn),
      semanticsLabel: semanticLabel,
      excludeFromSemantics: semanticLabel == null,
    );
  }
}
