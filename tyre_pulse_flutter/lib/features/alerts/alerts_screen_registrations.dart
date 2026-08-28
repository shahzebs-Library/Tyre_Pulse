library;

import 'package:flutter/material.dart';
import 'package:tyre_pulse/app/router/back_navigation.dart';
import 'package:tyre_pulse/app/router/routes.dart';
import 'package:tyre_pulse/app/router/screen_registry.dart';
import 'package:tyre_pulse/features/alerts/presentation/alerts_screen.dart';

final Map<String, TpScreenBuilder> alertsScreenRegistrations =
    <String, TpScreenBuilder>{
  TpRouteId.alerts: (BuildContext context, TpRoute route) => AlertsScreen(
        backFallback: TpBackFallbacks.forRoute(route),
      ),
};
