/// A tappable damage map rendered over truthful fleet-class artwork.
///
/// The selected fleet asset drives the image through the shared vehicle
/// photo resolver used by Assets and Work Orders. Unknown classes do not
/// borrow a different vehicle: they receive a neutral fleet icon. The only
/// custom painting here is the interaction overlay (zone boundaries and
/// saved markers), never a fabricated vehicle silhouette.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/theme/tp_colors.dart';
import 'package:tyre_pulse/features/accidents/domain/accident_damage_map.dart';
import 'package:tyre_pulse/features/assets/domain/vehicle_asset.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicle_photo_resolver.dart';

class VehicleDamageDiagram extends StatelessWidget {
  const VehicleDamageDiagram({
    required this.view,
    required this.map,
    required this.onPointTap,
    this.vehicle,
    super.key,
  });

  final AccidentDamageView view;
  final AccidentDamageMap map;
  final ValueChanged<AccidentDamagePoint> onPointTap;
  final VehicleAsset? vehicle;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? multiViewAsset =
        vehicle == null ? null : vehicleMultiViewAsset(vehicle!);
    final String? fallbackAsset =
        vehicle == null ? null : vehiclePhotoAsset(vehicle!);

    return AspectRatio(
      aspectRatio: multiViewAsset == null
          ? (view == AccidentDamageView.top ||
                  view == AccidentDamageView.left ||
                  view == AccidentDamageView.right
              ? 16 / 9
              : 5 / 4)
          : _exactViewAspectRatio(multiViewAsset, view),
      child: LayoutBuilder(
        builder: (BuildContext context, BoxConstraints constraints) {
          return DecoratedBox(
            decoration: BoxDecoration(
              color: palette.surfaceAlt,
              border: Border.all(color: palette.border),
              borderRadius: BorderRadius.circular(16),
            ),
            child: ClipRRect(
              borderRadius: BorderRadius.circular(15),
              child: GestureDetector(
                behavior: HitTestBehavior.opaque,
                onTapUp: (TapUpDetails details) {
                  final double dx =
                      (details.localPosition.dx / constraints.maxWidth)
                          .clamp(0.0, 1.0);
                  final double dy =
                      (details.localPosition.dy / constraints.maxHeight)
                          .clamp(0.0, 1.0);
                  onPointTap(
                    AccidentDamagePoint(
                      view: view,
                      normalizedX: dx,
                      normalizedY: dy,
                    ),
                  );
                },
                child: Stack(
                  fit: StackFit.expand,
                  children: <Widget>[
                    _VehicleArtwork(
                      vehicle: vehicle,
                      view: view,
                      multiViewAsset: multiViewAsset,
                      fallbackAsset: fallbackAsset,
                    ),
                    CustomPaint(
                      painter: _DamageZoneOverlayPainter(
                        view: view,
                        map: map,
                        palette: palette,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

/// Saved damage pins remain precise enough to expose the underlying asset.
@visibleForTesting
const double accidentDamageMarkerRadius = 12;

double _exactViewAspectRatio(
  String boardAssetPath,
  AccidentDamageView view,
) =>
    1;

class _VehicleArtwork extends StatelessWidget {
  const _VehicleArtwork({
    required this.vehicle,
    required this.view,
    required this.multiViewAsset,
    required this.fallbackAsset,
  });

  final VehicleAsset? vehicle;
  final AccidentDamageView view;
  final String? multiViewAsset;
  final String? fallbackAsset;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    if (vehicle != null && multiViewAsset != null) {
      return _ExactVehicleView(
        boardAssetPath: multiViewAsset!,
        view: view,
        fallbackIcon: vehicleFallbackIcon(vehicle!),
      );
    }
    if (vehicle != null && fallbackAsset != null) {
      return Padding(
        padding: const EdgeInsets.all(12),
        child: Image.asset(
          fallbackAsset!,
          key: const Key('accident.damage.vehicle-artwork'),
          fit: BoxFit.contain,
          filterQuality: FilterQuality.high,
          errorBuilder: (_, __, ___) => _FallbackArtwork(
            icon: vehicleFallbackIcon(vehicle!),
          ),
        ),
      );
    }
    return _FallbackArtwork(
      icon: vehicle == null
          ? Icons.touch_app_outlined
          : vehicleFallbackIcon(vehicle!),
      color: palette.textMuted,
    );
  }
}

/// Loads the exact pre-sliced image for one vehicle side. These are build-time
/// assets, not a runtime crop of the composite board, so every selectable view
/// has its own image bounds and its own normalized marker surface.
class _ExactVehicleView extends StatelessWidget {
  const _ExactVehicleView({
    required this.boardAssetPath,
    required this.view,
    required this.fallbackIcon,
  });

  final String boardAssetPath;
  final AccidentDamageView view;
  final IconData fallbackIcon;

  @override
  Widget build(BuildContext context) {
    final String stem = boardAssetPath
        .replaceFirst('assets/vehicle_multiview/', '')
        .replaceFirst(RegExp(r'\.png$'), '');
    final String exactAsset =
        'assets/vehicle_multiview_views/${stem}_${view.name}.png';
    return Padding(
      padding: const EdgeInsets.all(2),
      child: Image.asset(
        exactAsset,
        key: Key('accident.damage.multiview.${view.name}'),
        fit: BoxFit.contain,
        filterQuality: FilterQuality.high,
        errorBuilder: (_, __, ___) => _FallbackArtwork(icon: fallbackIcon),
      ),
    );
  }
}

class _FallbackArtwork extends StatelessWidget {
  const _FallbackArtwork({required this.icon, this.color});

  final IconData icon;
  final Color? color;

  @override
  Widget build(BuildContext context) => Center(
        child: Icon(
          icon,
          key: const Key('accident.damage.vehicle-fallback'),
          size: 72,
          color: color ?? TpPalette.of(context).textMuted,
        ),
      );
}

class _DamageZoneOverlayPainter extends CustomPainter {
  const _DamageZoneOverlayPainter({
    required this.view,
    required this.map,
    required this.palette,
  });

  final AccidentDamageView view;
  final AccidentDamageMap map;
  final TpPalette palette;

  @override
  void paint(Canvas canvas, Size size) {
    for (int index = 0; index < map.marks.length; index++) {
      final AccidentDamageMark mark = map.marks[index];
      if (mark.effectiveView != view) continue;
      AccidentDamageZone? legacyZone;
      if (!mark.hasExactPoint) {
        for (final AccidentDamageZone zone in kAccidentDamageZones) {
          if (zone.id == mark.zoneId) {
            legacyZone = zone;
            break;
          }
        }
      }
      final double? x = mark.normalizedX ??
          (legacyZone == null ? null : legacyZone.left + legacyZone.width / 2);
      final double? y = mark.normalizedY ??
          (legacyZone == null ? null : legacyZone.top + legacyZone.height / 2);
      if (x == null || y == null) continue;
      final TpStatus tone = switch (mark.severity) {
        AccidentDamageSeverity.minor => TpStatus.info,
        AccidentDamageSeverity.moderate => TpStatus.warning,
        AccidentDamageSeverity.severe => TpStatus.critical,
      };
      final TpStatusColors colors = palette.forStatus(tone);
      final Offset center = Offset(x * size.width, y * size.height);
      canvas.drawCircle(
        center,
        accidentDamageMarkerRadius + 2,
        Paint()..color = Colors.black.withValues(alpha: 0.16),
      );
      canvas.drawCircle(
        center,
        accidentDamageMarkerRadius,
        Paint()
          ..color = colors.base
          ..style = PaintingStyle.fill,
      );
      canvas.drawCircle(
        center,
        accidentDamageMarkerRadius,
        Paint()
          ..color = Colors.white
          ..style = PaintingStyle.stroke
          ..strokeWidth = 2,
      );
      final TextPainter number = TextPainter(
        text: TextSpan(
          text: '${index + 1}',
          style: const TextStyle(
            color: Colors.white,
            fontSize: 11,
            fontWeight: FontWeight.w800,
            height: 1,
          ),
        ),
        textDirection: TextDirection.ltr,
      )..layout();
      number.paint(
        canvas,
        center - Offset(number.width / 2, number.height / 2),
      );
    }
  }

  @override
  bool shouldRepaint(covariant _DamageZoneOverlayPainter oldDelegate) =>
      oldDelegate.view != view ||
      oldDelegate.map != map ||
      oldDelegate.palette != palette;
}
