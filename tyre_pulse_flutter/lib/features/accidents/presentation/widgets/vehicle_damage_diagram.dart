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
    this.readOnly = false,
    this.selectedZoneId,
    this.selectedAreaLabel,
    super.key,
  });

  final AccidentDamageView view;
  final AccidentDamageMap map;
  final ValueChanged<AccidentDamagePoint> onPointTap;
  final VehicleAsset? vehicle;
  final bool readOnly;
  final String? selectedZoneId;
  final String? selectedAreaLabel;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    final String? multiViewAsset =
        vehicle == null ? null : vehicleMultiViewAsset(vehicle!);
    final String? fallbackAsset =
        vehicle == null ? null : vehiclePhotoAsset(vehicle!);
    final _DamageViewFraming framing = _DamageViewFraming.forView(
      view,
      hasExactViewAsset: multiViewAsset != null,
    );

    return AspectRatio(
      aspectRatio: framing.aspectRatio,
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
                onTapUp: readOnly
                    ? null
                    : (TapUpDetails details) {
                        final Offset sourcePoint = framing.viewportToSource(
                          details.localPosition,
                          Size(constraints.maxWidth, constraints.maxHeight),
                        );
                        onPointTap(
                          AccidentDamagePoint(
                            view: view,
                            normalizedX: sourcePoint.dx,
                            normalizedY: sourcePoint.dy,
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
                      framing: framing,
                    ),
                    CustomPaint(
                      painter: _DamageZoneOverlayPainter(
                        view: view,
                        map: map,
                        palette: palette,
                        framing: framing,
                        selectedZoneId: selectedZoneId,
                      ),
                    ),
                    if (selectedAreaLabel != null)
                      PositionedDirectional(
                        start: 8,
                        end: 8,
                        bottom: 6,
                        child: IgnorePointer(
                          child: Center(
                            child: DecoratedBox(
                              key: const Key('accident.damage.selectedCallout'),
                              decoration: BoxDecoration(
                                color: palette.surface,
                                border: Border.all(color: palette.primary),
                                borderRadius: BorderRadius.circular(6),
                              ),
                              child: Padding(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: 8,
                                  vertical: 4,
                                ),
                                child: Text(
                                  selectedAreaLabel!,
                                  textAlign: TextAlign.center,
                                  style: Theme.of(context).textTheme.labelSmall,
                                ),
                              ),
                            ),
                          ),
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

/// Converts a stored source-image point to the pixel at which its marker is
/// painted. Exposed so focused tests can protect crop/marker alignment.
@visibleForTesting
Offset accidentDamageMarkerViewportPoint({
  required AccidentDamageView view,
  required Offset sourcePoint,
  required Size viewport,
  required bool hasExactViewAsset,
}) =>
    _DamageViewFraming.forView(
      view,
      hasExactViewAsset: hasExactViewAsset,
    ).sourceToViewport(sourcePoint, viewport);

/// Inverse of [accidentDamageMarkerViewportPoint], used for exact taps.
@visibleForTesting
Offset accidentDamageTapSourcePoint({
  required AccidentDamageView view,
  required Offset viewportPoint,
  required Size viewport,
  required bool hasExactViewAsset,
}) =>
    _DamageViewFraming.forView(
      view,
      hasExactViewAsset: hasExactViewAsset,
    ).viewportToSource(viewportPoint, viewport);

class _VehicleArtwork extends StatelessWidget {
  const _VehicleArtwork({
    required this.vehicle,
    required this.view,
    required this.multiViewAsset,
    required this.fallbackAsset,
    required this.framing,
  });

  final VehicleAsset? vehicle;
  final AccidentDamageView view;
  final String? multiViewAsset;
  final String? fallbackAsset;
  final _DamageViewFraming framing;

  @override
  Widget build(BuildContext context) {
    final TpPalette palette = TpPalette.of(context);
    if (vehicle != null && multiViewAsset != null) {
      return _ExactVehicleView(
        boardAssetPath: multiViewAsset!,
        view: view,
        fallbackIcon: vehicleFallbackIcon(vehicle!),
        fit: framing.imageFit,
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
    required this.fit,
  });

  final String boardAssetPath;
  final AccidentDamageView view;
  final IconData fallbackIcon;
  final BoxFit fit;

  @override
  Widget build(BuildContext context) {
    final String stem = boardAssetPath
        .replaceFirst('assets/vehicle_multiview/', '')
        .replaceFirst(RegExp(r'\.png$'), '');
    final String exactAsset =
        'assets/vehicle_multiview_views/${stem}_${view.name}.png';
    return Image.asset(
      exactAsset,
      key: Key('accident.damage.multiview.${view.name}'),
      fit: fit,
      alignment: Alignment.center,
      filterQuality: FilterQuality.high,
      errorBuilder: (_, __, ___) => _FallbackArtwork(icon: fallbackIcon),
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
    required this.framing,
    this.selectedZoneId,
  });

  final AccidentDamageView view;
  final AccidentDamageMap map;
  final TpPalette palette;
  final _DamageViewFraming framing;
  final String? selectedZoneId;

  @override
  void paint(Canvas canvas, Size size) {
    final List<AccidentDamageMark> marks = map.marks;
    for (int index = 0; index < marks.length; index++) {
      final AccidentDamageMark mark = marks[index];
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
      final Offset center = framing.sourceToViewport(Offset(x, y), size);
      if (!framing.isVisible(center, size)) continue;
      if (mark.zoneId == selectedZoneId) {
        canvas.drawCircle(
          center,
          accidentDamageMarkerRadius + 7,
          Paint()..color = colors.base.withValues(alpha: 0.22),
        );
      }
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
      oldDelegate.selectedZoneId != selectedZoneId ||
      oldDelegate.palette != palette ||
      oldDelegate.framing != framing;
}

/// All exact view images are audited 768x768 source canvases. Side views use
/// a 16:9 viewport with a centred `cover` crop so empty top/bottom board space
/// is removed. Stored points remain normalized to that square source canvas;
/// both hit testing and marker painting use this same transform.
@immutable
final class _DamageViewFraming {
  const _DamageViewFraming({
    required this.aspectRatio,
    required this.imageFit,
    required this.cropsSquareSource,
  });

  factory _DamageViewFraming.forView(
    AccidentDamageView view, {
    required bool hasExactViewAsset,
  }) {
    final bool isSide =
        view == AccidentDamageView.left || view == AccidentDamageView.right;
    if (hasExactViewAsset) {
      return _DamageViewFraming(
        aspectRatio: isSide ? 16 / 9 : 1,
        imageFit: isSide ? BoxFit.cover : BoxFit.contain,
        cropsSquareSource: isSide,
      );
    }
    return _DamageViewFraming(
      aspectRatio: view == AccidentDamageView.top || isSide ? 16 / 9 : 5 / 4,
      imageFit: BoxFit.contain,
      cropsSquareSource: false,
    );
  }

  final double aspectRatio;
  final BoxFit imageFit;
  final bool cropsSquareSource;

  Offset viewportToSource(Offset point, Size viewport) {
    if (!cropsSquareSource) {
      return Offset(
        (point.dx / viewport.width).clamp(0.0, 1.0),
        (point.dy / viewport.height).clamp(0.0, 1.0),
      );
    }
    final double cropY = (viewport.width - viewport.height) / 2;
    return Offset(
      (point.dx / viewport.width).clamp(0.0, 1.0),
      ((point.dy + cropY) / viewport.width).clamp(0.0, 1.0),
    );
  }

  Offset sourceToViewport(Offset point, Size viewport) {
    if (!cropsSquareSource) {
      return Offset(point.dx * viewport.width, point.dy * viewport.height);
    }
    final double cropY = (viewport.width - viewport.height) / 2;
    return Offset(
      point.dx * viewport.width,
      point.dy * viewport.width - cropY,
    );
  }

  bool isVisible(Offset point, Size viewport) =>
      point.dx >= 0 &&
      point.dx <= viewport.width &&
      point.dy >= 0 &&
      point.dy <= viewport.height;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is _DamageViewFraming &&
          other.aspectRatio == aspectRatio &&
          other.imageFit == imageFit &&
          other.cropsSquareSource == cropsSquareSource;

  @override
  int get hashCode => Object.hash(aspectRatio, imageFit, cropsSquareSource);
}
