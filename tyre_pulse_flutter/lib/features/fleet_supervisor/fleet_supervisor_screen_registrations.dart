/// Every screen the Fleet Supervisor team feature contributes to the shared
/// screen registry. Driver detail and the charge form are pushed on top of the
/// list with Navigator, so only the list needs a route.
library;

import 'package:flutter/widgets.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/fleet_supervisor/presentation/my_drivers_screen.dart';

final Map<String, TpScreenBuilder> fleetSupervisorScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.myDrivers: _buildMyDrivers,
};

Widget _buildMyDrivers(BuildContext context, TpRoute route) {
  if (route is! MyDriversRoute) return TpScreenNotAvailable(route: route);
  return const MyDriversScreen();
}
