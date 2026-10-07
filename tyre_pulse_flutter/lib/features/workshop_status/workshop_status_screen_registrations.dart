library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/workshop_status/presentation/workshop_status_list_screen.dart';

final Map<String, TpScreenBuilder> workshopStatusScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.workshopStatus: (BuildContext context, TpRoute route) =>
      route is WorkshopStatusRoute
          ? WorkshopStatusListScreen(route: route)
          : TpScreenNotAvailable(route: route),
};
