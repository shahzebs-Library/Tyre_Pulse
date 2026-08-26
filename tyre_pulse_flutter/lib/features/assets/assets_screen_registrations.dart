/// Wires this feature's screens into the shared route registry.
///
/// `screen_registry.dart`'s own doc: "Lets each feature contribute its own
/// screens without one file having to import them all." The composition
/// root (a later phase - `main.dart` does not yet override
/// `screenRegistryProvider` at all, verified by reading it) is expected to
/// fold [assetsScreenRegistrations] into that provider alongside every other
/// feature's own map, via [TpScreenRegistry.withAll].
///
/// Only [TpRouteId.vehicles] is registered here. `routes.dart` declares no
/// `vehicleDetail` route id - see `vehicle_detail_screen.dart`'s library
/// comment for the full reasoning - so there is nothing to register that
/// screen under; it is reached by [VehiclesListScreen] pushing it directly.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/assets/presentation/vehicles_list_screen.dart';

/// Builds the fleet register list.
///
/// Reads the scanner-to-picker hand-off directly off the matched
/// [VehiclesRoute] - see `VehiclesListScreen`'s library comment for why that
/// field exists at all - and resolves the screen's back fallback from the
/// same table [TpScreenNotAvailable] uses, so every registered screen (built
/// here or elsewhere) agrees about where Back goes with no history.
Widget buildVehiclesListScreen(BuildContext context, TpRoute route) {
  final AssetNo? preselected = route is VehiclesRoute ? route.assetNo : null;
  return VehiclesListScreen(
    initialSearchTerm: preselected?.value,
    backFallback: TpBackFallbacks.forRoute(route),
  );
}

/// This feature's contribution to the shared screen registry.
final Map<String, TpScreenBuilder> assetsScreenRegistrations =
    <String, TpScreenBuilder>{TpRouteId.vehicles: buildVehiclesListScreen};
