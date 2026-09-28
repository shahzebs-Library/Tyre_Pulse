/// Every screen the extras feature contributes to the shared screen registry.
///
/// Mirrors `features/home/home_screen_registrations.dart`'s shape. The route
/// ids, paths and guards already exist in `app/router/`; nothing there
/// changed for these screens to register:
/// - [TpRouteId.fleetAi] (`/ai`, `ModuleGuarded(RouteModule.ai)`)
/// - [TpRouteId.repairRequest] (`/repair-request`,
///   `ModuleGuarded(RouteModule.repairRequest)`)
///
/// `/register` is registered by `features/auth/auth_screen_registrations.dart`.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/extras/presentation/fleet_ai_screen.dart';
import 'package:tyre_pulse/features/extras/presentation/repair_request_screen.dart';

/// The routes this feature builds a screen for.
final Map<String, TpScreenBuilder> extrasScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.fleetAi: _buildFleetAi,
  TpRouteId.repairRequest: _buildRepairRequest,
};

Widget _buildFleetAi(BuildContext context, TpRoute route) {
  if (route is! FleetAiRoute) return TpScreenNotAvailable(route: route);
  return FleetAiScreen(route: route);
}

Widget _buildRepairRequest(BuildContext context, TpRoute route) {
  if (route is! RepairRequestRoute) return TpScreenNotAvailable(route: route);
  return RepairRequestScreen(route: route);
}
