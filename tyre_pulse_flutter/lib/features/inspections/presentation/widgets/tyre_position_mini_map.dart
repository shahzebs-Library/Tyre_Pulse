/// A small top-down axle map for the tyre editor header: the vehicle's real
/// wheel slots (from the shared `kTyreDiagramLayouts`, so it can never show
/// an axle the full diagram does not), with the wheel being edited filled.
///
/// Deliberately its own tiny painter rather than a scaled-down
/// `VehicleTyreDiagram`: that widget brings a card, a legend and a
/// repeating highlight animation that make no sense at 56 px wide.
library;

import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_diagram_layouts.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';

class TyrePositionMiniMap extends StatelessWidget {
  const TyrePositionMiniMap({
    required this.vehicleType,
    required this.position,
    required this.semanticLabel,
    this.assetNo,
    this.width = 56,
    this.maxHeight = 112,
    super.key,
  });

  final String vehicleType;
  final String? assetNo;

  /// The slot id (or a stored code the shared map places) to highlight.
  final String position;
  final String semanticLabel;
  final double width;
  final double maxHeight;

  @override
  Widget build(BuildContext context) {
    final String key = resolveVehicleType(vehicleType, assetNo);
    final DiagramLayout? layout = kTyreDiagramLayouts[key];
    if (layout == null || layout.tyres.isEmpty) return const SizedBox.shrink();
    final String? selected = layout.tyres.any((t) => t.id == position)
        ? position
        : slotForStoredPosition(layout.key, position);

    final Rect bounds = _bounds(layout.tyres);
    final double aspect = bounds.height / bounds.width;
    double w = width;
    double h = w * aspect;
    if (h > maxHeight) {
      h = maxHeight;
      w = h / aspect;
    }
    final TpPalette palette = TpPalette.of(context);
    return Semantics(
      label: semanticLabel,
      image: true,
      excludeSemantics: true,
      child: SizedBox(
        width: w,
        height: h,
        child: CustomPaint(
          painter: _MiniMapPainter(
            slots: layout.tyres,
            bounds: bounds,
            selectedId: selected,
            wheel: palette.borderStrong,
            body: palette.border,
            highlight: palette.primary,
            ring: palette.text,
          ),
        ),
      ),
    );
  }

  static Rect _bounds(List<TyreSlot> slots) {
    double l = double.infinity, t = double.infinity;
    double r = -double.infinity, b = -double.infinity;
    for (final TyreSlot s in slots) {
      l = math.min(l, s.x);
      t = math.min(t, s.y);
      r = math.max(r, s.x + s.w);
      b = math.max(b, s.y + s.h);
    }
    // A margin so the selection ring is never clipped.
    const double pad = 8;
    return Rect.fromLTRB(l - pad, t - pad, r + pad, b + pad);
  }
}

class _MiniMapPainter extends CustomPainter {
  _MiniMapPainter({
    required this.slots,
    required this.bounds,
    required this.selectedId,
    required this.wheel,
    required this.body,
    required this.highlight,
    required this.ring,
  });

  final List<TyreSlot> slots;
  final Rect bounds;
  final String? selectedId;
  final Color wheel;
  final Color body;
  final Color highlight;
  final Color ring;

  @override
  void paint(Canvas canvas, Size size) {
    final double sx = size.width / bounds.width;
    final double sy = size.height / bounds.height;
    Rect map(TyreSlot s) => Rect.fromLTWH(
          (s.x - bounds.left) * sx,
          (s.y - bounds.top) * sy,
          s.w * sx,
          s.h * sy,
        );

    // Chassis: a rounded spine between the outermost wheel rows.
    final double cx = size.width / 2;
    final Paint bodyPaint = Paint()..color = body;
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        Rect.fromCenter(
          center: Offset(cx, size.height / 2),
          width: size.width * 0.28,
          height: size.height * 0.92,
        ),
        const Radius.circular(4),
      ),
      bodyPaint,
    );
    // Axles: one bar per distinct wheel row.
    final Set<double> rows = <double>{};
    for (final TyreSlot s in slots) {
      rows.add(((s.y + s.h / 2) - bounds.top) * sy);
    }
    final Paint axle = Paint()
      ..color = body
      ..strokeWidth = math.max(1.5, size.width * 0.04);
    for (final double y in rows) {
      canvas.drawLine(
        Offset(size.width * 0.12, y),
        Offset(size.width * 0.88, y),
        axle,
      );
    }
    for (final TyreSlot s in slots) {
      final Rect r = map(s);
      final bool isSelected = s.id == selectedId;
      final RRect rr = RRect.fromRectAndRadius(r, const Radius.circular(2));
      canvas.drawRRect(rr, Paint()..color = isSelected ? highlight : wheel);
      if (isSelected) {
        canvas.drawRRect(
          rr.inflate(2),
          Paint()
            ..color = ring
            ..style = PaintingStyle.stroke
            ..strokeWidth = 1.5,
        );
      }
    }
  }

  @override
  bool shouldRepaint(_MiniMapPainter old) =>
      old.selectedId != selectedId ||
      old.slots != slots ||
      old.wheel != wheel ||
      old.highlight != highlight;
}
