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

/// The owner-approved "Tyre Pulse signature icons".
///
/// Fifteen glyphs, nothing else. They are drawn on a 24x24 grid with a 1.9
/// stroke, round caps and joins, no fill, and are tinted with one colour so
/// they follow the palette in light and dark. Path data is copied verbatim
/// from the approved artifact; do not redraw or add glyphs here.
///
/// ## Consistency rule (one place, so every screen agrees)
///
/// * **Gem tile** ([TpGem], see [TpGemSpec]): feature, action and summary
///   tiles on Home. One glyph on a coloured gradient tile; the colour carries
///   the meaning (see [TpGemTone]).
/// * **Plain stroked glyph** ([TpAssetIcon] / [TpIcon]): bottom navigation,
///   list rows, headers and inline icons. Same paths, `currentColor`.
/// * **Vehicle class**: mixers (TM, tri-mixer, transit mixer) draw
///   [TpAssetIconKind.mixer]; concrete and line pumps (MP) draw
///   [TpAssetIconKind.pump]; tyre records and serials draw
///   [TpAssetIconKind.tyre]; tyre pressure draws [TpAssetIconKind.gauge].
///   Classes the family has no glyph for (loader, trailer, bus, pickup,
///   generator, chiller, plant, truck 6x4, tanker, canter) keep their
///   Material outlined icon.
/// * Generic actions (back, search, add, close, chevrons, edit, delete, share,
///   filter) stay Material.
enum TpAssetIconKind {
  tyre,
  mixer,
  pump,
  scan,
  inspection,
  approve,
  accident,
  wash,
  sync,
  issue,
  gauge,
  more,
  home,
  user,
  bell,
}

/// Placeholder for the stroke width, filled in per size so large icons do not
/// turn chunky: the stroke is 1.9 on the 24 grid and never exceeds about 3
/// logical pixels on screen.
const String _sw = '@SW@';

const String _open =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" '
    'fill="none" stroke="#000" stroke-width="$_sw" '
    'stroke-linecap="round" stroke-linejoin="round">';
const String _close = '</svg>';

String _svg(String body) => '$_open$body$_close';

String _sourceFor(TpAssetIconKind kind, double size) {
  final double width = math.min(1.9, 3 * 24 / size);
  return _sources[kind]!.replaceFirst(_sw, width.toStringAsFixed(2));
}

// Path data copied exactly from the approved signature-icons artifact. The
// small `fill="#fff"` hub / pivot dots render in the tint colour.
final Map<TpAssetIconKind, String> _sources = <TpAssetIconKind, String>{
  TpAssetIconKind.tyre: _svg(
    '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4.6"/>'
    '<path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6'
    'M16.8 16.8l1.6 1.6M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6"/>'
    '<circle cx="12" cy="12" r="1.3" fill="#fff"/>',
  ),
  TpAssetIconKind.mixer: _svg(
    '<path d="M2.5 16.5V11h4l2-3h3v8.5"/>'
    '<path d="M11.5 15.5l9-2.2-1.4-6.3a3 3 0 0 0-3.5-2.3l-3.2.7a3 3 0 0 0'
    '-2.3 3.5z"/>'
    '<path d="M13.6 7.6l4.6 5.4"/><circle cx="6" cy="17.5" r="1.8"/>'
    '<circle cx="16" cy="17.5" r="1.8"/><path d="M2.5 17.5h1.7M8 17.5h6.2"/>',
  ),
  TpAssetIconKind.pump: _svg(
    '<path d="M2.5 17V12h4l1.6-2.5h2.4V17"/><path d="M10.5 17h11v-3.5h-11"/>'
    '<path d="M12 13.5l4-6 5.5 1.5M16 7.5l2-3"/>'
    '<circle cx="6" cy="18" r="1.6"/><circle cx="14.5" cy="18" r="1.6"/>'
    '<circle cx="19" cy="18" r="1.6"/>',
  ),
  TpAssetIconKind.scan: _svg(
    '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1'
    '-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>'
    '<rect x="8" y="8" width="3" height="3" rx=".6"/>'
    '<rect x="13" y="8" width="3" height="3" rx=".6"/>'
    '<rect x="8" y="13" width="3" height="3" rx=".6"/>'
    '<path d="M13 13h3v3"/>',
  ),
  TpAssetIconKind.inspection: _svg(
    '<rect x="5" y="4" width="14" height="17" rx="3"/>'
    '<path d="M9 4V3h6v1"/><path d="M8.5 11l1.6 1.6 3-3M8.5 16.5h7"/>',
  ),
  TpAssetIconKind.approve: _svg(
    '<path d="M12 2.8l2.3 1.7 2.9-.1.9 2.7 2.3 1.7-.9 2.7.9 2.7-2.3 1.7-.9 '
    '2.7-2.9-.1L12 21.2l-2.3-1.7-2.9.1-.9-2.7L3.6 15.2l.9-2.7-.9-2.7 2.3-1.7'
    '.9-2.7 2.9.1z"/><path d="M8.5 12.2l2.3 2.3 4.7-4.7"/>',
  ),
  TpAssetIconKind.accident: _svg(
    '<path d="M7 17v-5a5 5 0 0 1 10 0v5"/><path d="M5 17h14v3H5z"/>'
    '<path d="M12 3v2M4.2 6.2l1.4 1.4M19.8 6.2l-1.4 1.4M2 12h2M20 12h2"/>'
    '<path d="M10 13.5a2 2 0 0 1 2-2"/>',
  ),
  TpAssetIconKind.wash: _svg(
    '<path d="M3.5 15V12l2.5-3.5h8l3 3.5h3.5V15"/>'
    '<circle cx="7.5" cy="16.5" r="1.7"/><circle cx="16.5" cy="16.5" r="1.7"/>'
    '<path d="M8 3.5c0 1.5-1.5 2-1.5 3.2a1.5 1.5 0 0 0 3 0C9.5 5.5 8 5 8 3.5z'
    'M14.5 2.5c0 1.5-1.5 2-1.5 3.2a1.5 1.5 0 0 0 3 0c0-1.2-1.5-1.7-1.5-3.2z"/>',
  ),
  TpAssetIconKind.sync: _svg(
    '<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/>'
    '<path d="M17.5 3.5v3.4h-3.4M6.5 20.5v-3.4h3.4"/>',
  ),
  TpAssetIconKind.issue: _svg(
    '<path d="M5 21V4"/>'
    '<path d="M5 4.5c4-2 6 2 10 0s4 0 4 0v9s-1-2-4 0-6-2-10 0"/>',
  ),
  TpAssetIconKind.gauge: _svg(
    '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4.2-5.4"/>'
    '<circle cx="12" cy="17" r="1.4" fill="#fff"/>'
    '<path d="M6.5 13.5l1.2.7M12 9v1.4M17.5 13.5l-1.2.7"/>',
  ),
  TpAssetIconKind.more: _svg(
    '<rect x="4" y="4" width="7" height="7" rx="2"/>'
    '<rect x="13" y="4" width="7" height="7" rx="2"/>'
    '<rect x="4" y="13" width="7" height="7" rx="2"/>'
    '<rect x="13" y="13" width="7" height="7" rx="2"/>',
  ),
  TpAssetIconKind.home: _svg(
    '<path d="M3.5 10.5L12 4l8.5 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-4v-6h-6v6H5A1.5'
    ' 1.5 0 0 1 3.5 19z"/>',
  ),
  TpAssetIconKind.user: _svg(
    '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  ),
  TpAssetIconKind.bell: _svg(
    '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5h4"/>',
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

/// The Material icons that stand for one of the fifteen signature concepts.
///
/// Used by [TpIcon] so a screen that passes an `IconData` (a tab, a list row,
/// a generic tile) gets the signature glyph without per-screen glue.
/// Deliberately narrow: warning, speed (odometer), done-all (acknowledge),
/// report-problem (tyre damage) and every generic action are NOT mapped.
final Map<IconData, TpAssetIconKind> _materialToGlyph =
    <IconData, TpAssetIconKind>{
  Icons.notifications: TpAssetIconKind.bell,
  Icons.notifications_none: TpAssetIconKind.bell,
  Icons.notifications_none_rounded: TpAssetIconKind.bell,
  Icons.notifications_active_outlined: TpAssetIconKind.bell,
  Icons.notifications_outlined: TpAssetIconKind.bell,
  Icons.home: TpAssetIconKind.home,
  Icons.home_outlined: TpAssetIconKind.home,
  Icons.home_rounded: TpAssetIconKind.home,
  Icons.person: TpAssetIconKind.user,
  Icons.person_outline: TpAssetIconKind.user,
  Icons.person_outline_rounded: TpAssetIconKind.user,
  Icons.person_rounded: TpAssetIconKind.user,
  Icons.qr_code_scanner: TpAssetIconKind.scan,
  Icons.qr_code_scanner_rounded: TpAssetIconKind.scan,
  Icons.assignment: TpAssetIconKind.inspection,
  Icons.assignment_outlined: TpAssetIconKind.inspection,
  Icons.checklist: TpAssetIconKind.inspection,
  Icons.checklist_outlined: TpAssetIconKind.inspection,
  Icons.checklist_rounded: TpAssetIconKind.inspection,
  Icons.checklist_rtl_outlined: TpAssetIconKind.inspection,
  Icons.fact_check_outlined: TpAssetIconKind.inspection,
  Icons.fact_check: TpAssetIconKind.inspection,
  Icons.done_all: TpAssetIconKind.approve,
  Icons.how_to_reg_outlined: TpAssetIconKind.approve,
  Icons.assignment_turned_in_outlined: TpAssetIconKind.approve,
  Icons.car_crash_outlined: TpAssetIconKind.accident,
  Icons.car_crash: TpAssetIconKind.accident,
  Icons.local_car_wash: TpAssetIconKind.wash,
  Icons.local_car_wash_rounded: TpAssetIconKind.wash,
  Icons.local_car_wash_outlined: TpAssetIconKind.wash,
  Icons.sync: TpAssetIconKind.sync,
  Icons.sync_rounded: TpAssetIconKind.sync,
  Icons.report_gmailerrorred_rounded: TpAssetIconKind.issue,
  Icons.tire_repair_outlined: TpAssetIconKind.tyre,
  Icons.tire_repair_rounded: TpAssetIconKind.tyre,
};

/// The signature glyph for a Material [icon], or null when it has none.
TpAssetIconKind? tpGlyphForMaterial(IconData icon) => _materialToGlyph[icon];

/// Drop-in for [Icon]: draws the signature glyph when [icon] stands for one of
/// the fifteen concepts, otherwise the Material icon unchanged.
class TpIcon extends StatelessWidget {
  const TpIcon(
    this.icon, {
    this.size,
    this.color,
    this.semanticLabel,
    this.textDirection,
    super.key,
  });

  final IconData? icon;
  final double? size;
  final Color? color;
  final String? semanticLabel;
  final TextDirection? textDirection;

  @override
  Widget build(BuildContext context) {
    final IconData? data = icon;
    final TpAssetIconKind? kind =
        data == null ? null : tpGlyphForMaterial(data);
    if (kind == null) {
      return Icon(
        icon,
        size: size,
        color: color,
        semanticLabel: semanticLabel,
        textDirection: textDirection,
      );
    }
    final double resolved = size ?? IconTheme.of(context).size ?? 24;
    return TpAssetIcon(
      kind,
      size: resolved,
      color: color,
      semanticLabel: semanticLabel,
    );
  }
}

/// Meaning colours for [TpGem]. The colour is the message: blue for
/// inspections and scanning, green for fleet / mixer / sync, red for tyre
/// problems and accidents ONLY, amber for approvals / issues / pump, teal for
/// washing, slate for "more", violet for pressure, graphite for tyres.
///
/// Gradient starts for green, teal and amber are slightly darker than the
/// artifact so the white glyph clears 3:1 where it sits on the tile.
enum TpGemTone {
  blue(Color(0xFF4F8BFF), Color(0xFF1D4ED8)),
  green(Color(0xFF21BA6C), Color(0xFF077A43)),
  red(Color(0xFFFF6B5B), Color(0xFFB42318)),
  amber(Color(0xFFE08C2A), Color(0xFFC2560A)),
  teal(Color(0xFF2CB2D8), Color(0xFF0369A1)),
  slate(Color(0xFF8A9AA8), Color(0xFF3F4E5B)),
  violet(Color(0xFF9B8CFF), Color(0xFF5B3FD1)),
  tyre(Color(0xFF5B6470), Color(0xFF15191E));

  const TpGemTone(this.start, this.end);

  final Color start;
  final Color end;
}

/// The one table that says which glyph and colour each Home feature, action
/// and summary tile uses.
enum TpGemSpec {
  inspectionsDue(TpAssetIconKind.inspection, TpGemTone.blue),
  pendingSync(TpAssetIconKind.sync, TpGemTone.green),
  tyresNeedAttention(TpAssetIconKind.tyre, TpGemTone.red),
  approvals(TpAssetIconKind.approve, TpGemTone.amber),
  scan(TpAssetIconKind.scan, TpGemTone.blue),
  washing(TpAssetIconKind.wash, TpGemTone.teal),
  asset(TpAssetIconKind.mixer, TpGemTone.green),
  reportIssue(TpAssetIconKind.issue, TpGemTone.amber),
  reportAccident(TpAssetIconKind.accident, TpGemTone.red),
  more(TpAssetIconKind.more, TpGemTone.slate),
  pump(TpAssetIconKind.pump, TpGemTone.amber),
  pressure(TpAssetIconKind.gauge, TpGemTone.violet),
  tyre(TpAssetIconKind.tyre, TpGemTone.tyre);

  const TpGemSpec(this.glyph, this.tone);

  final TpAssetIconKind glyph;
  final TpGemTone tone;
}

/// Gem sizes in logical pixels.
abstract final class TpGemSize {
  static const double md = 48;
  static const double lg = 64;
}

/// The gem tile: a rounded square on a [TpGemTone] gradient with a glossy top
/// half, a soft tinted shadow and a white glyph at 58% of the tile.
///
/// Static: no animation, so there is nothing to switch off for reduce-motion.
/// The tile is at least 48dp, so it already meets the touch-target minimum
/// when its owner makes it tappable. Decorative by default; pass
/// [semanticLabel] when the gem stands alone without a visible label.
class TpGem extends StatelessWidget {
  const TpGem(
    this.glyph, {
    required this.tone,
    this.size = TpGemSize.md,
    this.semanticLabel,
    super.key,
  });

  /// A gem from the shared [TpGemSpec] table.
  TpGem.spec(
    TpGemSpec spec, {
    TpGemTone? tone,
    double size = TpGemSize.md,
    String? semanticLabel,
    Key? key,
  }) : this(
          spec.glyph,
          tone: tone ?? spec.tone,
          size: size,
          semanticLabel: semanticLabel,
          key: key,
        );

  final TpAssetIconKind glyph;
  final TpGemTone tone;
  final double size;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final double radius = size * 0.31;
    final BorderRadius corners = BorderRadius.circular(radius);
    return Semantics(
      label: semanticLabel,
      image: semanticLabel != null,
      excludeSemantics: true,
      child: SizedBox(
        width: size,
        height: size,
        child: DecoratedBox(
          decoration: BoxDecoration(
            borderRadius: corners,
            gradient: LinearGradient(
              begin: const Alignment(-0.42, -0.91),
              end: const Alignment(0.42, 0.91),
              colors: <Color>[tone.start, tone.end],
            ),
            boxShadow: <BoxShadow>[
              BoxShadow(
                color: tone.end.withValues(alpha: 0.34),
                blurRadius: size * 0.28,
                offset: Offset(0, size * 0.1),
              ),
            ],
          ),
          child: ClipRRect(
            borderRadius: corners,
            child: Stack(
              alignment: Alignment.center,
              children: <Widget>[
                Positioned(
                  left: 0,
                  right: 0,
                  top: 0,
                  height: size * 0.5,
                  child: const DecoratedBox(
                    decoration: BoxDecoration(
                      gradient: LinearGradient(
                        begin: Alignment.topCenter,
                        end: Alignment.bottomCenter,
                        colors: <Color>[Color(0x52FFFFFF), Color(0x00FFFFFF)],
                      ),
                    ),
                  ),
                ),
                Positioned(
                  left: size * 0.14,
                  right: size * 0.14,
                  top: 0,
                  height: 1.5,
                  child: const DecoratedBox(
                    decoration: BoxDecoration(color: Color(0x73FFFFFF)),
                  ),
                ),
                TpAssetIcon(
                  glyph,
                  size: size * 0.58,
                  color: Colors.white,
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
