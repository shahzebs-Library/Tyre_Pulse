/// Draws the real, per-vehicle-class body artwork behind the wheels.
///
/// PREVIOUSLY A GENUINE GAP, NOW CLOSED. This file used to draw a plain
/// rounded-rectangle silhouette per [TyreDiagramBodyKey], with a library
/// comment explaining that the production RN renderer
/// (`mobile/components/VehicleTyreDiagram.tsx`) draws each of the eight
/// bodies as elaborate hand-authored inline SVG - gradients, headlights,
/// glass reflections, drum spiral fins, a company wordmark - and that no
/// exported asset existed for this Flutter port to read.
///
/// That artwork has now been converted, body-for-body, into eight real
/// `.svg` files under `assets/vehicle_diagram/` - a faithful format
/// conversion (react-native-svg JSX -> standard SVG XML) of every path,
/// gradient stop and colour in `PickupBody()`, `CanterBody()`,
/// `TriMixerBody()`, `ConcretePumpBody()`, `WheelLoaderBody()`, `BusBody()`,
/// `TataBody()` and `AshokLeylandBody()`. Every [TyreDiagramBodyKey] value
/// has a matching asset - there is no silhouette fallback left to invoke.
///
/// Each asset's `viewBox` is `-10 -5 220 {viewH+10}`, matching
/// [kDiagramViewMinX]/[kDiagramViewMinY]/[kDiagramViewWidth] and the
/// layout's own `viewH` EXACTLY (see the asset files' own header comments
/// for the per-body numbers), so [TyreDiagramBody] can hand it straight to
/// [TyreDiagramViewport]'s own `width`/`height` and the body lands in
/// register with the wheels [TyreWheelPainter] draws in the same
/// [Stack] - both read the same [TyreDiagramViewport]. `fit: BoxFit.fill` is
/// deliberate rather than the widget's own `BoxFit.contain` default: several
/// layouts share one body (`canter` backs Canter, Truck 6x4, Tanker AND -
/// for lack of a dedicated trailer body - Trailer, at a shorter `viewH`),
/// and a non-uniform fill is what keeps a reused body exactly filling
/// whatever viewport its layout actually has, rather than being letterboxed
/// inside it.
///
/// DELIBERATELY NOT PORTED: the RN `Tyre` component's realistic 3D wheel
/// (rubber/rim/hub gradients keyed off a fixed `RISK` hex palette). Per
/// `tyre_condition.dart`'s own library comment, that palette was already a
/// considered exclusion in this port - a condition's colour must follow
/// this app's real light/dark theme (`TpPalette.forStatus`), not one
/// authored for a different app's fixed dark theme. [TyreWheelPainter] is
/// where the realistic tyre now lives instead, painted with `dart:ui`
/// gradients so its rim colour stays theme-driven while still carrying the
/// rubber body, directional tread blocks, lug-nut ring and hub-cap shine
/// the reference tyre has.
library;

import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';
import 'package:tyre_pulse/features/tyre_diagram/domain/tyre_slot.dart';
import 'package:tyre_pulse/features/tyre_diagram/presentation/tyre_diagram_geometry.dart';

/// The asset this [TyreDiagramBodyKey] renders. Every enum value is
/// covered - there is no silhouette/placeholder path left.
String tyreDiagramBodyAsset(TyreDiagramBodyKey bodyKey) {
  return switch (bodyKey) {
    TyreDiagramBodyKey.pickup => 'assets/vehicle_diagram/pickup.svg',
    TyreDiagramBodyKey.canter => 'assets/vehicle_diagram/canter.svg',
    TyreDiagramBodyKey.triMixer => 'assets/vehicle_diagram/tri_mixer.svg',
    TyreDiagramBodyKey.concretePump =>
      'assets/vehicle_diagram/concrete_pump.svg',
    TyreDiagramBodyKey.wheelLoader => 'assets/vehicle_diagram/wheel_loader.svg',
    TyreDiagramBodyKey.bus => 'assets/vehicle_diagram/bus.svg',
    TyreDiagramBodyKey.tata => 'assets/vehicle_diagram/tata.svg',
    TyreDiagramBodyKey.ashokLeyland =>
      'assets/vehicle_diagram/ashok_leyland.svg',
  };
}

/// Renders [bodyKey]'s real artwork, sized to exactly fill [viewport].
class TyreDiagramBody extends StatelessWidget {
  const TyreDiagramBody({
    required this.bodyKey,
    required this.viewport,
    super.key,
  });

  final TyreDiagramBodyKey bodyKey;
  final TyreDiagramViewport viewport;

  @override
  Widget build(BuildContext context) {
    return SvgPicture.asset(
      tyreDiagramBodyAsset(bodyKey),
      width: viewport.width,
      height: viewport.height,
      fit: BoxFit.fill,
      // The composite Stack this sits in already paints the app's own
      // surface underneath; a failed asset load should leave that surface
      // visible (no wheels are affected - they are a separate CustomPaint)
      // rather than throwing out of the whole diagram.
      placeholderBuilder: (BuildContext context) => const SizedBox.shrink(),
      errorBuilder: (BuildContext context, Object error, StackTrace? stack) =>
          const SizedBox.shrink(),
    );
  }
}
