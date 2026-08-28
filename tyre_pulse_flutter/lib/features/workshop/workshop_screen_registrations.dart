library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/workshop/presentation/workshop_screen.dart';

final Map<String, TpScreenBuilder> workshopScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.workshop: (BuildContext context, TpRoute route) =>
      const WorkshopScreen(),
};
