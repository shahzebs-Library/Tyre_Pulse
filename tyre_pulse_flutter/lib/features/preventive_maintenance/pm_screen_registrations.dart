library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/preventive_maintenance/presentation/pm_screen.dart';

final Map<String, TpScreenBuilder> pmScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.preventiveMaintenance: (BuildContext context, TpRoute route) =>
      route is PreventiveMaintenanceRoute
          ? PreventiveMaintenanceScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
