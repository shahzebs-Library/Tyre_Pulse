/// Wires this feature's screens into the router's screen registry.
///
/// `app/router/screen_registry.dart` deliberately does not import any
/// feature, so the router can be built before feature screens exist - see
/// that file's own library comment. A feature contributes its screens by
/// exporting a map like this one; the composition root merges every
/// feature's map with [TpScreenRegistry.withAll] when it overrides
/// [screenRegistryProvider]. This file does neither of those things itself
/// - it only DECLARES the map scanning contributes, so wiring it in stays
/// the composition root's decision, not this feature's.
library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/scanning/presentation/scanner_screen.dart';

/// The screens this feature builds, keyed by [TpRoute.routeId].
///
/// Only [TpRouteId.scanner] today - this feature owns the scanner and its
/// domain resolution chain, nothing else. A resolved scan may navigate to
/// `VehiclesRoute`, `SerialSearchRoute` or `NewInspectionRoute`, but the
/// SCREENS behind those routes belong to their own features; until they
/// register themselves, the shared registry's own honest
/// [TpScreenNotAvailable] renders in their place, which is correct - not
/// something this feature should paper over with a placeholder of its own.
final Map<String, TpScreenBuilder> scanningScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.scanner: (BuildContext context, TpRoute route) =>
      const ScannerScreen(),
};
