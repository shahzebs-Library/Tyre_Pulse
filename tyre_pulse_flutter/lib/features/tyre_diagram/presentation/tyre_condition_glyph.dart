/// The ONE picture for a tyre condition, drawn from the shared tyre map.
///
/// Each condition has its own fixed colour ([tyreConditionColor]) and a
/// fixed glyph (`conditions.kinds[].glyph` in
/// `docs/document-specs/tyre-layouts.json`, generated into
/// `tyre_layout_spec.g.dart`): a tick for Good, a tread wearing down for
/// Worn, a nail in the tyre for Puncture, a squashed tyre on the ground for
/// Flat, a warning triangle for Damaged, a minus for Missing and a question
/// mark for Not checked. The web screen and the printed report draw the same
/// lines, so a tyre man who cannot read the word sees the same picture on
/// the phone, the screen and the paper. Colour is never the only signal:
/// the glyph and a short word always travel with it.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_condition.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_layout_spec.g.dart';

typedef _Glyph = (
  List<List<double>> strokes,
  List<List<double>> closed,
  List<List<double>> circles,
  List<List<double>> dots,
);

final Map<String, _Glyph> _glyphs = <String, _Glyph>{
  for (final (
        String kind,
        String _,
        String _,
        String _,
        List<List<double>> strokes,
        List<List<double>> closed,
        List<List<double>> circles,
        List<List<double>> dots,
      ) in kTyreSpecConditionKinds)
    kind: (strokes, closed, circles, dots),
};

/// Draws the glyph for [kind] into [rect] (a square works best) in [color].
/// [strokeWidth] is in the glyph's own 24-unit grid.
void paintTyreConditionGlyph(
  Canvas canvas,
  Rect rect,
  String kind,
  Color color, {
  double strokeWidth = 2.4,
}) {
  final _Glyph? glyph = _glyphs[kind] ?? _glyphs['none'];
  if (glyph == null) return;
  final double scale = rect.shortestSide / 24;
  final Offset origin = Offset(
    rect.left + (rect.width - 24 * scale) / 2,
    rect.top + (rect.height - 24 * scale) / 2,
  );
  Offset at(double x, double y) => origin + Offset(x * scale, y * scale);
  final Paint stroke = Paint()
    ..color = color
    ..style = PaintingStyle.stroke
    ..strokeWidth = strokeWidth * scale
    ..strokeCap = StrokeCap.round
    ..strokeJoin = StrokeJoin.round;
  final Paint fill = Paint()
    ..color = color
    ..style = PaintingStyle.fill;

  Path poly(List<double> p, {required bool close}) {
    final Path path = Path();
    for (int i = 0; i + 1 < p.length; i += 2) {
      final Offset o = at(p[i], p[i + 1]);
      if (i == 0) {
        path.moveTo(o.dx, o.dy);
      } else {
        path.lineTo(o.dx, o.dy);
      }
    }
    if (close) path.close();
    return path;
  }

  for (final List<double> p in glyph.$2) {
    canvas.drawPath(poly(p, close: true), stroke);
  }
  for (final List<double> p in glyph.$1) {
    canvas.drawPath(poly(p, close: false), stroke);
  }
  for (final List<double> c in glyph.$3) {
    canvas.drawCircle(at(c[0], c[1]), c[2] * scale, stroke);
  }
  for (final List<double> c in glyph.$4) {
    canvas.drawCircle(at(c[0], c[1]), c[2] * scale, fill);
  }
}

/// The colour band [condition] draws in (`null` is Not checked, grey).
TpStatus tyreConditionTone(TyreCondition? condition) =>
    condition == null ? TpStatus.unknown : tyreConditionStatus(condition);

/// The ONE mapping from a condition to its own colour (owner, 2026-11-27):
/// Damaged red, Worn amber, Puncture deep orange, Flat magenta, Missing
/// grey, Good green; `null` (Not checked) the quiet slate. The severity
/// band ([tyreConditionTone]) still decides how urgent a wheel is; this
/// decides the badge, legend dot and picker tint, so three different
/// critical faults no longer look the same.
TpConditionColor tyreConditionColor(TyreCondition? condition) =>
    switch (condition) {
      TyreCondition.good => TpConditionColors.good,
      TyreCondition.worn => TpConditionColors.worn,
      TyreCondition.damaged => TpConditionColors.damaged,
      TyreCondition.puncture => TpConditionColors.puncture,
      TyreCondition.flat => TpConditionColors.flat,
      TyreCondition.missing => TpConditionColors.missing,
      null => TpConditionColors.notChecked,
    };

/// The fill behind a condition's white glyph (badges, legend, the selected
/// tick): the condition's own deep colour in both themes, so white ink on it
/// keeps at least 4.5:1 contrast.
Color tyreConditionSelectedFill(TyreCondition? condition) =>
    tyreConditionColor(condition).fill;

/// The outline / tint colour of [condition] in [brightness].
Color tyreConditionAccent(TyreCondition? condition, Brightness brightness) =>
    tyreConditionColor(condition).accent(brightness);

/// The glyph for [condition] as a widget, in [color] or the band colour of
/// the current theme.
class TyreConditionGlyph extends StatelessWidget {
  const TyreConditionGlyph({
    required this.condition,
    this.size = 24,
    this.color,
    this.strokeWidth = 2.4,
    super.key,
  });

  /// `null` draws the Not checked question mark.
  final TyreCondition? condition;
  final double size;
  final Color? color;
  final double strokeWidth;

  @override
  Widget build(BuildContext context) {
    final Color ink =
        color ?? tyreConditionAccent(condition, Theme.of(context).brightness);
    return ExcludeSemantics(
      child: SizedBox.square(
        dimension: size,
        child: CustomPaint(
          painter: _GlyphPainter(
            kind: tyreConditionKindKey(condition),
            color: ink,
            strokeWidth: strokeWidth,
          ),
        ),
      ),
    );
  }
}

class _GlyphPainter extends CustomPainter {
  const _GlyphPainter({
    required this.kind,
    required this.color,
    required this.strokeWidth,
  });

  final String kind;
  final Color color;
  final double strokeWidth;

  @override
  void paint(Canvas canvas, Size size) => paintTyreConditionGlyph(
        canvas,
        Offset.zero & size,
        kind,
        color,
        strokeWidth: strokeWidth,
      );

  @override
  bool shouldRepaint(_GlyphPainter old) =>
      old.kind != kind || old.color != color || old.strokeWidth != strokeWidth;
}
